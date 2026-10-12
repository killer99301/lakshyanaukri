"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, ShieldCheck, UserCheck, XCircle } from "lucide-react";
import type { Qualification } from "@/types";
import { CATEGORY_LABELS, type CasteCategory } from "@/lib/eligibility";
import {
  QUALIFICATION_OPTIONS, dobProblem, findEligibleJobs,
  type FinderJob, type FinderPart, type FinderResult, type FinderVerdict,
} from "@/lib/eligibility-finder";
import { OrganizationLogo } from "@/components/common/OrganizationLogo";
import { PageReveal } from "@/components/common/motion/PageReveal";
import { AmbientBackground } from "@/components/common/motion/AmbientBackground";
import { cn, formatDate } from "@/lib/utils";

const field = "h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#EA580C]/40";
const label = "block text-[11px] font-bold uppercase tracking-wider text-[#475569] mb-1";

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const GROUPS: Record<FinderVerdict, { title: string; blurb: string; tone: string; icon: React.ReactNode }> = {
  ELIGIBLE: {
    title: "You can likely apply",
    blurb: "Your age fits and you hold the minimum qualification. Some posts also need a specific subject, trade or certificate, so open the job to check.",
    tone: "text-emerald-800",
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
  },
  CHECK: {
    title: "Check the notice first",
    blurb: "Something could not be settled from what is on record. Read the notice before applying.",
    tone: "text-amber-800",
    icon: <AlertTriangle className="h-5 w-5 text-amber-600" />,
  },
  NOT_ELIGIBLE: {
    title: "Not for you this time",
    blurb: "Your age or qualification is outside what these notices ask for.",
    tone: "text-slate-600",
    icon: <XCircle className="h-5 w-5 text-slate-400" />,
  },
};

function Part({ part }: { part: FinderPart }) {
  const icon =
    part.verdict === "OK" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
    : part.verdict === "CHECK" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
    : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />;
  return (
    <span className="flex items-start gap-1.5 text-xs text-[#334155] font-medium leading-relaxed">
      {icon}
      <span>{part.note}</span>
    </span>
  );
}

function ResultCard({ result, today }: { result: FinderResult; today: string }) {
  const { job } = result;
  const notOpenYet = Boolean(job.openDate) && job.openDate > today;
  return (
    <Link
      href={`/jobs/${job.slug}`}
      className="block bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-2xs hover:border-[#FED7AA] transition-colors group"
    >
      <div className="flex items-start gap-3">
        <OrganizationLogo organizationName={job.organizationName} size="md" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm sm:text-base font-extrabold text-[#0F172A] group-hover:text-[#EA580C] transition-colors leading-snug">{job.title}</h3>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-[#EA580C] shrink-0 mt-1" />
          </div>
          <div className="text-xs text-[#475569] font-semibold flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{job.organizationName}</span>
            {job.vacancies ? <span>{job.vacancies.toLocaleString("en-IN")} posts</span> : null}
            {notOpenYet
              ? <span className="text-indigo-700">Opens {formatDate(job.openDate)}</span>
              : job.closeDate ? <span className="text-[#EA580C]">Last date {formatDate(job.closeDate)}</span> : null}
          </div>
          <div className="space-y-1 pt-0.5">
            <Part part={result.age} />
            <Part part={result.qualification} />
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function EligibilityFinderClient({ jobs }: { jobs: FinderJob[] }) {
  const [dob, setDob] = useState("");
  const [category, setCategory] = useState<CasteCategory>("GEN");
  const [pwbd, setPwbd] = useState(false);
  const [qualification, setQualification] = useState<Qualification>("Graduate");
  const [asked, setAsked] = useState(false);
  const [showRuledOut, setShowRuledOut] = useState(false);

  const today = todayIso();
  // Closed jobs are left out; one with no last date on record is kept.
  const openJobs = useMemo(() => jobs.filter((j) => !j.closeDate || j.closeDate >= today), [jobs, today]);
  const problem = dobProblem(dob, today);
  const results = useMemo(
    () => (asked && !problem ? findEligibleJobs(openJobs, { dobIso: dob, category, pwbd, qualification }) : []),
    [asked, problem, openJobs, dob, category, pwbd, qualification],
  );
  const group = (v: FinderVerdict) => results.filter((r) => r.verdict === v);

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-8 relative">
      <AmbientBackground />
      <PageReveal className="relative z-10 container mx-auto px-4 max-w-4xl space-y-6">
        <div className="bg-gradient-to-r from-[#0F172A] via-slate-900 to-[#7C2D12] rounded-3xl p-6 sm:p-9 text-white shadow-xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 border border-orange-400/30 text-orange-200 text-xs font-black uppercase tracking-wider">
            <UserCheck className="h-3.5 w-3.5" /> Eligibility finder
          </div>
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight mt-3">Which jobs can I apply for?</h1>
          <p className="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed mt-2 max-w-2xl">
            Tell us your date of birth, category and qualification. We check your age on each notice’s own cut-off date, across all{" "}
            {/* Counted on the visitor's own date, which can differ from the server's by a day. */}
            <span suppressHydrationWarning>{openJobs.length}</span> government jobs open or opening soon.
          </p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); setAsked(true); }}
          className="bg-white border border-[#E2E8F0] rounded-3xl p-5 sm:p-6 shadow-xs space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={label} htmlFor="finder-dob">Date of birth</label>
              <input id="finder-dob" type="date" className={field} value={dob} max={today} onChange={(e) => setDob(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="finder-category">Category</label>
              <select id="finder-category" className={field} value={category} onChange={(e) => setCategory(e.target.value as CasteCategory)}>
                {(Object.keys(CATEGORY_LABELS) as CasteCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="finder-qualification">Highest qualification</label>
              <select id="finder-qualification" className={field} value={qualification} onChange={(e) => setQualification(e.target.value as Qualification)}>
                {QUALIFICATION_OPTIONS.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-[#334155] cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-[#EA580C]" checked={pwbd} onChange={(e) => setPwbd(e.target.checked)} />
            I am a person with a benchmark disability (PwBD)
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-[#EA580C] text-white text-sm font-extrabold shadow-xs hover:bg-[#C2410C] active:scale-95 transition-all cursor-pointer"
            >
              Find my jobs <ArrowRight className="h-4 w-4" />
            </button>
            <span className="inline-flex items-center gap-1.5 text-xs text-[#475569] font-medium">
              <ShieldCheck className="h-4 w-4 text-emerald-600" /> Worked out on your device. Nothing you enter is saved or sent.
            </span>
          </div>
          {asked && problem && <p role="alert" className="text-sm font-bold text-red-600">{problem}</p>}
        </form>

        {asked && !problem && (
          <div className="space-y-6" aria-live="polite">
            {results.length === 0 && (
              <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 text-sm text-[#475569] font-medium">
                No government jobs are open right now. Check back soon.
              </div>
            )}

            {(["ELIGIBLE", "CHECK"] as FinderVerdict[]).map((v) => {
              const list = group(v);
              if (v === "CHECK" && list.length === 0) return null;
              return (
                <section key={v} className="space-y-3">
                  <div>
                    <h2 className={cn("flex items-center gap-2 text-lg font-black", GROUPS[v].tone)}>
                      {GROUPS[v].icon} {GROUPS[v].title} <span className="text-sm font-bold text-slate-500">({list.length})</span>
                    </h2>
                    <p className="text-xs text-[#475569] font-medium mt-0.5">{GROUPS[v].blurb}</p>
                  </div>
                  {list.length === 0
                    ? <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 text-sm text-[#475569] font-medium">None of the open jobs fit on both age and qualification. Look at the list below.</div>
                    : list.map((r) => <ResultCard key={r.job.slug} result={r} today={today} />)}
                </section>
              );
            })}

            {group("NOT_ELIGIBLE").length > 0 && (
              <section className="space-y-3">
                <button
                  type="button"
                  onClick={() => setShowRuledOut((s) => !s)}
                  aria-expanded={showRuledOut}
                  className={cn("flex items-center gap-2 text-sm font-extrabold cursor-pointer hover:underline", GROUPS.NOT_ELIGIBLE.tone)}
                >
                  {GROUPS.NOT_ELIGIBLE.icon} {GROUPS.NOT_ELIGIBLE.title} ({group("NOT_ELIGIBLE").length}) — {showRuledOut ? "hide" : "show why"}
                </button>
                {showRuledOut && group("NOT_ELIGIBLE").map((r) => <ResultCard key={r.job.slug} result={r} today={today} />)}
              </section>
            )}

            <p className="text-xs text-[#475569] font-medium leading-relaxed bg-white border border-[#E2E8F0] rounded-2xl p-4">
              This checks two things only: your age on the notice’s cut-off date, and the lowest qualification any post asks for. It does not check
              subjects, marks, experience, physical standards, domicile, or relaxations for ex-servicemen and others. A job listed under “You can likely apply”
              may have posts you do not qualify for. Read the official notice before you apply.
            </p>
          </div>
        )}
      </PageReveal>
    </div>
  );
}
