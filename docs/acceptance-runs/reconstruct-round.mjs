// A round against the required checks the suites declare (run: node docs/acceptance-runs/reconstruct-round.mjs 1|2): from each saved log, which required checks ran,
// passed or failed, and which did not run. No AI, no re-run: the logs only.
import { readFileSync } from "node:fs";

const SUITES = new URL("../../tests/local-stack/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const S = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DIR = { 1: "round1-2026-10-29", 2: "round2-2026-10-31" };

// The declarations, read from the suites' own source.
const src = (f) => readFileSync(SUITES + f, "utf8");
const gemini = (() => {
  const s = src("importer-gemini.acceptance.ts");
  const body = s.slice(s.indexOf("const REQUIRED"), s.indexOf("for (const [s, names] of Object.entries(REQUIRED))"));
  return Function(`${body.replace("const REQUIRED: Record<string, string[]> =", "return")}`)();
})();
const LIC = (name, scanned) => [
  `${name}: 181 cities, each with its figure and page as a person read them`, `${name}: Ananthapur 1`, `${name}: Total Vacancies 232, complete`,
  `${name}: Table E rows on scanned pages (${scanned.join(", ")}) marked as read from the image by AI, and only those`,
  `${name}: the page images of Table E's scanned pages are there to compare`, `${name}: one table, nothing left unread in it, the reading complete`,
];
const scans = {
  "lic-scan": LIC("lic-scan", [5, 6, 7, 8, 9]), "lic-text-then-scan": LIC("lic-text-then-scan", [8, 9]), "lic-scan-then-text": LIC("lic-scan-then-text", [6, 7]),
  "lic-mixed": [...LIC("lic-mixed", [5, 6, 7, 8, 9]), "lic-mixed: values from the text pages are not marked as AI-read from an image"],
  "tg-page23": ["tg-page23: posts 14, 15, 16 with totals 1, 26, 2", "tg-page23: every category cell as printed (a person's reading)", "tg-page23: every row marked as read from the image by AI"],
};
if (!src("importer-scans.acceptance.ts").includes("const LIC_CHECKS")) throw new Error("scans suite changed: update this script");
const b26 = (() => {
  const s = src("importer-b26.acceptance.ts");
  const out = {};
  for (const m of s.matchAll(/expectChecks\("([^"]+)", (\[[\s\S]*?\])\);/g)) out[m[1]] = Function(`return ${m[2]}`)();
  return out;
})();

// Checks that do not apply when the saved result shows it: lic-scan.pdf is pages 1-5 and prints no vacancy table.
const licScanHasNoTable = (log) => {
  if (!/gemini\.log$/.test(log)) return null;
  const json = JSON.parse(readFileSync(`${S}${log.replace(".log", "")}/lic-scan.json`, "utf8"));
  return json.items.some((i) => i.fieldPath === "vacancies.table") ? null : "lic-scan.pdf is pages 1-5 and the saved result has no vacancy table";
};
const NOT_APPLICABLE = {
  "lic-scan\u0000scan: no separate total or breakdown is ticked against the table": licScanHasNoTable,
  "lic-scan\u0000scan table: every row's line is in the AI's write-up": licScanHasNoTable,
};

function report(title, required, log) {
  const lines = readFileSync(S + log, "utf8").split(/\r?\n/);
  let sec = "";
  const ran = new Map();
  for (const l of lines) {
    const h = /^── (.*)$/.exec(l);
    if (h) { sec = h[1]; continue; }
    const c = /^\s+(PASS|FAIL) {2}(.*?)(?: — .*)?$/.exec(l);
    if (c) ran.set(`${sec}\u0000${c[2]}`, c[1]);
    // From round 2 the harness writes "N/A" with its reason for a check that does not apply.
    const na = /^\s+N\/A {3}(.*?) — (.*)$/.exec(l);
    if (na) ran.set(`${sec}\u0000${na[1]}`, `N/A: ${na[2]}`);
  }
  // Round 1 predates the N/A lines: a check is not applicable there only when its saved result proves it.
  for (const [key, rule] of Object.entries(NOT_APPLICABLE)) {
    if (ran.has(key)) continue;
    const reason = rule(log);
    if (reason) ran.set(key, `N/A (from the saved result): ${reason}`);
  }
  let n = 0, pass = 0, fail = 0;
  const notRun = [], notApplicable = [];
  for (const [s, names] of Object.entries(required)) for (const name of names) {
    n++;
    const r = ran.get(`${s}\u0000${name}`);
    if (r === "PASS") pass++; else if (r === "FAIL") fail++; else if (r?.startsWith("N/A")) notApplicable.push(`[${s}] ${name} — ${r}`); else notRun.push(`[${s}] ${name}`);
  }
  const extra = [...ran.keys()].filter((k) => { const [s, name] = k.split("\u0000"); return !(required[s] ?? []).includes(name); }).map((k) => `${k.replace("\u0000", "] ")} = ${ran.get(k)}`);
  console.log(`\n${title} (${log}): required ${n}; passed ${pass}, failed ${fail}, not run ${notRun.length}, not applicable ${notApplicable.length} -> ${fail ? "FAILURES" : notRun.length ? "INCOMPLETE" : "ALL PASS"}`);
  for (const x of notApplicable) console.log(`  not applicable ${x}`);
  for (const x of notRun) console.log(`  NOT RUN ${x}`);
  for (const x of extra) console.log(`  also ran (not required): [${x}`);
}
const round = process.argv[2] ?? "1";
report("IBPS/LIC/BTSC", gemini, `${DIR[round]}/gemini.log`);
report("Scans", scans, `${DIR[round]}/scans.log`);
report("B2.6 (ssc, upsc, bpsc)", b26, `${DIR[round]}/b26.log`);
