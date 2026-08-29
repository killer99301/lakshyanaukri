import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { siteConfig } from "@/config/site";
import { Analytics } from "@/components/common/Analytics";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — Verified Government Jobs & Competitive Exams`,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    "Government Jobs",
    "Sarkari Naukri",
    "Sarkari Result",
    "BPSC 72nd",
    "UPSC CSE",
    "SSC CGL",
    "RRB NTPC",
    "Banking Recruitment",
    "Admit Cards",
    "Answer Keys",
    "Competitive Exams",
    "LakshyaNaukri",
  ],
  openGraph: {
    title: `${siteConfig.name} — Verified Government Jobs & Competitive Exams`,
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: siteConfig.name,
    locale: "en_IN",
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
    description: siteConfig.description,
    creator: "@lakshyanaukri",
    images: ["/og.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#FAFAFA] text-[#0F172A]">
        {children}
        <Analytics />
      </body>
    </html>
  );
}

