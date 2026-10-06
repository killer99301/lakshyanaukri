"use client";

import { useId, useState } from "react";

// ═══════════════════════════════════════════════════════════
// Admin: the small "i" that explains a name
// ═══════════════════════════════════════════════════════════
//
// Hover it, tab to it, or tap it: a short plain-language note appears. The
// wording lives in HELP below, keyed by the section title, the field path or
// the label it explains, so one place holds every explanation.

export const HELP: Record<string, string> = {
  // ── Sections ──
  "Identity": "The basics that name this job: its title, the official notification number, and who is recruiting.",
  "Recruitment Status": "Where the whole recruitment stands right now. Normally worked out from the dates; set it by hand only to override that.",
  "Important Dates": "The application window. These dates drive the “days left” badge, Closing Soon, and the timeline on the public page.",
  "Vacancies": "How many posts there are, and the split by post or category if the notification gives one.",
  "Post-wise Eligibility": "The qualification needed for each post, as the notification states it.",
  "Age Criteria": "Minimum and maximum age, the date the age is counted on, and the extra years allowed for each category.",
  "Fees & Pay": "The application fee for each group and the pay level or salary of the post.",
  "Selection Process": "The steps a candidate goes through, in order: written exam, skill test, interview, document check.",
  "Exam Stages": "The same steps, but with their dates and what has happened so far. This is what moves the public timeline and “What’s next”.",
  "Exam Pattern": "For each paper: subjects, number of questions, marks, time allowed and negative marking.",
  "Syllabus": "The subjects and topics for each paper, as listed in the official notification.",
  "How to Apply": "Short numbered steps for filling the application.",
  "Links": "Where the public buttons go: notification PDF, Apply Online, official website, and later the admit card, answer key and result. Publishing needs at least one link marked official.",
  "Candidate Documents": "Papers a candidate must keep ready or upload: photo, signature, certificates.",
  "Official Update History": "Dated notes of what changed after the notification: a corrigendum, an extended last date, a new exam date.",
  "Special Conditions": "Anything unusual that applies only to this recruitment.",
  "Evidence Sources": "The pages and files the record’s facts were taken from.",
  "Conflicts": "Places where two sources disagreed and someone must decide which is right.",
  "Revision History": "Every change made to this record: who, when, the old value and the new one.",

  // ── Identity ──
  "identity.title": "The full name of the recruitment as visitors will see it, for example “SSC CHSL Examination 2026”.",
  "identity.shortTitle": "A shorter name for tight spaces. Optional.",
  "identity.notificationNumber": "The reference printed on the official notice, such as “F. No. HQ-C1102/5/2026”. Used to spot duplicates.",
  "identity.advertisementNumber": "Some bodies print an advertisement number as well as, or instead of, a notification number. Optional.",
  "Organization": "The body that is recruiting. Fixed when the record is created.",
  "Year": "The recruitment year in the notification’s name. Fixed when the record is created.",
  "Govt Type": "Central, State or PSU. Decides which “Central Govt / State Govt / PSU” list the job appears in.",
  "Slug": "The last part of the job’s web address. Made from the title when the record is created; it does not change.",
  "Record ID": "The internal number of this record. Only useful when reporting a problem.",

  // ── Listing details ──
  "Listing details": "What shows in the four boxes at the top of the job page and in search and filters.",
  "Qualification": "The lowest qualification that makes someone eligible for at least one post. Drives the “12th Pass / Graduate” filter.",
  "Location": "Where the posts are: “All India”, or a state name.",
  "Category": "Which group the job is listed under: SSC, Banking, Railway and so on.",
  "Short description": "One or two plain sentences shown under the title and in search results.",

  // ── Dates ──
  "dates.notificationDate": "The day the notification was issued.",
  "dates.applicationOpenDate": "The first day candidates can apply.",
  "dates.applicationCloseDate": "The last day to submit the application. The most important date on the page.",
  "dates.feePaymentCloseDate": "The last day to pay the fee, when it differs from the last date to apply.",
  "dates.correctionWindowStart": "The first day candidates can correct a submitted form.",
  "dates.correctionWindowEnd": "The last day candidates can correct a submitted form.",
  "dates.extendedCloseDate": "A new last date, if the body officially extended it. Shown as “Extended”.",
  "dates.prelimsDate": "Older single-date field. Prefer the Exam Stages section, which also records whether the date is confirmed.",
  "dates.examDate": "Older single-date field. Prefer the Exam Stages section, which also records whether the date is confirmed.",
  "dates.mainsDate": "Older single-date field. Prefer the Exam Stages section.",
  "dates.admitCardDate": "The day the admit card was released. Add the admit card link itself under Links.",
  "dates.interviewDate": "Older single-date field. Prefer the Exam Stages section.",
  "dates.resultDate": "The day the result was declared. Add the result link itself under Links.",
  "dates.documentVerificationDate": "Older single-date field. Prefer the Exam Stages section.",

  // ── Vacancies and money ──
  "vacancies.total": "The total number of posts. Leave empty if the notification does not give one.",
  "financial.feeGeneral": "The fee for General and OBC candidates, in rupees. Enter 0 if it is free.",
  "financial.feeSCST": "The fee for SC, ST and PwD candidates, in rupees. Enter 0 if they are exempt.",
  "financial.payScale": "The pay level and range, as written in the notification.",

  // ── Field status badges ──
  "VERIFIED": "Checked against an official source, with that source attached.",
  "PENDING": "Filled in, but nobody has marked it as checked yet. Everything AI Assist fills starts here. It can still be published.",
  "CONFLICTED": "Two sources gave different values. Decide which is right.",
  "NEEDS_UPDATE": "This was right once but an official update may have changed it.",
  "NOT_SPECIFIED": "The notification does not say. Shown to visitors as “not specified”, never guessed.",

  // ── Record states ──
  "DRAFT": "Not visible to the public. You can edit everything.",
  "APPROVED": "Checked and ready, but not yet live.",
  "PUBLISHED": "Live on the website. Click “Edit Record” to change it; the live page stays as it is until you publish again.",
  "ARCHIVED": "Taken off the website.",

  // ── Actions ──
  "Approve & Publish": "Makes this record live on the website. Needs at least one link marked official.",
  "Publish Record": "Makes this approved record live on the website.",
  "Edit Record": "Reopens a live record for editing. Visitors keep seeing the last published version until you publish again.",
  "Preview public page": "Shows how the job page will look with what is saved now, without publishing.",
  "AI Assist": "Paste a page or PDF address. It fills only empty fields, marks them Pending, and never publishes. For fields that already have a value it shows a suggestion you can apply or ignore.",

  // ── Links editor ──
  "Link type": "What the link is. The type decides which button or list it appears in.",
  "Official source": "Tick only if the address is on the recruiting body’s own website.",
  "My saved copy": "Use when the address is your own copy of the file. It is shown as “Saved copy”, with the official page it came from.",

  // ── Exam stages editor ──
  "Where it stands": "What has happened to this stage so far. “Held” and “Result declared” mark it done on the public timeline.",
  "Is the date confirmed?": "Confirmed means an official notice gives this date. Tentative means it comes from an exam calendar or may change.",
  "Or as written": "Use when there is no single day: a range like “12–20 Dec 2026” or just “December 2026”. It is shown exactly as typed.",
};

export function InfoTip({ id, text }: { id?: string; text?: string }) {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const message = text ?? (id ? HELP[id] : undefined);
  if (!message) return null;

  return (
    <span
      style={{ position: "relative", display: "inline-flex", marginLeft: 6, verticalAlign: "middle" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="What is this?"
        aria-describedby={open ? tipId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          width: 15, height: 15, borderRadius: 999, padding: 0,
          border: "1px solid #484f58", background: open ? "#16223d" : "transparent",
          color: open ? "#e2e8f0" : "#8c9bb8",
          fontSize: 10, fontWeight: 700, fontStyle: "italic", fontFamily: "Georgia, serif",
          lineHeight: "13px", cursor: "help", textTransform: "none", letterSpacing: 0,
        }}
      >
        i
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          style={{
            position: "absolute", top: 20, left: -8, zIndex: 50,
            width: 280, maxWidth: "70vw", padding: "9px 11px",
            background: "#131c31", border: "1px solid #2b3a5c", borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
            color: "#e2e8f0", fontSize: 12, fontWeight: 400, lineHeight: 1.5,
            textTransform: "none", letterSpacing: 0, textAlign: "left", whiteSpace: "normal",
            fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif", fontStyle: "normal",
          }}
        >
          {message}
        </span>
      )}
    </span>
  );
}
