// ═══════════════════════════════════════════════════════════
// Syllabus library through the REAL route handler and repository,
// against the in-memory test database. Never touches production.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/syllabus-library.test.ts
//
// Covers: session and origin checks, add, list, read one, replace for the
// same exam, refusals with a plain reason, and that no record is touched.
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

const BODY = `SOURCE
Basis: OFFICIAL NOTICE (2026)

EXAM PATTERN

Paper: Tier-I
Subjects:
General Awareness | 25 | 50

SYLLABUS

Subject: General Awareness
Topics:
History
Geography
`;
const FILE = `LIBRARY\nExam: SSC CHSL\nMatch: ssc chsl; combined higher secondary\n\n${BODY}`;

(async () => {
  const { pg, token, adminId } = await boot();
  const library = await import("@/app/api/admin/cms/syllabus-library/route");
  const { suggestFromLibrary, stripLibraryBlock } = await import("@/lib/cms/syllabus-library");
  const { parseContentFile } = await import("@/lib/cms/content-import");

  const PATH = "/api/admin/cms/syllabus-library";
  const req = (query: string, method: string, body?: unknown, opts: { auth?: boolean; origin?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", origin: opts.origin ?? ORIGIN };
    if (opts.auth !== false) headers.cookie = `admin_sid=${token}`;
    return new NextRequest(`${ORIGIN}${PATH}${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  };
  const recordCount = async () => ((await pg.query("SELECT count(*)::int AS n FROM recruitments")).rows[0] as { n: number }).n;
  const recordsBefore = await recordCount();

  section("Session and origin protection");
  let r = await library.GET(req("", "GET", undefined, { auth: false }));
  check("list without a session → 401", r.status === 401, r.status);
  r = await library.POST(req("", "POST", { text: FILE }, { auth: false }));
  check("add without a session → 401", r.status === 401, r.status);
  r = await library.POST(req("", "POST", { text: FILE }, { origin: "https://evil.example" }));
  check("add from a foreign origin → 403", r.status === 403, r.status);

  section("Empty library");
  r = await library.GET(req("", "GET"));
  let d = await r.json();
  check("list → 200, no entries, set up", r.status === 200 && d.entries.length === 0 && !d.notSetUp, d);

  section("Add a file");
  r = await library.POST(req("", "POST", { text: FILE }));
  d = await r.json();
  check("add → 200, not a replacement", r.status === 200 && d.replaced === false, d);
  check("entry carries exam, match words and stated source", d.entry?.exam === "SSC CHSL" && d.entry.match.join("|") === "ssc chsl|combined higher secondary" && d.entry.basis === "OFFICIAL NOTICE (2026)", d.entry);
  const id: string = d.entry.id;
  const row = (await pg.query("SELECT updated_by FROM syllabus_library WHERE id = $1", [id])).rows[0] as { updated_by: string };
  check("the admin who added it is recorded", row.updated_by === adminId, row);

  r = await library.GET(req("", "GET"));
  d = await r.json();
  check("list shows it, without the file content", d.entries.length === 1 && !("content" in d.entries[0]), d.entries);
  check("it is offered on a matching job title only", suggestFromLibrary(d.entries, ["SSC CHSL Examination 2027"]).length === 1 && suggestFromLibrary(d.entries, ["SSC CGL 2027"]).length === 0);

  r = await library.GET(req(`?id=${id}`, "GET"));
  d = await r.json();
  check("read one → the file as pasted", r.status === 200 && d.entry.content === FILE, d);
  const read = parseContentFile(stripLibraryBlock(d.entry.content));
  check("what the paste box reads from it: 1 paper, 1 subject, 2 topics", read.examPattern.length === 1 && read.syllabus.length === 1 && read.syllabus[0].topics.length === 2, read);

  r = await library.GET(req("?id=not-a-uuid", "GET"));
  check("read with a bad id → 404", r.status === 404, r.status);
  r = await library.GET(req("?id=00000000-0000-4000-8000-000000000000", "GET"));
  check("read an unknown id → 404", r.status === 404, r.status);

  section("Replace the file for the same exam");
  r = await library.POST(req("", "POST", { text: FILE.replace("Exam: SSC CHSL", "Exam: ssc  chsl").replace("History", "Ancient History") }));
  d = await r.json();
  check("same exam, written differently → replaces, same entry", r.status === 200 && d.replaced === true && d.entry.id === id, d);
  const n = ((await pg.query("SELECT count(*)::int AS n FROM syllabus_library")).rows[0] as { n: number }).n;
  check("still exactly one entry", n === 1, n);
  r = await library.GET(req(`?id=${id}`, "GET"));
  d = await r.json();
  check("the newer content is kept", d.entry.content.includes("Ancient History"), d.entry.content);

  section("Refusals");
  r = await library.POST(req("", "POST", { text: BODY }));
  d = await r.json();
  check("no LIBRARY block → 400 with a plain reason", r.status === 400 && /“Exam:” line/.test(d.error), d);
  r = await library.POST(req("", "POST", { text: `LIBRARY\nExam: IBPS PO\nMatch: po\n\n${BODY}` }));
  d = await r.json();
  check("match word too short → 400", r.status === 400 && /too short/.test(d.error), d);
  r = await library.POST(req("", "POST", { text: "   " }));
  check("empty text → 400", r.status === 400, r.status);
  r = await library.POST(req("", "POST", { text: 42 }));
  check("text that is not text → 400", r.status === 400, r.status);
  r = await library.POST(req("", "POST", { text: `${FILE}\n${"x".repeat(200_001)}` }));
  check("over-long file → 400", r.status === 400, r.status);

  section("Nothing else changed");
  check("no recruitment record was created or removed", (await recordCount()) === recordsBefore, await recordCount());

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
