// Server Component wrapper — exports metadata for the homepage.
// The interactive content lives in HomePageClient.tsx (client component).
import type { Metadata } from "next";
import { siteConfig } from "@/config/site";
import HomePageClient from "./HomePageClient";

export const metadata: Metadata = {
  title: `${siteConfig.name} — Verified Government Jobs & Competitive Exams`,
  description:
    "Find verified UPSC, SSC CGL, BPSC, RRB NTPC, and IBPS PO government jobs and competitive exam updates with official notification dates, vacancies, admit cards, results, and answer keys.",
  alternates: {
    canonical: siteConfig.url,
  },
  openGraph: {
    title: `${siteConfig.name} — Verified Government Jobs & Competitive Exams`,
    description:
      "Find verified UPSC, SSC CGL, BPSC, RRB NTPC, and IBPS PO government jobs and competitive exam updates with official notification dates, vacancies, admit cards, results, and answer keys.",
    url: siteConfig.url,
    siteName: siteConfig.name,
    type: "website",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "LakshyaNaukri — Verified Government Jobs & Competitive Exams",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — Verified Government Jobs & Competitive Exams`,
    description:
      "Find verified UPSC, SSC CGL, BPSC, RRB NTPC, and IBPS PO government jobs and competitive exam updates.",
    images: ["/og.jpg"],
  },
};

export default function HomePage() {
  return <HomePageClient />;
}
