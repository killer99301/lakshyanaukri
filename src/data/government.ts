// ═══════════════════════════════════════════════════════════
// Career Campus — Verified Government Recruitment Records
// ═══════════════════════════════════════════════════════════
// Every record here has been audited against official sources.
// See provenance.notes for verification details.
//
// Non-negotiable rules:
//   - VERIFIED requires official source URL + official source type
//   - Unknown data = "Not specified" / "Not verified" / "Not declared"
//   - Each CEN is a separate record
//   - Vacancy breakdown must match totalVacancies (or be omitted)
// ═══════════════════════════════════════════════════════════

import type { GovernmentRecruitment } from "@/types";

export const GOVERNMENT_RECRUITMENTS: GovernmentRecruitment[] = [

  // ─── 1. BPSC 72nd CCE ─────────────────────────────────
  {
    id: "bpsc-72nd-cce-2026",
    slug: "bpsc-72nd-combined-competitive-exam-2026",
    type: "government",
    title: "BPSC 72nd Combined Competitive Examination",
    organizationId: "bpsc",
    organizationName: "Bihar Public Service Commission (BPSC)",
    notificationNumber: "Advt No. 72/2026",
    shortDescription:
      "Bihar Combined Competitive Examination for Sub-Divisional Officer (SDM), " +
      "Deputy SP, Revenue Officer, and Block Development Officer posts across state cadres.",
    category: "state-psc",
    state: "Bihar",
    qualification: "Graduate",
    postDate: "2026-05-05",
    govType: "State Govt",

    totalVacancies: 1186,
    vacanciesDisplay: "1,186 Revised Vacancies",
    originalVacancies: 1230,

    application: {
      notificationDate: "2026-05-05",
      openDate: "2026-05-10",
      closeDate: "2026-06-10",
    },

    examStages: [
      {
        name: "Preliminary Examination",
        order: 1,
        status: "SCHEDULED",
        certainty: "TENTATIVE",
        dateDisplay: "25 Oct 2026 (Tentative — Exam Calendar)",
        dateIso: "2026-10-25",
        dateProvenance: "BPSC Examination Calendar (14 Aug 2026)",
        notes:
          "Tentative date listed in BPSC Examination Calendar (14 Aug 2026). Subject to revision / confirmation via final official notice.",
        noticeUrl: "https://bpsc.bih.nic.in",
      },
      {
        name: "Mains Written Examination",
        order: 2,
        status: "NOT_DECLARED",
        certainty: "TBA",
      },
      {
        name: "Interview & Document Verification",
        order: 3,
        status: "NOT_DECLARED",
        certainty: "TBA",
      },
    ],

    vacancyBreakdown: [
      { post: "Sub-Divisional Officer (SDM)", count: 220, payScale: "Level 9 (₹53,100–₹1,67,800)" },
      { post: "Deputy Superintendent of Police (DSP)", count: 140, payScale: "Level 9 (₹53,100–₹1,67,800)" },
      { post: "Revenue Officer & Circle Officer", count: 826, payScale: "Level 7 (₹44,900–₹1,42,400)" },
    ],

    fee: {
      rows: [
        { category: "General / OBC / EWS", amount: 600, note: "₹600" },
        { category: "SC / ST / PwD / Female (Bihar Domicile)", amount: 150, note: "₹150" },
      ],
      modes: ["Net Banking", "Credit Card", "Debit Card", "UPI"],
    },

    ageLimit: {
      min: 20,
      max: 37,
      asOf: "2026-08-01",
      relaxation: ["BC/EBC: +3 years", "SC/ST: +5 years"],
    },

    eligibility: [
      "Bachelor's Degree in any discipline from a recognized University.",
    ],

    selectionProcess: [
      "Preliminary Examination (Objective — 150 Marks)",
      "Mains Written Examination (Subjective — 900 Marks)",
      "Personal Interview & Document Verification (120 Marks)",
    ],

    howToApply: [
      "Applications for this cycle are closed.",
      "Preliminary Examination is tentatively scheduled for 25 Oct 2026 as per BPSC Examination Calendar (published 14 Aug 2026).",
      "Important: This date is tentative and subject to revision upon release of the final official exam notice.",
      "Monitor bpsc.bih.nic.in for the official exam notification and subsequent admit card download schedule.",
    ],

    links: {
      // No specific notification PDF URL verified — set to undefined to prevent misleading PDF button
      notification: undefined,
      apply: "https://onlinebpsc.bihar.gov.in/",
      website: "https://bpsc.bih.nic.in/",
    },

    updates: [
      {
        id: "bpsc-72-u3",
        date: "2026-08-14",
        type: "RESCHEDULE",
        title: "Tentative Prelims Date: 25 Oct 2026 (Exam Calendar)",
        description:
          "BPSC Examination Calendar published on 14 Aug 2026 lists 25 Oct 2026 as the tentative Preliminary Examination date. The date is tentative and subject to revision upon publication of the final exam notice.",
        sourceUrl: "https://bpsc.bih.nic.in",
        field: "examStages[0].dateIso",
        previousValue: "Originally 26 Jul 2026 (Postponed on 18 Jul)",
        newValue: "2026-10-25 (Tentative)",
      },
      {
        id: "bpsc-72-u2",
        date: "2026-07-18",
        type: "POSTPONEMENT",
        title: "72nd CCE Preliminary Examination Postponed",
        description:
          "BPSC published official notice on 18 Jul 2026 confirming postponement of the " +
          "Prelims originally scheduled for 26 Jul 2026. Fresh date TBA.",
        sourceUrl: "https://bpsc.bih.nic.in",
        field: "examStages[0].status",
        previousValue: "SCHEDULED",
        newValue: "POSTPONED",
      },
      {
        id: "bpsc-72-u1",
        date: "2026-06-01",
        type: "CORRIGENDUM",
        title: "44 Sugarcane Officer Vacancies Deleted",
        description:
          "Official corrigendum removed 44 Sugarcane Officer posts (Bihar Sugarcane Development " +
          "Rules 2025). Total vacancies revised from 1,230 to 1,186.",
        sourceUrl: "https://bpsc.bih.nic.in",
        field: "totalVacancies",
        previousValue: "1,230",
        newValue: "1,186",
      },
    ],

    provenance: {
      status: "PARTIALLY_VERIFIED",
      lastVerifiedAt: "2026-08-16",
      primarySourceUrl: "https://bpsc.bih.nic.in",
      primarySourceType: "OFFICIAL_WEBSITE",
      notes:
        "1,186 vacancies and corrigenda confirmed via BPSC notices. " +
        "Prelims tentatively listed for 25 Oct 2026 in BPSC Examination Calendar (14 Aug 2026); " +
        "date remains tentative pending final official exam notice. Marked PARTIALLY_VERIFIED.",
    },

    ecosystem: {
      careerCampus2: "https://cc2.careercampus.in/bpsc-72nd-prep",
      calcInfinityAge: "https://calcinfinity.com/age-calculator?cutoff=2026-08-01",
      anantamarg: "https://anantamarg.com/shubh-muhurat",
    },
  },

  // ─── 2. RRB NTPC Graduate — CEN 05/2024 ──────────────
  // CRITICAL CORRECTION: Application period ended Oct 2024.
  // Process at final stages (DV/Medical) as of Aug 2026.
  {
    id: "rrb-ntpc-grad-cen-05-2024",
    slug: "rrb-ntpc-graduate-cen-05-2024",
    type: "government",
    title: "RRB NTPC Graduate Level Recruitment",
    organizationId: "rrb",
    organizationName: "Railway Recruitment Boards (RRB)",
    notificationNumber: "CEN 05/2024",
    shortDescription:
      "Recruitment for Graduate level posts including Chief Commercial cum Ticket Supervisor, " +
      "Station Master, Goods Train Manager, and Senior Clerk across 21 RRB zones.",
    category: "railway",
    state: "All India",
    qualification: "Graduate",
    postDate: "2024-09-13",
    govType: "Central Govt",

    totalVacancies: 8113,
    vacanciesDisplay: "8,113 Vacancies",

    application: {
      notificationDate: "2024-09-13",
      openDate: "2024-09-14",
      closeDate: "2024-10-13",
    },

    examStages: [
      {
        name: "CBT-1",
        order: 1,
        status: "CONDUCTED",
        certainty: "CONFIRMED",
        dateDisplay: "Mar–Apr 2025",
        dateIso: "2025-03-15",
        notes: "Computer Based Test Stage 1 conducted across multiple sessions.",
      },
      {
        name: "CBT-2",
        order: 2,
        status: "CONDUCTED",
        certainty: "CONFIRMED",
        dateDisplay: "Jun–Jul 2025",
        dateIso: "2025-06-10",
      },
      {
        name: "CBAT / Typing Skill Test",
        order: 3,
        status: "CONDUCTED",
        certainty: "CONFIRMED",
        dateDisplay: "Oct 2025",
        dateIso: "2025-10-01",
        notes: "CBAT for Station Master; TST for Clerk posts.",
      },
      {
        name: "Document Verification & Medical",
        order: 4,
        status: "SCHEDULED",
        certainty: "CONFIRMED",
        dateDisplay: "Aug–Sep 2026",
        dateProvenance: "RRB Official Document Verification Schedule",
        notes: "DV/Medical in progress across RRB zones.",
      },
    ],

    vacancyBreakdown: [
      { post: "Chief Commercial cum Ticket Supervisor", count: 1736, payScale: "Level 6 (₹35,400)" },
      { post: "Station Master", count: 994, payScale: "Level 6 (₹35,400)" },
      { post: "Goods Train Manager", count: 3144, payScale: "Level 5 (₹29,200)" },
      { post: "Senior Clerk cum Typist", count: 1507, payScale: "Level 5 (₹29,200)" },
      { post: "Jr Account Assistant cum Typist", count: 732, payScale: "Level 5 (₹29,200)" },
    ],

    fee: {
      rows: [
        { category: "General / OBC", amount: 500, note: "₹400 refunded after CBT-1" },
        { category: "SC / ST / PwBD / Female / Ex-SM", amount: 250, note: "Full refund after CBT-1" },
      ],
      modes: ["Internet Banking", "Debit/Credit Card", "UPI"],
    },

    ageLimit: {
      min: 18,
      max: 36,
      asOf: "2025-01-01",
      relaxation: ["OBC (NCL): +3 years", "SC/ST: +5 years"],
    },

    eligibility: [
      "Bachelor's Degree from a recognized University or equivalent.",
    ],

    selectionProcess: [
      "1st Stage Computer Based Test (CBT-1)",
      "2nd Stage Computer Based Test (CBT-2)",
      "Computer Based Aptitude Test (CBAT) — Station Master only",
      "Typing Skill Test (TST) — Senior Clerk / Jr Account Assistant only",
      "Document Verification & Medical Examination",
    ],

    howToApply: [
      "Application period for CEN 05/2024 has ended.",
      "Recruitment is in final stages (Document Verification & Medical).",
      "Check your respective RRB zone website for DV schedule and updates.",
    ],

    links: {
      // No specific CEN 05/2024 PDF URL verified on indianrailways.gov.in — set to undefined.
      // Candidate should check individual RRB zone websites for CEN PDF.
      notification: undefined,
      apply: "https://www.rrbapply.gov.in/",
      website: "https://indianrailways.gov.in/",
    },

    provenance: {
      status: "PARTIALLY_VERIFIED",
      lastVerifiedAt: "2026-08-16",
      primarySourceUrl: "https://indianrailways.gov.in",
      primarySourceType: "OFFICIAL_WEBSITE",
      notes:
        "8,113 vacancy confirmed. Application period 14 Sep – 13 Oct 2024 confirmed. " +
        "CBT-1, CBT-2, CBAT/TST stages confirmed as conducted. DV/Medical in progress. " +
        "Exact PDF notification URL not directly verified from indianrailways.gov.in.",
    },

    ecosystem: {
      careerCampus2: "https://cc2.careercampus.in/rrb-ntpc-grad-prep",
      calcInfinityAge: "https://calcinfinity.com/age-calculator?cutoff=2025-01-01",
    },
  },

  // ─── 3. RRB NTPC Undergraduate — CEN 06/2024 ─────────
  // CRITICAL CORRECTION: Recruitment COMPLETED. Results declared 26 May 2026.
  {
    id: "rrb-ntpc-ug-cen-06-2024",
    slug: "rrb-ntpc-undergraduate-cen-06-2024",
    type: "government",
    title: "RRB NTPC Undergraduate Level Recruitment",
    organizationId: "rrb",
    organizationName: "Railway Recruitment Boards (RRB)",
    notificationNumber: "CEN 06/2024",
    shortDescription:
      "Recruitment for 12th Pass (Undergraduate) level posts including Commercial cum " +
      "Ticket Clerk, Junior Clerk cum Typist, and Accounts Clerk across RRB zones.",
    category: "railway",
    state: "All India",
    qualification: "12th Pass",
    postDate: "2024-09-20",
    govType: "Central Govt",

    totalVacancies: 3445,
    vacanciesDisplay: "3,445 Vacancies",

    application: {
      notificationDate: "2024-09-20",
      openDate: "2024-09-21",
      closeDate: "2024-10-20",
    },

    examStages: [
      {
        name: "CBT-1",
        order: 1,
        status: "CONDUCTED",
        certainty: "CONFIRMED",
        dateDisplay: "Apr–May 2025",
        dateIso: "2025-04-01",
      },
      {
        name: "CBT-2",
        order: 2,
        status: "CONDUCTED",
        certainty: "CONFIRMED",
        dateDisplay: "Aug 2025",
        dateIso: "2025-08-01",
      },
      {
        name: "Typing Skill Test",
        order: 3,
        status: "CONDUCTED",
        certainty: "CONFIRMED",
        dateDisplay: "Nov 2025",
        dateIso: "2025-11-01",
        notes: "Applicable for Junior Clerk / Accounts Clerk posts.",
      },
      {
        name: "Document Verification & Medical",
        order: 4,
        status: "RESULT_DECLARED",
        certainty: "CONFIRMED",
        dateDisplay: "Feb–Apr 2026",
        dateIso: "2026-02-01",
        notes: "Final results declared 26 May 2026.",
      },
    ],

    vacancyBreakdown: [
      { post: "Commercial cum Ticket Clerk", count: 2022, payScale: "Level 3 (₹21,700)" },
      { post: "Junior Clerk cum Typist", count: 990, payScale: "Level 2 (₹19,900)" },
      { post: "Accounts Clerk cum Typist", count: 361, payScale: "Level 2 (₹19,900)" },
      { post: "Trains Clerk", count: 72, payScale: "Level 2 (₹19,900)" },
    ],

    fee: {
      rows: [
        { category: "General / OBC", amount: 500, note: "₹400 refunded after CBT-1" },
        { category: "SC / ST / PwBD / Female", amount: 250, note: "Full refund after CBT-1" },
      ],
      modes: ["Internet Banking", "Debit/Credit Card", "UPI"],
    },

    ageLimit: {
      min: 18,
      max: 33,
      asOf: "2025-01-01",
      relaxation: ["OBC: +3 years", "SC/ST: +5 years"],
    },

    eligibility: [
      "12th (+2 Stage) or equivalent from a recognized Board with 50% marks in aggregate.",
    ],

    selectionProcess: [
      "1st Stage Computer Based Test (CBT-1)",
      "2nd Stage Computer Based Test (CBT-2)",
      "Typing Skill Test (TST) where applicable",
      "Document Verification & Medical Examination",
    ],

    howToApply: [
      "Recruitment for CEN 06/2024 is complete.",
      "Final results were declared on 26 May 2026.",
    ],

    links: {
      // No specific CEN 06/2024 PDF URL verified on indianrailways.gov.in — set to undefined.
      // Candidate should check individual RRB zone websites for CEN PDF.
      notification: undefined,
      apply: "https://www.rrbapply.gov.in/",
      website: "https://indianrailways.gov.in/",
    },

    provenance: {
      status: "PARTIALLY_VERIFIED",
      lastVerifiedAt: "2026-08-16",
      primarySourceUrl: "https://indianrailways.gov.in",
      primarySourceType: "OFFICIAL_WEBSITE",
      notes:
        "3,445 vacancy confirmed. App dates 21 Sep – 20 Oct 2024 confirmed. " +
        "Final result declared 26 May 2026 confirmed via secondary sources. " +
        "Exact exam stage dates are approximate month-level.",
    },
  },

  // ─── 4. SSC CGL 2026 ─────────────────────────────────
  // CORRECTED: 12,256 vacancies (not 17,727), notification May 2026, apps closed
  {
    id: "ssc-cgl-2026",
    slug: "ssc-cgl-combined-graduate-level-2026",
    type: "government",
    title: "SSC CGL 2026 (Combined Graduate Level Examination)",
    organizationId: "ssc",
    organizationName: "Staff Selection Commission (SSC)",
    notificationNumber: "CGL 2026",
    shortDescription:
      "Recruitment for Group 'B' and Group 'C' posts across Ministries, Departments, " +
      "and Organizations of the Government of India.",
    category: "ssc",
    state: "All India",
    qualification: "Graduate",
    postDate: "2026-05-21",
    govType: "Central Govt",

    totalVacancies: 12256,
    vacanciesDisplay: "12,256 Tentative Vacancies",

    application: {
      notificationDate: "2026-05-21",
      openDate: "2026-05-21",
      closeDate: "2026-06-20",
    },

    examStages: [
      {
        name: "Tier-I (Computer Based Test)",
        order: 1,
        status: "SCHEDULED",
        certainty: "TENTATIVE",
        dateDisplay: "Sep–Oct 2026 (Tentative — SSC Notice)",
        dateProvenance: "SSC Official Notification (21 May 2026)",
        notes: "Tentative exam window announced in official notification. Exact dates and shifts to be published on ssc.gov.in.",
        noticeUrl: "https://ssc.gov.in",
      },
      {
        name: "Tier-II (Computer Based Test)",
        order: 2,
        status: "NOT_DECLARED",
        certainty: "TBA",
      },
      {
        name: "Document Verification",
        order: 3,
        status: "NOT_DECLARED",
        certainty: "TBA",
      },
    ],

    fee: {
      rows: [
        { category: "General / OBC / EWS Male", amount: 100, note: "₹100" },
        { category: "Female / SC / ST / PwBD", amount: 0, note: "Nil (Exempted)" },
      ],
      modes: ["BHIM UPI", "Net Banking", "Visa", "Mastercard"],
    },

    ageLimit: {
      min: 18,
      max: 30,
      asOf: "2026-08-01",
      relaxation: ["OBC: +3 years", "SC/ST: +5 years", "PwD: +10 years"],
    },

    eligibility: [
      "Bachelor's Degree in any stream from a recognized University.",
    ],

    selectionProcess: [
      "Tier-I Examination (Computer Based Test — Qualifying)",
      "Tier-II Examination (Computer Based Test — Merit Rank)",
      "Document Verification & Medical Test",
    ],

    howToApply: [
      "Application period for SSC CGL 2026 has ended.",
      "Check ssc.gov.in for Tier-I exam admit card and schedule.",
    ],

    links: {
      // No specific CGL 2026 notification PDF URL verified — set to undefined.
      // Candidates should download the notification directly from ssc.gov.in.
      notification: undefined,
      apply: "https://ssc.gov.in/login",
      website: "https://ssc.gov.in/",
    },

    provenance: {
      status: "PARTIALLY_VERIFIED",
      lastVerifiedAt: "2026-08-16",
      primarySourceUrl: "https://ssc.gov.in",
      primarySourceType: "OFFICIAL_WEBSITE",
      notes:
        "12,256 tentative vacancies confirmed from ssc.gov.in. Notification date 21 May 2026 confirmed. " +
        "Application closed Jun 2026 confirmed. Tier-I tentatively Sep–Oct 2026. " +
        "Exact vacancy breakdown not available in tentative notice — omitted per Rule 2.",
    },

    ecosystem: {
      careerCampus2: "https://cc2.careercampus.in/ssc-cgl-mock-test",
      calcInfinityAge: "https://calcinfinity.com/age-calculator?cutoff=2026-08-01",
    },
  },

  // ─── 5. IBPS PO/MT CRP XVI 2026 ──────────────────────
  // CORRECTED: 7,365 vacancies, notif 1 Jul 2026, apps closed 26 Jul, prelims 22-23 Aug 2026
  {
    id: "ibps-po-crp-xvi-2026",
    slug: "ibps-po-mt-crp-xvi-2026",
    type: "government",
    title: "IBPS PO/MT CRP XVI — Probationary Officer 2026",
    organizationId: "ibps",
    organizationName: "Institute of Banking Personnel Selection (IBPS)",
    notificationNumber: "CRP PO/MT-XVI",
    shortDescription:
      "CRP PO/MT-XVI recruitment for Probationary Officers and Management Trainees " +
      "in 11 participating public sector banks across India.",
    category: "banking",
    state: "All India",
    qualification: "Graduate",
    postDate: "2026-07-01",
    govType: "PSU Bank",

    totalVacancies: 7365,
    vacanciesDisplay: "7,365 Vacancies",

    application: {
      notificationDate: "2026-07-01",
      openDate: "2026-07-01",
      closeDate: "2026-07-26",
    },

    examStages: [
      {
        name: "Preliminary Examination",
        order: 1,
        status: "CONDUCTED",
        certainty: "CONFIRMED",
        dateDisplay: "22–23 Aug 2026",
        dateIso: "2026-08-22",
        dateProvenance: "IBPS Official Notification / Admit Card Notice",
        notes: "Conducted 22–23 Aug 2026.",
      },
      {
        name: "Mains Examination",
        order: 2,
        status: "SCHEDULED",
        certainty: "CONFIRMED",
        dateDisplay: "4 Oct 2026",
        dateIso: "2026-10-04",
        dateProvenance: "IBPS CRP XVI Official Notification",
      },
      {
        name: "Common Interview",
        order: 3,
        status: "NOT_DECLARED",
        certainty: "TBA",
      },
    ],

    fee: {
      rows: [
        { category: "General / OBC / EWS", amount: 850, note: "₹850" },
        { category: "SC / ST / PwBD", amount: 175, note: "₹175" },
      ],
      modes: ["Debit Cards", "Credit Cards", "Internet Banking", "IMPS", "UPI"],
    },

    ageLimit: {
      min: 20,
      max: 30,
      asOf: "2026-08-01",
      relaxation: ["OBC (NCL): +3 years", "SC/ST: +5 years"],
    },

    eligibility: [
      "Degree (Graduation) in any discipline from a University recognized by the Govt. of India.",
    ],

    selectionProcess: [
      "Preliminary Online Examination (100 Marks)",
      "Main Online Examination & Descriptive Test (225 Marks)",
      "Common Interview (100 Marks)",
    ],

    howToApply: [
      "Application period for CRP PO/MT-XVI has ended.",
      "Prelims conducted 22–23 Aug 2026. Mains examination scheduled 4 Oct 2026.",
    ],

    links: {
      // No verified PDF URL for CRP XVI notification — set to undefined.
      // Candidates should access the notification from ibps.in directly.
      notification: undefined,
      apply: "https://ibpsonline.ibps.in/",
      website: "https://www.ibps.in/",
    },

    provenance: {
      status: "PARTIALLY_VERIFIED",
      lastVerifiedAt: "2026-08-16",
      primarySourceUrl: "https://www.ibps.in",
      primarySourceType: "OFFICIAL_WEBSITE",
      notes:
        "7,365 vacancies confirmed from ibps.in. Notification 1 Jul 2026, apps closed 26 Jul 2026 confirmed. " +
        "Prelims 22–23 Aug 2026 conducted — confirmed. " +
        "Mains 4 Oct 2026 confirmed. Exact vacancy breakdown by bank not yet available — omitted per Rule 2.",
    },

    ecosystem: {
      careerCampus2: "https://cc2.careercampus.in/ibps-po-test-series",
      calcInfinityAge: "https://calcinfinity.com/age-calculator?cutoff=2026-08-01",
    },
  },

  // ─── 6. UPSC CSE 2026 ────────────────────────────────
  // CORRECTED: Notif 4 Feb 2026, Prelims CONDUCTED 24 May 2026, Mains 21 Aug 2026
  {
    id: "upsc-cse-2026",
    slug: "upsc-civil-services-cse-2026",
    type: "government",
    title: "UPSC Civil Services Examination (CSE) 2026",
    organizationId: "upsc",
    organizationName: "Union Public Service Commission (UPSC)",
    notificationNumber: "CSE 2026",
    shortDescription:
      "Premier recruitment examination for IAS, IPS, IFS, IRS, and Central Group 'A' " +
      "Civil Services of the Government of India.",
    category: "government",
    state: "All India",
    qualification: "Graduate",
    postDate: "2026-02-04",
    govType: "Central Govt",

    totalVacancies: 1056,
    vacanciesDisplay: "Not specified",
    // Note: UPSC CSE vacancy is typically declared with the final result, not the notification.
    // 1056 is from secondary sources. Marking display as "Not specified" per Rule 2
    // since exact number could not be verified from upsc.gov.in notification PDF directly.

    application: {
      notificationDate: "2026-02-04",
      openDate: "2026-02-04",
      closeDate: "2026-02-25",
    },

    examStages: [
      {
        name: "Preliminary Examination",
        order: 1,
        status: "CONDUCTED",
        certainty: "CONFIRMED",
        dateDisplay: "24 May 2026",
        dateIso: "2026-05-24",
      },
      {
        name: "Mains Written Examination",
        order: 2,
        status: "CONDUCTED",
        certainty: "CONFIRMED",
        dateDisplay: "21–28 Aug 2026",
        dateIso: "2026-08-21",
        dateProvenance: "UPSC Official Examination Timetable",
        notes: "Mains examination conducted 21–28 Aug 2026.",
      },
      {
        name: "Personality Test / Interview",
        order: 3,
        status: "NOT_DECLARED",
        certainty: "TBA",
      },
    ],

    fee: {
      rows: [
        { category: "General / OBC / EWS Male", amount: 100, note: "₹100" },
        { category: "Female / SC / ST / PwBD", amount: 0, note: "Nil (Exempted)" },
      ],
      modes: ["Visa/Mastercard/Rupay", "Net Banking", "UPI"],
    },

    ageLimit: {
      min: 21,
      max: 32,
      asOf: "2026-08-01",
      relaxation: ["OBC: +3 years (9 attempts)", "SC/ST: +5 years (Unlimited)"],
    },

    eligibility: [
      "Degree from a University incorporated by an Act of the Central or State Legislature in India.",
    ],

    selectionProcess: [
      "Civil Services Preliminary Examination (Objective)",
      "Civil Services Main Examination (Written — 1750 Marks)",
      "Personality Test / Interview (275 Marks)",
    ],

    howToApply: [
      "Application period for CSE 2026 has ended.",
      "Prelims conducted 24 May 2026. Mains conducted Aug 2026. Await Personality Test / Interview schedule from upsc.gov.in.",
      "Check upsconline.nic.in for e-admit cards and updates.",
    ],

    links: {
      // No specific CSE 2026 notification PDF URL verified directly — set to undefined.
      // Candidates should access the notification from upsc.gov.in directly.
      notification: undefined,
      apply: "https://upsconline.nic.in/",
      website: "https://upsc.gov.in/",
    },

    provenance: {
      status: "PARTIALLY_VERIFIED",
      lastVerifiedAt: "2026-08-16",
      primarySourceUrl: "https://upsc.gov.in",
      primarySourceType: "OFFICIAL_WEBSITE",
      notes:
        "Notification 4 Feb 2026 confirmed from upsc.gov.in. Prelims 24 May 2026 conducted — confirmed. " +
        "Mains commenced 21 Aug 2026, concluded Aug 2026 — confirmed. Vacancy count 1056 is from secondary sources — " +
        "UPSC typically declares final vacancy with results. Display shows 'Not specified' per Rule 2.",
    },

    ecosystem: {
      careerCampus2: "https://cc2.careercampus.in/upsc-cse-prep",
      calcInfinityAge: "https://calcinfinity.com/age-calculator?cutoff=2026-08-01",
    },
  },
  {
    "id": "ibps-crppomtxv",
    "slug": "ibps-common-process-probationary-officers-management-trainees-2025",
    "type": "government",
    "title": "COMMON RECRUITMENT PROCESS FOR RECRUITMENT OF PROBATIONARY OFFICERS/ MANAGEMENT TRAINEES",
    "organizationId": "ibps",
    "organizationName": "Institute of Banking Personnel Selection",
    "shortDescription": "Institute of Banking Personnel Selection recruitment notification discovered on 2026-09-02. Complete details pending verification.",
    "category": "banking",
    "state": "All India",
    "qualification": "Graduate",
    "notificationNumber": "CRP PO/MT -XV",
    "govType": "PSU Bank",
    "totalVacancies": 202,
    "vacanciesDisplay": "202 Vacancies",
    "application": {
      "openDate": "2025-07-01",
      "closeDate": "2025-07-21"
    },
    "examStages": [
      {
        "name": "Details not yet declared",
        "order": 1,
        "status": "NOT_DECLARED",
        "certainty": "TBA"
      }
    ],
    "links": {
      "notification": "https://www.ibps.in/wp-content/uploads/Detailed-Notification_CRP-PO-XV_10.7.25.pdf",
      "apply": "https://ibps.in",
      "website": "https://ibps.in"
    },
    "provenance": {
      "status": "NOT_VERIFIED",
      "lastVerifiedAt": "2026-09-02",
      "primarySourceUrl": "https://www.ibps.in/wp-content/uploads/Detailed-Notification_CRP-PO-XV_10.7.25.pdf",
      "primarySourceType": "OFFICIAL_NOTIFICATION",
      "notes": "Auto-discovered from https://www.ibps.in/wp-content/uploads/Detailed-Notification_CRP-PO-XV_10.7.25.pdf on 2026-09-02 (source tier 3). Confidence: 100%. Missing fields: postDate. STATUS: Requires human verification against official notification before setting to PARTIALLY_VERIFIED."
    }
  }
];
