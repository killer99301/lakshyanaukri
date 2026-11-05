// ═══════════════════════════════════════════════════════════
// Discovery leads: the objects schema.sql creates (for the migration's check)
// ═══════════════════════════════════════════════════════════
//
// Pure. Kept beside schema.sql; the discovery-leads test checks the two agree.

export const DISCOVERY_OBJECTS = {
  tables: {
    discovery_leads: [
      "id", "lead_key", "kind", "title", "organization_id", "organization_name", "notification_number",
      "status", "status_reason", "notes", "status_changed_at", "status_changed_by",
      "match_kind", "match_recruitment_id", "match_reason", "match_confidence", "match_candidates", "related_leads",
      "first_seen_at", "last_seen_at", "seen_runs",
    ],
    discovery_lead_sources: [
      "id", "lead_id", "source_id", "source_name", "source_tier", "listing_url", "item_url", "item_fingerprint",
      "pdf_url", "title_seen", "nearby_date", "official", "first_seen_at", "last_seen_at", "seen_runs",
    ],
  } as Record<string, string[]>,
  indexes: ["idx_discovery_leads_status", "idx_discovery_leads_match", "idx_discovery_lead_sources_fingerprint"],
};

/** What is missing, as lines to print; empty when everything is there. */
export function discoveryProblems(columns: Array<{ table_name: string; column_name: string }>, indexes: string[]): string[] {
  const problems: string[] = [];
  for (const [table, wanted] of Object.entries(DISCOVERY_OBJECTS.tables)) {
    const have = new Set(columns.filter((c) => c.table_name === table).map((c) => c.column_name));
    if (have.size === 0) { problems.push(`table ${table} is missing`); continue; }
    for (const c of wanted) if (!have.has(c)) problems.push(`${table}.${c} is missing`);
  }
  for (const i of DISCOVERY_OBJECTS.indexes) if (!indexes.includes(i)) problems.push(`index ${i} is missing`);
  return problems;
}
