// ═══════════════════════════════════════════════════════════
// Local test database server — https://localhost/sql
// ═══════════════════════════════════════════════════════════
//
//   npm run test:stack:db
//
// Runs the in-memory test database behind the same HTTPS endpoint shape the
// Neon driver expects, so the UNMODIFIED app can run against it (see
// run-next.mjs). Seeds one published record and a throwaway admin.
//
// Everything is in memory: stopping this process discards all data.
// Throwaway files (certificate, admin credentials) go to tests/local-stack/.tmp/
// which is git-ignored. Needs `openssl` on PATH the first time, and port 443 free.
// ═══════════════════════════════════════════════════════════

import https from "node:https";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { boot, ORIGIN } from "./boot";
import { handle, errorBody } from "./emulator";

const TMP = join(process.cwd(), "tests", "local-stack", ".tmp");
const KEY = join(TMP, "key.pem");
const CERT = join(TMP, "cert.pem");

function ensureCertificate(): void {
  mkdirSync(TMP, { recursive: true });
  if (existsSync(KEY) && existsSync(CERT)) return;
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
      "-keyout", KEY, "-out", CERT, "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-addext", "basicConstraints=critical,CA:TRUE",
    ],
    { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
  );
}

(async () => {
  ensureCertificate();
  const { pg, token, adminId } = await boot();
  const { hashPassword } = await import("@/lib/auth/password");

  // Throwaway admin for signing in through the real login form.
  const password = randomBytes(18).toString("base64url");
  await pg.query("UPDATE admins SET password_hash = $1 WHERE id = $2", [await hashPassword(password), adminId]);
  writeFileSync(join(TMP, "creds.json"), JSON.stringify({ username: "test-admin", password }, null, 2));

  // Seed one published record so static pages have CMS content at build time.
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const req = (method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}/api/admin/cms/records`, {
      method,
      headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const manual = (value: unknown) => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });

  let res = await records.POST(req("POST", {
    organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", govType: "Central Govt",
    title: "TEST SEED IBPS Clerk 2026", recruitmentYear: 2026,
  }));
  const seed = (await res.json()).record;
  let revision: string = seed.recordRevision;
  const edits: Array<[string, unknown]> = [
    ["dates.applicationOpenDate", "2026-10-01"],
    ["dates.applicationCloseDate", "2026-10-21"],
    ["vacancies.total", 1000],
    ["links", [
      { type: "OFFICIAL_NOTIFICATION", label: "Official Notification", url: "https://www.ibps.in/seed.pdf", official: true },
      { type: "OFFICIAL_WEBSITE", label: "Official Website", url: "https://www.ibps.in", official: true },
    ]],
  ];
  for (const [fieldPath, value] of edits) {
    res = await fields.PATCH(req("PATCH", { fieldPath, field: manual(value), clientRevision: revision }), ctx(seed.id));
    revision = (await res.json()).record.recordRevision;
  }
  await approve.POST(req("POST"), ctx(seed.id));
  await publish.POST(req("POST"), ctx(seed.id));

  const server = https.createServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }, (request, response) => {
    if (request.method !== "POST" || request.url !== "/sql") {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", async () => {
      try {
        const out = await handle(pg, JSON.parse(Buffer.concat(chunks).toString("utf8")));
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
      } catch (e) {
        response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify(errorBody(e)));
      }
    });
  });

  server.listen(443, "127.0.0.1", () => {
    console.log("Local test database ready on https://localhost/sql");
    console.log(`Seed record: /jobs/${seed.slug}`);
    console.log("Test admin: username test-admin, password in tests/local-stack/.tmp/creds.json");
    console.log("Next: npm run test:stack:app   (or test:stack:build, then test:stack:start)");
  });
})().catch((e) => {
  console.error("Local test database failed to start:", e);
  process.exit(1);
});
