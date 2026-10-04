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
import { updateLinks, updateHowToApply } from "@/lib/cms/record-ops";
import { routeFieldUpdate } from "@/lib/cms/field-update-router";
import { buildSlug, slugify } from "@/lib/cms/slug";

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

suite("Slugs");

test("SL01 buildSlug avoids repeated organisation and year", () => {
  assert.equal(buildSlug("ibps", "IBPS Clerk 2026", 2026), "ibps-clerk-2026");
  assert.equal(buildSlug("bpsc", "BPSC 72nd Combined Competitive Exam", 2026), "bpsc-72nd-combined-competitive-exam-2026");
  assert.equal(buildSlug("canara-bank", "Canara Bank Graduate Apprentice 2026", 2026), "canara-bank-graduate-apprentice-2026");
  assert.equal(buildSlug("upsc", "Civil Services", 2026), "upsc-civil-services-2026");
  assert.equal(buildSlug("ssc", "SSC", 2026), "ssc-2026");
});

test("SL02 slugify handles punctuation, dashes and length", () => {
  assert.equal(slugify("  CRP — RRBs (XV): Officers & Assistants!  "), "crp-rrbs-xv-officers-assistants");
  assert.equal(slugify("Canara Bank", 40), "canara-bank");
  assert.equal(slugify("a".repeat(100)).length, 60);
  assert.equal(/^-|-$/.test(slugify("--x--")), false);
});
