// ═══════════════════════════════════════════════════════════
// KNOWN DEFECT (found in Stage C, C1; NOT fixed): a "(continued)" heading
// ═══════════════════════════════════════════════════════════
//
// A reproduction, not a test (it is not run by any suite). The code table
// reader joins a table that runs on to the next page. When that page starts
// with a "(continued)" heading and the column heading printed again, the
// first row there takes both lines into its name. The bank of row 3 is read
// as "Annexure I (continued) Sr. No. Name of the Bank SC ST OBC EWS UR Total
// 3 Gamma Gramin Bank". Its figures are right. The same page without those
// two lines reads correctly.
//
// Documented in docs/known-defects/continued-heading.md. Fixing it needs the
// owner's go-ahead (it belongs with B2.5, tables across pages). C3's table
// review must let a person catch such a row label.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/known-defect-continued-heading.repro.ts

import { boot } from "./boot";
import { makePdf } from "./pdf-fixture";
import type { VacancyTable } from "@/lib/vacancy-table";

const PAGE1 = "Institute of Banking Personnel Selection\nAnnexure I\nTentative vacancies\nSr. No. Name of the Bank SC ST OBC EWS UR Total\n1 Alpha Gramin Bank 2 1 3 1 3 10\n2 Beta Gramin Bank 2 1 3 1 5 12";
const WITH_HEADING = "Annexure I (continued)\nSr. No. Name of the Bank SC ST OBC EWS UR Total\n3 Gamma Gramin Bank 1 1 2 1 3 8\nTotal 5 3 8 3 11 30";
const WITHOUT_HEADING = "3 Gamma Gramin Bank 1 1 2 1 3 8\nTotal 5 3 8 3 11 30";

(async () => {
  const { adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  for (const [name, page2, year] of [["with the (continued) heading", WITH_HEADING, 2026], ["without it", WITHOUT_HEADING, 2027]] as const) {
    const p = await service.previewImport({
      adminId, mode: "NEW", apiKey: undefined,
      newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year, title: "TEST RECORD continued-heading repro", govType: "PSU" },
      sources: [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: makePdf([PAGE1, page2]), url: "https://www.ibps.in/repro.pdf", attestation: "a test document" }],
    } as never);
    const t = (p.proposal as unknown as { items: Array<{ fieldPath: string; value: unknown }> }).items.find((i) => i.fieldPath === "vacancies.table")?.value as VacancyTable | undefined;
    console.log(`\n${name}:`);
    for (const r of t?.rows ?? []) console.log(`  page ${r.source.page}: bank "${r.at.bank}", total ${r.total}`);
    const bad = (t?.rows ?? []).filter((r) => /continued|Name of the Bank/i.test(r.at.bank ?? ""));
    console.log(`  → ${bad.length ? `DEFECT PRESENT: ${bad.length} row label(s) hold heading lines` : "row labels clean"}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
