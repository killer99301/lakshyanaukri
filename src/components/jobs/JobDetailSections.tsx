"use client";

import React from "react";
import {
  Calendar,
  Users,
  GraduationCap,
  CreditCard,
  CheckCircle,
  FileCheck,
  Building2,
  Check,
  Info,
  ExternalLink,
  History,
} from "lucide-react";
import type { Opportunity } from "@/types";
import { getVacancyDisplay, getStageCertainty } from "@/lib/lifecycle";
import { resolveDocumentAccess } from "@/lib/documents";

interface JobDetailSectionsProps {
  job: Opportunity;
}

export const JobDetailSections: React.FC<JobDetailSectionsProps> = ({ job }) => {
  const isGov = job.type === "government";
  const isPriv = job.type === "private";
  const isIntern = job.type === "internship";
  const vacancyText = getVacancyDisplay(job);

  return (
    <div className="space-y-8">
      {/* 1. Overview Section */}
      <section id="overview" className="bg-white border border-[#E2E8F0] rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="p-2 rounded-xl bg-orange-50 text-[#EA580C]">
            <Info className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-black text-[#0F172A]">Job Summary & Overview</h2>
        </div>

        <p className="text-sm text-[#475569] leading-relaxed font-medium">
          {job.shortDescription}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 pt-2">
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
            <span className="text-[11px] font-bold text-[#475569] uppercase tracking-wider block">Organization</span>
            <span className="text-sm font-extrabold text-[#0F172A] mt-0.5 block">{job.organizationName}</span>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
            <span className="text-[11px] font-bold text-[#475569] uppercase tracking-wider block">Category</span>
            <span className="text-sm font-extrabold text-[#0F172A] mt-0.5 block capitalize">{job.category.replace("-", " ")}</span>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
            <span className="text-[11px] font-bold text-[#475569] uppercase tracking-wider block">Type</span>
            <span className="text-sm font-extrabold text-[#0F172A] mt-0.5 block capitalize">{job.type}</span>
          </div>

          {isPriv && (
            <>
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-bold text-[#475569] uppercase tracking-wider block">Salary</span>
                <span className="text-sm font-extrabold text-[#0F172A] mt-0.5 block">{job.salary}</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-bold text-[#475569] uppercase tracking-wider block">Work Mode</span>
                <span className="text-sm font-extrabold text-[#0F172A] mt-0.5 block">{job.workMode}</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-bold text-[#475569] uppercase tracking-wider block">Experience</span>
                <span className="text-sm font-extrabold text-[#0F172A] mt-0.5 block">{job.experience}</span>
              </div>
            </>
          )}

          {isIntern && (
            <>
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-bold text-[#475569] uppercase tracking-wider block">Stipend</span>
                <span className="text-sm font-extrabold text-[#0F172A] mt-0.5 block">{job.stipend}</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-bold text-[#475569] uppercase tracking-wider block">Duration</span>
                <span className="text-sm font-extrabold text-[#0F172A] mt-0.5 block">{job.duration}</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="text-[11px] font-bold text-[#475569] uppercase tracking-wider block">Work Mode</span>
                <span className="text-sm font-extrabold text-[#0F172A] mt-0.5 block">{job.workMode}</span>
              </div>
            </>
          )}
        </div>

        {/* Private Job Skills */}
        {isPriv && job.skills && job.skills.length > 0 && (
          <div className="pt-3 border-t border-slate-100">
            <span className="text-xs font-bold text-[#475569] block mb-2">Required Skills:</span>
            <div className="flex flex-wrap gap-1.5">
              {job.skills.map((skill, idx) => (
                <span key={idx} className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold border border-indigo-100">
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 2. Official Corrigenda & Update History Timeline */}
      {job.updates && job.updates.length > 0 && (
        <section id="updates-history" className="bg-white border border-[#FED7AA] rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-amber-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-50 text-amber-700">
                <History className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-[#0F172A]">Official Corrigenda & Updates History</h2>
                <p className="text-xs text-[#475569] font-medium">Verified notices published by {job.organizationName}</p>
              </div>
            </div>
            <span className="text-xs font-black px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
              {job.updates.length} {job.updates.length === 1 ? "Update" : "Updates"}
            </span>
          </div>

          <div className="space-y-3.5">
            {job.updates.map((item) => {
              const docAccess = resolveDocumentAccess({
                officialPdfUrl: item.sourceUrl,
                organization: job.organizationName,
                publishedDate: item.date,
                documentTitle: item.title,
                customPdfLabel: "Official PDF Notice",
              });

              return (
                <div key={item.id} className="p-4 rounded-2xl bg-amber-50/50 border border-amber-200/80 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-wider bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded">
                        {item.type}
                      </span>
                      <span className="text-xs font-bold text-amber-950">Published Date: {item.date}</span>
                    </div>

                    {docAccess.isAvailable && docAccess.url && (
                      <a
                        href={docAccess.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-bold text-amber-800 hover:text-amber-950 underline flex items-center gap-1 cursor-pointer"
                        title={docAccess.disclaimer}
                      >
                        <span>{docAccess.label}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  <h3 className="text-sm font-black text-[#0F172A]">{item.title}</h3>
                  <p className="text-xs text-[#475569] leading-relaxed font-medium">{item.description}</p>

                {(item.previousValue || item.newValue) && (
                  <div className="pt-1 flex items-center gap-2 flex-wrap text-xs">
                    <span className="font-bold text-[#475569] text-[11px]">Field Revision:</span>
                    {item.previousValue && (
                      <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 line-through text-[11px] font-medium">
                        {item.previousValue}
                      </span>
                    )}
                    {item.previousValue && item.newValue && (
                      <span className="text-slate-400 font-bold text-xs">→</span>
                    )}
                    {item.newValue && (
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-extrabold text-[11px]">
                        {item.newValue}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </section>
      )}

      {/* 3. Important Dates Section */}
      <section id="important-dates" className="bg-white border border-[#E2E8F0] rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
            <Calendar className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-black text-[#0F172A]">Important Dates & Schedule</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="bg-slate-50 text-[#475569] border-b border-slate-200">
                <th className="py-3 px-4 font-extrabold">Event / Milestone</th>
                <th className="py-3 px-4 font-extrabold text-right">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="text-[#0F172A]">
                <td className="py-3.5 px-4 font-semibold">Application Open Date</td>
                <td className="py-3.5 px-4 text-right font-bold">{job.application.openDate}</td>
              </tr>
              <tr className="bg-[#FFF7ED] text-[#EA580C]">
                <td className="py-3.5 px-4 font-extrabold">Application Closing Date</td>
                <td className="py-3.5 px-4 text-right font-extrabold">
                  {isGov && job.application.extendedCloseDate ? (
                    <span>
                      {job.application.extendedCloseDate}{" "}
                      <span className="text-[10px] underline font-bold">(Extended)</span>
                    </span>
                  ) : (
                    job.application.closeDate
                  )}
                </td>
              </tr>
              {isGov && job.examStages && job.examStages.length > 0 && (
                job.examStages.map((stage) => {
                  const certainty = getStageCertainty(stage);
                  const isTentative = certainty === "TENTATIVE";
                  const isPostponed = certainty === "POSTPONED" || stage.status === "POSTPONED";
                  const isScheduled = stage.status === "SCHEDULED" && !isTentative;
                  const isResult = stage.status === "RESULT_DECLARED";
                  const isAdmitCard = stage.status === "ADMIT_CARD_OUT";

                  return (
                    <tr
                      key={stage.order}
                      className={
                        isTentative || isPostponed
                          ? "bg-amber-50/40 text-[#0F172A]"
                          : isScheduled
                          ? "bg-blue-50/30 text-[#0F172A]"
                          : "text-[#0F172A]"
                      }
                    >
                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold">{stage.name}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${
                                isTentative
                                  ? "bg-amber-100 text-amber-900 border-amber-300"
                                  : isPostponed
                                  ? "bg-rose-100 text-rose-900 border-rose-300"
                                  : isScheduled
                                  ? "bg-blue-100 text-blue-900 border-blue-300"
                                  : isResult
                                  ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                                  : isAdmitCard
                                  ? "bg-indigo-100 text-indigo-900 border-indigo-300"
                                  : "bg-slate-100 text-slate-600 border-slate-200"
                              }`}
                            >
                              {isTentative ? "Tentative Schedule" : stage.status.replace(/_/g, " ")}
                            </span>
                          </div>
                          {stage.dateProvenance && (
                            <p className="text-[11px] text-amber-900/80 font-bold">
                              Source: {stage.dateProvenance}
                            </p>
                          )}
                          {stage.notes && (
                            <p className="text-xs text-[#475569] font-medium leading-relaxed max-w-xl">
                              {stage.notes}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right align-top">
                        <span
                          className={`font-extrabold text-xs sm:text-sm block ${
                            isTentative || isPostponed
                              ? "text-amber-900"
                              : isScheduled
                              ? "text-blue-900"
                              : "text-[#0F172A]"
                          }`}
                        >
                          {stage.dateDisplay || stage.dateIso || "TBA"}
                        </span>
                        {(() => {
                          const stageDoc = resolveDocumentAccess({
                            officialPdfUrl: stage.noticeUrl,
                            organization: job.organizationName,
                            documentTitle: `${job.title} - ${stage.name}`,
                            customPdfLabel: "Official Stage Notice",
                          });

                          return stageDoc.isAvailable && stageDoc.url ? (
                            <a
                              href={stageDoc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-[#EA580C] hover:underline font-bold inline-flex items-center gap-1 mt-1 justify-end"
                              title={stageDoc.disclaimer}
                            >
                              <span>{stageDoc.label}</span>
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          ) : null;
                        })()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. Vacancies Breakdown Section */}
      <section id="vacancies" className="bg-white border border-[#E2E8F0] rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
            <Users className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-black text-[#0F172A]">Vacancy Details & Post Breakdown</h2>
        </div>

        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-purple-50/60 border border-purple-100">
          <span className="text-xs font-bold text-purple-900">Total Available Vacancies</span>
          <span className="text-base font-black text-purple-700">{vacancyText}</span>
        </div>

        {isGov && job.vacancyBreakdown && job.vacancyBreakdown.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="bg-slate-50 text-[#475569] border-b border-slate-200">
                  <th className="py-3 px-4 font-extrabold">Post Name</th>
                  <th className="py-3 px-4 font-extrabold text-center">Vacancies</th>
                  <th className="py-3 px-4 font-extrabold text-right">Pay Scale / Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {job.vacancyBreakdown.map((v, i) => (
                  <tr key={i} className="text-[#0F172A] font-semibold hover:bg-slate-50/50">
                    <td className="py-3.5 px-4 font-extrabold text-[#0F172A]">{v.post}</td>
                    <td className="py-3.5 px-4 text-center font-bold text-[#EA580C]">{v.count.toLocaleString("en-IN")}</td>
                    <td className="py-3.5 px-4 text-right text-slate-600">{v.payScale || "As per rules"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 5. Eligibility & Age Limit Section */}
      <section id="eligibility" className="bg-white border border-[#E2E8F0] rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
            <GraduationCap className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-black text-[#0F172A]">Eligibility Criteria & Age Limit</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Educational Qualification Box */}
          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
            <h3 className="text-xs font-black text-[#475569] uppercase tracking-wider">Educational Qualification</h3>
            <ul className="space-y-2">
              {isGov && job.eligibility && job.eligibility.length > 0 ? (
                job.eligibility.map((q, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs sm:text-sm text-[#0F172A] font-semibold">
                    <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{q}</span>
                  </li>
                ))
              ) : (
                <li className="flex items-start gap-2 text-xs sm:text-sm text-[#0F172A] font-semibold">
                  <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>{job.qualification} degree from a recognized Board or University in India.</span>
                </li>
              )}
            </ul>
          </div>

          {/* Age Limit Box */}
          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
            <h3 className="text-xs font-black text-[#475569] uppercase tracking-wider">Age Limit Criteria</h3>
            {isGov && job.ageLimit ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#475569]">Age Range</span>
                  <span className="text-sm font-black text-[#EA580C]">
                    {job.ageLimit.min ?? 18} to {job.ageLimit.max ?? 37} Years
                  </span>
                </div>
                {job.ageLimit.asOf && (
                  <p className="text-[11px] font-semibold text-slate-500">
                    Calculated as of: {job.ageLimit.asOf}
                  </p>
                )}
                {job.ageLimit.relaxation && job.ageLimit.relaxation.length > 0 && (
                  <div className="pt-2 border-t border-slate-200">
                    <span className="text-[11px] font-bold text-slate-600 block mb-1">Age Relaxation:</span>
                    <ul className="space-y-1">
                      {job.ageLimit.relaxation.map((r, i) => (
                        <li key={i} className="text-[11px] font-medium text-[#475569] flex items-center gap-1.5">
                          <span className="h-1 w-1 rounded-full bg-slate-400" />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs font-semibold text-[#0F172A]">As per organization standards.</p>
            )}
          </div>
        </div>
      </section>

      {/* 6. Application Fee Section (Government only) */}
      {isGov && job.fee && (
        <section id="application-fee" className="bg-white border border-[#E2E8F0] rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <CreditCard className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-black text-[#0F172A]">Application Fee & Payment Modes</h2>
          </div>

          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-50 text-[#475569] border-b border-slate-200">
                    <th className="py-3 px-4 font-extrabold">Category</th>
                    <th className="py-3 px-4 font-extrabold text-right">Fee Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {job.fee.rows.map((fee, idx) => (
                    <tr key={idx} className="text-[#0F172A] font-semibold">
                      <td className="py-3 px-4 font-bold">{fee.category}</td>
                      <td className="py-3 px-4 text-right font-black text-[#EA580C]">
                        {fee.note || (fee.amount !== null ? `₹${fee.amount}` : "Nil")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {job.fee.modes && job.fee.modes.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className="text-xs font-bold text-[#475569]">Accepted Payment Modes:</span>
                {job.fee.modes.map((mode, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold">
                    {mode}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 7. Selection Process Section */}
      {isGov && job.selectionProcess && job.selectionProcess.length > 0 && (
        <section id="selection-process" className="bg-white border border-[#E2E8F0] rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <div className="p-2 rounded-xl bg-teal-50 text-teal-600">
              <FileCheck className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-black text-[#0F172A]">Selection Process</h2>
          </div>

          <div className="space-y-3">
            {job.selectionProcess.map((step, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="h-7 w-7 rounded-xl bg-[#EA580C] text-white flex items-center justify-center font-black text-xs shrink-0 mt-0.5">
                  {idx + 1}
                </div>
                <div className="space-y-0.5">
                  <span className="text-sm font-extrabold text-[#0F172A]">{step}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 8. How to Apply Section */}
      <section id="how-to-apply" className="bg-white border border-[#E2E8F0] rounded-3xl p-6 sm:p-7 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
          <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
            <CheckCircle className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-black text-[#0F172A]">How to Apply Online Step-by-Step</h2>
        </div>

        {isGov && job.howToApply && job.howToApply.length > 0 ? (
          <ol className="space-y-3">
            {job.howToApply.map((step, idx) => (
              <li key={idx} className="flex items-start gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="h-6 w-6 rounded-full bg-slate-900 text-white flex items-center justify-center font-black text-xs shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <span className="text-xs sm:text-sm font-semibold text-[#0F172A] leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs font-semibold text-[#475569]">
            Visit the official portal link provided above to register and complete your application.
          </p>
        )}
      </section>

      {/* 9. About Organization Section */}
      <section className="bg-slate-900 rounded-3xl p-6 text-white space-y-3">
        <div className="flex items-center gap-2 text-orange-400 font-extrabold text-xs uppercase tracking-wider">
          <Building2 className="h-4 w-4" /> About Recruiting Body
        </div>
        <h3 className="text-xl font-black text-white">{job.organizationName}</h3>
        <p className="text-xs text-slate-300 leading-relaxed font-medium">
          {job.organizationName} is a premier organization responsible for conducting recruitment examinations and selecting qualified candidates across India.
        </p>
      </section>
    </div>
  );
};
