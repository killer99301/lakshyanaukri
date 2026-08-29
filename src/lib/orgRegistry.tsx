import React from "react";

export interface OrgIdentity {
  id: string;
  name: string;
  shortName: string;
  brandColor: string;
  bgLight: string;
  textColor: string;
  officialLogoSvg?: React.ReactNode;
}

export const ORG_REGISTRY: Record<string, OrgIdentity> = {
  // 1. RRB / Indian Railways
  rrb: {
    id: "rrb",
    name: "Railway Recruitment Boards",
    shortName: "RRB",
    brandColor: "#DC2626",
    bgLight: "bg-rose-50 border-rose-200",
    textColor: "text-rose-700",
  },

  // 2. BPSC (Bihar Public Service Commission)
  bpsc: {
    id: "bpsc",
    name: "Bihar Public Service Commission",
    shortName: "BPSC",
    brandColor: "#D97706",
    bgLight: "bg-amber-50 border-amber-200",
    textColor: "text-amber-700",
  },

  // 3. SSC (Staff Selection Commission)
  ssc: {
    id: "ssc",
    name: "Staff Selection Commission",
    shortName: "SSC",
    brandColor: "#2563EB",
    bgLight: "bg-blue-50 border-blue-200",
    textColor: "text-blue-700",
  },

  // 4. UPSC (Union Public Service Commission)
  upsc: {
    id: "upsc",
    name: "Union Public Service Commission",
    shortName: "UPSC",
    brandColor: "#4338CA",
    bgLight: "bg-indigo-50 border-indigo-200",
    textColor: "text-indigo-700",
  },

  // 5. IBPS
  ibps: {
    id: "ibps",
    name: "Institute of Banking Personnel Selection",
    shortName: "IBPS",
    brandColor: "#059669",
    bgLight: "bg-emerald-50 border-emerald-200",
    textColor: "text-emerald-700",
  },

  // 6. SBI
  sbi: {
    id: "sbi",
    name: "State Bank of India",
    shortName: "SBI",
    brandColor: "#0284C7",
    bgLight: "bg-sky-50 border-sky-200",
    textColor: "text-sky-700",
  },

  // 7. UPPSC
  uppsc: {
    id: "uppsc",
    name: "Uttar Pradesh Public Service Commission",
    shortName: "UPPSC",
    brandColor: "#D97706",
    bgLight: "bg-amber-50 border-amber-200",
    textColor: "text-amber-700",
  },

  // 8. RPSC
  rpsc: {
    id: "rpsc",
    name: "Rajasthan Public Service Commission",
    shortName: "RPSC",
    brandColor: "#EA580C",
    bgLight: "bg-orange-50 border-orange-200",
    textColor: "text-orange-700",
  },

  // 9. MPPSC
  mppsc: {
    id: "mppsc",
    name: "Madhya Pradesh Public Service Commission",
    shortName: "MPPSC",
    brandColor: "#0284C7",
    bgLight: "bg-sky-50 border-sky-200",
    textColor: "text-sky-700",
  },

  // 10. MPSC
  mpsc: {
    id: "mpsc",
    name: "Maharashtra Public Service Commission",
    shortName: "MPSC",
    brandColor: "#7C3AED",
    bgLight: "bg-purple-50 border-purple-200",
    textColor: "text-purple-700",
  },

  // 11. IAF (Air Force)
  iaf: {
    id: "iaf",
    name: "Indian Air Force",
    shortName: "IAF",
    brandColor: "#0284C7",
    bgLight: "bg-sky-50 border-sky-200",
    textColor: "text-sky-700",
  },

  // 12. Indian Navy
  navy: {
    id: "navy",
    name: "Indian Navy",
    shortName: "Navy",
    brandColor: "#1E3A8A",
    bgLight: "bg-blue-950/10 border-blue-900/20",
    textColor: "text-blue-900",
  },

  // 13. ISRO
  isro: {
    id: "isro",
    name: "Indian Space Research Organisation",
    shortName: "ISRO",
    brandColor: "#EA580C",
    bgLight: "bg-orange-50 border-orange-200",
    textColor: "text-orange-700",
  },

  // 14. DRDO
  drdo: {
    id: "drdo",
    name: "Defence Research & Dev. Org.",
    shortName: "DRDO",
    brandColor: "#4B5563",
    bgLight: "bg-slate-100 border-slate-300",
    textColor: "text-slate-800",
  },

  // 15. TCS
  tcs: {
    id: "tcs",
    name: "Tata Consultancy Services",
    shortName: "TCS",
    brandColor: "#0F172A",
    bgLight: "bg-slate-100 border-slate-300",
    textColor: "text-slate-900",
  },

  // 16. Google
  google: {
    id: "google",
    name: "Google India",
    shortName: "Google",
    brandColor: "#4285F4",
    bgLight: "bg-blue-50 border-blue-200",
    textColor: "text-blue-600",
  },
};

export function getOrgIdentity(organizationName: string): OrgIdentity {
  const nameLower = organizationName.toLowerCase();

  if (nameLower.includes("railway") || nameLower.includes("rrb")) return ORG_REGISTRY.rrb;
  if (nameLower.includes("bihar") || nameLower.includes("bpsc")) return ORG_REGISTRY.bpsc;
  if (nameLower.includes("staff selection") || nameLower.includes("ssc")) return ORG_REGISTRY.ssc;
  if (nameLower.includes("union public") || nameLower.includes("upsc")) return ORG_REGISTRY.upsc;
  if (nameLower.includes("ibps") || nameLower.includes("banking personnel")) return ORG_REGISTRY.ibps;
  if (nameLower.includes("state bank") || nameLower.includes("sbi")) return ORG_REGISTRY.sbi;
  if (nameLower.includes("iaf") || nameLower.includes("air force") || nameLower.includes("afcat")) return ORG_REGISTRY.iaf;
  if (nameLower.includes("navy")) return ORG_REGISTRY.navy;
  if (nameLower.includes("isro") || nameLower.includes("space research")) return ORG_REGISTRY.isro;
  if (nameLower.includes("drdo")) return ORG_REGISTRY.drdo;
  if (nameLower.includes("uttar pradesh") || nameLower.includes("uppsc")) return ORG_REGISTRY.uppsc;
  if (nameLower.includes("rajasthan") || nameLower.includes("rpsc")) return ORG_REGISTRY.rpsc;
  if (nameLower.includes("madhya pradesh") || nameLower.includes("mppsc")) return ORG_REGISTRY.mppsc;
  if (nameLower.includes("maharashtra") || nameLower.includes("mpsc")) return ORG_REGISTRY.mpsc;
  if (nameLower.includes("tcs") || nameLower.includes("tata consultancy")) return ORG_REGISTRY.tcs;
  if (nameLower.includes("google")) return ORG_REGISTRY.google;

  const words = organizationName.trim().split(/\s+/);
  const shortName = words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : organizationName.slice(0, 3).toUpperCase();

  return {
    id: `custom-${shortName.toLowerCase()}`,
    name: organizationName,
    shortName,
    brandColor: "#475569",
    bgLight: "bg-slate-100 border-slate-200",
    textColor: "text-slate-700",
  };
}
