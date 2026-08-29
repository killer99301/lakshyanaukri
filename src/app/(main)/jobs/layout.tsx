import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Government Jobs & Opportunities Marketplace 2026",
  description:
    "Explore 100% verified government jobs, state PSC recruitments, SSC, Banking, and Railway opportunities with live dates, vacancies, and official notices.",
  openGraph: {
    title: "Government Jobs & Opportunities Marketplace 2026 | LakshyaNaukri",
    description:
      "Explore 100% verified government jobs, state PSC recruitments, SSC, Banking, and Railway opportunities with live dates, vacancies, and official notices.",
  },
};

export default function JobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
