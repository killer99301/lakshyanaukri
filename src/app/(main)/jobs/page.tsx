import type { Metadata } from "next";
import { getAllVerifiedOpportunitiesWithCMS } from "@/lib/repository";
import JobsPageClient from "./JobsPageClient";

export const metadata: Metadata = {
  title: "Government Jobs & Exams 2026",
  description:
    "Browse verified government job notifications, competitive exam schedules, and private job opportunities across India.",
  // Filter links (/jobs?category=banking, ?state=…) are views of this one page,
  // not separate pages for search engines.
  alternates: { canonical: "/jobs" },
};

export default async function JobsPage() {
  const opportunities = await getAllVerifiedOpportunitiesWithCMS();
  return <JobsPageClient opportunities={opportunities} />;
}
