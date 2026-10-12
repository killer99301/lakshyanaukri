import type { Metadata } from "next";
import { getAllVerifiedOpportunitiesWithCMS } from "@/lib/repository";
import { getVacancyCount } from "@/lib/lifecycle";
import { toFinderJob } from "@/lib/eligibility-finder";
import EligibilityFinderClient from "./EligibilityFinderClient";

export const metadata: Metadata = {
  title: "Which Jobs Can I Apply For? | Eligibility Finder",
  description:
    "Enter your date of birth, category and qualification to see which open government and private jobs you are eligible for, checked against each notice's age limit and cut-off date.",
};

export default async function EligibilityPage() {
  const opportunities = await getAllVerifiedOpportunitiesWithCMS();
  // Every job is handed over with its dates; which of them are still open is
  // decided in the browser, on the day the visitor looks.
  const jobs = opportunities.map((job) => toFinderJob(job, getVacancyCount(job)));
  return <EligibilityFinderClient jobs={jobs} />;
}
