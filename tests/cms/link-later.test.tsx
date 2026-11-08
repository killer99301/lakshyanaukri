// "Link not released yet" (ADMIN_NOT_YET_OPEN), docs/apply-link-not-yet-open-design.md revision 3: the decision's
// rules, the gate, the public wording (built-in and browser lines), the Telegram line and the Updates Needed
// reminder. Pure: no database, no network. The database side is tests/local-stack/link-later.test.ts and the
// migration tests/local-stack/link-later-migration.test.ts.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/link-later.test.tsx

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { applicationAddressIn, checkLinkLater, dateLines, dateRoles, datesIn, describesFutureLink, durableWords, linkLaterReminder, type LinkLaterReminderInput } from "@/lib/cms/importer/link-later";
import { classifyField, publishGate, type FieldState } from "@/lib/cms/importer/classify";
import { CRITICAL_FIELDS } from "@/lib/cms/importer/fields";
import { rowActions } from "@/app/admin/cms/[id]/check-actions";
import { ApplyLinkLaterNotice } from "@/components/jobs/ApplyLinkLaterNotice";
import { buildJobAnnouncement } from "@/lib/telegram";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import type { RecruitmentRecord } from "@/types/recruitment-record";

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");
const LINK = "The link for online registration will be activated on www.ibps.in from 01.12.2099";
const BOTH = "The link for online registration will be activated on www.ibps.in from 01.12.2099; online registration from 03.12.2099 to 23.12.2099";
const ok = (input: Partial<Parameters<typeof checkLinkLater>[0]>) => checkLinkLater({ quote: LINK, linkReleaseOn: "2099-12-01", applicationsOpenOn: null, where: null, reviewerConfirmed: true, ...input });

suite("The decision's rules: the link itself, not a schedule");

test("L101 a sentence about the link's release passes; the value keeps the two dates apart", () => {
  const r = ok({ quote: BOTH, applicationsOpenOn: "2099-12-03", where: "www.ibps.in" });
  assert.ok(r.ok, JSON.stringify(r));
  if (r.ok) assert.deepEqual(r.value, { linkNotReleased: true, reviewerConfirmed: true, linkReleaseOn: "2099-12-01", applicationsOpenOn: "2099-12-03", where: "www.ibps.in" });
});

test("L102 a schedule of dates only, or 'apply online from …': refused, pointing to the normal route", () => {
  for (const quote of ["Online registration: 01.12.2099 to 21.12.2099", "Candidates can apply online from 01.12.2099", "Applications open on 1 December 2099"]) {
    const r = ok({ quote });
    assert.ok(!r.ok && /do not say the application link will be released later/.test(r.error), `${quote}: ${JSON.stringify(r)}`);
  }
});

test("L103 the words give the application address: refused, verify it instead; a bare site is only a place", () => {
  const r = ok({ quote: "The link will be activated at https://ibpsonline.ibps.in/crprrbxv/ from 01.12.2099" });
  assert.ok(!r.ok && /gives the application address/.test(r.error), JSON.stringify(r));
  assert.equal(applicationAddressIn("will be activated on www.ibps.in from 01.12.2099"), null);
  assert.equal(applicationAddressIn("see https://www.ibps.in/ for details"), null);
  assert.equal(applicationAddressIn("at www.ibps.in/crp-xv."), "www.ibps.in/crp-xv");
});

test("L104 the reviewer's statement is required; a keyword match is never enough on its own", () => {
  const r = ok({ reviewerConfirmed: false });
  assert.ok(!r.ok && /Confirm the statement/.test(r.error));
});

test("L105 the link's date given as the opening date, or the opening date as the link's: refused", () => {
  const a = ok({ quote: BOTH, linkReleaseOn: "2099-12-03" });
  assert.ok(!a.ok && /given for applications or registration, not for the link/.test(a.error), JSON.stringify(a));
  const b = ok({ quote: BOTH, applicationsOpenOn: "2099-12-01" });
  assert.ok(!b.ok && /given for the link, not for applications opening/.test(b.error), JSON.stringify(b));
});

test("L106 an opening date not in the words counts only as the job's verified 'Applications open' date", () => {
  const r = ok({ applicationsOpenOn: "2099-12-03" });
  assert.ok(!r.ok && /not in the quoted words/.test(r.error));
  assert.ok(ok({ applicationsOpenOn: "2099-12-03", verifiedOpenDate: "2099-12-03" }).ok);
  assert.ok(!ok({ applicationsOpenOn: "2099-12-03", verifiedOpenDate: "2099-12-04" }).ok);
});

test("L107 a place only: allowed when the words describe the link's release there; the place must be in the words", () => {
  const q = "The online application link will be made available on the website www.ibps.in in due course";
  assert.ok(ok({ quote: q, linkReleaseOn: null, where: "www.ibps.in" }).ok);
  const r = ok({ quote: q, linkReleaseOn: null, where: "www.sbi.co.in" });
  assert.ok(!r.ok && /not in the quoted words/.test(r.error));
  const none = ok({ quote: q, linkReleaseOn: null, where: null });
  assert.ok(!none.ok && /or the site it names/.test(none.error));
  assert.ok(!ok({ quote: q, linkReleaseOn: null, where: "www.ibps.in/x" }).ok, "a place is a site name, not a page");
});

test("L108 dates in the forms notices use; each tied to the nearest naming word", () => {
  assert.deepEqual(datesIn("1st December 2099, Dec 3, 2099, 05/12/2099, 2099-12-07, 09-12-2099").map((d) => d.iso),
    ["2099-12-01", "2099-12-03", "2099-12-05", "2099-12-07", "2099-12-09"]);
  assert.deepEqual(dateRoles("Online registration link will be activated on 01.12.2099 and registration closes on 21.12.2099").map((r) => r.role), ["LINK", "APPLY"]);
  assert.ok(describesFutureLink("Activation of online registration link: 01.12.2099"));
  assert.ok(!describesFutureLink("Online registration: 01.12.2099 to 21.12.2099"));
});

suite("The gate: the Apply Online link only");

const decided = (fieldPath: string, value: unknown, hasValue = false): FieldState => ({
  fieldPath, hasValue, value: hasValue ? { type: "APPLY_ONLINE", url: "https://x.example/" } : null, latestRevisionId: "rev1", latestRevisionAt: "2099-01-01T00:00:00Z",
  claims: [{ id: "c1", seq: 1, kind: "ADMIN_NOT_YET_OPEN", value, fieldRevisionId: "rev1", retrievalId: "r1" }],
});
const LATER = { linkNotReleased: true, reviewerConfirmed: true, linkReleaseOn: "2099-12-01", applicationsOpenOn: "2099-12-03", where: "www.ibps.in" };

test("L201 the decision on the Apply Online link passes the gate; nothing else is relaxed", () => {
  const states = CRITICAL_FIELDS.map((p) => p === "links#APPLY_ONLINE" ? decided(p, LATER)
    : { fieldPath: p, hasValue: false, value: null, latestRevisionId: null, latestRevisionAt: null, claims: [] });
  const g = publishGate(states, "2099-01-01T00:00:00Z");
  assert.ok(!g.blockers.some((b) => b.fieldPath === "links#APPLY_ONLINE"), "the Apply Online link no longer blocks");
  assert.equal(g.ok, false, "every other missing field still blocks");
  assert.equal(g.verdicts.find((v) => v.fieldPath === "links#APPLY_ONLINE")?.cls, "NOT_YET_OPEN");
  assert.deepEqual(g.verdicts.find((v) => v.fieldPath === "links#APPLY_ONLINE")?.linkLater, { linkReleaseOn: "2099-12-01", applicationsOpenOn: "2099-12-03", where: "www.ibps.in" });
});

test("L202 on any other field, or once a link is on the job, it is not a pass", () => {
  assert.notEqual(classifyField(decided("financial.feeGeneral", LATER), null).cls, "NOT_YET_OPEN");
  assert.notEqual(classifyField(decided("links#APPLY_ONLINE", LATER, true), null).cls, "NOT_YET_OPEN");
  assert.notEqual(classifyField(decided("links#APPLY_ONLINE", { linkNotReleased: false }), null).cls, "NOT_YET_OPEN");
});

test("L203 the check list offers 'Link not released yet' on the Apply Online link only, without a link", () => {
  assert.equal(rowActions({ fieldPath: "links#APPLY_ONLINE", cls: "MISSING", value: null }, null).linkLater, true);
  assert.equal(rowActions({ fieldPath: "links#APPLY_ONLINE", cls: "SUPPORTED", value: { url: "x" } }, null).linkLater, false);
  assert.equal(rowActions({ fieldPath: "links#APPLY_ONLINE", cls: "NOT_YET_OPEN", value: null }, null).linkLater, false);
  assert.equal(rowActions({ fieldPath: "financial.feeGeneral", cls: "MISSING", value: null }, null).linkLater, false);
});

suite("The public page: durable wording, browser-only date lines");

const P = { linkReleaseOn: "2099-12-01", applicationsOpenOn: "2099-12-03", where: "www.ibps.in" };

test("L301 the built-in sentences: what the notice announced and what this page provides; never 'not released'", () => {
  for (const p of [P, { ...P, applicationsOpenOn: null }, { linkReleaseOn: null, applicationsOpenOn: null, where: "www.ibps.in" }]) {
    const w = durableWords(p).join(" ");
    assert.match(w, /^No direct Apply Online link is provided on this page\./);
    assert.ok(!/not yet released|not released|unreleased/i.test(w), w);
  }
  assert.match(durableWords(P).join(" "), /scheduled for release on 1 Dec 2099 \(at www\.ibps\.in\)\. The official notice gives 3 Dec 2099 as the date applications open\./);
  assert.ok(!/applications open/i.test(durableWords({ ...P, applicationsOpenOn: null }).join(" ")), "no opening sentence without a recorded opening date");
});

test("L302 the cached HTML holds only the durable sentences (the date lines are drawn after loading)", () => {
  const html = renderToStaticMarkup(<ApplyLinkLaterNotice later={P} />);
  assert.ok(!/data-date-line/.test(html), "no date line in the server HTML");
  assert.equal((html.match(/data-durable/g) ?? []).length, 3);
  assert.ok(!/Apply Online<\/a>|href=/.test(html), "no link, no button");
});

test("L303 the browser lines: before and after the link's date; the opening line only from its own date", () => {
  assert.deepEqual(dateLines(P, "2099-11-30"), ["Link scheduled for release on 1 Dec 2099.", "Applications open on 3 Dec 2099."]);
  const after = dateLines(P, "2099-12-01");
  assert.match(after[0], /^The scheduled release date \(1 Dec 2099\) has passed\. This page does not have the link yet/);
  assert.deepEqual(dateLines(P, "2099-12-03").length, 1, "nothing extra once applications open");
  assert.deepEqual(dateLines({ ...P, applicationsOpenOn: null }, "2099-11-30"), ["Link scheduled for release on 1 Dec 2099."]);
  for (const day of ["2099-11-30", "2099-12-01", "2099-12-10"]) {
    assert.ok(!dateLines(P, day).some((l) => /official website (still )?(lacks|does not have|has no)/i.test(l)), "never says the official site lacks the link");
  }
});

const record = (links: unknown[] = []) => ({
  id: "00000000-0000-0000-0000-0000000000a1", slug: "test-link-later", draftState: "DRAFT", recordRevision: "r1",
  identity: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2099, govType: "PSU",
    title: { value: "IBPS TEST LINK LATER 2099", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } },
  dates: {}, vacancies: {}, financial: {}, links, documents: [], updates: [],
  lifecycle: { status: "DRAFT", conflicts: [], events: [] },
  provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2099-01-01", primarySourceType: "NOT_VERIFIED" },
  createdAt: "2099-01-01T00:00:00Z", updatedAt: "2099-01-01T00:00:00Z",
} as unknown as RecruitmentRecord);

test("L304 the public job: shown only while no Apply Online link is given; a verified link replaces it", () => {
  const snap = { ...projectForPreview(record()), applyLinkLater: P };
  const job = snapshotToGovernmentRecruitment(snap);
  assert.deepEqual(job.applyLinkLater, P);
  assert.equal(job.links.apply, "");
  const withLink = snapshotToGovernmentRecruitment({ ...projectForPreview(record([{ type: "APPLY_ONLINE", label: "Apply", url: "https://ibpsonline.ibps.in/x/", official: true }])), applyLinkLater: P });
  assert.equal(withLink.applyLinkLater, undefined);
});

test("L305 Telegram (only when ticked, decided elsewhere): the pending line, and the opening date only when recorded", () => {
  const snap = { ...projectForPreview(record()), applyLinkLater: P };
  const t = text(buildJobAnnouncement(snap, "NEW"));
  assert.match(t, /Application link: scheduled for release on .*2099 \(official notice\); not provided here yet/);
  assert.match(t, /Applications open: .*2099 \(official notice\)/);
  assert.ok(!/Applications open/.test(text(buildJobAnnouncement({ ...snap, applyLinkLater: { ...P, applicationsOpenOn: null } }, "NEW"))));
  assert.ok(!/Application link/.test(text(buildJobAnnouncement(projectForPreview(record()), "NEW"))));
});

suite("Updates Needed: until a verified link is on the published page");

const base: LinkLaterReminderInput = { latest: P, inForce: true, cls: "NOT_YET_OPEN", hasLink: false, publishedHasLink: false, publishedShowsLater: true };

test("L401 decision in force: SOON before the link's date, NOW from it", () => {
  assert.equal(linkLaterReminder(base, "2099-11-30")?.level, "SOON");
  const now = linkLaterReminder(base, "2099-12-01");
  assert.equal(now?.level, "NOW");
  assert.match(now!.message, /due by 1 Dec 2099/);
  assert.equal(linkLaterReminder({ ...base, latest: { ...P, linkReleaseOn: null } }, "2099-12-02")?.level, "SOON", "the opening date counts only without a link date…");
  assert.equal(linkLaterReminder({ ...base, latest: { ...P, linkReleaseOn: null } }, "2099-12-03")?.level, "NOW", "…from the opening date");
  assert.equal(linkLaterReminder({ ...base, latest: { linkReleaseOn: null, applicationsOpenOn: null, where: "www.ibps.in" } }, "2199-01-01")?.level, "SOON", "no date: never urgent by itself");
});

test("L402 the steps after: link added unverified, decision withdrawn, verified awaiting republish, then cleared", () => {
  assert.match(linkLaterReminder({ ...base, inForce: false, cls: "SUPPORTED", hasLink: true }, "2099-11-30")!.message, /added but is not verified/);
  assert.equal(linkLaterReminder({ ...base, inForce: false, cls: "SUPPORTED", hasLink: true }, "2099-12-05")!.level, "NOW");
  assert.match(linkLaterReminder({ ...base, inForce: false, cls: "MISSING" }, "2099-11-30")!.message, /live page still shows the scheduled-link wording/);
  assert.equal(linkLaterReminder({ ...base, inForce: false, cls: "MISSING" }, "2099-11-30")!.level, "NOW");
  assert.match(linkLaterReminder({ ...base, inForce: false, cls: "MISSING", publishedShowsLater: false }, "2099-11-30")!.message, /was withdrawn/);
  assert.match(linkLaterReminder({ ...base, inForce: false, cls: "VERIFIED", hasLink: true }, "2099-11-30")!.message, /verified but the public page does not show it yet/);
  assert.equal(linkLaterReminder({ ...base, inForce: false, cls: "VERIFIED", hasLink: true, publishedHasLink: true, publishedShowsLater: false }, "2099-12-05"), null);
});
