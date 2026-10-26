// ═══════════════════════════════════════════════════════════
// What the importer migration must leave in the database
// ═══════════════════════════════════════════════════════════
//
// Pure. The migration script and the tests read the live catalogue and pass
// it here; anything missing, of the wrong type or nullability, disabled or
// set up differently is reported in plain words.

type Col = [type: string, nullable: boolean];

const T = "text", U = "uuid", J = "jsonb", TS = "timestamp with time zone", I = "integer", D = "date";
const V = "character varying", C = "character", B = "bigint", A = "ARRAY";

export const IMPORTER_OBJECTS = {
  tables: {
    recruitment_imports: {
      import_id: [U, false], mode: [V, false], recruitment_id: [U, true], base_revision: [V, true],
      identity_key: [T, true], org_year_key: [T, true], status: [V, false], proposal: [J, false],
      selected_items: [A, true], duplicate_override: [J, true], result: [J, true], created_by: [U, false],
      created_at: [TS, false], applied_by: [U, true], applied_at: [TS, true],
    },
    recruitment_sources: {
      id: [U, false], content_sha256: [C, false], content_kind: [V, false], byte_size: [I, false],
      page_count: [I, true], text: [T, false], first_seen_at: [TS, false],
    },
    recruitment_source_retrievals: {
      id: [U, false], import_id: [U, false], source_id: [U, false], declared_kind: [V, false],
      version_label: [T, true], document_date: [D, true], method: [V, false], origin_url: [T, true],
      origin_host: [T, true], origin_role: [V, false], origin_purposes: [A, false], authenticity: [V, false],
      authenticity_method: [V, true], matched_retrieval_id: [U, true], attested_by: [U, true],
      attested_at: [TS, true], attestation_note: [T, true], retrieved_by: [U, false], retrieved_at: [TS, false],
    },
    recruitment_field_claims: {
      id: [U, false], seq: [B, false], recruitment_id: [U, false], field_path: [V, false], kind: [V, false],
      value: [J, true], value_hash: [C, true], retrieval_id: [U, true], page: [I, true], quote: [T, true],
      table_cell: [J, true], review_scope: [J, true], field_revision_id: [U, true], revokes_claim_id: [U, true],
      justification: [T, true], public_note: [T, true], import_id: [U, true], claimed_by: [U, true], claimed_at: [TS, false],
    },
    recruitment_claim_supersessions: {
      superseding_claim_id: [U, false], superseded_claim_id: [U, false], decided_by: [U, false], decided_at: [TS, false],
    },
  } as Record<string, Record<string, Col>>,
  triggers: [
    ["trg_field_claims_append_only", "recruitment_field_claims"],
    ["trg_field_claims_check", "recruitment_field_claims"],
    ["trg_supersessions_append_only", "recruitment_claim_supersessions"],
    ["trg_supersessions_check", "recruitment_claim_supersessions"],
    ["trg_sources_append_only", "recruitment_sources"],
    ["trg_retrievals_append_only", "recruitment_source_retrievals"],
    ["trg_retrievals_check", "recruitment_source_retrievals"],
    ["trg_imports_guard", "recruitment_imports"],
  ] as Array<[string, string]>,
  functions: [
    "cms_apply_import", "cms_import_item_holds", "cms_job_duplicates", "cms_create_job_checked",
    "cms_create_job_from_draft",
    "cms_importer_refuse_change", "cms_importer_check_retrieval", "cms_importer_check_supersession",
    "cms_importer_check_claim", "cms_importer_guard_import",
  ],
  indexes: [
    "idx_recruitment_imports_recruitment", "idx_source_retrievals_source", "idx_source_retrievals_import",
    "idx_field_claims_lookup", "uq_field_claims_revoked_once",
  ],
};

export interface Catalogue {
  columns: Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>;
  triggers: Array<{ name: string; table_name: string; enabled: string }>;
  functions: Array<{ name: string; security_definer: boolean; config: string }>;
  indexes: string[];
}

export function describeProblems(cat: Catalogue): string[] {
  const problems: string[] = [];
  for (const [table, cols] of Object.entries(IMPORTER_OBJECTS.tables)) {
    const present = cat.columns.filter((c) => c.table_name === table);
    if (present.length === 0) { problems.push(`table ${table} is missing`); continue; }
    for (const [name, [type, nullable]] of Object.entries(cols)) {
      const c = present.find((p) => p.column_name === name);
      if (!c) { problems.push(`${table}.${name} is missing`); continue; }
      if (c.data_type !== type) problems.push(`${table}.${name} is ${c.data_type}, expected ${type}`);
      if ((c.is_nullable === "YES") !== nullable) problems.push(`${table}.${name} should be ${nullable ? "nullable" : "NOT NULL"}`);
    }
    for (const c of present) if (!(c.column_name in cols)) problems.push(`${table}.${c.column_name} is not expected`);
  }
  for (const [name, table] of IMPORTER_OBJECTS.triggers) {
    const t = cat.triggers.find((x) => x.name === name && x.table_name === table);
    if (!t) problems.push(`trigger ${name} on ${table} is missing`);
    else if (t.enabled === "D") problems.push(`trigger ${name} on ${table} is disabled`);
  }
  for (const name of IMPORTER_OBJECTS.functions) {
    const f = cat.functions.find((x) => x.name === name);
    if (!f) { problems.push(`function ${name} is missing`); continue; }
    if (f.security_definer) problems.push(`function ${name} must not be SECURITY DEFINER`);
    if (!/search_path=pg_catalog, ?pg_temp/.test(f.config)) problems.push(`function ${name} must fix search_path to pg_catalog, pg_temp`);
  }
  for (const name of IMPORTER_OBJECTS.indexes) if (!cat.indexes.includes(name)) problems.push(`index ${name} is missing`);
  return problems;
}
