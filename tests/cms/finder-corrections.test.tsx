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
  assert.equal(cmsOrganisationIn("Alpha Beta Recruitment 2026", [{ organizationId: "alpha", organizationName: null }, { organizationId: "beta", organizationName: null }]), null, "a tie recognises neither");
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
