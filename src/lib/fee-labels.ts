// ═══════════════════════════════════════════════════════════
// Public wording for application fees (owner's decision, 11 Nov 2026)
// ═══════════════════════════════════════════════════════════
//
// The CMS keeps two fee amounts: one for General candidates and one for SC /
// ST / PwBD. The General amount is shown as "General (UR)" only: notices do
// not all charge EWS and OBC candidates the same (SBI Fire charges ₹750 to
// General, EWS and OBC alike; others do not), so the label never claims
// categories the record does not hold. Categories without a row of their own
// are pointed to the notification; no amount is inferred for them. Pure.

export const GENERAL_FEE_LABEL = "General (UR)";
export const RESERVED_FEE_LABEL = "SC / ST / PwBD";

/** The line under the fee table naming the categories it has no row for, or null when it has none to name. */
export function feeCategoriesNote(rows: Array<{ category: string }>): string | null {
  if (rows.length === 0) return null;
  const missing = ["EWS", "OBC"];
  if (!rows.some((r) => r.category === RESERVED_FEE_LABEL)) missing.push("SC", "ST", "PwBD");
  const list = missing.length === 2 ? missing.join(" and ") : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Fees for ${list} candidates are not listed separately here. Check the official notification for them.`;
}
