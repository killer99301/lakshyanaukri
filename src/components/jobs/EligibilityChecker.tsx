"use client";

import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import type { AgeLimit } from "@/types";
import { CATEGORY_LABELS, checkAge, describeAge, type AgeVerdict, type CasteCategory } from "@/lib/eligibility";
import { cn, formatDate } from "@/lib/utils";

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
    title: "You are probably over the upper age limit",
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
  // post only — never for the widest range across all of them.
  const chosen = posts.find((p) => p.post === post);
  const limit: AgeLimit | null =
    posts.length === 0
      ? ageLimit
      : chosen
        ? { ...ageLimit, min: chosen.min, max: chosen.max, bornFrom: chosen.bornFrom, bornTo: chosen.bornTo }
        : null;

  // A date-of-birth window can be checked on its own; an age range needs the
  // date the notice counts age on. With neither, there is nothing to check.
  const answerable = (l: { min?: number; max?: number; bornFrom?: string; bornTo?: string }) =>
    Boolean(l.bornFrom || l.bornTo) || (Boolean(ageLimit.asOf) && (l.min != null || l.max != null));
  if (!(posts.length > 0 ? posts.some(answerable) : answerable(ageLimit))) return null;

  const byBirthDate = Boolean(limit && (limit.bornFrom || limit.bornTo));
  const result = dob && limit && answerable(limit) ? checkAge(limit, dob, category, pwbd) : null;
  const tone = result ? TONE[result.verdict] : null;

  return (
    <div className="p-5 rounded-2xl border border-[#FED7AA] bg-[#FFF7ED]/60 space-y-4" id="age-check">
      <div>
        <h3 className="text-sm font-black text-[#0F172A]">Check your age for this recruitment</h3>
        <p className="text-xs font-medium text-[#475569] mt-0.5">
          {ageLimit.asOf
            ? `Your age is counted on ${formatDate(ageLimit.asOf)}, the date the notice uses.`
            : "Your date of birth is compared with the range printed in the notice."}{" "}
          Nothing you enter is saved or sent.
        </p>
      </div>

      <div className={cn("grid gap-3", posts.length > 0 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
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
        <div>
          <label className={label} htmlFor="age-check-dob">Date of birth</label>
          <input id="age-check-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={field} />
        </div>
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

      {dob && posts.length > 0 && !chosen && (
        <p role="status" className="text-xs font-semibold text-[#475569]">Choose the post you are applying for; the age limit is different for each.</p>
      )}

      {result && tone && (
        <div role="status" className={cn("rounded-2xl border px-4 py-3 flex items-start gap-3", tone.box)}>
          {tone.icon}
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-black">{tone.title}</p>
            {result.age && ageLimit.asOf && (
              <p className="text-xs font-semibold">
                On {formatDate(ageLimit.asOf)} you will be {describeAge(result.age)} old.
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
            {result.verdict === "CHECK_NOTICE" && (
              <p className="text-xs font-semibold">
                You will already have turned {result.effectiveMax ?? limit?.max} on that date. Most notices (SSC, RRB, UPSC, IBPS and others) mean you
                must not have reached that age, which puts you over the limit. A few count the whole year; the date-of-birth range in the official
                notification settles it.
              </p>
            )}
            {result.verdict === "TOO_OLD" && !result.relaxation && (
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
