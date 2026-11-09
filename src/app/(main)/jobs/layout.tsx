import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Government Jobs & Opportunities Marketplace 2026",
  description:
    "Government recruitment information: dates, eligibility, vacancies and application links.",
  openGraph: {
    title: "Government Jobs & Opportunities Marketplace 2026 | LakshyaNaukri",
    description:
      "Government recruitment information: dates, eligibility, vacancies and application links.",
  },
};

export default function JobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
