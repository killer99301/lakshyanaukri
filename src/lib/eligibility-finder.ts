// ═══════════════════════════════════════════════════════════
// "Which jobs can I apply for?" — one visitor against every open job
// ═══════════════════════════════════════════════════════════
//
// Pure functions, run in the visitor's browser. Nothing they type is stored
// or sent anywhere.
//
// It covers every kind of job on the site: government recruitments, private
// jobs and internships.
//
// For each job still open (or not yet open) it answers two questions from
// what is on the record: is the visitor's age inside the limit on the
// notice's cut-off date, and do they hold the lowest qualification any post
// asks for. The age part is the same check the job page uses (eligibility.ts).
//
// It never guesses in the visitor's favour:
//   - no age limit or no cut-off date on record → "check the notice"
//   - a qualification that only sometimes counts (a diploma where 12th is
//     asked) → "check the notice"
// and it only ever says a job is ruled out when the record plainly says so.

import type { AgeLimit, Opportunity, Qualification } from "@/types";
import { checkAge, type AgeCheck, type CasteCategory } from "@/lib/eligibility";

export interface FinderInput {
  dobIso: string;
  category: CasteCategory;
  pwbd: boolean;
  qualification: Qualification;
}

export type FinderVerdict = "ELIGIBLE" | "CHECK" | "NOT_ELIGIBLE";
export type PartVerdict = "OK" | "CHECK" | "NO";

export interface FinderPart {
  verdict: PartVerdict;
  /** One plain sentence for the visitor. */
  note: string;
}

export interface FinderResult {
  job: FinderJob;
  verdict: FinderVerdict;
  age: FinderPart;
  qualification: FinderPart;
}

/** The few fields of a job the finder needs; everything else stays on the server. */
export interface FinderJob {
  /** Government recruitments set an age limit; private jobs and internships usually set none. */
  kind: Opportunity["type"];
  slug: string;
  title: string;
  organizationName: string;
  qualification: Qualification;
  ageLimit?: AgeLimit;
  closeDate: string;
  openDate: string;
  vacancies?: number;
}

export const QUALIFICATION_OPTIONS: Qualification[] = ["10th Pass", "12th Pass", "ITI", "Diploma", "Graduate", "Post Graduate"];

export function toFinderJob(job: Opportunity, vacancies?: number): FinderJob {
  return {
    kind: job.type,
    slug: job.slug,
    title: job.title,
    organizationName: job.organizationName,
    qualification: job.qualification,
    ...(job.type === "government" && job.ageLimit ? { ageLimit: job.ageLimit } : {}),
    closeDate: job.application.closeDate,
    openDate: job.application.openDate,
    ...(vacancies ? { vacancies } : {}),
  };
}

// ─── Age ──────────────────────────────────────────────────

const INSIDE = new Set(["WITHIN", "WITHIN_RELAXED"]);

function ageNote(check: AgeCheck): FinderPart {
  switch (check.verdict) {
    case "WITHIN":
      return { verdict: "OK", note: "Your age is within the limit." };
    case "WITHIN_RELAXED":
      return { verdict: "OK", note: `Your age is within the limit with the ${check.relaxation?.years}-year relaxation for your category.` };
    case "CHECK_NOTICE":
      return { verdict: "CHECK", note: "You have reached the upper age limit; most notices count that as over the limit." };
    case "TOO_YOUNG":
      return { verdict: "NO", note: "You are below the minimum age." };
    case "TOO_OLD":
      return { verdict: "NO", note: "You are above the upper age limit." };
    default:
      return { verdict: "CHECK", note: check.reason ?? "The age limit for this job is not on record yet." };
  }
}

/** The visitor's age against one job. With ages set post by post, any one post that fits is enough. */
export function ageFor(limit: AgeLimit | undefined, input: FinderInput): FinderPart {
  if (!limit) return { verdict: "CHECK", note: "The age limit for this job is not on record yet." };

  const posts = limit.postWise ?? [];
  if (posts.length === 0) return ageNote(checkAge(limit, input.dobIso, input.category, input.pwbd));

  const checks = posts.map((post) => ({
    post: post.post,
    check: checkAge(
      { min: post.min, max: post.max, bornFrom: post.bornFrom, bornTo: post.bornTo, asOf: limit.asOf, relaxation: limit.relaxation },
      input.dobIso, input.category, input.pwbd,
    ),
  }));
  const inside = checks.filter((c) => INSIDE.has(c.check.verdict));
  if (inside.length > 0) {
    const names = inside.slice(0, 3).map((c) => c.post).join(", ");
    return {
      verdict: "OK",
      note: inside.length === posts.length
        ? "Your age is within the limit for every post."
        : `Your age is within the limit for ${inside.length} of ${posts.length} posts: ${names}${inside.length > 3 ? " and more" : ""}.`,
    };
  }
  if (checks.some((c) => c.check.verdict === "CHECK_NOTICE" || c.check.verdict === "UNKNOWN")) {
    return { verdict: "CHECK", note: "Your age could not be confirmed for any post from what is on record." };
  }
  return {
    verdict: "NO",
    note: checks.every((c) => c.check.verdict === "TOO_YOUNG") ? "You are below the minimum age for every post." : "Your age is outside the limit for every post.",
  };
}

// ─── Qualification ────────────────────────────────────────

// School and degree levels sit on one ladder. ITI and Diploma do not: they
// are trade and technical qualifications taken after 10th.
const LADDER: Partial<Record<Qualification, number>> = { "10th Pass": 1, "12th Pass": 2, Graduate: 3, "Post Graduate": 4 };

/** What the visitor holds against the lowest qualification any post of the job asks for. */
export function qualificationFor(needed: Qualification, held: Qualification): FinderPart {
  const ok = (note: string): FinderPart => ({ verdict: "OK", note });
  const check = (note: string): FinderPart => ({ verdict: "CHECK", note });
  const no = (note: string): FinderPart => ({ verdict: "NO", note });

  if (needed === held) return ok(`You hold the qualification asked for (${needed}).`);

  if (needed === "ITI" || needed === "Diploma") {
    // Only the highest qualification is asked, so a graduate may hold one too.
    return check(`This job asks for ${needed === "ITI" ? "an ITI certificate" : "a diploma"}, usually in a named trade or branch.`);
  }
  // Everyone with ITI or a diploma has passed 10th.
  if (needed === "10th Pass") return ok("You hold more than the 10th pass asked for.");

  if (held === "ITI" || held === "Diploma") {
    return needed === "12th Pass"
      ? check(`This job asks for 12th pass; some notices accept ${held === "ITI" ? "ITI" : "a diploma"} in its place and some do not.`)
      : no(`This job asks for ${needed === "Graduate" ? "a degree" : "a post-graduate degree"}.`);
  }
  return (LADDER[held] ?? 0) >= (LADDER[needed] ?? 99)
    ? ok(`You hold more than the ${needed.toLowerCase()} asked for.`)
    : no(`This job asks for ${needed === "12th Pass" ? "12th pass" : needed === "Graduate" ? "a degree" : "a post-graduate degree"}.`);
}

// ─── Together ─────────────────────────────────────────────

export function assessJob(job: FinderJob, input: FinderInput): FinderResult {
  // A government recruitment with no age limit on record is unfinished data.
  // A private job or internship with none simply has no age rule.
  const age: FinderPart = job.kind === "government"
    ? ageFor(job.ageLimit, input)
    : { verdict: "OK", note: `No age limit is stated for this ${job.kind === "internship" ? "internship" : "job"}.` };
  const qualification = qualificationFor(job.qualification, input.qualification);
  const verdict: FinderVerdict =
    age.verdict === "NO" || qualification.verdict === "NO" ? "NOT_ELIGIBLE"
    : age.verdict === "OK" && qualification.verdict === "OK" ? "ELIGIBLE"
    : "CHECK";
  return { job, verdict, age, qualification };
}

const ORDER: Record<FinderVerdict, number> = { ELIGIBLE: 0, CHECK: 1, NOT_ELIGIBLE: 2 };

/** Every job assessed: those the visitor can apply for first, soonest closing first within each group. */
export function findEligibleJobs(jobs: FinderJob[], input: FinderInput): FinderResult[] {
  return jobs
    .map((job) => assessJob(job, input))
    .sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || (a.job.closeDate || "9999").localeCompare(b.job.closeDate || "9999") || a.job.title.localeCompare(b.job.title));
}

/** A date of birth the finder can use: a real past date, and an age a candidate could have. */
export function dobProblem(dobIso: string, todayIso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dobIso)) return "Enter your date of birth.";
  const d = new Date(`${dobIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dobIso) return "That is not a real date.";
  if (dobIso >= todayIso) return "Your date of birth must be in the past.";
  const years = Number(todayIso.slice(0, 4)) - Number(dobIso.slice(0, 4));
  if (years < 13 || years > 75) return "Check the year of your date of birth.";
  return null;
}
