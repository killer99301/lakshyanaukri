// ═══════════════════════════════════════════════════════════
// A job's syllabus going into the library by itself, through the REAL route
// handlers and repository, against the in-memory test database. Never
// touches production.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/library-autosave.test.ts
//
// Covers: a first save adds an unapproved entry; a later save on the same job
// refreshes it; approving makes it the admin's, after which the job no longer
// changes it; a job already covered by a hand-kept entry adds nothing; and
// the next year's job is offered the entry.
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";

(async () => {
  const { token } = await boot();
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const library = await import("@/app/api/admin/cms/syllabus-library/route");
  const { suggestFromLibrary } = await import("@/lib/cms/syllabus-library");
  const { parseContentFile } = await import("@/lib/cms/content-import");
  const { approvedBasis, isUnapproved, withBasis } = await import("@/lib/cms/library-from-job");
  type Entry = import("@/lib/cms/syllabus-library").LibraryEntrySummary;

  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const create = async (title: string, year = 2026) => {
    const r = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: "tnpsc", organizationName: "Tamil Nadu Public Service Commission", govType: "State Govt", title, recruitmentYear: year, forceCreate: true }));
    const d = await r.json();
    return { id: d.record.id as string, rev: d.record.recordRevision as string };
  };
  const save = async (job: { id: string; rev: string }, fieldPath: string, value: unknown) => {
    const r = await fields.PATCH(req(`/api/admin/cms/records/${job.id}/fields`, "PATCH", {
      fieldPath, field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: job.rev, reason: "test",
    }), ctx(job.id));
    const d = await r.json();
    if (r.status === 200) job.rev = d.record.recordRevision;
    return { status: r.status, library: d.library as { exam: string; refreshed: boolean } | undefined, error: d.error };
  };
  const list = async () => ((await (await library.GET(req("/api/admin/cms/syllabus-library", "GET"))).json()).entries ?? []) as Entry[];
  const content = async (id: string) => (await (await library.GET(req(`/api/admin/cms/syllabus-library?id=${id}`, "GET"))).json()).entry.content as string;

  const ONE = [{ subject: "General Studies", topics: ["General Science", "Current Events"] }];
  const TWO = [...ONE, { subject: "Aptitude", topics: ["Percentage", "Ratio"] }];
  const PAPER = [{ name: "Paper I", durationMinutes: 180, totalMarks: 300, sections: [{ subject: "General Studies", questions: 100, marks: 150 }] }];

  section("A syllabus for an exam the library does not have");
  const job = await create("TEST RECORD TNPSC Group IV Recruitment 2026 (Notification No. 11/2026)");
  let out = await save(job, "dates.applicationCloseDate", "2026-11-05");
  check("saving some other field adds nothing to the library", out.status === 200 && out.library === undefined && (await list()).length === 0, out);
  out = await save(job, "syllabus", ONE);
  let entries = await list();
  check("the save says the syllabus was also kept in the library", out.status === 200 && out.library?.exam === "TEST RECORD TNPSC Group IV" && out.library.refreshed === false, out);
  check("one entry, marked as saved automatically and not checked", entries.length === 1 && isUnapproved(entries[0].basis) && /Not checked against the official notice/.test(entries[0].basis ?? ""), entries);
  check("it holds the job's syllabus", JSON.stringify(parseContentFile(await content(entries[0].id)).syllabus) === JSON.stringify(ONE));

  section("The same job saves again");
  out = await save(job, "examPattern", PAPER);
  check("adding the exam pattern refreshes the entry", out.library?.refreshed === true && (await list()).length === 1, out);
  out = await save(job, "syllabus", TWO);
  entries = await list();
  const read = parseContentFile(await content(entries[0].id));
  check("the entry now holds the pattern and the longer syllabus", read.examPattern.length === 1 && read.examPattern[0].durationMinutes === 180 && read.syllabus.length === 2, read);

  section("Next year's job");
  check("it is offered the entry", suggestFromLibrary(entries, ["TEST RECORD TNPSC Group IV Recruitment 2027 (Notification No. 04/2027)"]).length === 1);
  check("a different exam of the same body is not", suggestFromLibrary(entries, ["TEST RECORD TNPSC Group II Recruitment 2027"]).length === 0);

  section("Once approved, the entry is the admin's");
  const approved = withBasis(await content(entries[0].id), approvedBasis("13 Oct 2026", entries[0].basis));
  const r = await library.POST(req("/api/admin/cms/syllabus-library", "POST", { text: approved }));
  entries = await list();
  check("approved: still one entry, no longer marked unchecked", r.status === 200 && entries.length === 1 && !isUnapproved(entries[0].basis) && /^Approved on 13 Oct 2026/.test(entries[0].basis ?? ""), entries);
  out = await save(job, "syllabus", ONE);
  check("a later save on the job no longer changes it", out.status === 200 && out.library === undefined && parseContentFile(await content(entries[0].id)).syllabus.length === 2, out);

  const next = await create("TEST RECORD TNPSC Group IV Recruitment 2027", 2027);
  out = await save(next, "syllabus", [{ subject: "Brand new subject", topics: ["A topic"] }]);
  entries = await list();
  check("next year's job, already covered by the approved entry, adds nothing", out.library === undefined && entries.length === 1 && parseContentFile(await content(entries[0].id)).syllabus.length === 2, entries);

  section("A title that names no exam");
  const vague = await create("Recruitment 2026", 2025);
  out = await save(vague, "syllabus", ONE);
  check("the syllabus is saved, and the library is left alone", out.status === 200 && out.library === undefined && (await list()).length === 1, out);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
