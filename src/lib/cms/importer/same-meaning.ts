// ═══════════════════════════════════════════════════════════
// Importer: do two read values say the same thing?
// ═══════════════════════════════════════════════════════════
//
// Pure. The code reader and the AI reader can write the same fact in different
// forms: one keeps the passage it read the value from, one adds an empty list,
// one ends a step with a full stop, one files "no negative marking" as a note.
// Those are the same value. A different number, date, name, step or a list split
// differently is not: that is a real difference, and it stays one.
//
// Only meaning-preserving changes are made here (never a guess):
//   - the passage kept with a value (`evidence`) is not part of the value;
//   - empty parts (null, "", [], {}) say nothing;
//   - spaces are collapsed and a trailing full stop, semicolon or comma is dropped;
//   - in an exam pattern, a note about negative marking is the negative-marking line;
//   - links are judged by address and type (as before).
// Two values are "compatible" when, after that, one says everything the other says
// (the other may leave a part out, never say it differently).
//
// Stored value hashes are not changed (they stay as before): this is only used to
// decide whether values disagree.

/** Links are judged by address and type (the same rule as the preview's `comparable`). */
function comparable(fieldPath: string, value: unknown): unknown {
  if (fieldPath.startsWith("links#") && value && typeof value === "object") {
    const l = value as { url?: string; type?: string };
    return { type: l.type, url: l.url };
  }
  return value;
}

const NEGATIVE_MARKING = /\bnegative\s+marking\b|\bpenalty\b.*\bwrong\b|\bwrong\s+answers?\b/i;

function clean(v: unknown): unknown {
  if (typeof v === "string") {
    const s = v.replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "").trim();
    return s === "" ? undefined : s;
  }
  if (Array.isArray(v)) {
    const a = v.map(clean).filter((x) => x !== undefined);
    return a.length === 0 ? undefined : a;
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "evidence") continue;
      const c = clean(x);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return v === null ? undefined : v;
}

/** A paper's note that is the negative-marking statement is filed as that statement. */
function examPaper(p: unknown): unknown {
  if (!p || typeof p !== "object" || Array.isArray(p)) return p;
  const o = { ...(p as Record<string, unknown>) };
  if (typeof o.note === "string" && o.negativeMarking === undefined && NEGATIVE_MARKING.test(o.note)) {
    o.negativeMarking = o.note;
    delete o.note;
  }
  return o;
}

/** The value in the form its meaning is judged on. */
export function canonicalForm(fieldPath: string, value: unknown): unknown {
  let v = comparable(fieldPath, value);
  if (fieldPath === "examPattern" && Array.isArray(v)) v = v.map(examPaper);
  return clean(v);
}

/** `a` says nothing that `b` does not say the same way (b may say more). */
function covers(a: unknown, b: unknown): boolean {
  if (a === undefined) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => covers(x, b[i]));
  if (a && typeof a === "object") {
    if (!b || typeof b !== "object" || Array.isArray(b)) return false;
    return Object.entries(a as Record<string, unknown>).every(([k, x]) => covers(x, (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

/** The two values say the same thing, or one only adds parts the other leaves out. */
export function compatible(fieldPath: string, a: unknown, b: unknown): boolean {
  const ca = canonicalForm(fieldPath, a), cb = canonicalForm(fieldPath, b);
  return covers(ca, cb) || covers(cb, ca);
}

/** Within `whole`, `part`'s text may be only a piece of it ("2 years …" within "2 years …; OR 3 years …"). */
function within(part: unknown, whole: unknown): boolean {
  if (part === undefined) return true;
  if (typeof part === "string") return typeof whole === "string" && whole.includes(part);
  if (Array.isArray(part)) return Array.isArray(whole) && part.length === whole.length && part.every((x, i) => within(x, whole[i]));
  if (part && typeof part === "object") {
    if (!whole || typeof whole !== "object" || Array.isArray(whole)) return false;
    return Object.entries(part as Record<string, unknown>).every(([k, x]) => within(x, (whole as Record<string, unknown>)[k]));
  }
  return part === whole;
}

/**
 * The saved value leaves out part of what a source states: everything saved is in the source's value, and the
 * source says more (a part the saved value lacks, such as an experience requirement, or text of which the saved
 * text is only a piece, such as one of two alternative pathways). Directional: a source that says less than the
 * saved value is never an omission. Forms of the same value (see canonicalForm) are not an omission.
 */
export function leavesOut(fieldPath: string, saved: unknown, sourceValue: unknown): boolean {
  const s = canonicalForm(fieldPath, saved), c = canonicalForm(fieldPath, sourceValue);
  if (s === undefined || c === undefined) return false;
  return within(s, c) && !covers(c, s);
}

export type DisagreementKind =
  /** The sources disagree: no value is given (in some reading) by every source. */
  | "SOURCES"
  /** The sources can agree, but one source was read two different ways, or itself gives two different values. */
  | "READINGS"
  /** The saved value leaves out part of what a source states (an omission, not a difference of form). */
  | "OMITTED";

/**
 * Whether the read values of one field disagree, and how. `retrievalId` identifies the source each value came from.
 * Formatting-only differences are not a disagreement. A real difference inside one source is never hidden: it is
 * READINGS (the admin sees it and acknowledges it, like a disagreement between sources).
 */
export function disagreement(fieldPath: string, claims: Array<{ value: unknown; retrievalId: string | null }>): DisagreementKind | null {
  if (claims.length < 2) return null;
  let anyIncompatible = false;
  for (let i = 0; i < claims.length && !anyIncompatible; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      if (!compatible(fieldPath, claims[i].value, claims[j].value)) { anyIncompatible = true; break; }
    }
  }
  if (!anyIncompatible) return null;
  const sources = [...new Set(claims.map((c) => c.retrievalId ?? "?"))];
  if (sources.length > 1) {
    // The sources agree when one value (as some source gave it) is compatible with something every source gave.
    const agreed = claims.some((v) => sources.every((s) => claims.some((c) => (c.retrievalId ?? "?") === s && compatible(fieldPath, v.value, c.value))));
    if (!agreed) return "SOURCES";
  }
  return "READINGS";
}

/** Values grouped by meaning: compatible values share a group (the fuller one is kept as the group's value). */
export function groupByMeaning<T extends { value: unknown }>(fieldPath: string, items: T[]): Array<{ value: unknown; members: T[] }> {
  const groups: Array<{ value: unknown; members: T[] }> = [];
  for (const it of items) {
    const g = groups.find((x) => compatible(fieldPath, x.value, it.value));
    if (!g) { groups.push({ value: it.value, members: [it] }); continue; }
    g.members.push(it);
    // Keep the value that says more (the other leaves parts out).
    if (covers(canonicalForm(fieldPath, g.value), canonicalForm(fieldPath, it.value))) g.value = it.value;
  }
  return groups;
}
