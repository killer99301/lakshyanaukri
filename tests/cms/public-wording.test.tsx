// Owner-controlled publication, Stage 2: the public side. No verification badges, the owner's exact wording (D5),
// link words from the trusted-domains registry (§1.3), the Private Jobs filter hidden. Pure: no database, no network.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/public-wording.test.tsx

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { projectForPreview } from "@/lib/cms/projector";
import { snapshotToGovernmentRecruitment } from "@/lib/cms/adapter";
import { publicLinkWords, isAggregatorHost } from "@/lib/public-link-labels";
import { pageUpdatedLabel } from "@/lib/lifecycle";
import { JobDetailHeader } from "@/components/jobs/JobDetailHeader";
import { JobCard } from "@/components/jobs/JobCard";
import { MarketplaceJobCard } from "@/components/jobs/MarketplaceJobCard";
import { OfficialNotificationCard } from "@/components/jobs/OfficialNotificationCard";
import { JobDetailSections } from "@/components/jobs/JobDetailSections";
import type { Opportunity } from "@/types";

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");
const read = (p: string) => readFileSync(p, "utf8");
const BADGES = /Not Verified|Partially Verified|✓ Verified|Needs Update|Key details checked|Last verified|Not yet checked against|Details not yet checked|Verified/;

const record = (orgId: string, links: unknown[], over: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-0000000000b1", slug: "test-public-wording", draftState: "DRAFT", recordRevision: "r1",
  identity: { organizationId: orgId, organizationName: orgId === "ibps" ? "Institute of Banking Personnel Selection" : "Test Organisation", recruitmentYear: 2099, govType: "PSU",
    title: { value: "TEST PUBLIC WORDING 2099", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } },
  dates: { applicationCloseDate: { value: "2099-07-26", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } },
  vacancies: {}, financial: {}, links, documents: [], updates: [],
  lifecycle: { status: "DRAFT", conflicts: [], events: [] },
  provenance: { status: "VERIFIED", lastVerifiedAt: "2099-01-01", primarySourceType: "OFFICIAL_NOTIFICATION" },
  createdAt: "2099-01-01T00:00:00Z", updatedAt: "2099-01-01T00:00:00Z", ...over,
} as unknown as RecruitmentRecord);
const L = (type: string, url: string, official = false) => ({ type, label: type, url, official });
const jobOf = (orgId: string, links: unknown[], snapOver: Record<string, unknown> = {}) =>
  snapshotToGovernmentRecruitment({ ...projectForPreview(record(orgId, links)), ...snapOver }) as unknown as Opportunity;
const NOW = new Date("2099-07-01T00:00:00Z");

suite("Link words from the registry (§1.3)");

test("W01 the recruiting body's own host: Official Website / Notification / Apply Online (subdomains too)", () => {
  assert.deepEqual([publicLinkWords("ibps", "https://www.ibps.in/", "website").label, publicLinkWords("ibps", "https://www.ibps.in/n.pdf", "notification").label,
    publicLinkWords("ibps", "https://ibpsreg.ibps.in/x/", "apply").label], ["Official Website", "Notification", "Apply Online"]);
  assert.equal(publicLinkWords("ibps", "https://ibpsreg.ibps.in/x/", "apply").official, true);
});

test("W02 an application partner: Apply Online with “Applications are taken on <host>”, never official", () => {
  const w = publicLinkWords("lic-hfl", "https://nats.education.gov.in/apply", "apply");
  assert.equal(w.label, "Apply Online");
  assert.equal(w.official, false);
  assert.equal(w.note, "Applications are taken on nats.education.gov.in");
  assert.equal(publicLinkWords("lic-hfl", "https://bfsissc.com/x", "apply").label, "Application link", "a partner for the exam only is not an application partner");
});

test("W03 unlisted hosts, an unlisted gov.in and an unregistered organisation: by kind only, never “Official”", () => {
  assert.equal(publicLinkWords("ibps", "https://example.org/n.pdf", "notification").label, "Notification link");
  assert.equal(publicLinkWords("ssc", "https://someboard.gov.in/", "website").label, "Website link");
  assert.equal(publicLinkWords("canara-bank", "https://canarabank.bank.in/careers", "website").label, "Website link", "an organisation not in the registry");
  assert.equal(publicLinkWords("sbi", "https://sbi.bank.in/web/careers", "website").label, "Official Website", "sbi.bank.in is SBI's own site (registry, 9 Nov)");
  assert.equal(publicLinkWords("sbi", "https://ibpsreg.ibps.in/sbiameoct26/", "apply").label, "Application link", "the IBPS registration site stays neutral for SBI");
  assert.equal(publicLinkWords("ibps", "https://apply.example.org/", "apply").label, "Application link");
});

test("W04 an aggregator is never an Apply destination: only “Other link”", () => {
  for (const u of ["https://www.adda247.com/jobs/x", "https://www.sarkariresult.com/x", "https://govtjobguru.in/x"]) {
    const w = publicLinkWords("ibps", u, "apply");
    assert.ok(w.label === "Other link" && !w.asApply && !w.official, u);
  }
  assert.ok(isAggregatorHost("m.freejobalert.com") && !isAggregatorHost("ibps.in"));
});

suite("No verification badges on public pages (D5)");

test("W05 the job header: no badge, the page date as “Updated: <date>”, Apply words from the registry", () => {
  const job = jobOf("ibps", [L("OFFICIAL_WEBSITE", "https://www.ibps.in/", true), L("OFFICIAL_NOTIFICATION", "https://www.ibps.in/n.pdf", true), L("APPLY_ONLINE", "https://ibpsreg.ibps.in/x/", true)],
    { keyDetailsChecked: true, keyDetailsCheckedOn: "2099-06-30" });
  const t = text(renderToStaticMarkup(<JobDetailHeader job={job} now={NOW} />));
  assert.ok(!BADGES.test(t), t);
  assert.match(t, /Updated: /);
  assert.ok(t.includes("Apply Online"), t);
  const closed = jobOf("ibps", [L("OFFICIAL_WEBSITE", "https://www.ibps.in/", true)]);
  assert.ok(text(renderToStaticMarkup(<JobDetailHeader job={closed} now={new Date("2099-08-01T00:00:00Z")} />)).includes("Official Website"), "a closed job names the body's own site");
});

test("W06 an aggregator Apply link already on a page is not shown as Apply; the website is named by its standing", () => {
  const job = jobOf("ibps", [L("OFFICIAL_WEBSITE", "https://example.org/", false), L("APPLY_ONLINE", "https://www.adda247.com/jobs/x", false)]);
  const html = renderToStaticMarkup(<JobDetailHeader job={job} now={NOW} />);
  assert.ok(!html.includes("adda247.com"), "no link to the aggregator");
  assert.ok(text(html).includes("Website link") && !text(html).includes("Apply Online"), text(html));
});

test("W07 the notice card, job cards and sections: no badges, no “Official” for unlisted links", () => {
  const job = jobOf("ibps", [L("OFFICIAL_NOTIFICATION", "https://example.org/n.pdf", true)]);
  const card = text(renderToStaticMarkup(<OfficialNotificationCard notificationPdfUrl={job.links.notification} officialWebsiteUrl={job.links.website} organizationId={job.organizationId} />));
  assert.ok(!BADGES.test(card) && card.includes("Notification link") && !/Official PDF|Official Website/.test(card), card);
  for (const el of [<JobCard key="a" job={job} />, <MarketplaceJobCard key="b" job={job} />]) {
    const t = text(renderToStaticMarkup(el));
    assert.ok(!BADGES.test(t), t);
  }
  const withUpdate = { ...job, updates: [{ id: "u1", type: "CORRIGENDUM", title: "Corrigendum", dateIso: "2099-06-01", dateDisplay: "1 Jun 2099", summary: "x" }] } as unknown as Opportunity;
  const sections = text(renderToStaticMarkup(<JobDetailSections job={withUpdate} />));
  assert.ok(!/Verified notices published by/.test(sections) && sections.includes("Recruitment information for Institute of Banking Personnel Selection"), "org line");
});

test("W08 the page date is the page's, never a check date; none without one", () => {
  const job = jobOf("ibps", []);
  assert.match(pageUpdatedLabel(job) ?? "", /^Updated: /);
  assert.equal(pageUpdatedLabel({ ...job, provenance: { ...job.provenance, pageUpdatedAt: undefined } } as Opportunity), null);
});

suite("The owner's exact wording and metadata (D5)");

const D5 = {
  title: "Government Jobs & Competitive Exams",
  home: "Recruitment information, important dates, eligibility, vacancies and application links.",
  hero: "Explore government recruitment opportunities across India.",
  list: "Government recruitment information: dates, eligibility, vacancies and application links.",
};

test("W09 titles, descriptions and hero carry the D5 text exactly", () => {
  const layout = read("src/app/layout.tsx"), home = read("src/app/(main)/page.tsx"), site = read("src/config/site.ts");
  assert.ok(layout.includes("`${siteConfig.name} | Government Jobs & Competitive Exams`") && layout.includes("\"LakshyaNaukri | Government Jobs & Competitive Exams\""));
  assert.ok(home.includes("`${siteConfig.name} | Government Jobs & Competitive Exams`") && home.includes(JSON.stringify(D5.home)));
  assert.ok(site.includes(JSON.stringify(D5.home)));
  assert.ok(read("src/app/not-found.tsx").includes("LakshyaNaukri | Government Jobs & Competitive Exams"));
  assert.ok(read("src/app/(main)/HomePageClient.tsx").includes(D5.hero) && read("src/components/jobs/JobsHero.tsx").includes(D5.hero));
  assert.ok(read("src/app/(main)/jobs/layout.tsx").includes(JSON.stringify(D5.list)) && read("src/app/(main)/jobs/page.tsx").includes(JSON.stringify(D5.list)));
  assert.ok(read("src/app/(main)/admit-cards/page.tsx").includes("Admit cards and download links"));
  assert.ok(read("src/app/(main)/answer-keys/page.tsx").includes("Answer keys and source links"));
  assert.ok(read("src/app/(main)/HomePageClient.tsx").includes("Free. No spam.</p>"));
});

test("W10 no public file claims verification; the Private Jobs filter is hidden (private jobs themselves kept)", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
  const files = [...walk("src/app/(main)"), ...walk("src/components/jobs"), "src/app/layout.tsx", "src/app/not-found.tsx", "src/config/site.ts", "src/components/layout/Footer.tsx"];
  const claims = /Verified Government|verified government|100% verified|Browse verified|Discover verified|Verified notices|Verified Answer Key|Verified Career|Official Sourcing Guarantee|Verified government updates|trustworthy|Your trusted partner|Sourced directly from official/;
  const hits = files.filter((f) => claims.test(read(f)));
  assert.deepEqual(hits, []);
  const sidebar = read("src/components/jobs/JobFiltersSidebar.tsx");
  assert.ok(!/label: "Private Jobs"/.test(sidebar), "filter option removed");
  assert.ok(/id: "private"/.test(read("src/lib/constants.ts")), "the private type itself remains");
});
