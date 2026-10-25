// Job discovery, on demand: robots.txt, sorting a listing page's links, and
// matching them with jobs already in the CMS. The page is a stub; no network.

import { suite, test, assert } from "../intelligence/suite";
import { discoverFromPage, robotsAllows, similarJobs } from "@/lib/cms/importer/discover";
import type { FetchedSource } from "@/lib/cms/importer/fetch-source";

const LISTING = `<html><body>
<h2>Latest Bihar Jobs</h2>
<ul>
<li><a href="/exams/bihar/btsc-fso-recruitment-2026/">BTSC FSO Recruitment 2026 Notification Out For 105 Posts, Apply Online</a> 15/10/2026</li>
<li><a href="/exams/bihar/btsc-tvo-recruitment-2026/">BTSC Touring Veterinary Officer Recruitment 2026 Out, Apply Online For 787 Vacancies</a></li>
<li><a href="/exams/bihar/bihar-slet-2026-extended/">Bihar SLET Notification 2026 Apply Online Last Date Extended To 31 October</a></li>
<li><a href="/exams/bihar/bpsc-72nd-postponed/">BPSC 72nd CCE Prelims Exam Postponed, Check New Exam Date Update</a></li>
<li><a href="https://bpsc.bihar.gov.in/Advt/22-2026.pdf">BPSC Advt. No. 22/2026 72nd Combined Competitive Examination notification</a></li>
<li><a href="/product-onlineliveclasses/113961/fso-complete-batch?utm_source=x">Bihar BTSC Food Safety Officer (FSO) Complete Batch with Test Series 2026</a></li>
<li><a href="/exams/bihar/bihar-police-syllabus/">Bihar Police Constable Syllabus 2026, Download PDF</a></li>
<li><a href="/about-us/">About us and our editorial team</a></li>
<li><a href="/exams/bihar/btsc-fso-recruitment-2026/#respond">BTSC FSO Recruitment 2026 Notification Out For 105 Posts, Apply Online</a></li>
</ul></body></html>`;

const page = (url: string, body: string, type = "text/html"): FetchedSource => ({ ok: true, finalUrl: url, contentType: type, bytes: Buffer.from(body) });

suite("robots.txt");
test("ID01 the longest matching rule wins; a named agent's group replaces *", () => {
  const robots = "User-agent: *\nDisallow: /wp-admin/\nDisallow: /search\nAllow: /search/jobs\n\nUser-agent: BadBot\nDisallow: /";
  assert.equal(robotsAllows(robots, "/exams/bihar/"), true);
  assert.equal(robotsAllows(robots, "/wp-admin/x"), false);
  assert.equal(robotsAllows(robots, "/search?q=x"), false);
  assert.equal(robotsAllows(robots, "/search/jobs/bihar"), true);
  assert.equal(robotsAllows("User-agent: LakshyaNaukriBot\nDisallow: /", "/exams/"), false);
  assert.equal(robotsAllows("", "/anything"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /*.pdf$", "/a/notice.pdf"), false);
});

suite("A listing page");
test("ID02 new jobs and updates are found; courses, syllabi, menus and repeats are not", async () => {
  const fetched: string[] = [];
  const out = await discoverFromPage({
    url: "https://www.example-portal.com/exams/bihar/",
    jobs: [{ id: "j1", title: "BPSC 72nd CCE 2026" }, { id: "j2", title: "BTSC Food Safety Officer Recruitment 2026" }],
    fetchSourceFn: async (u) => { fetched.push(u); return u.endsWith("robots.txt") ? page(u, "User-agent: *\nDisallow: /wp-admin/", "text/plain") : page(u, LISTING); },
  });
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.deepEqual(fetched, ["https://www.example-portal.com/robots.txt", "https://www.example-portal.com/exams/bihar/"], "one page, nothing followed");
  const titles = out.found.map((f) => `${f.kind}:${f.title.split(",")[0]}`);
  assert.deepEqual(titles, [
    "NEW:BTSC FSO Recruitment 2026 Notification Out For 105 Posts",
    "NEW:BTSC Touring Veterinary Officer Recruitment 2026 Out",
    "UPDATE:Bihar SLET Notification 2026 Apply Online Last Date Extended To 31 October",
    "UPDATE:BPSC 72nd CCE Prelims Exam Postponed",
    "NEW:BPSC Advt. No. 22/2026 72nd Combined Competitive Examination notification",
  ]);
  const fso = out.found[0];
  assert.equal(fso.official, false, "a portal's article is research");
  assert.equal(fso.date, "2026-10-15");
  assert.deepEqual(fso.maybe.map((m) => m.id), ["j2"], "the FSO job is already in the CMS");
  assert.equal(out.found[4].official, true, "BPSC's own PDF is on its own site");
  assert.deepEqual(out.found[3].maybe.map((m) => m.id), ["j1"], "the postponement is an update to the BPSC job");
});
test("ID03 a page robots.txt closes is not fetched", async () => {
  const fetched: string[] = [];
  const out = await discoverFromPage({
    url: "https://www.example-portal.com/search?q=bihar",
    jobs: [],
    fetchSourceFn: async (u) => { fetched.push(u); return u.endsWith("robots.txt") ? page(u, "User-agent: *\nDisallow: /search", "text/plain") : page(u, LISTING); },
  });
  assert.equal(out.ok, false);
  assert.equal(fetched.length, 1);
});
test("ID04 similar titles need the same year and most of their words", () => {
  const jobs = [{ id: "a", title: "SSC CGL 2026" }, { id: "b", title: "SSC CGL 2025" }, { id: "c", title: "SSC CHSL 2026" }];
  assert.deepEqual(similarJobs("SSC CGL 2026 Notification Out, Apply Online", jobs).map((j) => j.id), ["a"]);
  assert.deepEqual(similarJobs("RRB NTPC 2026 Notification", jobs), []);
  const btsc = [{ id: "fso", title: "BTSC Food Safety Officer Recruitment 2026" }];
  assert.deepEqual(similarJobs("BTSC FSO Recruitment 2026 Notification Out For 105 Posts", btsc).map((j) => j.id), ["fso"]);
  assert.deepEqual(similarJobs("BTSC Touring Veterinary Officer Recruitment 2026 Out, Apply Online for 787 Vacancies", btsc), [], "same body, another post");
});
