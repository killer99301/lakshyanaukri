# Architectural & Design System Proposal: Career Campus

## Executive Summary
This document provides a visual reference inspection, design system token alignment, and reusable component mapping for **Career Campus** based on the primary light mode visual reference standards (Homepage, Job Listing, and BPSC 72nd Recruitment Detail Page).

### Core Architectural Principles
1. **Light Mode Only**: Strict adherence to light theme (clean white/off-white background, warm orange `#EA580C` / coral red `#F95738` brand accents, dark charcoal `#0F172A` text).
2. **Data-Driven Dynamic Pages**: Polymorphic schema rendering BPSC 72nd, UPSC, SSC, RRB, and Private jobs using a single reusable engine.
3. **Direct Official PDF Links**: Notification PDFs are NOT hosted locally. The platform links directly to the official PDF hosted on the recruiting authority's server (`View Official Notification ↗`).
4. **Contextual Ecosystem Cards**: Seamless, non-intrusive integration for **Career Campus 2** (Preparation/PYQs), **CalcInfinity** (Age/Percentage Calculators), and **Anantamarg** (Auspicious Timing).

---

## 1. Design System & Visual Tokens

| Design Token Category | Token / Value | Usage & Context |
| :--- | :--- | :--- |
| **Brand Primary Accent** | `#EA580C` (Orange-600) | Primary CTA buttons ("Apply Now", "Start Preparing Now", "Subscribe") |
| **Brand Secondary Accent**| `#F95738` (Warm Coral Red) | Badges, alert text, deadline highlights, accent borders |
| **Surface Background** | `#FAFAFA` (Slate-50) | Main page background |
| **Surface Card/Container**| `#FFFFFF` (Pure White) | Content cards, sidebar widgets, header bar |
| **Surface Accent/Highlight**| `#FFF7ED` (Orange-50) | Quick stats containers, banner backgrounds, highlighted table headers |
| **Text Primary** | `#0F172A` (Slate-900) | Main headings, job titles, key numbers |
| **Text Secondary** | `#475569` (Slate-600) | Subtitles, labels, key-value descriptions |
| **Borders & Dividers** | `#E2E8F0` (Slate-200) | Subtle 1px card borders, table dividers |
| **Accent Borders** | `#FED7AA` (Orange-200) | Active tabs, featured card borders |
| **Badge Tints** | `#EEF2FF`, `#ECFDF5`, `#FFF7ED` | Soft indigo (Govt), emerald (Category), orange (Job Type) |

---

## 2. Reusable Component Pattern Mapping

Based on the reference UI (Homepage, Jobs Listing, and BPSC 72nd Detail Page), we break down the UI into the following reusable components:

### A. Layout Components (`src/components/layout/`)
- `<Header />`: Top bar with Logo, navigation dropdowns (Jobs, Exams, Companies, Resources, Tools, Blog), theme indicator, Login (ghost), Sign Up (orange pill).
- `<Footer />`: 4-column layout + copyright bar + Ecosystem resource links + "Made with ❤️ in India".
- `<Breadcrumbs />`: Chevron-separated trail (`Home > Jobs > State Govt > Detail`) + Share & Save Job action buttons.
- `<PageContainer />`: Centered layout wrapper with responsive max-width (`max-w-7xl`) and consistent padding.

### B. Core Job Detail Components (`src/components/jobs/`)
- `<JobDetailHeader />`: Hero card featuring Organization logo avatar, Job Title, Organization Name, Category Badges (`State Govt`, `Graduate`, `Full Time`), Quick Metrics (Vacancies count, Last Date, Days Left badge), and Primary CTAs (`Apply Now`, `Official Website ↗`).
- `<JobSectionTabs />`: Sticky sub-navigation bar (`Overview`, `Important Dates`, `Vacancies`, `Eligibility`, `Syllabus`, `Exam Pattern`, `Salary`, `Selection Process`, `Contact`).
- `<KeyAttributesGrid />`: 2-column icon grid detailing Organization, Post Name, Department, Job Type, Location, Application Mode, Official Website.
- `<ImportantDatesCard />`: Milestone dates table with color-coded highlight for upcoming deadlines.
- `<OfficialNotificationCard />`: Structured PDF notification module with PDF icon, document meta, and **Direct External Link Action** (`View Official Notification ↗`).
- `<VacancyOverviewTable />`: Clean tabular display for Post Type, Seat Count, and Pay Scale (Level 9 / Level 10 basic pay breakdown).
- `<SelectionProcessSteps />`: Numbered sequence (1 to 5) with step titles (Prelims, Mains, Interview, Document Verification, Medical).
- `<AboutOrganizationCard />`: Organization summary with building image thumbnail and direct website link.

### C. Ecosystem Supporting Widgets (`src/components/ecosystem/`)
- `<EcosystemPrepCard />` (**Career Campus 2**):
  - Promotes prep materials (Syllabus, PYQs, Mock Tests, Performance Analysis).
  - Primary CTA: "Start Preparing Now ↗" (orange button).
  - Footer tag: "Powered by Career Campus 2".
- `<EcosystemCalcCard />` (**CalcInfinity**):
  - Promotes eligibility tools (Age Calculator, Date Calculator, Percentage Calculator).
  - Primary CTA: "Explore Calculators ↗".
  - Footer tag: "Powered by CalcInfinity".
- `<EcosystemMuhuratCard />` (**Anantamarg**):
  - Promotes auspicious application timing.
  - Features traditional calendar illustration & CTA: "Check Muhurat ↗".
  - Footer tag: "Powered by Anantamarg".
- `<EcosystemWideBanner />`: Bottom full-width banner combining prep guidance, book stack graphic, and feature pills (Live Classes, Study Material, Free Mocks, Doubt Support).

### D. Job Listing & Card Components (`src/components/jobs/`)
- `<JobCard />` (List & Grid views): Reusable for Homepage, Job Listing, and Search Results. Displays logo, recruitment title, organization, category tags, vacancy count, last date, days left badge, and "View Details" button.
- `<JobSearchFilterBar />`: Search input, location filter dropdown, category pills (All Jobs, Govt, Private, Internship, WFH), and detailed dropdown filters (Department, Qualification, Experience, Salary).

---

## 3. Official Notification PDF Rule Implementation

```
+-----------------------------------------------------------------------+
|  [PDF Icon]  BPSC 72nd Combined Competitive Examination 2026          |
|              Official Notification PDF | Size: ~1.25 MB               |
|                                                                       |
|              [ View Official Notification ↗ ]                          |
|                                                                       |
|  * Note: Links directly to the official BPSC portal notification PDF  |
+-----------------------------------------------------------------------+
```

- **Target Attribute**: `target="_blank"` and `rel="noopener noreferrer"`
- **Schema Property**: `officialLinks.notificationPdfUrl` containing the direct external HTTPS URL.
- **Button Label**: "View Official Notification ↗" or "Open Official PDF ↗".

---

## 4. Next Implementation Steps

1. **Phase 1: Architecture & Design System Setup**
   - Create helper utility `cn()` (`clsx` + `tailwind-merge`).
   - Define custom color variables and font families in `globals.css`.
   - Implement `types/job.ts`, `types/ecosystem.ts`, and `lib/constants.ts`.

2. **Phase 2: Core Components & Layout Shell**
   - Build Header, Footer, Breadcrumb, and Container components.
   - Build Ecosystem Cards (`<EcosystemPrepCard />`, `<EcosystemCalcCard />`, `<EcosystemMuhuratCard />`).

3. **Phase 3: Reusable Job Detail Engine & Jobs Listing**
   - Implement dynamic route `app/jobs/[slug]/page.tsx`.
   - Build Job Listing page `app/jobs/page.tsx` with search & filters.

4. **Phase 4: Homepage & Final Integration**
   - Assemble Homepage using shared job cards, category grids, and ecosystem showcases.
