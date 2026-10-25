// ═══════════════════════════════════════════════════════════
// Which hosts may speak for which organisation, and for what
// ═══════════════════════════════════════════════════════════
//
// Pure and client-safe. A reviewed list, changed only in code. AUTHORITY
// hosts are the recruiting body's own; PARTNER hosts (an exam agency, a
// national application portal) are trusted only for the purposes listed.
// A host not listed for the job's organisation is UNLISTED: its documents
// can be read and shown, never used to verify a value.
//
// Adding an organisation is one entry here. Keys are recruitments.organization_id.

import type { Purpose } from "@/lib/cms/importer/fields";

export type OriginRole = "AUTHORITY" | "PARTNER" | "UNLISTED" | "NONE";

interface HostEntry { host: string; role: "AUTHORITY" | "PARTNER"; purposes: Array<Purpose | "all"> }

export const TRUSTED_DOMAINS: Record<string, HostEntry[]> = {
  // LIC Housing Finance apprentices: LIC HFL is the authority; BFSI SSC runs
  // the exam and takes the fee; applications go through the NATS portal.
  "lic-hfl": [
    { host: "lichousing.com", role: "AUTHORITY", purposes: ["all"] },
    { host: "bfsissc.com", role: "PARTNER", purposes: ["exam", "fee_payment"] },
    { host: "nats.education.gov.in", role: "PARTNER", purposes: ["application"] },
  ],
  ssc: [{ host: "ssc.gov.in", role: "AUTHORITY", purposes: ["all"] }],
  upsc: [
    { host: "upsc.gov.in", role: "AUTHORITY", purposes: ["all"] },
    { host: "upsconline.gov.in", role: "AUTHORITY", purposes: ["all"] },
  ],
  bpsc: [
    { host: "bpsc.bihar.gov.in", role: "AUTHORITY", purposes: ["all"] },
    { host: "bpsc.bih.nic.in", role: "AUTHORITY", purposes: ["all"] },
    { host: "onlinebpsc.bihar.gov.in", role: "AUTHORITY", purposes: ["all"] },
  ],
  ibps: [{ host: "ibps.in", role: "AUTHORITY", purposes: ["all"] }],
  // Bihar Technical Service Commission. Its online form runs on an NIC exam
  // portal (btsc.pariksha.nic.in) that is not listed until the owner confirms it.
  btsc: [{ host: "btsc.bihar.gov.in", role: "AUTHORITY", purposes: ["all"] }],
  rrb: [
    { host: "rrbcdg.gov.in", role: "AUTHORITY", purposes: ["all"] },
    { host: "rrbapply.gov.in", role: "AUTHORITY", purposes: ["all"] },
    { host: "indianrailways.gov.in", role: "AUTHORITY", purposes: ["all"] },
  ],
};

/** Hostname without "www.", lower case; null when the address cannot be read. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const covers = (entryHost: string, host: string) => host === entryHost || host.endsWith(`.${entryHost}`);

/** The role and purposes of a host for an organisation, frozen into each retrieval. */
export function originFor(organizationId: string, host: string | null): { role: OriginRole; purposes: Array<Purpose | "all"> } {
  if (!host) return { role: "NONE", purposes: [] };
  const entry = (TRUSTED_DOMAINS[organizationId] ?? []).find((e) => covers(e.host, host));
  return entry ? { role: entry.role, purposes: entry.purposes } : { role: "UNLISTED", purposes: [] };
}

/** Whether a document from this origin may verify a field with this purpose. */
export function authorityCovers(role: OriginRole, purposes: string[], purpose: Purpose): boolean {
  if (role === "AUTHORITY") return true;
  if (role === "PARTNER") return purposes.includes(purpose);
  return false;
}
