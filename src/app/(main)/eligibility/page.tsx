import type { Metadata } from "next";
import { getAllVerifiedOpportunitiesWithCMS } from "@/lib/repository";
import { getVacancyCount } from "@/lib/lifecycle";
import { toFinderJob } from "@/lib/eligibility-finder";
import { getAllPublishedSnapshots } from "@/lib/cms/public-repository";
import type { CmsRecruitmentPost } from "@/types/recruitment-record";
import EligibilityFinderClient from "./EligibilityFinderClient";

export const metadata: Metadata = {
  title: "Which Jobs Can I Apply For? | Eligibility Finder",
  description:
    "Enter your date of birth, category and qualification to see which open government and private jobs you are eligible for, checked against each notice's age limit and cut-off date.",
};

/**
 * Each published job's qualifications, post by post. The finder uses them to
 * spot a job where every post asks for its own named qualification. If they
 * cannot be read, the finder still works from the listed level alone.
 */
async function qualificationsByPost(): Promise<Map<string, string[][]>> {
  try {
    const snapshots = await getAllPublishedSnapshots();
    return new Map(
      snapshots.map((snap) => [
        snap.slug,
        (Array.isArray(snap.eligibility) ? (snap.eligibility as CmsRecruitmentPost[]) : []).map((post) => post.qualification ?? []),
      ]),
    );
  } catch {
    return new Map();
  }
}

export default async function EligibilityPage() {
  const opportunities = await getAllVerifiedOpportunitiesWithCMS();
  // Every job is handed over with its dates; which of them are still open is
  // decided in the browser, on the day the visitor looks.
  const postQualifications = await qualificationsByPost();
  const jobs = opportunities.map((job) => toFinderJob(job, getVacancyCount(job), postQualifications.get(job.slug)));
  return <EligibilityFinderClient jobs={jobs} />;
}
