// ═══════════════════════════════════════════════════════════
// Career Campus — Homepage & Widget Auxiliary Types
// ═══════════════════════════════════════════════════════════
// Note: For core opportunity domain types, see src/types/index.ts.
// ═══════════════════════════════════════════════════════════

export interface ResultItem {
  id: string;
  slug: string;
  title: string;
  organization: string;
  examName: string;
  resultDateIso: string;
  resultType: string;         // e.g., "Final Merit List", "Prelims Result", "Scorecard"
  statusText?: string;        // e.g., "Declared"
  officialUrl: string;        // Official Government portal URL
  documentUrl?: string;       // Direct PDF/Document URL (supports external hosted PDF / Drive)
}

export interface AdmitCardItem {
  id: string;
  slug: string;
  title: string;
  organization: string;
  examName: string;
  releaseDateIso: string;
  examDateIso?: string;
  statusText?: string;        // e.g., "Available Now"
  officialUrl: string;
  documentUrl?: string;
}

export interface AnswerKeyItem {
  id: string;
  slug: string;
  title: string;
  organization: string;
  examName: string;
  releaseDateIso: string;
  objectionDeadlineIso?: string;
  statusText?: string;        // e.g., "Provisional Key"
  officialUrl: string;
  documentUrl?: string;
}

export interface UpcomingExamItem {
  id: string;
  slug: string;
  title: string;
  organization: string;
  examDateIso: string;
  admitCardDateIso?: string;
  category: string;
  state: string;
  statusText?: string;
  officialUrl: string;
}

export interface QualificationOption {
  id: string;
  label: string;
  slug: string;
  href: string;
}

export interface JobRoleOption {
  id: string;
  label: string;
  slug: string;
  href: string;
}

export interface OrganizationOption {
  id: string;
  name: string;
  fullName: string;
  slug: string;
  href: string;
  badgeLabel?: string;
}
