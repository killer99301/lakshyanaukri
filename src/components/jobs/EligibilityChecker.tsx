"use client";

import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import type { AgeLimit } from "@/types";
import { CATEGORY_LABELS, checkAge, describeAge, limitForPost, type AgeVerdict, type CasteCategory } from "@/lib/eligibility";
import { dobProblem } from "@/lib/eligibility-finder";
import { DobFields } from "@/components/common/DobFields";
import { cn, formatDate } from "@/lib/utils";

// Today in the visitor's own calendar, for the date-of-birth check.
const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const TONE: Record<AgeVerdict, { box: string; icon: React.ReactNode; title: string }> = {
  WITHIN: {
    box: "bg-emerald-50 border-emerald-200 text-emerald-900",
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />,
    title: "Your age is within the limit",
  },
  WITHIN_RELAXED: {
    box: "bg-emerald-50 border-emerald-200 text-emerald-900",
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />,
    title: "Your age is within the limit, with relaxation",
  },
  CHECK_NOTICE: {
    box: "bg-amber-50 border-amber-200 text-amber-900",
    icon: <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />,
    title: "At the upper age limit — check the notification",
  },
  TOO_YOUNG: {
    box: "bg-red-50 border-red-200 text-red-900",
    icon: <XCircle className="h-5 w-5 text-red-600 shrink-0" />,
    title: "You are below the minimum age",
  },
  TOO_OLD: {
    box: "bg-red-50 border-red-200 text-red-900",
    icon: <XCircle className="h-5 w-5 text-red-600 shrink-0" />,
    title: "You are above the upper age limit",
  },
  UNKNOWN: {
    box: "bg-slate-50 border-slate-200 text-slate-700",
    icon: <HelpCircle className="h-5 w-5 text-slate-500 shrink-0" />,
    title: "This cannot be worked out yet",
  },
};

/**
 * The explanation for an age that has completed the upper limit but not the next year. Notices count this case
 * differently (some accept candidates until the day before their next birthday, others only those who have not yet
 * reached the limit), and without the notice's date-of-birth range on record neither reading is assumed.
 */
export function atUpperLimitText(o: {
  asOf: string; completedYears: number; max: number;
  /** A relaxation used for this category, and the upper age it gives. */
  relaxation?: { category: string; effectiveMax: number };
  /** An upper age the notice prints for this category itself. */
  categoryMax?: { category: string };
}): string {
  const limit = o.categoryMax
    ? `a maximum age of ${o.max} for ${o.categoryMax.category}`
    : o.relaxation
      ? `a maximum age of ${o.max}, or ${o.relaxation.effectiveMax} with the ${o.relaxation.category} relaxation`
      : `a maximum age of ${o.max}`;
  return `Your completed age on ${formatDate(o.asOf)} is ${o.completedYears} years. The recruitment states ${limit}, but the exact eligible `
    + "date-of-birth range is not in the saved details. Please check the official notification’s date-of-birth conditions and any "
    + "applicable category relaxation before deciding whether you are eligible.";
}

const field = "h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/40";
const label = "block text-[11px] font-bold uppercase tracking-wider text-[#475569] mb-1";

/**
 * Works out the visitor's age on the notice's cut-off date and compares it
 * with the printed limit. Runs in the browser; nothing typed here leaves it.
 * Shown only when the record has an age limit and its cut-off date.
 */
export function EligibilityChecker({ ageLimit }: { ageLimit?: AgeLimit }) {
  const [dob, setDob] = useState("");
  const [category, setCategory] = useState<CasteCategory>("GEN");
  const [pwbd, setPwbd] = useState(false);
  const [post, setPost] = useState("");

  const posts = ageLimit?.postWise ?? [];
  if (!ageLimit) return null;

  // Where the notice sets ages post by post, the answer is for the chosen
  // post only, by its own rules (range, cut-off date, relaxations, printed
  // category maximums) — never for the widest range across all of them.
  const chosen = posts.find((p) => p.post === post);
  const limit: AgeLimit | null = posts.length === 0 ? ageLimit : chosen ? limitForPost(ageLimit, chosen) : null;
  const countedOn = limit?.asOf ?? (posts.length === 0 || posts.every((p) => !p.asOf) ? ageLimit.asOf : undefined);

  // A date-of-birth window can be checked on its own; an age range needs the
  // date the notice counts age on. With neither, there is nothing to check.
  const answerable = (l: AgeLimit) =>
    Boolean(l.bornFrom || l.bornTo) || (Boolean(l.asOf) && (l.min != null || l.max != null || Boolean(l.categoryMax?.length)));
  if (!(posts.length > 0 ? posts.some((p) => answerable(limitForPost(ageLimit, p))) : answerable(ageLimit))) return null;

  const byBirthDate = Boolean(limit && (limit.bornFrom || limit.bornTo));
  // An impossible date (31 February), a future one or an unlikely year is named instead of an answer.
  const problem = dob ? dobProblem(dob, todayIso()) : null;
  const result = dob && !problem && limit && answerable(limit) ? checkAge(limit, dob, category, pwbd) : null;
  const tone = result ? TONE[result.verdict] : null;

  return (
    <div className="p-5 rounded-2xl border border-[#FED7AA] bg-[#FFF7ED]/60 space-y-4" id="age-check">
      <div>
        <h3 className="text-sm font-black text-[#0F172A]">Check your age for this recruitment</h3>
        <p className="text-xs font-medium text-[#475569] mt-0.5">
          {countedOn
            ? `Your age is counted on ${formatDate(countedOn)}, the date the notice uses${chosen?.asOf ? " for this post" : ""}.`
            : posts.some((p) => p.asOf)
              ? "Some posts count age on a date of their own; choose a post."
              : "Your date of birth is compared with the range printed in the notice."}{" "}
          Nothing you enter is saved or sent.
        </p>
      </div>

      <div className={cn("grid gap-3", posts.length > 0 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
        {posts.length > 0 && (
          <div>
            <label className={label} htmlFor="age-check-post">Post</label>
            <select id="age-check-post" value={post} onChange={(e) => setPost(e.target.value)} className={field}>
              <option value="">Choose a post…</option>
              {posts.map((p) => (
                <option key={p.post} value={p.post}>{p.post}</option>
              ))}
            </select>
          </div>
        )}
        {/* Two columns wherever the form has two or three, so Day, Month and Year each have room (at laptop widths
            one column left Month 18 px wide). */}
        <DobFields id="age-check-dob" legendClassName={label} fieldClassName={field} className="sm:col-span-2" onChange={setDob} />
        <div>
          <label className={label} htmlFor="age-check-category">Category</label>
          <select id="age-check-category" value={category} onChange={(e) => setCategory(e.target.value as CasteCategory)} className={field}>
            {(Object.keys(CATEGORY_LABELS) as CasteCategory[]).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-[#0F172A] sm:pt-6 cursor-pointer">
          <input type="checkbox" checked={pwbd} onChange={(e) => setPwbd(e.target.checked)} className="h-4 w-4 accent-[#EA580C]" />
          Person with disability (PwBD)
        </label>
      </div>

      {problem && <p role="alert" className="text-xs font-bold text-red-600">{problem}</p>}

      {dob && !problem && posts.length > 0 && !chosen && (
        <p role="status" className="text-xs font-semibold text-[#475569]">Choose the post you are applying for; the age limit is different for each.</p>
      )}

      {result && tone && (
        <div role="status" className={cn("rounded-2xl border px-4 py-3 flex items-start gap-3", tone.box)}>
          {tone.icon}
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-black">{tone.title}</p>
            {result.age && limit?.asOf && (
              <p className="text-xs font-semibold">
                On {formatDate(limit.asOf)} you will be {describeAge(result.age)} old.
              </p>
            )}
            {result.categoryMax && (
              <p className="text-xs font-semibold">
                Upper age printed for {result.categoryMax.category}: {result.categoryMax.max} years.
              </p>
            )}
            {byBirthDate && limit && (
              <p className="text-xs font-semibold">
                The notice allows dates of birth
                {limit.bornFrom ? ` from ${formatDate(limit.bornFrom)}` : ""}
                {limit.bornTo ? ` to ${formatDate(limit.bornTo)}` : ""}, both dates included.
              </p>
            )}
            {byBirthDate && result.verdict === "WITHIN_RELAXED" && result.relaxation && (
              <p className="text-xs font-semibold">
                Relaxation used: {result.relaxation.category}, {result.relaxation.years} years on the earliest date.
              </p>
            )}
            {result.verdict === "UNKNOWN" && <p className="text-xs font-semibold">{result.reason}</p>}
            {result.relaxation && result.effectiveMax != null && (
              <p className="text-xs font-semibold">
                Relaxation used: {result.relaxation.category}, {result.relaxation.years} years — upper limit {result.effectiveMax} for you.
              </p>
            )}
            {result.verdict === "CHECK_NOTICE" && result.age && limit?.asOf && (
              <p className="text-xs font-semibold" data-at-upper-limit>
                {atUpperLimitText({
                  asOf: limit.asOf,
                  completedYears: result.age.years,
                  max: result.categoryMax ? result.categoryMax.max : limit.max ?? result.age.years,
                  ...(result.relaxation && result.effectiveMax != null ? { relaxation: { category: result.relaxation.category, effectiveMax: result.effectiveMax } } : {}),
                  ...(result.categoryMax ? { categoryMax: { category: result.categoryMax.category } } : {}),
                })}
              </p>
            )}
            {result.verdict === "TOO_OLD" && !result.relaxation && !result.categoryMax && (
              <p className="text-xs font-semibold">
                No relaxation for your category is listed here. Ex-servicemen, women and some other groups may get more; see the notification.
              </p>
            )}
          </div>
        </div>
      )}

      <p className="text-[11px] font-medium text-slate-500">
        This checks age only, using the limits shown above. Qualification, other relaxations and the final decision are as per the official notification.
      </p>
    </div>
  );
}
