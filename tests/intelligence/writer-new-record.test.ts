// Phase 7: appendNewRecord tests (WNR1–WNR8)
//
// Tests the appendNewRecord() function in src/intelligence/writer.ts.
// All tests use a temp dataPath in intelligence-runs/ and a small
// injected governmentRecords array. The real government.ts is NEVER touched.
// productionWrites remains 0.

import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import type { GovernmentRecruitment, ExamStageStatus } from "@/types";
import { appendNewRecord } from "@/intelligence/writer";

// ─── Helpers ─────────────────────────────────────────────────

const TMP_DIR = join(process.cwd(), "intelligence-runs");

function tmpPath(): string {
  return join(TMP_DIR, `test-writer-new-${randomUUID()}.ts`);
}

const tempFiles: string[] = [];
function track(p: string): string { tempFiles.push(p); return p; }

function check(label: string, cond: boolean): void {
  console.log(`  ${cond ? "✅" : "❌"}  ${label}`);
  assert.ok(cond, label);
}

function makeMinimalDraft(overrides: Partial<GovernmentRecruitment> = {}): GovernmentRecruitment {
  return {
    id: `ssc-new-rec-${randomUUID().slice(0, 8)}`,
    slug: `ssc-new-rec-${randomUUID().slice(0, 8)}`,
    type: "government",
    title: "SSC CGL Combined Graduate Level 2027",
    organizationId: "ssc",
    organizationName: "Staff Selection Commission",
    notificationNumber: "Advt No. 01/2027",
    govType: "Central Govt",
    shortDescription: "Auto-discovered test record — not a real recruitment.",
    category: "ssc",
    state: "All India",
    qualification: "Graduate",
    postDate: "2027-01-15",
    totalVacancies: 0,
    vacanciesDisplay: "Vacancies not specified — verify from official notification",
    examStages: [{ name: "Details not yet declared", order: 1, status: "NOT_DECLARED" as ExamStageStatus }],
    application: { notificationDate: "2027-01-15", openDate: "2027-01-15", closeDate: "2027-01-15" },
    links: { apply: "https://ssc.gov.in", website: "https://ssc.gov.in" },
    provenance: {
      status: "NOT_VERIFIED",
      lastVerifiedAt: "2027-01-15",
      primarySourceUrl: "https://ssc.gov.in/home/latestNotices",
      primarySourceType: "OFFICIAL_WEBSITE",
    },
    ...overrides,
  };
}

function makeExistingRecord(): GovernmentRecruitment {
  return {
    id: "ssc-existing-001",
    slug: "ssc-existing-001",
    type: "government",
    title: "SSC CGL 2026",
    organizationId: "ssc",
    organizationName: "Staff Selection Commission",
    notificationNumber: "Advt No. 01/2026",
    govType: "Central Govt",
    shortDescription: "Existing canonical record.",
    category: "ssc",
    state: "All India",
    qualification: "Graduate",
    postDate: "2026-01-15",
    totalVacancies: 17000,
    vacanciesDisplay: "17,000 Vacancies",
    examStages: [{ name: "Tier I", order: 1, status: "SCHEDULED" as ExamStageStatus, dateIso: "2026-09-01", dateDisplay: "01 Sep 2026" }],
    application: { notificationDate: "2026-01-15", openDate: "2026-02-01", closeDate: "2026-03-01" },
    links: { notification: "https://ssc.gov.in/docs/cgl-2026.pdf", apply: "https://ssc.gov.in", website: "https://ssc.gov.in" },
    provenance: { status: "VERIFIED", lastVerifiedAt: "2026-01-15", primarySourceUrl: "https://ssc.gov.in/docs/cgl-2026.pdf", primarySourceType: "OFFICIAL_NOTIFICATION" },
  };
}

// ─── WNR1: Guard 1 — draft.type must be 'government' ─────────

console.log("\nWNR1: Guard 1 — non-government type is refused");

const g1draft = makeMinimalDraft({ type: "private" as "government" });
const g1path = track(tmpPath());
const g1result = appendNewRecord(g1draft, { dataPath: g1path, governmentRecords: [] });
check("WNR1: committed is false", !g1result.committed);
check("WNR1b: refuseReason mentions type", g1result.refuseReason?.includes("government") ?? false);
check("WNR1c: file was not written", !existsSync(g1path));

// ─── WNR2: Guard 2 — empty id is refused ─────────────────────

console.log("\nWNR2: Guard 2 — empty id is refused");

const g2draft = makeMinimalDraft({ id: "" });
const g2path = track(tmpPath());
const g2result = appendNewRecord(g2draft, { dataPath: g2path, governmentRecords: [] });
check("WNR2: committed is false", !g2result.committed);
check("WNR2b: refuseReason mentions id", g2result.refuseReason?.includes("id") ?? false);

// ─── WNR3: Guard 3 — empty slug is refused ───────────────────

console.log("\nWNR3: Guard 3 — empty slug is refused");

const g3draft = makeMinimalDraft({ slug: "   " });
const g3path = track(tmpPath());
const g3result = appendNewRecord(g3draft, { dataPath: g3path, governmentRecords: [] });
check("WNR3: committed is false", !g3result.committed);
check("WNR3b: refuseReason mentions slug", g3result.refuseReason?.includes("slug") ?? false);

// ─── WNR4: Guard 4 — duplicate id is refused ─────────────────

console.log("\nWNR4: Guard 4 — duplicate record id is refused");

const existing = makeExistingRecord();
const g4draft = makeMinimalDraft({ id: existing.id, slug: "unique-slug-for-g4" });
const g4path = track(tmpPath());
const g4result = appendNewRecord(g4draft, { dataPath: g4path, governmentRecords: [existing] });
check("WNR4: committed is false", !g4result.committed);
check("WNR4b: refuseReason mentions duplicate id", g4result.refuseReason?.includes(existing.id) ?? false);

// ─── WNR5: Guard 5 — duplicate slug is refused ───────────────

console.log("\nWNR5: Guard 5 — duplicate slug is refused");

const g5draft = makeMinimalDraft({ id: "unique-id-for-g5", slug: existing.slug });
const g5path = track(tmpPath());
const g5result = appendNewRecord(g5draft, { dataPath: g5path, governmentRecords: [existing] });
check("WNR5: committed is false", !g5result.committed);
check("WNR5b: refuseReason mentions duplicate slug", g5result.refuseReason?.includes(existing.slug) ?? false);

// ─── WNR6: Guard 6 — Trust Gate failure is refused ───────────

console.log("\nWNR6: Guard 6 — Trust Gate failure blocks append");

// Inject a draft with an invalid organizationId to trigger Trust Gate errors
const g6draft = makeMinimalDraft({ organizationId: "" });
const g6path = track(tmpPath());
const g6result = appendNewRecord(g6draft, { dataPath: g6path, governmentRecords: [] });
check("WNR6: committed is false (Trust Gate rejected)", !g6result.committed);
check("WNR6b: refuseReason mentions Trust Gate", g6result.refuseReason?.toLowerCase().includes("trust gate") ?? false);
check("WNR6c: file was not written", !existsSync(g6path));

// ─── WNR7: Successful append ──────────────────────────────────

console.log("\nWNR7: Successful append — valid draft + empty records");

const g7draft = makeMinimalDraft();
const g7path = track(tmpPath());
const g7result = appendNewRecord(g7draft, { dataPath: g7path, governmentRecords: [existing] });
check("WNR7: committed is true", g7result.committed);
check("WNR7b: changeType is NEW_NOTICE", g7result.changeType === "NEW_NOTICE");
check("WNR7c: file was written to temp path", existsSync(g7path));
check("WNR7d: existing record is preserved in written file", readFileSync(g7path, "utf-8").includes(existing.id));
check("WNR7e: new draft id appears in written file", readFileSync(g7path, "utf-8").includes(g7draft.id));
check("WNR7f: opportunityId matches draft.id", g7result.opportunityId === g7draft.id);

// ─── WNR8: Real government.ts not modified ───────────────────

console.log("\nWNR8: productionWrites invariant");

const realPath = join(process.cwd(), "src", "data", "government.ts");
const realContentsAfter = readFileSync(realPath, "utf-8");
check("WNR8: real government.ts was not modified", !realContentsAfter.includes(g7draft.id));

// ─── WNR9: Minimal-diff append to existing file ──────────────
// When the target file already exists (production path), appendNewRecord must use
// the text-append strategy: insert the new record before "\n];" without touching
// anything else. Existing record formatting must be character-for-character identical.

console.log("\nWNR9: Text-append strategy preserves existing file content");

import { writeFileSync as _writeFileSync } from "node:fs";

const g9existing = makeExistingRecord();
const g9draft = makeMinimalDraft();
const g9path = track(tmpPath());

// Write a minimal government.ts-style file with one record already in it
const g9initial =
  'import type { GovernmentRecruitment } from "@/types";\n' +
  "export const GOVERNMENT_RECRUITMENTS: GovernmentRecruitment[] = [\n" +
  `  ${JSON.stringify(g9existing, null, 2).split("\n").join("\n  ")}\n` +
  "];\n";
_writeFileSync(g9path, g9initial, "utf-8");

const g9result = appendNewRecord(g9draft, { dataPath: g9path, governmentRecords: [g9existing] });

const g9content = readFileSync(g9path, "utf-8");
check("WNR9: committed is true", g9result.committed);
check("WNR9b: existing record id is still in file", g9content.includes(g9existing.id));
check("WNR9c: new draft id appears in file", g9content.includes(g9draft.id));
// The initial content up to the closing bracket must be unchanged
const initialBeforeClose = g9initial.slice(0, g9initial.lastIndexOf("\n];"));
check("WNR9d: existing content is unchanged (minimal diff)", g9content.startsWith(initialBeforeClose));
check("WNR9e: file still ends with \\n];\\n", g9content.endsWith("\n];\n"));

// ─── Cleanup ──────────────────────────────────────────────────

for (const p of tempFiles) {
  if (existsSync(p)) unlinkSync(p);
}

console.log("\n✅ All WNR tests passed.\n");
