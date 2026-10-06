import React from "react";
import { BookOpen, ClipboardList, Sparkles } from "lucide-react";
import type { ExamPatternPaper, SyllabusSubject } from "@/types/recruitment-record";
import { siteConfig } from "@/config/site";

// ═══════════════════════════════════════════════════════════
// Exam pattern and syllabus on a job page
// ═══════════════════════════════════════════════════════════
//
// Facts from the official notification only. Preparation advice lives on
// LakshyaGyan, which this section points to. Each block renders nothing when
// the record has no data for it.

const card = "bg-white border border-[#E2E8F0] rounded-3xl p-6 sm:p-7 shadow-xs space-y-4";

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${hours} hr ${rest} min`;
}

export function ExamPatternSection({ papers }: { papers?: ExamPatternPaper[] }) {
  if (!papers || papers.length === 0) return null;
  return (
    <section id="exam-pattern" className={card}>
      <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
        <div className="p-2 rounded-xl bg-sky-50 text-sky-600">
          <ClipboardList className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-black text-[#0F172A]">Exam Pattern</h2>
      </div>

      <div className="space-y-5">
        {papers.map((paper) => {
          const facts = [
            paper.mode,
            paper.durationMinutes ? formatDuration(paper.durationMinutes) : null,
            paper.totalQuestions ? `${paper.totalQuestions} questions` : null,
            paper.totalMarks ? `${paper.totalMarks} marks` : null,
          ].filter(Boolean) as string[];
          const showQuestions = paper.sections.some((s) => s.questions);
          const showMarks = paper.sections.some((s) => s.marks);

          return (
            <div key={paper.name} className="space-y-2.5">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h3 className="text-sm font-extrabold text-[#0F172A]">{paper.name}</h3>
                {facts.length > 0 && <p className="text-xs font-semibold text-[#475569]">{facts.join(" · ")}</p>}
              </div>

              {paper.sections.length > 0 && (
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-[#475569] border-b border-slate-200">
                        <th className="py-2.5 px-4 font-extrabold">Subject</th>
                        {showQuestions && <th className="py-2.5 px-4 font-extrabold text-right">Questions</th>}
                        {showMarks && <th className="py-2.5 px-4 font-extrabold text-right">Marks</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paper.sections.map((s) => (
                        <tr key={s.subject} className="text-[#0F172A]">
                          <td className="py-2.5 px-4 font-semibold">{s.subject}</td>
                          {showQuestions && <td className="py-2.5 px-4 text-right font-bold tabular-nums">{s.questions ?? "—"}</td>}
                          {showMarks && <td className="py-2.5 px-4 text-right font-bold tabular-nums">{s.marks ?? "—"}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {paper.negativeMarking && (
                <p className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                  Negative marking: {paper.negativeMarking}
                </p>
              )}
              {paper.note && <p className="text-xs text-[#475569] font-medium">{paper.note}</p>}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-400 font-medium">
        As stated in the official notification. Check it for the final word.
      </p>
    </section>
  );
}

export function SyllabusSection({ subjects }: { subjects?: SyllabusSubject[] }) {
  if (!subjects || subjects.length === 0) return null;

  // Subjects are grouped under their paper, in the order they were entered.
  const groups: Array<{ paper: string | null; subjects: SyllabusSubject[] }> = [];
  for (const subject of subjects) {
    const paper = subject.paper ?? null;
    const group = groups.find((g) => g.paper === paper);
    if (group) group.subjects.push(subject);
    else groups.push({ paper, subjects: [subject] });
  }

  const lakshyaGyan = siteConfig.ecosystem.lakshyaGyan;

  return (
    <section id="syllabus" className={card}>
      <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
        <div className="p-2 rounded-xl bg-violet-50 text-violet-600">
          <BookOpen className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-black text-[#0F172A]">Syllabus</h2>
      </div>

      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.paper ?? "all"} className="space-y-3">
            {group.paper && (
              <h3 className="text-xs font-black uppercase tracking-wider text-[#C2410C]">{group.paper}</h3>
            )}
            {group.subjects.map((subject) => (
              <details
                key={`${group.paper ?? ""}-${subject.subject}`}
                open
                className="group rounded-2xl border border-slate-200 bg-slate-50/60 open:bg-white"
              >
                <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-4 py-3">
                  <span className="text-sm font-extrabold text-[#0F172A]">{subject.subject}</span>
                  <span className="text-[11px] font-bold text-[#475569] shrink-0">
                    {subject.topics.length} {subject.topics.length === 1 ? "topic" : "topics"}
                  </span>
                </summary>
                <ul className="flex flex-wrap gap-1.5 px-4 pb-4">
                  {subject.topics.map((topic) => (
                    <li
                      key={topic}
                      className="text-xs font-semibold text-[#334155] bg-white border border-slate-200 rounded-lg px-2.5 py-1"
                    >
                      {topic}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-400 font-medium">
        As listed in the official notification. Check it for the final word.
      </p>

      {/* The bridge to preparation content, which is not hosted here */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-[#FFF7ED] border border-[#FED7AA] rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Sparkles className="h-4 w-4 text-[#EA580C] shrink-0" />
          <p className="text-xs font-semibold text-[#0F172A]">
            Preparation strategy, topic explanations, practice questions and paper analysis will be on{" "}
            <span className="font-black">{lakshyaGyan.name}</span>.
          </p>
        </div>
        {lakshyaGyan.url ? (
          <a
            href={lakshyaGyan.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-extrabold text-[#EA580C] hover:underline shrink-0"
          >
            Prepare on {lakshyaGyan.name} ↗
          </a>
        ) : (
          <span className="text-[11px] font-black uppercase tracking-wider text-[#C2410C] bg-white border border-[#FED7AA] rounded-full px-2.5 py-1 shrink-0">
            Coming soon
          </span>
        )}
      </div>
    </section>
  );
}
