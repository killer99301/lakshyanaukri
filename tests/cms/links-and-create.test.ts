// ═══════════════════════════════════════════════════════════
// Links / how-to-apply write path and record creation helpers
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no HTTP.
//
//  LK01  links: valid list saved, trimmed, revision recorded with old and new values
//  LK02  links: non-http(s) URLs rejected (javascript:, relative, empty)
//  LK03  links: unknown type, missing label, non-boolean official rejected
//  LK04  links: editing does not change draft state or any ProvenanceField
//  LK05  links: unknown properties are dropped; sourceId is kept
//  HW01  howToApply: steps trimmed and saved with a revision
//  HW02  howToApply: empty steps and non-arrays rejected
//  RT01  router: "links" and "howToApply" are routable; "documents" is not
//  SL01  buildSlug: no repeated organisation or year; stable for plain titles
//  SL02  slugify: punctuation, dashes and length handled
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { randomUUID } from "node:crypto";

import type { RecruitmentRecord, ProvenanceField } from "@/types/recruitment-record";
import { updateLinks, updateHowToApply, updateClassification } from "@/lib/cms/record-ops";
import { routeFieldUpdate } from "@/lib/cms/field-update-router";
import { buildSlug, slugify } from "@/lib/cms/slug";
import { savedFilePath, cleanPdfName, isAllowedSavedFilePath, savedFileProblem, MAX_SAVED_FILE_BYTES } from "@/lib/cms/saved-files";
import { lifecycleLinksOf } from "@/lib/cms/lifecycle-links";

const ADMIN = randomUUID();

function pf<T>(value: T): ProvenanceField<T> {
  return { value, status: "VERIFIED", evidenceIds: ["evid-001"], conflict: false, manuallyEdited: false };
}

function makeRecord(): RecruitmentRecord {
  return {
    id: randomUUID(),
    slug: "test-2026",
    draftState: "DRAFT",
    recordRevision: "abc",
    identity: { organizationId: "ibps", organizationName: "IBPS", recruitmentYear: 2026, title: pf("Test Recruitment 2026") },
    dates: { applicationCloseDate: pf<string | null>("2026-06-01") },
    vacancies: {},
    financial: {},
    links: [{ type: "OFFICIAL_WEBSITE", label: "Website", url: "https://www.ibps.in", official: true }],
    documents: [],
    lifecycle: { status: "DRAFT", conflicts: [], events: [] },
    provenance: { status: "NOT_VERIFIED", lastVerifiedAt: "2026-10-01", primarySourceType: "NOT_VERIFIED" } as RecruitmentRecord["provenance"],
    updates: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const NOTIF = { type: "OFFICIAL_NOTIFICATION", label: "  Official Notification ", url: " https://www.ibps.in/n.pdf ", official: true };

suite("Links write path");

test("LK01 valid links saved, trimmed, revision records old and new", () => {
  const record = makeRecord();
  const { record: updated, revision } = updateLinks(record, [...record.links, NOTIF], ADMIN, "Added link");
  assert.equal(updated.links.length, 2);
  assert.equal(updated.links[1].label, "Official Notification");
  assert.equal(updated.links[1].url, "https://www.ibps.in/n.pdf");
  assert.equal(revision.fieldPath, "links");
  assert.equal((revision.oldValue as unknown[]).length, 1);
  assert.equal((revision.newValue as unknown[]).length, 2);
  assert.equal(revision.reason, "Added link");
  assert.equal(record.links.length, 1); // original untouched
});

test("LK02 non-http(s) URLs rejected", () => {
  const record = makeRecord();
  for (const url of ["javascript:alert(1)", "/relative/path", "", "ftp://x.example/a", "data:text/html,x"]) {
    assert.throws(() => updateLinks(record, [{ ...NOTIF, url }], ADMIN), /valid http/, url);
  }
});

test("LK03 unknown type, missing label, non-boolean official rejected", () => {
  const record = makeRecord();
  assert.throws(() => updateLinks(record, [{ ...NOTIF, type: "SOMETHING" }], ADMIN), /unknown type/);
  assert.throws(() => updateLinks(record, [{ ...NOTIF, label: "   " }], ADMIN), /needs a label/);
  assert.throws(() => updateLinks(record, [{ ...NOTIF, official: "yes" }], ADMIN), /official/);
  assert.throws(() => updateLinks(record, "not-a-list", ADMIN), /must be an array/);
  assert.throws(() => updateLinks(record, Array(31).fill(NOTIF), ADMIN), /at most 30/);
});

test("LK04 editing links changes nothing else", () => {
  const record = makeRecord();
  const { record: updated } = updateLinks(record, [], ADMIN);
  assert.equal(updated.draftState, "DRAFT");
  assert.deepEqual(updated.identity, record.identity);
  assert.deepEqual(updated.dates, record.dates);
  assert.deepEqual(updated.lifecycle, record.lifecycle);
  assert.equal(updated.publishedAt, undefined);
});

test("LK05 unknown properties dropped, sourceId kept", () => {
  const record = makeRecord();
  const { record: updated } = updateLinks(record, [{ ...NOTIF, sourceId: "src-1", injected: "<script>" }], ADMIN);
  assert.deepEqual(Object.keys(updated.links[0]).sort(), ["label", "official", "sourceId", "type", "url"]);
});

test("LK06 saved copy: needs its official source, is never official, gets a saved date", () => {
  const record = makeRecord();
  const COPY = { type: "RESULT", label: "Final Result (PDF)", url: "https://drive.google.com/file/d/abc123/view", official: false, savedFrom: " https://www.ibps.in/result.pdf " };
  const { record: updated } = updateLinks(record, [...record.links, COPY], ADMIN);
  const saved = updated.links[1];
  assert.equal(saved.savedFrom, "https://www.ibps.in/result.pdf");
  assert.equal(saved.official, false);
  assert.ok(/^20\d{2}-\d{2}-\d{2}$/.test(saved.savedOn ?? ""));
  assert.equal(updateLinks(record, [{ ...COPY, savedOn: "2026-10-01" }], ADMIN).record.links[0].savedOn, "2026-10-01");

  assert.throws(() => updateLinks(record, [{ ...COPY, official: true }], ADMIN), /cannot be marked official/);
  assert.throws(() => updateLinks(record, [{ ...COPY, savedFrom: "javascript:alert(1)" }], ADMIN), /official http/);
  assert.throws(() => updateLinks(record, [{ ...COPY, savedFrom: "https://drive.google.com/file/d/other/view" }], ADMIN), /same site as the copy/);
  // An ordinary link is unchanged: no saved-copy fields appear.
  assert.equal("savedFrom" in updateLinks(record, [NOTIF], ADMIN).record.links[0], false);
});

suite("How-to-apply write path");

test("HW01 steps trimmed and saved with a revision", () => {
  const record = makeRecord();
  const { record: updated, revision } = updateHowToApply(record, ["  Register  ", "Pay the fee"], ADMIN, "Edited steps");
  assert.deepEqual(updated.howToApply, ["Register", "Pay the fee"]);
  assert.equal(revision.fieldPath, "howToApply");
  assert.deepEqual(revision.oldValue, []);
  assert.equal(updated.draftState, "DRAFT");
});

test("HW02 empty steps and non-arrays rejected", () => {
  const record = makeRecord();
  assert.throws(() => updateHowToApply(record, ["ok", "   "], ADMIN), /non-empty/);
  assert.throws(() => updateHowToApply(record, [1, 2], ADMIN), /non-empty/);
  assert.throws(() => updateHowToApply(record, "steps", ADMIN), /must be an array/);
  assert.throws(() => updateHowToApply(record, ["x".repeat(501)], ADMIN), /500 characters/);
});

suite("Router");

test("RT01 links and howToApply routable; documents is not", () => {
  const record = makeRecord();
  const wrap = (value: unknown): ProvenanceField<unknown> => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  assert.equal(routeFieldUpdate(record, "links", wrap([NOTIF]), ADMIN).record.links.length, 1);
  assert.equal(routeFieldUpdate(record, "howToApply", wrap(["Apply online"]), ADMIN).record.howToApply?.length, 1);
  assert.throws(() => routeFieldUpdate(record, "documents", wrap([]), ADMIN), /Unknown or unroutable/);
  assert.throws(() => routeFieldUpdate(record, "identity.organizationName", wrap("X"), ADMIN), /not an editable/);
});

suite("Listing details write path");

test("CL01 classification saved with a revision; blanks removed; nothing else changes", () => {
  const record = makeRecord();
  const { record: updated, revision } = updateClassification(
    record, { qualification: "12th Pass", category: "ssc", state: "  All India ", shortDescription: "" }, ADMIN, "Edited listing details",
  );
  assert.deepEqual(updated.classification, { category: "ssc", state: "All India", qualification: "12th Pass" });
  assert.equal(revision.fieldPath, "classification");
  assert.deepEqual(revision.oldValue, {});
  assert.equal(updated.draftState, "DRAFT");
  assert.deepEqual(updated.identity, record.identity);
});

test("CL02 unknown qualification or category, wrong types and over-long text rejected", () => {
  const record = makeRecord();
  assert.throws(() => updateClassification(record, { qualification: "PhD" }, ADMIN), /qualification level/);
  assert.throws(() => updateClassification(record, { category: "private" }, ADMIN), /unknown category/);
  assert.throws(() => updateClassification(record, { state: 5 }, ADMIN), /must be text/);
  assert.throws(() => updateClassification(record, { shortDescription: "x".repeat(301) }, ADMIN), /300 characters/);
  assert.throws(() => updateClassification(record, ["a"], ADMIN), /must be an object/);
  const wrap = { value: { state: "Bihar" }, status: "PENDING" as const, evidenceIds: [], conflict: false, manuallyEdited: true };
  assert.equal(routeFieldUpdate(record, "classification", wrap, ADMIN).record.classification?.state, "Bihar");
});

suite("Slugs");

test("SL01 buildSlug avoids repeated organisation and year", () => {
  assert.equal(buildSlug("ibps", "IBPS Clerk 2026", 2026), "ibps-clerk-2026");
  assert.equal(buildSlug("bpsc", "BPSC 72nd Combined Competitive Exam", 2026), "bpsc-72nd-combined-competitive-exam-2026");
  assert.equal(buildSlug("canara-bank", "Canara Bank Graduate Apprentice 2026", 2026), "canara-bank-graduate-apprentice-2026");
  assert.equal(buildSlug("upsc", "Civil Services", 2026), "upsc-civil-services-2026");
  assert.equal(buildSlug("ssc", "SSC", 2026), "ssc-2026");
  // A long title is shortened at a word boundary, never through the year.
  assert.equal(
    buildSlug("ssc", "TEST SSC CHSL (Combined Higher Secondary Level) Examination 2026", 2026),
    "ssc-test-ssc-chsl-combined-higher-secondary-level-examination-2026",
  );
  const long = buildSlug("upsc", "Engineering Services Examination for Civil Mechanical Electrical and Electronics Branches 2026", 2026);
  assert.equal(/-\d{1,3}-2026$/.test(long), false);
  assert.ok(long.endsWith("-2026") && long.length <= 72 && !long.includes("--"));
});

test("SL02 slugify handles punctuation, dashes and length", () => {
  assert.equal(slugify("  CRP — RRBs (XV): Officers & Assistants!  "), "crp-rrbs-xv-officers-assistants");
  assert.equal(slugify("Canara Bank", 40), "canara-bank");
  assert.equal(slugify("a".repeat(100)).length, 60);
  assert.equal(/^-|-$/.test(slugify("--x--")), false);
});

suite("Saved files (uploaded PDFs)");

test("SF01 storage path is documents/<job-slug>/<clean-name>.pdf and nothing else is accepted", () => {
  assert.equal(savedFilePath("ssc-chsl-2026", "Final Result (Tier-I) 2026.PDF"), "documents/ssc-chsl-2026/final-result-tier-i-2026.pdf");
  assert.equal(savedFilePath("ssc-chsl-2026", "नतीजा.pdf"), "documents/ssc-chsl-2026/document.pdf");
  assert.equal(cleanPdfName("a".repeat(200) + ".pdf").length, 84);
  assert.throws(() => savedFilePath("../etc", "x.pdf"), /usable slug/);
  assert.throws(() => savedFilePath("", "x.pdf"), /usable slug/);

  assert.equal(isAllowedSavedFilePath("documents/ssc-chsl-2026/final-result.pdf"), true);
  for (const bad of [
    "documents/ssc-chsl-2026/final-result.exe",
    "documents/ssc-chsl-2026/sub/final.pdf",
    "documents/../secrets/final.pdf",
    "images/ssc-chsl-2026/final.pdf",
    "documents/SSC/final.pdf",
    "documents/ssc-chsl-2026/Final Result.pdf",
    "final.pdf",
  ]) assert.equal(isAllowedSavedFilePath(bad), false, bad);
});

test("SF02 only real PDFs within the size limit can be uploaded", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);
  assert.equal(savedFileProblem({ name: "result.pdf", size: 1000 }, pdf), null);
  assert.match(savedFileProblem({ name: "result.docx", size: 1000 }, pdf) ?? "", /Only PDF/);
  assert.match(savedFileProblem({ name: "renamed.pdf", size: 1000 }, exe) ?? "", /not a real PDF/);
  assert.match(savedFileProblem({ name: "empty.pdf", size: 0 }, pdf) ?? "", /empty/);
  assert.match(savedFileProblem({ name: "huge.pdf", size: MAX_SAVED_FILE_BYTES + 1 }, pdf) ?? "", /larger than/);
  assert.equal(savedFileProblem({ name: "max.pdf", size: MAX_SAVED_FILE_BYTES }, pdf), null);
});

test("SF03 cut-off is a link type and is listed with results", () => {
  const record = makeRecord();
  const { record: updated } = updateLinks(record, [{ type: "CUT_OFF", label: "Tier-I Cut-off", url: "https://www.ibps.in/cutoff.pdf", official: true }], ADMIN);
  assert.equal(updated.links[0].type, "CUT_OFF");
  const listed = lifecycleLinksOf({ id: "x", slug: "job-x", title: "Job X", organizationName: "IBPS", projectedAt: "2026-10-04T00:00:00Z", links: updated.links } as never);
  assert.deepEqual(listed.map((l) => [l.kind, l.label]), [["result", "Tier-I Cut-off"]]);
});
