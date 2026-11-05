// Discovery: a lead's notice number as a key for matching. Pure and client-safe (the inbox says when one is not used).

/**
 * A notice number as a comparable key: letters and digits only, upper case. None when it is too short, or when
 * its only number is a year: the portal reader takes "XV 2026", "CGL 2026" or "XV/2026" out of a title such as
 * "IBPS RRB XV 2026 Corrigendum", and such a fragment is shared by every notice of that exam and year. Used as
 * identity it would merge different updates into one lead and tie a lead to the wrong job, so it is not one:
 * the lead is matched by its address and title instead (strong or possible, never a duplicate). Kept on the
 * lead as read, and said there.
 */
export function noticeKey(n: string | null | undefined): string | null {
  // The label is not the number: "Advt. No. 05/2026" and "05/2026" are the same notice.
  const bare = (n ?? "").trim().replace(/^(?:(?:advt|advertisement|notification|notice|employment notice)\.?\s*)?(?:no|number)\.?\s*[:.\-]?\s*/i, "");
  const k = bare.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (k.length < 4 || !/\d/.test(k)) return null;
  // A number besides a year (19xx or 20xx): "05/2026", "CEN 05/2026", "HO:HRM:REC:AO:1:2026" count; "XV 2026" does not.
  const withoutYears = bare.replace(/(?<!\d)(?:19|20)\d{2}(?!\d)/g, " ");
  return /\d/.test(withoutYears) ? k : null;
}

/** Whether a lead's notice number is used to match jobs. */
export const usableNotice = (n: string | null | undefined) => noticeKey(n) !== null;
