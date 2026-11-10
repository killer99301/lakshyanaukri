// Server Component wrapper — exports metadata for the homepage.
// The interactive content lives in HomePageClient.tsx (client component).
import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import { getAllVerifiedOpportunitiesWithCMS } from "@/lib/repository";
import { getLifecycleLinks } from "@/lib/cms/lifecycle-links";
import { indiaToday } from "@/lib/home-priorities";
import HomePageClient from "./HomePageClient";

export const metadata: Metadata = {
  // Absolute: the layout's template would add the brand a second time.
  title: { absolute: `${siteConfig.name} | Government Jobs & Competitive Exams` },
  description:
    "Recruitment information, important dates, eligibility, vacancies and application links.",
  alternates: {
    canonical: siteConfig.url,
  },
  openGraph: {
    title: `${siteConfig.name} | Government Jobs & Competitive Exams`,
    description:
      "Recruitment information, important dates, eligibility, vacancies and application links.",
    url: siteConfig.url,
    siteName: siteConfig.name,
    type: "website",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "LakshyaNaukri | Government Jobs & Competitive Exams",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} | Government Jobs & Competitive Exams`,
    description:
      "Recruitment information, important dates, eligibility, vacancies and application links.",
    images: ["/og.jpg"],
  },
};

export default async function HomePage() {
  const [opportunities, lifecycleLinks] = await Promise.all([
    getAllVerifiedOpportunitiesWithCMS(),
    getLifecycleLinks(),
  ]);
  // India's date when the page is drawn: open/closed is worked out on it until the visitor's own date takes over.
  const renderedOn = indiaToday();
  return <HomePageClient opportunities={opportunities} lifecycleLinks={lifecycleLinks} renderedOn={renderedOn} />;
}
