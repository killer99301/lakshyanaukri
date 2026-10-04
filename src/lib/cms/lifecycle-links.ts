// ═══════════════════════════════════════════════════════════
// Results, admit cards and answer keys shown on the public site
// ═══════════════════════════════════════════════════════════
//
// These lists are NOT maintained by hand. Each entry is a link an admin added
// to a published recruitment record and marked official (type RESULT,
// ADMIT_CARD or ANSWER_KEY). Nothing appears until such a link exists, so the
// site never shows a result or admit card it cannot point to.

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
}

export interface LifecycleLinks {
  results: LifecycleLink[];
  admitCards: LifecycleLink[];
  answerKeys: LifecycleLink[];
}

const KIND_BY_TYPE: Record<string, LifecycleKind> = {
  RESULT: "result",
  ADMIT_CARD: "admitCard",
  ANSWER_KEY: "answerKey",
};

export const EMPTY_LIFECYCLE_LINKS: LifecycleLinks = { results: [], admitCards: [], answerKeys: [] };

/** Pure: official result / admit card / answer key links from published snapshots, newest first. */
export function lifecycleLinksFrom(snapshots: PublishedRecruitmentSnapshot[]): LifecycleLinks {
  const all: LifecycleLink[] = [];
  for (const snap of snapshots) {
    (snap.links ?? []).forEach((link, index) => {
      const kind = KIND_BY_TYPE[link.type];
      if (!kind || !link.official || !/^https?:\/\//i.test(link.url)) return;
      all.push({
        id: `${snap.id}-${index}`,
        kind,
        label: link.label,
        url: link.url,
        jobTitle: snap.title ?? snap.slug,
        jobSlug: snap.slug,
        organization: snap.organizationName,
        updatedAtIso: snap.projectedAt,
      });
    });
  }
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
