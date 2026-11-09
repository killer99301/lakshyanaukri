import type { Metadata } from "next";
import { getAllVerifiedOpportunitiesWithCMS } from "@/lib/repository";
import JobsPageClient from "./JobsPageClient";

export const metadata: Metadata = {
  title: "Government Jobs & Exams 2026 | LakshyaNaukri",
  description:
    "Government recruitment information: dates, eligibility, vacancies and application links.",
};

export default async function JobsPage() {
  const opportunities = await getAllVerifiedOpportunitiesWithCMS();
  return <JobsPageClient opportunities={opportunities} />;
}
