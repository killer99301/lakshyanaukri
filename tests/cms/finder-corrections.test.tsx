// Listing finder corrections, from the supervised SarkariResult test (10 Nov 2026): dates from a link's own row,
// no cross-organisation suggestions, applications apart from "in the CMS", and organisations the CMS knows.
// Offline: a constructed fixture with the titles and addresses that test returned; no network, no AI.

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { discoverFromPage, labelledLastDate, firstDate, cmsOrganisationIn, type FoundJob } from "@/lib/cms/importer/discover";
import { matchLead, titleNamesBody, normaliseExamWording } from "@/lib/cms/discovery/match";
import { extractLinks } from "@/intelligence/discovery";
import { applicationsLine, splitMaybe, FoundRow } from "@/app/admin/cms/import/DiscoverPanel";
import type { FetchedSource } from "@/lib/cms/importer/fetch-source";

const HTML = fs.readFileSync(path.join(__dirname, "../fixtures/discovery/sarkariresult-latest-2026-11-10.html"), "utf8");
const page = (url: string, body: string, type = "text/html"): FetchedSource => ({ ok: true, finalUrl: url, contentType: type, bytes: Buffer.from(body) });

// The CMS jobs the 10 Nov test matched against, by their titles then. The organisation IDs follow the CMS's
// kebab-case IDs; rrc-nwr and delhi-university are assumptions (the test showed only that they are not rrb's).
const JOBS = [
  { id: "rrb-g26", organizationId: "rrb", organizationName: "Railway Recruitment Boards", title: "RRB NTPC Graduate Level Recruitment 2026 (CEN 06/2026)", notificationNumber: "CEN 06/2026", year: 2026 },
  { id: "rrb-g25", organizationId: "rrb", organizationName: "Railway Recruitment Boards", title: "RRB NTPC Graduate Level Recruitment (CEN 06/2025)", notificationNumber: "CEN 06/2025", year: 2026 },
  { id: "rrb-ug26", organizationId: "rrb", organizationName: "Railway Recruitment Boards", title: "RRB NTPC Undergraduate Level Recruitment 2026 (CEN 07/2026)", notificationNumber: "CEN 07/2026", year: 2026 },
  { id: "rrb-sm", organizationId: "rrb", organizationName: "Railway Recruitment Boards", title: "RRB Station Master Recruitment 2026", notificationNumber: null, year: 2026 },
  { id: "canara", organizationId: "canara-bank", organizationName: "Canara Bank", title: "Canara Bank Graduate Apprentice Recruitment 2026", notificationNumber: null, year: 2026 },
  { id: "du", organizationId: "delhi-university", organizationName: "University of Delhi", title: "Delhi University Non-Teaching Recruitment 2026", notificationNumber: null, year: 2026 },
  { id: "lichfl", organizationId: "lic-hfl", organizationName: "LIC Housing Finance Limited", title: "LIC HFL Apprentice Recruitment 2026 Notification Out – Apply Online for 232 Posts", notificationNumber: null, year: 2026 },
  { id: "nwr", organizationId: "rrc-nwr", organizationName: "RRC North Western Railway", title: "RRC NWR Jaipur Apprentice Recruitment 2026 (Notice No. 04/2026)", notificationNumber: "04/2026", year: 2026 },
  { id: "bpsc", organizationId: "bpsc", organizationName: "Bihar Public Service Commission", title: "BPSC TRE 4.0 School Teacher Recruitment 2026 (Advt. No. 15/2026)", notificationNumber: "15/2026", year: 2026 },
  { id: "mpesb", organizationId: "mp-esb", organizationName: "MP Employee Selection Board", title: "MPESB MP Police Constable Driver Recruitment 2026 - Apply Online for 1000 Posts", notificationNumber: null, year: 2026 },
];

let found: FoundJob[] = [];
const byUrl = (part: string) => {
  const f = found.find((x) => x.url.includes(part));
  if (!f) throw new Error(`no listing for ${part}`);
  return f;
};

async function run(jobs = JOBS, today = "2026-11-10") {
  const fetched: string[] = [];
  const out = await discoverFromPage({
    url: "https://www.sarkariresult.com/latestjob.php", jobs, today,
    fetchSourceFn: async (u) => { fetched.push(u); return u.endsWith("robots.txt") ? page(u, "User-agent: *\nDisallow: /wp-admin/", "text/plain") : page("https://www.sarkariresult.com/latestjob/", HTML); },
  });
  if (!out.ok) throw new Error(out.error);
  return { found: out.found, fetched };
}

// One read of the fixture page, shared by the tests below (the runner does not wait between async tests).
const READY = run().then((r) => { found = r.found; return r; });

suite("Dates from a link's own row");
test("FC01 each listing keeps its own last date, never the row above's", async () => {
  const r = await READY;
  assert.deepEqual(r.fetched, ["https://www.sarkariresult.com/robots.txt", "https://www.sarkariresult.com/latestjob.php"], "one page, nothing followed");
  assert.equal(found.length, 20, "every row is a listing");
  assert.equal(byUrl("upessc-up-primary").lastDate, "2026-11-11");
  assert.equal(byUrl("hcl-apprentice").lastDate, "2026-11-24", "was 2026-11-11, the UPESSC row's");
  assert.equal(byUrl("bhu-non-teaching").lastDate, "2026-11-25", "was 2026-12-06, the Bihar Vidhan Sabha row's");
  assert.equal(byUrl("indian-bank-apprentice").lastDate, "2026-11-25");
  assert.equal(byUrl("nicl-apprentice").lastDate, "2026-11-18");
  assert.equal(byUrl("rrb-ntpc-graduate-cen-06").lastDate, "2026-11-08", "'Last Date 08/11/2026' without a colon");
  for (const f of found) assert.equal(f.date, f.lastDate, `${f.title}: the shown date is its own last date`);
});
test("FC02 'Last Date : District Wise' is no date, not the next row's", async () => {
  await READY;
  const f = byUrl("up-anganwadi-helper");
  assert.equal(f.lastDate, undefined);
  assert.equal(f.date, undefined);
  assert.equal(f.applications, "UNKNOWN");
});
test("FC03 the label reader: a date straight after 'Last Date' only", async () => {
  await READY;
  assert.equal(labelledLastDate("X Online Form 2026 | Last Date : 13/11/2026"), "2026-11-13");
  assert.equal(labelledLastDate("X Last Date Extended to 20/11/2026"), "2026-11-20");
  assert.equal(labelledLastDate("X Last Date Extended Till 5 December 2026"), "2026-12-05");
  assert.equal(labelledLastDate("X | Last Date : District Wise, posted 05/11/2026"), undefined);
  assert.equal(labelledLastDate("X Last Date Extended To 31 October"), undefined, "no year: not a date");
  assert.equal(labelledLastDate("X Online Form 2026"), undefined);
  assert.equal(firstDate("31/02/2026 then 01/03/2026"), "2026-03-01", "an impossible date is skipped");
});
test("FC04 an unlabelled date after the link in its row is kept as a date shown, not a last date; one before the link is never taken", async () => {
  await READY;
  const html = `<ul><li><a href="/a/">Alpha Board Recruitment 2026 Online Form</a> 15/10/2026</li><li>Posted 01/09/2026 <a href="/b/">Beta Board Recruitment 2026 Online Form</a></li></ul>`;
  const [a, b] = extractLinks(html, "https://p.example/");
  assert.equal(a.after, "15/10/2026");
  assert.equal(b.after, undefined, "nothing after the second link in its row");
  assert.equal(b.nearbyDate, "2026-10-15", "the older readers' window still reaches the row above (left unchanged for them)");
});

suite("Applications apart from 'in the CMS'");
test("FC05 a passed last date says so; today's last date is still open; none given is unknown", async () => {
  await READY;
  assert.equal(byUrl("rrb-ntpc-graduate-cen-06").applications, "LAST_DATE_PASSED");
  assert.equal(byUrl("icsil-deo").applications, "LAST_DATE_PASSED");
  assert.equal(byUrl("bpsc-tre-4").applications, "LAST_DATE_PASSED");
  assert.equal(byUrl("up-ecce-educator-kanpur").applications, "OPEN", "last date 10/11 on 10 Nov: still open");
  assert.equal(byUrl("indian-bank-apprentice").applications, "OPEN");
  const passed = applicationsLine(byUrl("icsil-deo"));
  assert.equal(passed.tone, "warn");
  assert.match(passed.text, /^Last date 18 Oct 2026 has passed — closed unless it was extended; check the official site$/);
  assert.equal(applicationsLine(byUrl("indian-bank-apprentice")).text, "Last date 25 Nov 2026 (as the portal gives it)");
  assert.equal(applicationsLine({ applications: "UNKNOWN" }).text, "No last date given");
});
test("FC06 the panel shows 'Recruitment' (not 'New'), the applications line and 'Not in the CMS' apart", async () => {
  await READY;
  const f = byUrl("icsil-deo");
  const html = renderToStaticMarkup(<FoundRow f={f} onPick={() => {}} />);
  assert.ok(!/>New</.test(html), "no 'New' badge");
  assert.match(html, />Recruitment</);
  assert.match(html, /data-found-applications="LAST_DATE_PASSED"/);
  assert.match(html, /Not in the CMS: no job like it/);
});

suite("No cross-organisation suggestions");
test("FC07 NICL Graduate Apprentice is not suggested as Canara Bank's; Dr RMLIMS is not Delhi University's", async () => {
  await READY;
  const nicl = byUrl("nicl-apprentice");
  assert.deepEqual(nicl.maybe, [], "was POSSIBLE: Canara Bank Graduate Apprentice");
  assert.equal(nicl.organizationName, "National Insurance Company Limited");
  assert.equal(nicl.organizationId, undefined, "a name to read; no ID made up");
  assert.match(nicl.matchReason ?? "", /National Insurance Company Limited has no job in the CMS yet/);
  assert.deepEqual(byUrl("drrmlims").maybe, [], "was POSSIBLE: Delhi University Non-Teaching");
});
test("FC08 a body's own job is still suggested when the title names it, recognised or not", async () => {
  await READY;
  const lead = { organizationId: null, title: "Canara Bank Graduate Apprentice Online Form 2026", notificationNumber: null };
  assert.deepEqual(matchLead(lead, JOBS.filter((j) => j.id === "canara")).candidates.map((c) => c.id), ["canara"]);
  assert.equal(titleNamesBody("Indian Bank Apprentice Online Form 2026", "indian-bank", "Indian Bank"), true, "a body named only in common words needs them all");
  assert.equal(titleNamesBody("Indian Overseas Bank Apprentice 2026", "indian-bank", "Indian Bank"), true, "both words appear (the exam words still decide)");
  assert.equal(titleNamesBody("Punjab National Bank Apprentice 2026", "indian-bank", "Indian Bank"), false);
  assert.equal(titleNamesBody("MPESB MP Police Constable Driver 2026", "mp-esb", null), true, "the ID run together");
});
test("FC09 RRB NTPC Graduate CEN 06/2026: already in the CMS by notice number; CEN 06/2025 is apart, not 'already in the CMS'", async () => {
  await READY;
  const f = byUrl("rrb-ntpc-graduate-cen-06");
  assert.equal(f.match, "DUPLICATE");
  const { headline, alike } = splitMaybe(f);
  assert.deepEqual(headline.map((m) => m.id), ["rrb-g26"], "only the same notice heads it");
  assert.ok(!f.maybe.some((m) => m.id === "rrb-g25"), "was STRONG: a different notice number");
  assert.ok((f.differentNotice ?? []).some((m) => m.id === "rrb-g25"));
  assert.ok(alike.every((m) => m.kind !== "DUPLICATE"));
});
test("FC10 RRB NTPC 10+2 Under Graduate is the Undergraduate CEN 07/2026 job, not the Graduate ones", async () => {
  await READY;
  const f = byUrl("rrb-ntpc-ug-cen-07");
  assert.equal(f.match, "STRONG", "was POSSIBLE between the two Graduate jobs");
  assert.deepEqual(splitMaybe(f).headline.map((m) => m.id), ["rrb-ug26"]);
  assert.equal(normaliseExamWording("Railway RRB NTPC 10+2 Under Graduate Online Form 2026 | Last Date : 13/11/2026"), "Railway RRB NTPC Undergraduate Online Form 2026");
});

suite("Organisations the CMS knows");
test("FC11 LIC HFL is the CMS's lic-hfl, not LIC; NWR RRC Jaipur is the CMS's RRC NWR; MPESB is mp-esb", async () => {
  await READY;
  const lic = byUrl("lic-hfl-apprentice");
  assert.equal(lic.organizationId, "lic-hfl", "was lic (Life Insurance Corporation of India)");
  assert.equal(lic.match, "STRONG", "was POSSIBLE: 'another organisation's'");
  const nwr = byUrl("nwr-rrc-jaipur");
  assert.equal(nwr.organizationId, "rrc-nwr");
  assert.equal(nwr.match, "STRONG");
  assert.equal(byUrl("mpesb-police").organizationId, "mp-esb");
  assert.equal(byUrl("mpesb-police").match, "STRONG");
  assert.equal(byUrl("bpsc-tre-4").match, "STRONG");
  assert.equal(byUrl("rrb-station-master").match, "STRONG");
});
test("FC12 common bodies get a readable name; ambiguous ones and ties are not guessed", async () => {
  await READY;
  assert.equal(byUrl("indian-bank-apprentice").organizationName, "Indian Bank");
  assert.equal(byUrl("hcl-apprentice").organizationName, "Hindustan Copper Limited");
  assert.equal(byUrl("bhu-non-teaching").organizationName, "Banaras Hindu University");
  assert.equal(byUrl("dsssb-district").organizationName, "Delhi Subordinate Services Selection Board", "not Delhi University");
  assert.equal(byUrl("bihar-vidhan-sabha").organizationName, undefined, "not a listed body: left unrecognised");
  // Was 7 of 60 on the live page. Left unrecognised here: bodies with no unmistakable name in the list.
  assert.deepEqual(found.filter((f) => !f.organizationName).map((f) => f.title.split(" Online")[0].split(" |")[0]),
    ["Bihar Vidhan Sabha JSA and Office Attendant Post", "NTA CSIR UGC NET December 2026", "UP Anganwadi Helper", "UP ECCE Educator Kanpur Nagar", "Dr. RMLIMS Non Teaching Various Post", "ICSIL Data Entry Operator DEO Post"]);
  assert.deepEqual(cmsOrganisationIn("Alpha Beta Recruitment 2026", [{ organizationId: "alpha", organizationName: null }, { organizationId: "beta", organizationName: null }]), { ambiguous: ["alpha", "beta"] }, "a tie recognises neither");
});
test("FC13 an Indian Bank job in the CMS is recognised by its own ID and matched", async () => {
  const jobs = [...JOBS, { id: "ib", organizationId: "indian-bank", organizationName: "Indian Bank", title: "Indian Bank Apprentice Recruitment 2026", notificationNumber: null, year: 2026 }];
  const r = await run(jobs);
  const f = r.found.find((x) => x.url.includes("indian-bank-apprentice"))!;
  assert.equal(f.organizationId, "indian-bank");
  assert.equal(f.match, "STRONG");
  assert.ok(!r.found.find((x) => x.url.includes("nicl-apprentice"))!.maybe.some((m) => m.id === "ib"), "NICL is not suggested as Indian Bank's");
});
test("FC14 eligibility exams and updates are still told apart", async () => {
  await READY;
  assert.equal(byUrl("ugc-net").eligibilityExam, true);
  assert.equal(byUrl("uiic-ao-admit-card").kind, "UPDATE");
});

// ── Shapes of the CMS's real jobs ──
// An anonymised fixture keeps what the real CMS records showed on 10 Nov 2026 (organisation names whose initials
// are the acronym, an ID cut short, BTSC under two IDs, "LIC HFL Apprentice" as a body) with invented records.
// CMS_JOBS_FIXTURE can name a private copy of the real records (kept outside Git) to run the same checks on it.
const CMS_FILE = process.env.CMS_JOBS_FIXTURE ?? path.join(__dirname, "../fixtures/discovery/cms-jobs-anonymised.json");
const loaded = JSON.parse(fs.readFileSync(CMS_FILE, "utf8"));
const REAL: typeof JOBS = (Array.isArray(loaded) ? loaded : loaded.jobs).filter((j: { organizationId: string }) => j.organizationId !== "smoke-org");
let real: FoundJob[] = [];
const REAL_READY = run(REAL).then((r) => { real = r.found; return r; });
const inReal = (part: string) => {
  const f = real.find((x) => x.url.includes(part));
  if (!f) throw new Error(`no listing for ${part}`);
  return f;
};
/** The job of this organisation whose title matches, in whichever fixture is loaded. */
const jid = (org: string, title: RegExp) => {
  const j = REAL.filter((x) => x.organizationId === org && title.test(x.title));
  if (j.length !== 1) throw new Error(`${j.length} jobs of ${org} match ${title}`);
  return j[0].id;
};
const ids = (f: FoundJob) => f.maybe.map((m) => m.id);

suite("Shapes of the CMS's real jobs");
test("FR01 NICL Graduate Apprentice: recognised as the CMS's NICL by its initials; Canara Bank is never suggested", async () => {
  await REAL_READY;
  const f = inReal("nicl-apprentice");
  assert.equal(f.organizationId, "national-insurance-company-limited");
  assert.ok(!ids(f).includes(jid("canara-bank", /Graduate Apprentice/)), "not Canara Bank Graduate Apprentice");
  assert.ok(f.match !== "STRONG" && f.match !== "DUPLICATE");
});
test("FR02 MPESB Police Constable Driver: its CMS job, as a strong match", async () => {
  await REAL_READY;
  const f = inReal("mpesb-police");
  assert.equal(f.organizationId, "madhya-pradesh-employees-selection-board", "MPESB: the initials of its CMS name");
  assert.equal(f.match, "STRONG");
  assert.deepEqual(splitMaybe(f).headline.map((m) => m.id), [jid("madhya-pradesh-employees-selection-board", /Police Constable Driver/)]);
});
test("FR03 NWR RRC Jaipur: the CMS's own Railway Recruitment Cell, North Western Railway (a verified alias), not 'another organisation's'", async () => {
  await REAL_READY;
  const f = inReal("nwr-rrc-jaipur");
  assert.equal(f.organizationId, "railway-recruitment-cell-north-western-r");
  assert.equal(f.match, "STRONG");
  assert.deepEqual(splitMaybe(f).headline.map((m) => m.id), [jid("railway-recruitment-cell-north-western-r", /Jaipur Apprentice/)]);
  assert.ok(!/another organisation/.test(f.matchReason ?? ""));
});
test("FR04 LIC HFL Apprentice: the existing LIC HFL job (same body, same 232 posts)", async () => {
  await REAL_READY;
  const f = inReal("lic-hfl-apprentice");
  assert.equal(f.organizationId, "lic-hfl-apprentice");
  assert.equal(f.match, "STRONG");
  assert.deepEqual(splitMaybe(f).headline.map((m) => m.id), [jid("lic-hfl-apprentice", /232 Posts/)]);
});
test("FR05 RRB NTPC: Graduate CEN 06/2026 is its duplicate; 10+2 Under Graduate is the Undergraduate CEN 07/2026 job", async () => {
  await REAL_READY;
  const g = inReal("rrb-ntpc-graduate-cen-06");
  assert.equal(g.match, "DUPLICATE");
  assert.deepEqual(splitMaybe(g).headline.map((m) => m.id), [jid("rrb", /Graduate Level Recruitment 2026 \(CEN 06\/2026\)/)]);
  assert.ok((g.differentNotice ?? []).some((m) => m.id === jid("rrb", /\(CEN 06\/2025\)/)), "CEN 06/2025 apart");
  const u = inReal("rrb-ntpc-ug-cen-07");
  assert.equal(u.match, "STRONG");
  assert.deepEqual(splitMaybe(u).headline.map((m) => m.id), [jid("rrb", /Undergraduate Level Recruitment 2026 \(CEN 07\/2026\)/)]);
});
test("FR06 Dr RMLIMS is not suggested as Delhi University's", async () => {
  await REAL_READY;
  assert.ok(!ids(inReal("drrmlims")).includes(jid("university-of-delhi", /Non-Teaching/)));
});
test("FR07 like titles of different bodies stay non-matches", async () => {
  await REAL_READY;
  const ib = inReal("indian-bank-apprentice");
  assert.ok(ib.maybe.every((m) => !/canara|baroda|sail/i.test(m.title)), "Indian Bank Apprentice is not another bank's or SAIL's");
  const canara = jid("canara-bank", /Graduate Apprentice/);
  const sbi = matchLead({ organizationId: "sbi", organizationName: "State Bank of India", title: "SBI Graduate Apprentice Online Form 2026", notificationNumber: null }, REAL);
  assert.ok(!sbi.candidates.some((c) => c.id === canara), "a recognised SBI listing is not Canara Bank's");
  const rec = matchLead({ organizationId: "isro", organizationName: null, title: "ISRO Apprentice Recruitment 2026", notificationNumber: null }, REAL);
  assert.ok(rec.candidates.every((c) => REAL.find((j) => j.id === c.id)?.organizationId === "isro"));
});
test("FR08 initials two CMS bodies share are unclear: neither is chosen, nothing confident", async () => {
  await REAL_READY;
  // The CMS holds BTSC under two IDs ("bihar-technical-service-commission" and "…-btsc").
  const out = cmsOrganisationIn("BTSC Food Safety Officer Online Form 2026", REAL);
  assert.ok(out && "ambiguous" in out && out.ambiguous.length === 2, JSON.stringify(out));
  const r = await discoverFromPage({
    url: "https://p.example/list", jobs: REAL, today: "2026-11-10",
    fetchSourceFn: async (u) => (u.endsWith("robots.txt") ? page(u, "", "text/plain") : page(u, `<ul><li><a href="/btsc-fso/">BTSC Food Safety Officer FSO Online Form 2026 | Last Date : 24/11/2026</a></li></ul>`)),
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const f = r.found[0];
  assert.equal(f.organizationId, undefined);
  assert.equal(f.organizationUnclear?.length, 2);
  assert.ok(f.match !== "STRONG" && f.match !== "DUPLICATE", f.match);
  assert.match(renderToStaticMarkup(<FoundRow f={f} onPick={() => {}} />), /organisation unclear: /);
  // Short forms that are only part of a name are no evidence: "NWR" alone is not the North Western Railway cell.
  assert.equal(cmsOrganisationIn("NWR Apprentice Online Form 2026", REAL), null);
});
test("FR09 the dates, deadlines and kinds corrected before are unchanged", async () => {
  await REAL_READY;
  assert.equal(inReal("hcl-apprentice").lastDate, "2026-11-24");
  assert.equal(inReal("bhu-non-teaching").lastDate, "2026-11-25");
  assert.equal(inReal("icsil-deo").applications, "LAST_DATE_PASSED");
  assert.equal(inReal("ugc-net").eligibilityExam, true);
  assert.equal(inReal("uiic-ao-admit-card").kind, "UPDATE");
});
test("FR10 the strong matches found before stay strong (BPSC TRE 4.0, RRB Station Master)", async () => {
  await REAL_READY;
  assert.equal(inReal("bpsc-tre-4").match, "STRONG");
  assert.equal(inReal("rrb-station-master").match, "STRONG");
});
