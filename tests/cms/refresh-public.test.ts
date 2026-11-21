// Daily public-page refresh (Option A): authentication, the data check before anything is marked, the exact paths
// marked, and that the route reaches no unrelated service. No database, no network: dependencies are stand-ins.
//   npx tsx --tsconfig tsconfig.json tests/cms/refresh-public.test.ts
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { suite, test, assert } from "../intelligence/suite";
import { runPublicRefresh, cronAuthorised, REFRESH_TARGETS, type RefreshDeps } from "@/lib/public-refresh";

const SECRET = "test-secret-not-real";
const NOW = () => new Date("2026-11-18T19:05:00Z"); // 00:35 IST on 19 Nov
const deps = (over: Partial<RefreshDeps> = {}) => {
  const calls: Array<[string, string | undefined]> = []; const logs: string[] = [];
  const d: RefreshDeps = {
    secret: SECRET, authorization: `Bearer ${SECRET}`, countPublishedJobs: async () => 40,
    revalidate: (p, t) => { calls.push([p, t]); }, now: NOW, log: (l) => logs.push(l), ...over,
  };
  return { d, calls, logs };
};

suite("Refresh: who may call it");

test("RP-01 no CRON_SECRET configured → refused, nothing marked, data not read", async () => {
  let read = false;
  for (const secret of [undefined, "", "   "]) {
    const { d, calls } = deps({ secret, authorization: "Bearer ", countPublishedJobs: async () => { read = true; return 1; } });
    const r = await runPublicRefresh(d);
    assert.equal(r.status, 401); assert.equal(calls.length, 0);
  }
  assert.equal(read, false);
});

test("RP-02 missing, wrong, differently-cased or padded header → 401, nothing marked", async () => {
  for (const authorization of [null, "", SECRET, `bearer ${SECRET}`, `Bearer ${SECRET} `, `Bearer ${SECRET}x`, "Bearer wrong"]) {
    const { d, calls } = deps({ authorization });
    const r = await runPublicRefresh(d);
    assert.equal(r.status, 401, String(authorization)); assert.equal(calls.length, 0);
    assert.deepEqual(r.body, { refreshed: false, indiaDate: "2026-11-19", reason: "unauthorised" });
  }
  assert.equal(cronAuthorised(SECRET, `Bearer ${SECRET}`), true);
});

suite("Refresh: data check before marking");

test("RP-03 database read fails → 503 data-check-failed, nothing marked, error logged without the secret", async () => {
  const { d, calls, logs } = deps({ countPublishedJobs: async () => { throw new Error("fetch failed: connect ECONNREFUSED"); } });
  const r = await runPublicRefresh(d);
  assert.equal(r.status, 503); assert.equal(calls.length, 0);
  assert.deepEqual(r.body, { refreshed: false, indiaDate: "2026-11-19", reason: "data-check-failed" });
  assert.ok(logs.some((l) => l.includes("cached pages kept")));
  assert.ok(!logs.join(" ").includes(SECRET));
});

test("RP-04 the read finds no published job → 503 no-published-jobs, nothing marked (an empty result never replaces pages)", async () => {
  const { d, calls } = deps({ countPublishedJobs: async () => 0 });
  const r = await runPublicRefresh(d);
  assert.equal(r.status, 503); assert.equal(calls.length, 0);
  assert.equal(r.body.refreshed === false && r.body.reason, "no-published-jobs");
});

test("RP-05 marking throws → 500 revalidation-failed, reported truthfully", async () => {
  const { d } = deps({ revalidate: () => { throw new Error("Invariant: static generation store missing"); } });
  const r = await runPublicRefresh(d);
  assert.equal(r.status, 500); assert.equal(r.body.refreshed, false);
});

suite("Refresh: what is marked");

test("RP-06 success → exactly the two paths a publish marks, in order; truthful body; one log line", async () => {
  const { d, calls, logs } = deps();
  const r = await runPublicRefresh(d);
  assert.equal(r.status, 200);
  assert.deepEqual(calls, [["/", "layout"], ["/sitemap.xml", undefined]]);
  assert.deepEqual(r.body, { refreshed: true, indiaDate: "2026-11-19", publishedJobs: 40, paths: ["/", "/sitemap.xml"] });
  assert.equal(logs.length, 1); assert.ok(!logs[0].includes(SECRET));
  assert.deepEqual(REFRESH_TARGETS.map(([p, t]) => [p, t]), [["/", "layout"], ["/sitemap.xml", undefined]]);
});

test("RP-07 publish, take-down and put-back mark the same two paths (the refresh adds nothing new)", () => {
  for (const f of ["publish", "take-down", "put-back"]) {
    const src = readFileSync(join(process.cwd(), "src/app/api/admin/cms/records/[id]", f, "route.ts"), "utf8");
    assert.match(src, /revalidatePath\("\/", "layout"\)/, f); assert.match(src, /revalidatePath\("\/sitemap\.xml"\)/, f);
  }
});

test("RP-08 repeated authorised calls are harmless: each only marks the same paths again", async () => {
  const { d, calls } = deps();
  const rs = await Promise.all([runPublicRefresh(d), runPublicRefresh(d), runPublicRefresh(d)]);
  assert.ok(rs.every((r) => r.status === 200));
  assert.equal(calls.length, 6);
  assert.ok(calls.every(([p], i) => p === (i % 2 === 0 ? "/" : "/sitemap.xml")));
});

test("RP-09 India date is taken at the call (19:05 UTC on 18 Nov = 19 Nov in India)", async () => {
  const r = await runPublicRefresh(deps().d);
  assert.equal(r.body.indiaDate, "2026-11-19");
});

suite("Refresh: isolation from unrelated services");

// Every project module the route can load, following "@/..." and relative imports.
const SRC = join(process.cwd(), "src");
const resolveLocal = (from: string, spec: string): string | null => {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(c) && c.match(/\.tsx?$/)) return c;
  return null;
};
const graph = (entry: string) => {
  const seen = new Set<string>(); const pkgs = new Set<string>(); const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!; if (seen.has(f)) continue; seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:import|export)[^"'`]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] ?? m[2]; const local = resolveLocal(f, spec);
      if (local) stack.push(local); else if (!spec.startsWith(".") && !spec.startsWith("@/")) pkgs.add(spec);
    }
  }
  return { files: [...seen].map((f) => f.slice(SRC.length + 1).replace(/\\/g, "/")), pkgs: [...pkgs] };
};

test("RP-10 the route loads no Telegram, AI, discovery, importer, intelligence, publishing or write code", () => {
  const { files, pkgs } = graph(join(SRC, "app/api/cron/refresh-public/route.ts"));
  const banned = /telegram|gemini|\bai[-/]|ai-assist|discovery|importer|intelligence|record-ops|promoter|publish|announce|email|resend|upstash|redis/i;
  assert.deepEqual(files.filter((f) => banned.test(f)), [], `loaded: ${files.join(", ")}`);
  assert.deepEqual(pkgs.filter((p) => banned.test(p)), [], `packages: ${pkgs.join(", ")}`);
  assert.ok(files.includes("lib/cms/public-repository.ts") && files.includes("lib/public-refresh.ts"));
});

test("RP-11 the route's code issues no INSERT, UPDATE, DELETE or other write statement", () => {
  const { files } = graph(join(SRC, "app/api/cron/refresh-public/route.ts"));
  for (const f of files) {
    const src = readFileSync(join(SRC, f), "utf8");
    assert.doesNotMatch(src, /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE)\b/i, f);
  }
});

test("RP-12 the existing attention cron is untouched and independent (own route, own schedule)", () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.deepEqual(vercel.crons, [{ path: "/api/cron/attention", schedule: "30 2 * * *" }]);
  const att = graph(join(SRC, "app/api/cron/attention/route.ts")).files;
  assert.ok(!att.includes("lib/public-refresh.ts"));
});
