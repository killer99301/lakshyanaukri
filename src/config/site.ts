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
    // LakshyaGyan (formerly "Career Campus 2") is not live yet and has no
    // domain. Leave url empty until it does: every place that shows it then
    // says "coming soon" instead of linking anywhere.
    lakshyaGyan: {
      name: "LakshyaGyan",
      description: "Preparation, study material, previous-year papers & mock tests",
      url: "",
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
      // Offered to someone about to fill a form, ONLY on exam and job notices
      // still open for application (components/jobs/MuhuratCard.tsx) — not on
      // the home page, footer or listings, which link to `url`.
      // "Today's panchang & Rahu Kaal" opens AnantaMarg's home page, which
      // leads with today's panchang (the owner's choice, 2026-10-06).
      panchangUrl: "https://anantamarg.com",
      // The "Check Muhurat" button beside Apply Online opens the Muhurat
      // finder directly. Its "Exam Form / Job Application" purpose
      // ("Starting Important Work") was built on 2026-10-06 and was not yet on
      // the live site that day — check anantamarg.com/muhurat offers it before
      // deploying. Set formMuhuratLive to false to hide every muhurat link.
      muhuratUrl: "https://anantamarg.com/muhurat",
      formMuhuratLive: true,
    },
  },
};

export type SiteConfig = typeof siteConfig;
