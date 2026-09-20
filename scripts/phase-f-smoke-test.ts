#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════
// Phase F Smoke Test — CMS Public Read Path
// ═══════════════════════════════════════════════════════════
//
// Run (from project root):
//   npx tsx --tsconfig tsconfig.json scripts/phase-f-smoke-test.ts
// ═══════════════════════════════════════════════════════════

import { randomUUID } from "crypto";

import { createRecruitment, persistApproval, persistPublication, getRecruitmentById } from "@/lib/cms/repository";
import { projectToPublished, PROJECTION_VERSION } from "@/lib/cms/projector";
import { getPublishedBySlug, getPublishedSlugs } from "@/lib/cms/public-repository";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { getBySlug, getAllSlugs, getAllStaticSlugs } from "@/lib/repository";
import { sql } from "@/lib/db";
import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";

// ─── Test harness ─────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

// ─── Pure function tests ───────────────────────────────────

section("P1 — snapshotToGovernmentRecruitment (pure)");

const fullSnapshot: PublishedRecruitmentSnapshot = {
  id: "fake-id",
  slug: "fake-slug",
  organizationId: "bpsc",
  organizationName: "Bihar Public Service Commission",
  govType: "State Govt",
  recruitmentYear: 2026,
  title: "BPSC 73rd CCE",
  shortTitle: null,
  notificationNumber: "Advt No. 73/2026",
  advertisementNumber: null,
  dates: {
    notificationDate: "2026-01-15",
    applicationOpenDate: "2026-01-20",
    applicationCloseDate: "2026-02-20",
    feePaymentCloseDate: null,
    correctionWindowEnd: null,
    examDate: null,
    prelimsDate: null,
    mainsDate: null,
    admitCardDate: null,
    resultDate: null,
    interviewDate: null,
    documentVerificationDate: null,
    joiningDate: null,
  },
  vacancies: { total: 281, breakdown: null },
  financial: { feeGeneral: 750, feeSCST: 200, payScale: null, paymentModes: ["Online"] },
  eligibility: null,
  age: null,
  selection: null,
  howToApply: ["Apply online at bpsc.bih.nic.in"],
  links: [
    { type: "OFFICIAL_NOTIFICATION", label: "Notification PDF", url: "https://bpsc.bih.nic.in/n73.pdf", official: true },
    { type: "APPLY_ONLINE",          label: "Apply Online",     url: "https://onlinebpsc.bihar.gov.in", official: true },
    { type: "OFFICIAL_WEBSITE",      label: "Official Website", url: "https://bpsc.bih.nic.in",        official: true },
  ],
  documents: [],
  classification: {
    shortDescription: "Bihar state civil services — 281 posts.",
    category: "state-psc",
    state: "Bihar",
    qualification: "Graduate",
  },
  provenanceStatus: "VERIFIED",
  primarySourceUrl: "https://bpsc.bih.nic.in/n73.pdf",
  projectedAt: new Date().toISOString(),
  projectionVersion: "1.0",
  sourceRecordRevision: "abcdef01",
};

{
  const gr = snapshotToGovernmentRecruitment(fullSnapshot);
  ok("type is government",            gr.type === "government");
  ok("id preserved",                  gr.id === "fake-id");
  ok("slug preserved",                gr.slug === "fake-slug");
  ok("organizationId preserved",      gr.organizationId === "bpsc");
  ok("organizationName preserved",    gr.organizationName === "Bihar Public Service Commission");
  ok("title mapped",                  gr.title === "BPSC 73rd CCE");
  ok("shortDescription from classif.", gr.shortDescription === "Bihar state civil services — 281 posts.");
  ok("category from classification",  gr.category === "state-psc");
  ok("state from classification",     gr.state === "Bihar");
  ok("qualification from classif.",   gr.qualification === "Graduate");
  ok("govType State Govt",            gr.govType === "State Govt");
  ok("notificationNumber",            gr.notificationNumber === "Advt No. 73/2026");
  ok("totalVacancies",                gr.totalVacancies === 281);
  ok("vacanciesDisplay",              gr.vacanciesDisplay === "281 Posts");
  ok("application.openDate",          gr.application.openDate === "2026-01-20");
  ok("application.closeDate",         gr.application.closeDate === "2026-02-20");
  ok("links.notification PDF",        gr.links.notification === "https://bpsc.bih.nic.in/n73.pdf");
  ok("links.apply",                   gr.links.apply === "https://onlinebpsc.bihar.gov.in");
  ok("links.website",                 gr.links.website === "https://bpsc.bih.nic.in");
  ok("examStages is empty array",     Array.isArray(gr.examStages) && gr.examStages.length === 0);
  ok("howToApply passed through",     gr.howToApply?.[0] === "Apply online at bpsc.bih.nic.in");
  ok("fee.rows General",              gr.fee?.rows[0].category === "General / OBC" && gr.fee?.rows[0].amount === 750);
  ok("fee.rows SC/ST",                gr.fee?.rows[1].category === "SC / ST / PwBD" && gr.fee?.rows[1].amount === 200);
  ok("fee.modes",                     gr.fee?.modes[0] === "Online");
  ok("provenance.status VERIFIED",    gr.provenance.status === "VERIFIED");
  ok("provenance.primarySourceUrl",   gr.provenance.primarySourceUrl === "https://bpsc.bih.nic.in/n73.pdf");
  ok("provenance.primarySourceType",  gr.provenance.primarySourceType === "OFFICIAL_NOTIFICATION");
  ok("provenance.lastVerifiedAt set", typeof gr.provenance.lastVerifiedAt === "string");
  ok("updates is []",                 Array.isArray(gr.updates) && gr.updates.length === 0);

  const grAny = gr as unknown as Record<string, unknown>;
  ok("no CMS internals leaked",
    !("draftState"       in grAny) &&
    !("recordRevision"   in grAny) &&
    !("lifecycle"        in grAny) &&
    !("sourceRecordRevision" in grAny)
  );
}

section("P2 — null classification fields produce empty strings, not invented values");

{
  const noClassSnap: PublishedRecruitmentSnapshot = {
    ...fullSnapshot,
    id: "nc-id", slug: "nc-slug", title: null, notificationNumber: null,
    primarySourceUrl: null,
    vacancies: { total: null, breakdown: null },
    financial: { feeGeneral: null, feeSCST: null, payScale: null, paymentModes: [] },
    howToApply: [], links: [], documents: [],
    classification: { shortDescription: null, category: null, state: null, qualification: null },
    provenanceStatus: "PARTIALLY_VERIFIED",
  };

  const gr = snapshotToGovernmentRecruitment(noClassSnap);
  ok("null shortDescription → ''",         gr.shortDescription === "");
  ok("null category → 'government' only",  gr.category === "government");
  ok("null state → '' (not invented)",     gr.state === "");
  ok("null qualification → '' (not invented)", (gr.qualification as string) === "");
  ok("null title → ''",                    gr.title === "");
  ok("null vacancies → 0",                 gr.totalVacancies === 0);
  ok("null vacancies display text",        gr.vacanciesDisplay === "Vacancies TBC");
  ok("empty links.apply → ''",            gr.links.apply === "");
  ok("no fee rows",                        gr.fee === undefined);
  ok("null primarySourceUrl → undefined",  gr.provenance.primarySourceUrl === undefined);
}

section("P3 — PSU govType maps to PSU Bank");

{
  const psuSnap: PublishedRecruitmentSnapshot = {
    ...fullSnapshot,
    govType: "PSU",
    classification: { shortDescription: null, category: "banking", state: "All India", qualification: "Graduate" },
  };
  const gr = snapshotToGovernmentRecruitment(psuSnap);
  ok("PSU → PSU Bank", gr.govType === "PSU Bank");
}

// ─── Live DB tests ─────────────────────────────────────────

async function main() {
  const RUN_ID   = randomUUID().slice(0, 8);
  const SLUG     = `phase-f-test-${RUN_ID}`;
  let createdRecordId = "";

  const adminRows = await sql`SELECT id FROM admins LIMIT 1`;
  if (adminRows.length === 0) {
    console.error("No admin found in DB — run admin-setup.ts first");
    process.exit(1);
  }
  const ADMIN_ID = adminRows[0].id as string;

  section("L1 — Create CMS record with classification (live Neon)");

  {
    const record = await createRecruitment({
      slug: SLUG,
      identity: {
        organizationId: "bpsc",
        organizationName: "Bihar Public Service Commission",
        govType: "State Govt",
        recruitmentYear: 2026,
        title: {
          value: "BPSC Phase F Test — 73rd CCE",
          status: "VERIFIED",
          evidenceIds: [],
          conflict: false,
          manuallyEdited: true,
        },
      },
      dates: {
        applicationOpenDate: { value: "2026-03-01", status: "VERIFIED", evidenceIds: [], conflict: false, manuallyEdited: true },
        applicationCloseDate: { value: "2026-04-01", status: "VERIFIED", evidenceIds: [], conflict: false, manuallyEdited: true },
      },
      vacancies: {
        total: { value: 555, status: "VERIFIED", evidenceIds: [], conflict: false, manuallyEdited: true },
      },
      financial: {},
      classification: {
        shortDescription: "BPSC 73rd Combined Competitive Exam — Phase F integration test.",
        category: "state-psc",
        state: "Bihar",
        qualification: "Graduate",
      },
      provenance: {
        status: "VERIFIED",
        lastVerifiedAt: "2026-09-20",
        primarySourceType: "OFFICIAL_NOTIFICATION",
        primarySourceUrl: "https://bpsc.bih.nic.in/test-notification.pdf",
      },
      adminId: ADMIN_ID,
    });

    createdRecordId = record.id;

    ok("record created",                  !!record.id);
    ok("slug correct",                    record.slug === SLUG);
    ok("draftState = DRAFT",              record.draftState === "DRAFT");
    ok("classification.shortDescription", record.classification?.shortDescription?.includes("Phase F") ?? false);
    ok("classification.category",         record.classification?.category === "state-psc");
    ok("classification.state",            record.classification?.state === "Bihar");
    ok("classification.qualification",    record.classification?.qualification === "Graduate");

    // Add official notification link required for publish gate
    await sql`
      UPDATE recruitments
      SET links = ${JSON.stringify([{
        type: "OFFICIAL_NOTIFICATION",
        label: "Notification PDF",
        url: "https://bpsc.bih.nic.in/test-notification.pdf",
        official: true,
      }])}
      WHERE id = ${record.id}
    `;
    ok("official link added for publish gate", true);
  }

  section("L2 — Approve, project, and publish the record (live Neon)");

  {
    const record = await getRecruitmentById(createdRecordId);
    if (!record) { ok("record found for approval", false, "null"); return; }

    const approved = await persistApproval(record, ADMIN_ID);
    ok("draftState = APPROVED",              approved.draftState === "APPROVED");

    const snapshot = projectToPublished(approved);
    ok("snapshot.slug",                      snapshot.slug === SLUG);
    ok("classification.category in snap",    snapshot.classification.category === "state-psc");
    ok("classification.state in snap",       snapshot.classification.state === "Bihar");
    ok("classification.qualification in snap", snapshot.classification.qualification === "Graduate");
    ok("classification.shortDesc in snap",   snapshot.classification.shortDescription?.includes("Phase F") ?? false);
    ok("no CMS internals in snapshot",
      !("draftState"     in (snapshot as unknown as Record<string, unknown>)) &&
      !("recordRevision" in (snapshot as unknown as Record<string, unknown>)) &&
      !("lifecycle"      in (snapshot as unknown as Record<string, unknown>))
    );

    const published = await persistPublication(approved, snapshot, PROJECTION_VERSION, ADMIN_ID);
    ok("draftState = PUBLISHED",             published.draftState === "PUBLISHED");
  }

  section("L3 — getPublishedBySlug resolves the record (live Neon)");

  {
    const snap = await getPublishedBySlug(SLUG);
    ok("snapshot found by slug",             snap !== null);
    ok("snapshot.slug",                      snap?.slug === SLUG);
    ok("snapshot.title",                     snap?.title === "BPSC Phase F Test — 73rd CCE");
    ok("snapshot.classification.state",      snap?.classification.state === "Bihar");
    ok("snapshot.classification.category",   snap?.classification.category === "state-psc");
    ok("snapshot.vacancies.total",           snap?.vacancies.total === 555);
    ok("official link in snapshot",          snap?.links.some(l => l.type === "OFFICIAL_NOTIFICATION") ?? false);
  }

  section("L4 — getPublishedSlugs includes the new slug (live Neon)");

  {
    const slugs = await getPublishedSlugs();
    ok("published slugs is array",           Array.isArray(slugs));
    ok("new slug in published slugs",        slugs.includes(SLUG));
  }

  section("L5 — Full adapter pipeline: live snapshot → GovernmentRecruitment");

  {
    const snap = await getPublishedBySlug(SLUG);
    if (!snap) { ok("snapshot for adapter test", false, "null"); return; }

    const gr = snapshotToGovernmentRecruitment(snap);
    ok("type government",                    gr.type === "government");
    ok("title through full pipeline",        gr.title === "BPSC Phase F Test — 73rd CCE");
    ok("category state-psc",                 gr.category === "state-psc");
    ok("state Bihar",                        gr.state === "Bihar");
    ok("qualification Graduate",             gr.qualification === "Graduate");
    ok("shortDescription present",           gr.shortDescription.includes("Phase F"));
    ok("totalVacancies 555",                 gr.totalVacancies === 555);
    ok("vacanciesDisplay",                   gr.vacanciesDisplay === "555 Posts");
    ok("links.notification",                 gr.links.notification === "https://bpsc.bih.nic.in/test-notification.pdf");
    ok("examStages safe []",                 gr.examStages.length === 0);
    ok("no draftState leaked",               !("draftState" in (gr as unknown as Record<string, unknown>)));
    ok("no recordRevision leaked",           !("recordRevision" in (gr as unknown as Record<string, unknown>)));
    ok("provenance.status",                  gr.provenance.status === "VERIFIED");
    ok("provenance.primarySourceType",       gr.provenance.primarySourceType === "OFFICIAL_NOTIFICATION");
  }

  section("L6 — Public getBySlug: CMS-first, static fallback, nonexistent → undefined");

  {
    const cmsJob = await getBySlug(SLUG);
    ok("CMS slug resolves",                  cmsJob !== undefined);
    ok("CMS job type government",            cmsJob?.type === "government");
    ok("CMS job title correct",              (cmsJob as { title?: string })?.title === "BPSC Phase F Test — 73rd CCE");

    const staticSlugs = getAllStaticSlugs();
    if (staticSlugs.length > 0) {
      const staticJob = await getBySlug(staticSlugs[0]);
      ok("static slug still resolves",       staticJob !== undefined);
    } else {
      ok("no static slugs — skipped",        true);
    }

    const notFound = await getBySlug(`not-a-real-slug-${RUN_ID}`);
    ok("nonexistent slug → undefined",       notFound === undefined);
  }

  section("L7 — getAllSlugs: CMS + static, no duplicates");

  {
    const allSlugs = await getAllSlugs();
    ok("getAllSlugs returns array",           Array.isArray(allSlugs));
    ok("CMS slug included",                  allSlugs.includes(SLUG));

    const staticSlugs = getAllStaticSlugs();
    if (staticSlugs.length > 0) {
      ok("static slugs still present",       staticSlugs.every(s => allSlugs.includes(s)));
    }
    ok("no duplicate slugs",                 new Set(allSlugs).size === allSlugs.length);
  }

  section("L8 — CMS record takes precedence for same slug");

  {
    const snap = await getPublishedBySlug(SLUG);
    const fromCms = snap ? snapshotToGovernmentRecruitment(snap) : undefined;
    const fromRepo = await getBySlug(SLUG);

    ok("repo title matches CMS snapshot",    fromCms?.title === (fromRepo as { title?: string })?.title);
    ok("repo category matches CMS snapshot", fromCms?.category === (fromRepo as { category?: string })?.category);
    ok("repo state matches CMS snapshot",    fromCms?.state === (fromRepo as { state?: string })?.state);
  }

  // ─── Cleanup ────────────────────────────────────────────

  section("Cleanup");

  {
    await sql`DELETE FROM published_recruitments WHERE recruitment_id = ${createdRecordId}`;
    await sql`DELETE FROM recruitment_audit_events WHERE recruitment_id = ${createdRecordId}`;
    await sql`DELETE FROM field_revisions WHERE recruitment_id = ${createdRecordId}`;
    await sql`DELETE FROM recruitments WHERE id = ${createdRecordId}`;
    ok("test record cleaned up", true);
  }
}

main().then(() => {
  console.log(`\n═══════════════════════════════════════`);
  console.log(`  Phase F Smoke Test`);
  console.log(`  ${passed} passed  ${failed} failed`);
  console.log(`═══════════════════════════════════════`);
  if (failed > 0) process.exit(1);
}).catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
