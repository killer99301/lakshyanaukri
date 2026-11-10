// Eligibility UX and the SBI Apply Online label (owner-approved, 10 Nov 2026): date of birth as Day, Month and a
// typed Year on a job's age check and on /eligibility, the existing age engine unchanged, and one verified
// application page for SBI. Pure: no browser, no network.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/eligibility-ux.test.tsx

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { isoFromParts, checkAge, ageOn, describeAge } from "@/lib/eligibility";
import { dobProblem } from "@/lib/eligibility-finder";
import { publicLinkWords, VERIFIED_APPLICATION_PAGES } from "@/lib/public-link-labels";
import { originFor } from "@/lib/cms/importer/trusted-domains";
import { EligibilityChecker } from "@/components/jobs/EligibilityChecker";
import EligibilityFinderClient from "@/app/(main)/eligibility/EligibilityFinderClient";
import type { AgeLimit } from "@/types";

const TODAY = "2026-11-10";
const fromParts = (d: string, m: string, y: string) => isoFromParts(d, m, y);

suite("Date of birth from Day, Month and Year");
test("EU01 a typed four-digit year makes the date; until then there is none", () => {
  assert.equal(fromParts("15", "05", "1995"), "1995-05-15");
  assert.equal(fromParts("1", "1", "1998"), "1998-01-01", "unpadded values are padded");
  assert.equal(fromParts("15", "05", "95"), "", "a two-digit year is not a year");
  assert.equal(fromParts("15", "05", "199"), "", "still typing");
  assert.equal(fromParts("", "05", "1995"), "");
  assert.equal(fromParts("15", "", "1995"), "");
});
test("EU02 impossible dates, leap years, the future and unlikely years are named", () => {
  assert.equal(dobProblem(fromParts("31", "02", "1999"), TODAY), "That is not a real date.");
  assert.equal(dobProblem(fromParts("31", "04", "1999"), TODAY), "That is not a real date.", "April has 30 days");
  assert.equal(dobProblem(fromParts("29", "02", "2001"), TODAY), "That is not a real date.", "2001 is not a leap year");
  assert.equal(dobProblem(fromParts("29", "02", "2000"), TODAY), null, "2000 is a leap year");
  assert.equal(dobProblem(fromParts("29", "02", "1900"), TODAY), "That is not a real date.", "1900 is not a leap year");
  assert.equal(dobProblem(fromParts("11", "11", "2026"), TODAY), "Your date of birth must be in the past.");
  assert.equal(dobProblem(fromParts("01", "01", "1900"), TODAY), "Check the year of your date of birth.");
});

suite("The age engine, unchanged");
// SBI Assistant Manager (Engineer – Fire): 21 to 40 on 31 Oct 2026.
const SBI: AgeLimit = { min: 21, max: 40, asOf: "2026-10-31" };
test("EU03 exact age in years, months and days on the notice's own date", () => {
  const age = ageOn(fromParts("15", "05", "1998"), "2026-10-31");
  assert.ok(age);
  assert.equal(describeAge(age!), "28 years, 5 months, 16 days");
  assert.equal(describeAge(ageOn(fromParts("29", "02", "2000"), "2026-10-31")!), "26 years, 8 months, 2 days", "born on 29 February");
});
test("EU04 the minimum and maximum boundaries, exactly", () => {
  assert.equal(checkAge(SBI, fromParts("31", "10", "2005"), "GEN", false).verdict, "WITHIN", "21 on the day itself");
  assert.equal(checkAge(SBI, fromParts("01", "11", "2005"), "GEN", false).verdict, "TOO_YOUNG", "one day short of 21");
  assert.equal(checkAge(SBI, fromParts("01", "11", "1986"), "GEN", false).verdict, "WITHIN", "39 years, 11 months, 30 days");
  assert.equal(checkAge(SBI, fromParts("31", "10", "1986"), "GEN", false).verdict, "CHECK_NOTICE", "turned 40 that day: the notice decides");
  assert.equal(checkAge(SBI, fromParts("30", "10", "1985"), "GEN", false).verdict, "TOO_OLD");
});
test("EU05 category and PwBD use only the relaxations the notice gives", () => {
  const withRelaxation: AgeLimit = { ...SBI, relaxation: [{ category: "OBC", years: 3 }] } as AgeLimit;
  const obc = checkAge(withRelaxation, fromParts("30", "10", "1985"), "OBC", false);
  assert.equal(obc.verdict, "WITHIN_RELAXED");
  assert.equal(checkAge(withRelaxation, fromParts("30", "10", "1985"), "SC", false).verdict, "TOO_OLD", "no SC relaxation in this notice: none is invented");
  assert.equal(checkAge(SBI, fromParts("30", "10", "1985"), "GEN", true).verdict, "TOO_OLD", "no PwBD relaxation in this notice: none is invented");
});

suite("The fields on the page");
test("EU06 the job's age check: Day and Month lists and a typed Year, no calendar, nothing sent", () => {
  const html = renderToStaticMarkup(<EligibilityChecker ageLimit={SBI} />);
  assert.ok(!/type="date"/.test(html), "no native calendar");
  assert.match(html, /<legend[^>]*>Date of birth<\/legend>/);
  assert.match(html, /<label[^>]*for="age-check-dob-day"[^>]*>Day<\/label>/);
  assert.match(html, /<label[^>]*for="age-check-dob-month"[^>]*>Month<\/label>/);
  assert.match(html, /<label[^>]*for="age-check-dob-year"[^>]*>Year \(four digits\)<\/label>/);
  assert.match(html, /id="age-check-dob-year"[^>]*inputMode="numeric"|inputMode="numeric"[^>]*id="age-check-dob-year"/);
  assert.equal((html.match(/<option value="\d\d">\d\d<\/option>/g) ?? []).length, 31, "days 01 to 31");
  assert.match(html, /<option value="02">February<\/option>/);
  assert.match(html, /Nothing you enter is saved or sent/);
});
test("EU07 /eligibility uses the same fields", () => {
  const html = renderToStaticMarkup(<EligibilityFinderClient jobs={[]} />);
  assert.ok(!/type="date"/.test(html));
  assert.match(html, /id="finder-dob-day"/);
  assert.match(html, /id="finder-dob-month"/);
  assert.match(html, /id="finder-dob-year"/);
});

suite("Apply Online for SBI Fire, and nothing wider");
test("EU08 SBI Fire's verified IBPS page: Apply Online, with where applications are taken, never SBI's own site", () => {
  const w = publicLinkWords("sbi", "https://ibpsreg.ibps.in/sbiameoct26/", "apply");
  assert.equal(w.label, "Apply Online");
  assert.equal(w.official, false);
  assert.equal(w.asApply, true);
  assert.equal(w.note, "Applications are taken on ibpsreg.ibps.in");
  assert.equal(publicLinkWords("sbi", "https://ibpsreg.ibps.in/sbiameoct26", "apply").label, "Apply Online", "without the final slash");
  assert.equal(publicLinkWords("sbi", "https://ibpsreg.ibps.in/sbiameoct26/index.php", "apply").label, "Apply Online", "a page under it");
});
test("EU09 everything else stays as it was: other IBPS pages, other bodies, lookalikes, plain http, notices and sites", () => {
  const neutral = (org: string, url: string) => publicLinkWords(org, url, "apply").label;
  assert.equal(neutral("sbi", "https://ibpsreg.ibps.in/sbipojan27/"), "Application link", "another SBI registration page");
  assert.equal(neutral("sbi", "https://ibpsreg.ibps.in/sbiameoct26x/"), "Application link", "a near path");
  assert.equal(neutral("canara-bank", "https://ibpsreg.ibps.in/sbiameoct26/"), "Application link", "the page for another body");
  assert.equal(neutral("sbi", "https://ibpsreg.ibps.in.example.com/sbiameoct26/"), "Application link", "a lookalike host");
  assert.equal(neutral("sbi", "http://ibpsreg.ibps.in/sbiameoct26/"), "Application link", "not https");
  assert.equal(publicLinkWords("sbi", "https://ibpsreg.ibps.in/sbiameoct26/", "website").label, "Website link", "only the apply link");
  assert.equal(neutral("lic-hfl", "https://nats.education.gov.in/x"), "Apply Online", "LIC HFL's application partner, as before");
  assert.equal(neutral("sbi", "https://sbi.bank.in/web/careers"), "Apply Online", "SBI's own site, as before");
  assert.equal(neutral("ibps", "https://www.adda247.com/jobs/x"), "Other link", "an aggregator, as before");
  assert.equal(publicLinkWords("sbi", "https://ibpsreg.ibps.in/sbiameoct26/", "apply").official, false);
});
test("EU10 the trusted-domains registry is unchanged: IBPS's registration host is not SBI's", () => {
  assert.equal(originFor("sbi", "ibpsreg.ibps.in").role, "UNLISTED");
  assert.deepEqual(VERIFIED_APPLICATION_PAGES.map((p) => [p.organizationId, p.url]), [["sbi", "https://ibpsreg.ibps.in/sbiameoct26/"]]);
});
