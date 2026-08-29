export interface NavItem {
  title: string;
  href: string;
  description?: string;
  items?: NavItem[];
}

export const MAIN_NAV_ITEMS: NavItem[] = [
  {
    title: "Jobs",
    href: "/jobs",
    items: [
      { title: "All Jobs", href: "/jobs", description: "Browse all active career opportunities" },
      { title: "Government Jobs", href: "/jobs?category=government", description: "Central & State government recruitments" },
      { title: "State PSC Jobs", href: "/jobs?category=state-psc", description: "State public service commission exams" },
      { title: "Banking Jobs", href: "/jobs?category=banking", description: "IBPS, SBI, RBI recruitment notices" },
      { title: "Railway Jobs", href: "/jobs?category=railway", description: "RRB NTPC, Group D, ALP vacancies" },
    ],
  },
  {
    title: "Exams",
    href: "/exams",
    items: [
      { title: "Exams Directory", href: "/exams", description: "Comprehensive list of competitive exams" },
      { title: "UPSC Exams", href: "/exams?board=upsc", description: "CSE, NDA, CDS, CAPF exam guides" },
      { title: "SSC Exams", href: "/exams?board=ssc", description: "CGL, CHSL, MTS, CPO exam details" },
      { title: "State PSC Exams", href: "/exams?board=state-psc", description: "BPSC, UPPSC, MPPSC syllabus & pattern" },
    ],
  },
  {
    title: "Results",
    href: "/results",
  },
  {
    title: "Admit Cards",
    href: "/admit-cards",
  },
  {
    title: "Companies",
    href: "/companies",
  },
  {
    title: "Tools",
    href: siteConfigEcosystemCalcInfinityUrl(),
  },
];

function siteConfigEcosystemCalcInfinityUrl(): string {
  return "https://calcinfinity.com";
}

export const JOB_CATEGORIES = [
  { id: "government", label: "Government Jobs", shortLabel: "Govt Jobs" },
  { id: "private", label: "Private Jobs", shortLabel: "Private Jobs" },
  { id: "state-psc", label: "State PSC", shortLabel: "State PSC" },
  { id: "banking", label: "Banking & Financial", shortLabel: "Banking" },
  { id: "railway", label: "Railway Jobs", shortLabel: "Railway" },
  { id: "defence", label: "Defence & Police", shortLabel: "Defence" },
  { id: "ssc", label: "SSC Staff Selection", shortLabel: "SSC" },
  { id: "teaching", label: "Teaching & Education", shortLabel: "Teaching" },
] as const;

export const JOB_STATUSES = [
  { id: "upcoming", label: "Upcoming Notice", color: "peach" },
  { id: "active", label: "Application Open", color: "orange" },
  { id: "closing-soon", label: "Closing Soon", color: "coral" },
  { id: "closed", label: "Application Closed", color: "neutral" },
  { id: "admit-card", label: "Admit Card Out", color: "orange" },
  { id: "result-declared", label: "Result Declared", color: "orange" },
] as const;
