// ═══════════════════════════════════════════════════════════
// Reading a date the way people type it
// ═══════════════════════════════════════════════════════════
//
// Pure. The browser's date box splits into day, month and year boxes that
// fight pasting and typing. Date fields in the admin are plain text boxes
// instead, read here:
//
//   2026-10-28                         ISO, as stored
//   28-10-2026  28/10/2026  28.10.2026 day first, as Indian notices write it
//   28 Oct 2026  28th October, 2026    day, month name, year
//   Oct 28, 2026  October 28 2026      month name first
//
// Nothing is guessed. A two-digit year is refused, an impossible date is
// refused, and a numeric date that could be read either way (05-06-2026) is
// read day first, as notices write it, with a note saying so, so the admin
// sees how it was read before saving.

export type DateReading =
  | { ok: true; iso: string; note?: string }
  | { ok: false; error: string }
  | { ok: null };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad = (n: number) => String(n).padStart(2, "0");

function build(year: number, month: number, day: number): DateReading {
  if (year < 1900 || year > 2100) return { ok: false, error: "Check the year." };
  if (month < 1 || month > 12) return { ok: false, error: "There is no such month." };
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return { ok: false, error: `${NAMES[month]} ${year} has no day ${day}.` };
  }
  return { ok: true, iso: `${year}-${pad(month)}-${pad(day)}` };
}

export function readDate(input: string): DateReading {
  const text = input.trim().replace(/\s+/g, " ").replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return { ok: null };

  // 2026-10-28 (also 2026/10/28): year first is never ambiguous.
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  // 28-10-2026, 28/10/2026, 28.10.2026: day first.
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text);
  if (m) {
    if (m[3].length !== 4) return { ok: false, error: "Type the full year, for example 2026." };
    const day = Number(m[1]);
    const month = Number(m[2]);
    const read = build(Number(m[3]), month, day);
    if (read.ok && day <= 12 && month <= 12 && day !== month) {
      return { ...read, note: `Read day first, as notices write it. If you meant ${month} ${NAMES[day]}, type it with the month name.` };
    }
    if (!read.ok && month > 12 && day <= 12) return { ok: false, error: "Dates are read day first (28-10-2026). Type it with the month name to be sure." };
    return read;
  }

  // 28 Oct 2026
  m = /^(\d{1,2})[ -]([a-z]+)\.?[ -](\d{2,4})$/i.exec(text);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) return { ok: false, error: `“${m[2]}” is not a month.` };
    if (m[3].length !== 4) return { ok: false, error: "Type the full year, for example 2026." };
    return build(Number(m[3]), month, Number(m[1]));
  }

  // Oct 28 2026
  m = /^([a-z]+)\.? (\d{1,2}) (\d{2,4})$/i.exec(text);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) return { ok: false, error: `“${m[1]}” is not a month.` };
    if (m[3].length !== 4) return { ok: false, error: "Type the full year, for example 2026." };
    return build(Number(m[3]), month, Number(m[2]));
  }

  return { ok: false, error: "Not a date this box can read. Try 28 Oct 2026, 28-10-2026 or 2026-10-28." };
}

/** How a stored date is shown in the box: 2026-10-28 → "28 Oct 2026". */
export function showDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${NAMES[Number(m[2])].slice(0, 3)} ${m[1]}`;
}
