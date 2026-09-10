// ═══════════════════════════════════════════════════════════
// Career Campus — Organization Registry
// ═══════════════════════════════════════════════════════════
// Canonical identity for every recruiting organization.
// Recruitment records reference organizationId instead of
// duplicating names, logos, and URLs.
// ═══════════════════════════════════════════════════════════

import type { Organization } from "@/types";

export const ORGANIZATIONS: Record<string, Organization> = {
  bpsc: {
    id: "bpsc",
    name: "Bihar Public Service Commission",
    abbreviation: "BPSC",
    website: "https://bpsc.bih.nic.in",
    logo: "/logos/bpsc.svg",
    type: "state-govt",
  },

  rrb: {
    id: "rrb",
    name: "Railway Recruitment Boards",
    abbreviation: "RRB",
    website: "https://indianrailways.gov.in",
    logo: "/logos/rrb.svg",
    type: "central-govt",
  },

  ssc: {
    id: "ssc",
    name: "Staff Selection Commission",
    abbreviation: "SSC",
    website: "https://ssc.gov.in",
    logo: "/logos/ssc.svg",
    type: "central-govt",
  },

  upsc: {
    id: "upsc",
    name: "Union Public Service Commission",
    abbreviation: "UPSC",
    website: "https://upsc.gov.in",
    logo: "/logos/upsc.svg",
    type: "central-govt",
  },

  ibps: {
    id: "ibps",
    name: "Institute of Banking Personnel Selection",
    abbreviation: "IBPS",
    website: "https://www.ibps.in",
    logo: "/logos/ibps.svg",
    type: "autonomous",
  },

  google: {
    id: "google",
    name: "Google India",
    abbreviation: "Google",
    website: "https://careers.google.com",
    type: "private",
  },

  tcs: {
    id: "tcs",
    name: "Tata Consultancy Services",
    abbreviation: "TCS",
    website: "https://tcs.com/careers",
    type: "private",
  },

  // PSU general insurance companies (under Ministry of Finance)
  uiicl: {
    id: "uiicl",
    name: "United India Insurance Company Limited",
    abbreviation: "UIICL",
    website: "https://uiic.co.in",
    logo: "/logos/uiicl.svg",
    type: "central-govt",
  },

  niacl: {
    id: "niacl",
    name: "The New India Assurance Co. Ltd.",
    abbreviation: "NIACL",
    website: "https://newindia.co.in",
    logo: "/logos/niacl.svg",
    type: "central-govt",
  },

  oicl: {
    id: "oicl",
    name: "Oriental Insurance Company Limited",
    abbreviation: "OICL",
    website: "https://orientalinsurance.org.in",
    logo: "/logos/oicl.svg",
    type: "central-govt",
  },

  nicl: {
    id: "nicl",
    name: "National Insurance Company Limited",
    abbreviation: "NICL",
    website: "https://nicl.co.in",
    logo: "/logos/nicl.svg",
    type: "central-govt",
  },
};

/**
 * Resolve an organization by ID. Throws at build time if unknown.
 * Used by validation.ts to catch invalid organizationId references.
 */
export function getOrganization(id: string): Organization {
  const org = ORGANIZATIONS[id];
  if (!org) {
    throw new Error(`[Organization Registry] Unknown organizationId: "${id}". Add it to ORGANIZATIONS in data/organizations.ts.`);
  }
  return org;
}

/**
 * Get all registered organization IDs.
 */
export function getAllOrganizationIds(): string[] {
  return Object.keys(ORGANIZATIONS);
}
