#!/usr/bin/env node
// Gives never-published drafts the shorter address the create form now builds.
//
// Only touches records that are still DRAFT or APPROVED, have never been
// published, and were created on or after the date given with --since
// (so old smoke-test records are left alone). A published job's address is
// never changed by this script, or by anything else.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/cms-shorten-draft-slugs.ts --since=2026-10-06
//
// Without --apply it only prints what it would do.
import { sql } from "@/lib/db";
import { buildSlug } from "@/lib/cms/slug";
import { renameUnpublishedSlug } from "@/lib/cms/repository";

async function main() {
  const apply = process.argv.includes("--apply");
  const since = process.argv.find((a) => a.startsWith("--since="))?.slice("--since=".length);
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    console.error("Give the earliest creation date to touch, for example --since=2026-10-06");
    process.exit(1);
  }

  const rows = await sql`
    SELECT r.id, r.slug, r.organization_id, r.title_text, r.identity
    FROM recruitments r
    WHERE r.draft_state IN ('DRAFT', 'APPROVED')
      AND r.published_at IS NULL
      AND r.created_at >= ${since}::date
      AND NOT EXISTS (SELECT 1 FROM published_recruitments p WHERE p.recruitment_id = r.id)
    ORDER BY r.created_at
  `;

  let changed = 0;
  for (const r of rows) {
    const identity = r.identity as { recruitmentYear?: number };
    const title = String(r.title_text ?? "");
    if (!title || !identity.recruitmentYear) continue;
    const next = buildSlug(String(r.organization_id), title, identity.recruitmentYear);
    if (next === r.slug) {
      console.log(`  same     ${r.slug}`);
      continue;
    }
    if (!apply) {
      console.log(`  would    ${r.slug}\n        →  ${next}`);
      continue;
    }
    const ok = await renameUnpublishedSlug(String(r.id), next);
    console.log(`  ${ok ? "renamed " : "SKIPPED "} ${r.slug}\n        →  ${next}`);
    if (ok) changed += 1;
  }
  console.log(apply ? `\n${changed} address(es) changed.` : `\nNothing changed. Add --apply to rename.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
