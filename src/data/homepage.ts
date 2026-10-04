import {
  UpcomingExamItem,
  QualificationOption,
  JobRoleOption,
  OrganizationOption,
} from "@/types/job";


export interface OpportunityTypeItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  iconName: "Building2" | "Briefcase" | "GraduationCap" | "Sparkles" | "Home";
}

export const POPULAR_SEARCHES = [
  "SSC CGL",
  "BPSC",
  "UPSC",
  "Banking",
  "Railway",
  "12th Pass",
  "Teaching",
];

export const OPPORTUNITY_TYPES: OpportunityTypeItem[] = [
  {
    id: "govt",
    title: "Government Jobs",
    subtitle: "Latest Notifications",
    href: "/jobs?category=government",
    iconName: "Building2",
  },
  {
    id: "private",
    title: "Private Jobs",
    subtitle: "Top Companies Hiring",
    href: "/jobs?category=private",
    iconName: "Briefcase",
  },
  {
    id: "exams",
    title: "Exams",
    subtitle: "All Competitive Exams",
    href: "/exams",
    iconName: "GraduationCap",
  },
  {
    id: "internships",
    title: "Internships",
    subtitle: "Learn & Grow",
    href: "/jobs?category=internship",
    iconName: "Sparkles",
  },
  {
    id: "wfh",
    title: "Work From Home",
    subtitle: "Flexible Opportunities",
    href: "/jobs?wfh=true",
    iconName: "Home",
  },
];




// Results, admit cards and answer keys are no longer listed here by hand.
// They come from official links on published CMS records: see
// src/lib/cms/lifecycle-links.ts. Do not re-add fixed entries.

export const EXPLORE_CATEGORIES = [
  { id: "central-govt", label: "Central Govt", iconName: "Building2", href: "/jobs?govType=central" },
  { id: "state-govt", label: "State Govt", iconName: "Landmark", href: "/jobs?govType=state" },
  { id: "psu-jobs", label: "PSU Jobs", iconName: "Factory", href: "/jobs?govType=psu" },
  { id: "banking", label: "Banking", iconName: "CreditCard", href: "/jobs?category=banking" },
  { id: "teaching", label: "Teaching", iconName: "BookOpen", href: "/jobs?category=teaching" },
  { id: "defence", label: "Defence", iconName: "Shield", href: "/jobs?category=defence" },
  { id: "engineering", label: "Engineering", iconName: "Cpu", href: "/jobs?category=private&type=engineering" },
  { id: "view-all", label: "View All", iconName: "Grid", href: "/jobs" },
];

export const EXPLORE_STATES = [
  { id: "bihar", label: "Bihar", href: "/jobs?location=Bihar" },
  { id: "uttar-pradesh", label: "Uttar Pradesh", href: "/jobs?location=Uttar%20Pradesh" },
  { id: "rajasthan", label: "Rajasthan", href: "/jobs?location=Rajasthan" },
  { id: "maharashtra", label: "Maharashtra", href: "/jobs?location=Maharashtra" },
  { id: "madhya-pradesh", label: "Madhya Pradesh", href: "/jobs?location=Madhya%20Pradesh" },
  { id: "west-bengal", label: "West Bengal", href: "/jobs?location=West%20Bengal" },
  { id: "karnataka", label: "Karnataka", href: "/jobs?location=Karnataka" },
  { id: "all-states", label: "All States →", href: "/jobs", isAction: true },
];

export const EXPLORE_QUALIFICATIONS: QualificationOption[] = [
  { id: "q-10th", label: "10th Pass", slug: "10th-pass", href: "/jobs?qualification=10th-pass" },
  { id: "q-12th", label: "12th Pass", slug: "12th-pass", href: "/jobs?qualification=12th-pass" },
  { id: "q-iti", label: "ITI", slug: "iti", href: "/jobs?qualification=iti" },
  { id: "q-diploma", label: "Diploma", slug: "diploma", href: "/jobs?qualification=diploma" },
  { id: "q-grad", label: "Graduate", slug: "graduate", href: "/jobs?qualification=graduate" },
  { id: "q-be", label: "B.E. / B.Tech", slug: "be-btech", href: "/jobs?qualification=be-btech" },
  { id: "q-pg", label: "Post Graduate", slug: "post-graduate", href: "/jobs?qualification=post-graduate" },
  { id: "q-mba", label: "MBA", slug: "mba", href: "/jobs?q=MBA" },
  { id: "q-mca", label: "MCA", slug: "mca", href: "/jobs?q=MCA" },
  { id: "q-bed", label: "B.Ed", slug: "bed", href: "/jobs?q=B.Ed" },
  { id: "q-all", label: "All Qualifications →", slug: "qualifications", href: "/jobs" },
];

export const EXPLORE_ROLES: JobRoleOption[] = [
  { id: "r-teacher", label: "Teacher", slug: "teacher", href: "/jobs?q=Teacher" },
  { id: "r-engineer", label: "Engineer", slug: "engineer", href: "/jobs?q=Engineer" },
  { id: "r-clerk", label: "Clerk", slug: "clerk", href: "/jobs?q=Clerk" },
  { id: "r-police", label: "Police", slug: "police", href: "/jobs?q=Police" },
  { id: "r-nurse", label: "Nurse", slug: "nurse", href: "/jobs?q=Nurse" },
  { id: "r-accountant", label: "Accountant", slug: "accountant", href: "/jobs?q=Accountant" },
  { id: "r-professor", label: "Professor", slug: "professor", href: "/jobs?q=Professor" },
  { id: "r-doctor", label: "Doctor", slug: "doctor", href: "/jobs?q=Doctor" },
  { id: "r-steno", label: "Stenographer", slug: "stenographer", href: "/jobs?q=Stenographer" },
  { id: "r-apprentice", label: "Apprentice", slug: "apprentice", href: "/jobs?q=Apprentice" },
  { id: "r-all", label: "View All Roles →", slug: "roles", href: "/jobs" },
];

export const POPULAR_ORGANIZATIONS: OrganizationOption[] = [
  { id: "org-ssc", name: "SSC", fullName: "Staff Selection Commission", slug: "ssc", href: "/jobs?q=SSC", badgeLabel: "Central" },
  { id: "org-upsc", name: "UPSC", fullName: "Union Public Service Commission", slug: "upsc", href: "/jobs?q=UPSC", badgeLabel: "Civil Services" },
  { id: "org-bpsc", name: "BPSC", fullName: "Bihar Public Service Commission", slug: "bpsc", href: "/jobs?q=BPSC", badgeLabel: "State PSC" },
  { id: "org-railways", name: "Railways", fullName: "Indian Railways / RRB", slug: "railways", href: "/jobs?q=RRB", badgeLabel: "Railway" },
  { id: "org-ibps", name: "IBPS", fullName: "Banking Personnel Selection", slug: "ibps", href: "/jobs?q=IBPS", badgeLabel: "Banking" },
  { id: "org-sbi", name: "SBI", fullName: "State Bank of India", slug: "sbi", href: "/jobs?q=SBI", badgeLabel: "Bank" },
  { id: "org-drdo", name: "DRDO", fullName: "Defence Research & Dev. Org.", slug: "drdo", href: "/jobs?q=DRDO", badgeLabel: "Defence" },
  { id: "org-isro", name: "ISRO", fullName: "Indian Space Research Org.", slug: "isro", href: "/jobs?q=ISRO", badgeLabel: "Space Tech" },
];

export const UPCOMING_EXAMS: UpcomingExamItem[] = [
  // NOTE: UPSC CSE Prelims 2026 was conducted on 24 May 2026 — removed from upcoming.
  // The UPSC CSE 2026 Mains is currently in progress (21 Aug 2026 start).
  {
    id: "ue-upsc-cse-2026-mains",
    slug: "upsc-civil-services-cse-2026",
    title: "UPSC Civil Services Mains 2026",
    organization: "Union Public Service Commission",
    examDateIso: "2026-08-21",
    admitCardDateIso: "2026-08-01",
    category: "government",
    state: "All India",
    statusText: "Mains Conducted — Interview Date Awaited",
    officialUrl: "https://upsc.gov.in",
  },
  {
    id: "ue-bpsc-72nd-2026",
    slug: "bpsc-72nd-combined-competitive-exam-2026",
    title: "BPSC 72nd Combined Competitive Exam (Prelims)",
    organization: "Bihar Public Service Commission",
    examDateIso: "2026-10-25",
    admitCardDateIso: "",
    category: "state-psc",
    state: "Bihar",
    statusText: "Tentative: 25 Oct 2026 (Exam Calendar)",
    officialUrl: "https://bpsc.bih.nic.in",
  },
  {
    id: "ue-ibps-po-xvi-2026",
    slug: "ibps-po-mt-crp-xvi-2026",
    title: "IBPS PO/MT CRP XVI Preliminary Exam",
    organization: "Institute of Banking Personnel Selection",
    examDateIso: "2026-08-23",
    admitCardDateIso: "2026-08-14",
    category: "banking",
    state: "All India",
    // Prelims were conducted on 22–23 Aug 2026. Updating status to reflect this.
    // Mains date will be added once officially announced by IBPS.
    statusText: "Prelims Conducted — Mains Date Awaited",
    officialUrl: "https://www.ibps.in",
  },
  {
    id: "ue-ssc-cgl-2026",
    slug: "ssc-cgl-combined-graduate-level-2026",
    title: "SSC CGL Tier 1 Computer Based Exam 2026",
    organization: "Staff Selection Commission",
    examDateIso: "2026-09-20",
    admitCardDateIso: "",
    category: "ssc",
    state: "All India",
    statusText: "Tier I Tentatively Conducted — Result Awaited",
    officialUrl: "https://ssc.gov.in",
  },
];

export const HOW_IT_HELPS_STEPS = [
  {
    stepNumber: 1,
    title: "1. Discover",
    description: "Find the right job or exam opportunity tailored to your qualifications.",
    iconName: "Search",
  },
  {
    stepNumber: 2,
    title: "2. Prepare",
    description: "Study material, PYQs & mock tests on LakshyaGyan (coming soon).",
    iconName: "BookMarked",
  },
  {
    stepNumber: 3,
    title: "3. Calculate",
    description: "Check exact age eligibility, cutoff dates and marks with CalcInfinity.",
    iconName: "Calculator",
  },
  {
    stepNumber: 4,
    title: "4. Choose Muhurat",
    description: "Pick the best auspicious timing for submitting your application on Anantamarg.",
    iconName: "Sun",
  },
  {
    stepNumber: 5,
    title: "5. Apply",
    description: "Access direct official URLs to apply securely on the official portal.",
    iconName: "Send",
  },
];

// HOMEPAGE_STATS removed — the database currently has a small number of verified
// records and does not have measured platform-level statistics (active users,
// total listings, exam count) that could be displayed honestly.
//
// DO NOT re-add invented or aspirational numbers as factual statistics.
// When real measured metrics are available from analytics, add them here with a
// verification source and last-updated date.
//
// See audit finding I2 for rationale.
export const HOMEPAGE_STATS: { value: string; label: string }[] = [];


// NOTE: MOCK_TESTIMONIALS removed (Aug 2026).
// The testimonials section was replaced with a Telegram channel CTA.
// Do not re-add placeholder/illustrative testimonials without verified real user attribution.

