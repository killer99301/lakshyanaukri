// ═══════════════════════════════════════════════════════════
// LakshyaNaukri — Production Site Configuration
// ═══════════════════════════════════════════════════════════
// Domain: https://lakshyanaukri.in
// Update this file for any brand/domain changes.
// All metadata, sitemap, robots, and OG tags derive from here.
// ═══════════════════════════════════════════════════════════

export const siteConfig = {
  name: "LakshyaNaukri",
  tagline: "Your Trusted Partner for Government Jobs & Competitive Exams",
  description:
    "LakshyaNaukri is a verified government job and competitive exam intelligence platform offering trustworthy, updated information on UPSC, SSC, BPSC, RRB, IBPS, and State PSC recruitments across India.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://lakshyanaukri.in",
  ogImage: `${process.env.NEXT_PUBLIC_SITE_URL || "https://lakshyanaukri.in"}/og.jpg`,
  contact: {
    email: "shivorahq@gmail.com",
  },
  links: {
    twitter: "https://twitter.com/lakshyanaukri",
    facebook: "https://facebook.com/lakshyanaukri",
    instagram: "https://instagram.com/lakshyanaukri",
    youtube: "https://youtube.com/lakshyanaukri",
    telegram: "https://t.me/lakshyanaukri",
  },
  // Ecosystem partner tools — these deliberately keep their original domains
  // as they are separate products in the Career Campus ecosystem
  ecosystem: {
    careerCampus2: {
      name: "Career Campus 2",
      description: "Preparation, study material, previous-year papers & mock tests",
      url: "https://cc2.careercampus.in",
    },
    calcInfinity: {
      name: "CalcInfinity",
      description: "Calculators for age, percentage, date & educational tools",
      url: "https://calcinfinity.com",
    },
    anantamarg: {
      name: "Anantamarg",
      description: "Auspicious timings & Muhurat for application submission & key milestones",
      url: "https://anantamarg.com",
    },
  },
};

export type SiteConfig = typeof siteConfig;
