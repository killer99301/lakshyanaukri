// ═══════════════════════════════════════════════════════════
// Results, admit cards and answer keys shown on the public site
// ═══════════════════════════════════════════════════════════
//
// These lists are NOT maintained by hand. Each entry is a link an admin added
// to a published recruitment record (type RESULT, CUT_OFF, ADMIT_CARD or ANSWER_KEY)
// and that is either
//   - marked official, or
//   - a saved copy: our own copy of the document, recorded together with the
//     official address it was taken from. Always shown labelled as a copy.
// Any other link is ignored, so the site never lists a third-party page.

import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";

export type LifecycleKind = "result" | "admitCard" | "answerKey";

export interface LifecycleLink {
  id: string;
  kind: LifecycleKind;
  /** The link's own label, e.g. "Tier-I Result". */
  label: string;
  url: string;
  jobTitle: string;
  jobSlug: string;
  organization: string;
  /** When the record carrying the link was last published. */
  updatedAtIso: string;
  /** Present when the link is our saved copy rather than the official page. */
  savedCopy?: { from: string; host: string; on?: string };
}

export interface LifecycleLinks {
  results: LifecycleLink[];
  admitCards: LifecycleLink[];
  answerKeys: LifecycleLink[];
}

const KIND_BY_TYPE: Record<string, LifecycleKind> = {
  RESULT: "result",
  // Cut-off marks are published with results and are listed alongside them.
  CUT_OFF: "result",
  ADMIT_CARD: "admitCard",
  ANSWER_KEY: "answerKey",
};

const isHttp = (value: string | undefined): value is string => !!value && /^https?:\/\//i.test(value);

export const EMPTY_LIFECYCLE_LINKS: LifecycleLinks = { results: [], admitCards: [], answerKeys: [] };

function savedCopyOf(link: { savedFrom?: string; savedOn?: string }): LifecycleLink["savedCopy"] {
  if (!isHttp(link.savedFrom)) return undefined;
  try {
    return { from: link.savedFrom, host: new URL(link.savedFrom).hostname.replace(/^www\./, ""), on: link.savedOn };
  } catch {
    return undefined;
  }
}

/** Pure: the listable result / admit card / answer key links of one published record. */
export function lifecycleLinksOf(snap: PublishedRecruitmentSnapshot): LifecycleLink[] {
  const out: LifecycleLink[] = [];
  (snap.links ?? []).forEach((link, index) => {
    const kind = KIND_BY_TYPE[link.type];
    if (!kind || !isHttp(link.url)) return;
    const savedCopy = savedCopyOf(link);
    if (!link.official && !savedCopy) return;
    out.push({
      id: `${snap.id}-${index}`,
      kind,
      label: link.label,
      url: link.url,
      jobTitle: snap.title ?? snap.slug,
      jobSlug: snap.slug,
      organization: snap.organizationName,
      updatedAtIso: snap.projectedAt,
      ...(savedCopy ? { savedCopy } : {}),
    });
  });
  return out;
}

/** Pure: those links across all published records, newest first. */
export function lifecycleLinksFrom(snapshots: PublishedRecruitmentSnapshot[]): LifecycleLinks {
  const all = snapshots.flatMap(lifecycleLinksOf);
  all.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
  const of = (kind: LifecycleKind) => all.filter((l) => l.kind === kind);
  return { results: of("result"), admitCards: of("admitCard"), answerKeys: of("answerKey") };
}

/** Reads the lists for a page. Never throws: an unreachable database shows empty lists. */
export async function getLifecycleLinks(): Promise<LifecycleLinks> {
  try {
    const { getAllPublishedSnapshots } = await import("@/lib/cms/public-repository");
    return lifecycleLinksFrom(await getAllPublishedSnapshots());
  } catch {
    return EMPTY_LIFECYCLE_LINKS;
  }
}
