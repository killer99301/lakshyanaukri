// ═══════════════════════════════════════════════════════════
// Reading post-wise eligibility typed as "Post | qualification" lines
// ═══════════════════════════════════════════════════════════
//
// Client-safe and pure. Used while the admin types (to show what will be
// saved and which lines are wrong) and again on save, so the two can never
// disagree. Lines are stored as structured rows, not as the typed text.

import type { CmsRecruitmentPost } from "@/types/recruitment-record";

export const MAX_ELIGIBILITY_ROWS = 80;

export interface EligibilityRead {
  posts: CmsRecruitmentPost[];
  /** Lines that cannot be saved as written, with their line number as typed. */
  problems: Array<{ line: number; message: string }>;
  /** Things worth a second look that do not stop a save. */
  warnings: string[];
}

/**
 * `existing` is what the record holds now: anything on a row that the form
 * does not show (a post's pay scale, for one) stays with it while the post
 * name is unchanged.
 */
export function readEligibilityLines(text: string, existing: CmsRecruitmentPost[] = []): EligibilityRead {
  const posts: CmsRecruitmentPost[] = [];
  const problems: EligibilityRead["problems"] = [];
  const warnings: string[] = [];
  const seen = new Map<string, number>();

  text.replace(/\r/g, "").split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const n = index + 1;
    const cut = line.indexOf("|");
    if (cut === -1) {
      problems.push({ line: n, message: `Line ${n} has no “|”. Write it as “Post | qualification”, for example “Clerk | Graduate in any discipline”.` });
      return;
    }
    const post = line.slice(0, cut).trim().replace(/\s+/g, " ");
    const qualification = line.slice(cut + 1).split(";").map((q) => q.trim()).filter(Boolean);
    if (!post) {
      problems.push({ line: n, message: `Line ${n} has no post name before the “|”.` });
      return;
    }
    if (qualification.length === 0) {
      problems.push({ line: n, message: `Line ${n} has no qualification after the “|”.` });
      return;
    }
    const key = post.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) warnings.push(`“${post}” is on line ${first} and again on line ${n}.`);
    else seen.set(key, n);

    const before = existing.find((p) => p.post === post);
    posts.push({ ...(before ?? {}), post, qualification });
  });

  if (posts.length + problems.length > MAX_ELIGIBILITY_ROWS) {
    problems.push({ line: 0, message: `At most ${MAX_ELIGIBILITY_ROWS} posts.` });
  }
  return { posts, problems, warnings };
}
