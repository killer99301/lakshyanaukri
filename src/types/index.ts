// ═══════════════════════════════════════════════════════════
// Career Campus — Domain Types
// ═══════════════════════════════════════════════════════════
// Architecture: Three-layer model
//   Layer 1: Source Facts (provenance, source documents)
//   Layer 2: Historical Events (updates[], append-only)
//   Layer 3: Derived Current State (computed at runtime by lib/)
//
// This file defines the shape of Layers 1 & 2.
// Layer 3 is computed by functions in lib/lifecycle.ts and lib/urgency.ts.
// ═══════════════════════════════════════════════════════════

// ─── Organization ────────────────────────────────────────

export interface Organization {
  id: string;                     // "bpsc", "rrb", "ssc", "upsc", "ibps"
  name: string;                   // "Bihar Public Service Commission"
  abbreviation: string;           // "BPSC"
  website: string;                // "https://bpsc.bih.nic.in"
  logo?: string;                  // "/logos/bpsc.svg" — local asset path
  type: OrgType;
}

export type OrgType =
  | "central-govt"
  | "state-govt"
  | "psu"
  | "private"
  | "autonomous";

// ─── Provenance (Layer 1: Source Facts) ──────────────────

export type SourceType =
  | "OFFICIAL_NOTIFICATION"
  | "OFFICIAL_CORRIGENDUM"
  | "OFFICIAL_EXAM_NOTICE"
  | "OFFICIAL_PORTAL"
  | "OFFICIAL_WEBSITE"
  | "SECONDARY_SOURCE"
  | "NOT_VERIFIED";

export type VerificationStatus =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "NOT_VERIFIED"
  | "NEEDS_UPDATE";

export interface Provenance {
  status: VerificationStatus;
  lastVerifiedAt: string;         // ISO date — the actual day this record was checked
  primarySourceUrl?: string;      // direct link to the authoritative document
  primarySourceType: SourceType;
  notes?: string;                 // "Vacancy verified from corrigendum PDF page 3"
}

// ─── Update History (Layer 2: Historical Events) ────────

export type UpdateType =
  | "CORRIGENDUM"
  | "VACANCY_REVISION"
  | "DEADLINE_EXTENSION"
  | "POSTPONEMENT"
  | "RESCHEDULE"
  | "EXAM_NOTICE"
  | "CANCELLATION"
  | "GENERAL_NOTICE";

export interface UpdateRecord {
  id: string;
  date: string;                   // ISO date of the official notice
  type: UpdateType;
  title: string;                  // "44 Sugarcane Officer Posts Deleted"
  description: string;
  sourceUrl?: string;
  field?: string;                 // which field changed: "totalVacancies"
  previousValue?: string;         // "1,230"
  newValue?: string;              // "1,186"
}

// ─── Application Window & Lifecycle ─────────────────────

/**
 * ApplicationStatus is ALWAYS DERIVED at runtime from ApplicationWindow + now.
 * It is never stored in the data layer.
 * See lib/lifecycle.ts → deriveApplicationStatus()
 */
export type ApplicationStatus =
  | "UPCOMING"
  | "OPEN"
  | "CLOSING_SOON"
  | "APPLICATIONS_CLOSED";

export interface ApplicationWindow {
  notificationDate: string;       // ISO
  openDate: string;               // ISO
  closeDate: string;              // ISO
  extendedCloseDate?: string;     // ISO — if officially extended
  feeDeadline?: string;           // ISO — if different from closeDate
  correctionWindowEnd?: string;   // ISO
}

// ─── Exam Stages & Lifecycle ────────────────────────────

export type ExamStageStatus =
  | "NOT_DECLARED"
  | "SCHEDULED"
  | "ADMIT_CARD_OUT"
  | "POSTPONED"
  | "CONDUCTED"
  | "RESULT_DECLARED";

export type DateCertainty =
  | "CONFIRMED"
  | "TENTATIVE"
  | "POSTPONED"
  | "TBA";

export interface ExamStage {
  name: string;                   // "Preliminary Exam", "CBT-1", "Mains", "Interview"
  order: number;                  // 1, 2, 3...
  status: ExamStageStatus;
  certainty?: DateCertainty;      // "CONFIRMED" | "TENTATIVE" | "POSTPONED" | "TBA"
  dateDisplay?: string;           // "16–27 Mar 2026" or "Nov–Dec 2026" (human-readable)
  dateIso?: string;               // exact ISO date if a single date is known
  dateProvenance?: string;        // "BPSC Examination Calendar (14 Aug 2026)" or "Official Exam Notice"
  noticeUrl?: string;             // official notice for this specific stage
  notes?: string;                 // "City slip available from 5 Mar"
}

// ─── Vacancy, Fee, Age, Ecosystem ───────────────────────

export interface VacancyRow {
  post: string;
  count: number;
  payScale?: string;
  eligibility?: string;
}

export interface FeeRow {
  category: string;
  amount: number | null;          // null = free/exempt
  note?: string;
}

export interface AgeLimit {
  min?: number;
  max?: number;
  asOf: string;                   // ISO cutoff date
  relaxation?: string[];
}

export type Experience =
  | "Fresher"
  | "0–2 Years"
  | "1–3 Years"
  | "2–5 Years"
  | "3–5 Years"
  | "5+ Years";

export interface EcosystemLinks {
  careerCampus2?: string;
  calcInfinityAge?: string;
  anantamarg?: string;
}

// ─── Category & Qualification ───────────────────────────

export type Category =
  | "state-psc"
  | "ssc"
  | "banking"
  | "railway"
  | "defence"
  | "teaching"
  | "government"
  | "private"
  | "internship";

export type Qualification =
  | "10th Pass"
  | "12th Pass"
  | "Graduate"
  | "Post Graduate"
  | "Diploma"
  | "ITI";

// ─── Base Opportunity (shared fields) ───────────────────

export interface BaseOpportunity {
  id: string;
  slug: string;
  title: string;
  organizationId: string;         // FK → Organization registry
  organizationName: string;       // denormalized for SSR / SEO
  shortDescription: string;
  category: Category;
  state: string;                  // "Bihar", "All India", "Karnataka"
  qualification: Qualification;
  postDate: string;               // ISO

  provenance: Provenance;
  updates?: UpdateRecord[];
}

// ─── Government Recruitment ─────────────────────────────

export interface GovernmentRecruitment extends BaseOpportunity {
  type: "government";
  notificationNumber: string;     // "Advt No. 72/2024", "CEN 05/2024"
  govType: "Central Govt" | "State Govt" | "PSU Bank";

  totalVacancies: number;
  vacanciesDisplay: string;       // "1,186 Revised Vacancies"
  originalVacancies?: number;     // pre-corrigendum, if revised

  application: ApplicationWindow;
  examStages: ExamStage[];

  vacancyBreakdown?: VacancyRow[];
  fee?: { rows: FeeRow[]; modes: string[] };
  ageLimit?: AgeLimit;
  eligibility?: string[];
  selectionProcess?: string[];
  howToApply?: string[];

  links: {
    notification?: string;        // PDF URL
    apply: string;
    website: string;
    correction?: string;
    admitCard?: string;
    result?: string;
  };

  ecosystem?: EcosystemLinks;
}

// ─── Private Job ────────────────────────────────────────

export interface PrivateJob extends BaseOpportunity {
  type: "private";
  salary: string;                 // "₹24L – ₹38L / year"
  workMode: "On-site" | "Hybrid" | "Remote";
  experience: Experience;
  skills?: string[];
  jobType: "Full Time" | "Part Time" | "Contract";
  positions?: number;

  application: { openDate: string; closeDate: string };
  links: { apply: string; website: string };
}

// ─── Internship ─────────────────────────────────────────

export interface Internship extends BaseOpportunity {
  type: "internship";
  stipend: string;                // "₹35,000/month"
  duration: string;               // "6 months"
  workMode: "On-site" | "Hybrid" | "Remote";
  openings?: number;

  application: { openDate: string; closeDate: string };
  links: { apply: string; website: string };
}

// ─── Discriminated Union ────────────────────────────────

export type Opportunity = GovernmentRecruitment | PrivateJob | Internship;

// ─── Filter State ───────────────────────────────────────

export interface FilterState {
  searchQuery: string;
  types: Array<Opportunity["type"]>;
  categories: Category[];
  qualifications: Qualification[];
  experiences: Experience[];
  states: string[];
  applicationStatuses: ApplicationStatus[];
}

// ─── Urgency ────────────────────────────────────────────

export type UrgencyTier = "normal" | "mild" | "amber" | "urgent" | "today" | "passed" | "unknown";

export interface UrgencyInfo {
  tier: UrgencyTier;
  daysRemaining: number;
  label: string;                  // "30 days left", "Applications Closed", "Exam date not declared"
  badgeClass: string;             // Tailwind classes for the badge
  textClass: string;              // Tailwind classes for text
  isClosed: boolean;
}

// ─── Document Access Priority Chain ─────────────────────

export type DocumentAccessType =
  | "OFFICIAL_PDF"
  | "OFFICIAL_PORTAL"
  | "VERIFIED_MIRROR"
  | "UNAVAILABLE";

export interface DocumentSourceInput {
  officialPdfUrl?: string | null;
  officialPortalUrl?: string | null;
  mirrorUrl?: string | null;
  mirrorVerifiedAt?: string | null;
  organization?: string | null;
  publishedDate?: string | null;
  documentTitle?: string | null;
  customPdfLabel?: string;
  customPortalLabel?: string;
}

export interface ResolvedDocumentAccess {
  type: DocumentAccessType;
  url?: string;
  label: string;
  badgeLabel: string;
  badgeClass: string;
  isOfficial: boolean;
  isMirror: boolean;
  isDirectPdf: boolean;
  isAvailable: boolean;
  organization?: string;
  publishedDate?: string;
  mirrorVerifiedAt?: string;
  disclaimer?: string;
}
