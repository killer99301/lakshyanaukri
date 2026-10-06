"use client";

// ═══════════════════════════════════════════════════════════
// Admin: exam pattern and syllabus editors
// ═══════════════════════════════════════════════════════════
//
// Both hold facts printed in the official notification. Subjects and topics
// are typed as plain lines, which is the quickest way to copy them from a PDF.
// Every save goes through the normal field route: cleaned and bounded on the
// server, stored as Pending, and recorded in the change history.

import { useState } from "react";
import type { ExamPatternPaper, RecruitmentRecord, SyllabusSubject } from "@/types/recruitment-record";
import { InfoTip } from "../InfoTip";

const C = {
  bg: "#070b16", border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8",
  accent: "#62b5ff", green: "#3fb950", amber: "#d29922", red: "#f85149",
};

const input: React.CSSProperties = {
  width: "100%", padding: "7px 10px", background: C.bg, border: "1px solid #2b3a5c",
  borderRadius: 6, color: C.text, fontSize: 13, boxSizing: "border-box", fontFamily: "inherit",
};
const label: React.CSSProperties = { display: "block", fontSize: 11, color: C.muted, marginBottom: 4, fontWeight: 500 };
const ghost: React.CSSProperties = { background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: "2px 4px" };
const primary = (disabled: boolean): React.CSSProperties => ({
  padding: "6px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none",
  borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
});
const itemCard: React.CSSProperties = { padding: "10px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8 };

type SaveFn = (fieldPath: "examPattern" | "syllabus", value: unknown, reason: string) => Promise<string | null>;

function PendingNote({ status }: { status?: string }) {
  if (status !== "PENDING") return null;
  return (
    <div style={{ fontSize: 12, color: C.amber, marginBottom: 10 }}>
      Marked Pending — check it against the official notification.
    </div>
  );
}

const cleanError = (message: string) => message.replace(/^.*invariant:\s*/, "");
const toNumber = (text: string): number | undefined => {
  const n = Number(text.replace(/,/g, "").trim());
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
};

// ─── Exam pattern ───────────────────────────────────────────

interface PaperDraft {
  name: string; mode: string; duration: string; negativeMarking: string;
  totalQuestions: string; totalMarks: string; note: string; subjects: string;
}
const EMPTY_PAPER: PaperDraft = { name: "", mode: "", duration: "", negativeMarking: "", totalQuestions: "", totalMarks: "", note: "", subjects: "" };

const paperToDraft = (p: ExamPatternPaper): PaperDraft => ({
  name: p.name,
  mode: p.mode ?? "",
  duration: p.durationMinutes ? String(p.durationMinutes) : "",
  negativeMarking: p.negativeMarking ?? "",
  totalQuestions: p.totalQuestions ? String(p.totalQuestions) : "",
  totalMarks: p.totalMarks ? String(p.totalMarks) : "",
  note: p.note ?? "",
  subjects: p.sections.map((s) => [s.subject, s.questions ?? "", s.marks ?? ""].join(" | ")).join("\n"),
});

/** "General Intelligence | 25 | 50" per line → sections. Questions and marks are optional. */
function parseSubjects(text: string): ExamPatternPaper["sections"] {
  return text
    .split("\n")
    .map((line) => line.split("|").map((part) => part.trim()))
    .filter((parts) => parts[0])
    .map(([subject, questions, marks]) => ({
      subject,
      ...(toNumber(questions ?? "") ? { questions: toNumber(questions ?? "") } : {}),
      ...(toNumber(marks ?? "") ? { marks: toNumber(marks ?? "") } : {}),
    }));
}

const draftToPaper = (d: PaperDraft): Record<string, unknown> => ({
  name: d.name,
  mode: d.mode || undefined,
  durationMinutes: toNumber(d.duration),
  negativeMarking: d.negativeMarking || undefined,
  totalQuestions: toNumber(d.totalQuestions),
  totalMarks: toNumber(d.totalMarks),
  note: d.note || undefined,
  sections: parseSubjects(d.subjects),
});

export function ExamPatternEditor({ record, onSave }: { record: RecruitmentRecord; onSave: SaveFn }) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const papers = record.examPattern?.value ?? [];
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<PaperDraft>(EMPTY_PAPER);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof PaperDraft>(key: K, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  async function save(next: unknown[], reason: string): Promise<boolean> {
    setSaving(true);
    setErr(null);
    const problem = await onSave("examPattern", next, reason);
    setSaving(false);
    if (problem) { setErr(cleanError(problem)); return false; }
    return true;
  }

  async function submit() {
    const list: unknown[] = papers.map((p) => p);
    const adding = editing === -1;
    if (adding) list.push(draftToPaper(draft));
    else if (editing !== null) list[editing] = draftToPaper(draft);
    if (await save(list, `${adding ? "Added" : "Edited"} exam pattern: ${draft.name.trim()}`)) {
      setEditing(null);
      setDraft(EMPTY_PAPER);
    }
  }

  return (
    <div>
      <PendingNote status={record.examPattern?.status} />
      {papers.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
          No exam pattern yet. Add one entry per paper or tier, or run AI Assist on a page that has the pattern table.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {papers.map((p, i) => (
            <div key={`${i}-${p.name}`} style={itemCard}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                <span style={{ fontSize: 12, color: C.muted }}>
                  {[p.mode, p.durationMinutes ? `${p.durationMinutes} min` : null, p.totalQuestions ? `${p.totalQuestions} questions` : null, p.totalMarks ? `${p.totalMarks} marks` : null].filter(Boolean).join(" · ")}
                </span>
              </div>
              {p.sections.length > 0 && (
                <table style={{ fontSize: 12, marginTop: 8, borderCollapse: "collapse", width: "100%" }}>
                  <tbody>
                    {p.sections.map((s) => (
                      <tr key={s.subject}>
                        <td style={{ padding: "3px 0", color: C.text }}>{s.subject}</td>
                        <td style={{ padding: "3px 8px", color: C.muted, textAlign: "right", width: 110 }}>{s.questions ? `${s.questions} questions` : ""}</td>
                        <td style={{ padding: "3px 0", color: C.muted, textAlign: "right", width: 90 }}>{s.marks ? `${s.marks} marks` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {p.negativeMarking && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Negative marking: {p.negativeMarking}</div>}
              {p.note && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{p.note}</div>}
              {editable && (
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button style={ghost} disabled={saving} onClick={() => { setEditing(i); setDraft(paperToDraft(p)); setErr(null); }}>Edit</button>
                  <button
                    style={{ ...ghost, color: C.red, marginLeft: "auto" }}
                    disabled={saving}
                    aria-label={`Remove paper ${p.name}`}
                    onClick={() => { void save(papers.filter((_, j) => j !== i), `Removed exam pattern: ${p.name}`); }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!editable ? (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>Click “Edit Record” first to change the exam pattern.</div>
      ) : editing === null ? (
        <button style={{ ...primary(false), marginTop: 14 }} onClick={() => { setEditing(-1); setDraft(EMPTY_PAPER); setErr(null); }}>
          + Add paper
        </button>
      ) : (
        <div style={{ ...itemCard, marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>{editing === -1 ? "New paper" : `Edit paper ${editing + 1}`}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 2, minWidth: 180 }}>
              <label style={label} htmlFor="paper-name">Paper or tier name</label>
              <input id="paper-name" style={input} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Tier-I, Paper II, Skill Test…" />
            </div>
            <div style={{ flex: 2, minWidth: 160 }}>
              <label style={label} htmlFor="paper-mode">Type of test (optional)</label>
              <input id="paper-mode" style={input} value={draft.mode} onChange={(e) => set("mode", e.target.value)} placeholder="Computer Based, Descriptive…" />
            </div>
            <div style={{ flex: 1, minWidth: 110 }}>
              <label style={label} htmlFor="paper-duration">Time (minutes)</label>
              <input id="paper-duration" inputMode="numeric" style={input} value={draft.duration} onChange={(e) => set("duration", e.target.value)} placeholder="60" />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={label} htmlFor="paper-subjects">
              Subjects, one per line
              <InfoTip text="Type each subject on its own line. To add the number of questions and marks, separate them with a | sign: General Intelligence | 25 | 50. Leave them out if the notification gives only totals." />
            </label>
            <textarea
              id="paper-subjects"
              rows={5}
              style={{ ...input, fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.6 }}
              value={draft.subjects}
              onChange={(e) => set("subjects", e.target.value)}
              placeholder={"General Intelligence | 25 | 50\nGeneral Awareness | 25 | 50\nQuantitative Aptitude | 25 | 50\nEnglish Language | 25 | 50"}
            />
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Format: Subject | questions | marks. Questions and marks are optional.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={label} htmlFor="paper-total-q">Total questions</label>
              <input id="paper-total-q" inputMode="numeric" style={input} value={draft.totalQuestions} onChange={(e) => set("totalQuestions", e.target.value)} placeholder="100" />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={label} htmlFor="paper-total-m">Total marks</label>
              <input id="paper-total-m" inputMode="numeric" style={input} value={draft.totalMarks} onChange={(e) => set("totalMarks", e.target.value)} placeholder="200" />
            </div>
            <div style={{ flex: 3, minWidth: 220 }}>
              <label style={label} htmlFor="paper-negative">Negative marking, as written (optional)</label>
              <input id="paper-negative" style={input} value={draft.negativeMarking} onChange={(e) => set("negativeMarking", e.target.value)} placeholder="0.50 marks for each wrong answer" />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={label} htmlFor="paper-note">Note (optional)</label>
            <input id="paper-note" style={input} value={draft.note} onChange={(e) => set("note", e.target.value)} placeholder="Qualifying in nature" />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
            <button style={primary(saving || !draft.name.trim())} disabled={saving || !draft.name.trim()} onClick={() => { void submit(); }}>
              {saving ? "Saving…" : editing === -1 ? "Add paper" : "Save paper"}
            </button>
            <button style={{ ...ghost, color: C.muted }} onClick={() => { setEditing(null); setDraft(EMPTY_PAPER); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 10 }}>{err}</div>}
    </div>
  );
}

// ─── Syllabus ───────────────────────────────────────────────

interface SubjectDraft { paper: string; subject: string; topics: string }
const EMPTY_SUBJECT: SubjectDraft = { paper: "", subject: "", topics: "" };

/** One topic per line; a single line with commas is split on the commas. */
function parseTopics(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const parts = lines.length === 1 ? lines[0].split(/[,;]/) : lines;
  return parts.map((p) => p.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean);
}

export function SyllabusEditor({ record, onSave }: { record: RecruitmentRecord; onSave: SaveFn }) {
  const editable = record.draftState === "DRAFT" || record.draftState === "APPROVED";
  const subjects = record.syllabus?.value ?? [];
  const paperNames = (record.examPattern?.value ?? []).map((p) => p.name);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<SubjectDraft>(EMPTY_SUBJECT);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(next: unknown[], reason: string): Promise<boolean> {
    setSaving(true);
    setErr(null);
    const problem = await onSave("syllabus", next, reason);
    setSaving(false);
    if (problem) { setErr(cleanError(problem)); return false; }
    return true;
  }

  async function submit() {
    const item: SyllabusSubject = {
      ...(draft.paper.trim() ? { paper: draft.paper.trim() } : {}),
      subject: draft.subject,
      topics: parseTopics(draft.topics),
    };
    const list: unknown[] = subjects.map((s) => s);
    const adding = editing === -1;
    if (adding) list.push(item);
    else if (editing !== null) list[editing] = item;
    if (await save(list, `${adding ? "Added" : "Edited"} syllabus: ${draft.subject.trim()}`)) {
      // Keep the paper for the next subject: syllabi are entered a paper at a time.
      setEditing(null);
      setDraft({ ...EMPTY_SUBJECT, paper: adding ? draft.paper : "" });
    }
  }

  const topicCount = parseTopics(draft.topics).length;

  return (
    <div>
      <PendingNote status={record.syllabus?.status} />
      {subjects.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
          No syllabus yet. Add one subject at a time with its topics, or run AI Assist on a page that lists the syllabus.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {subjects.map((s, i) => (
            <div key={`${i}-${s.paper ?? ""}-${s.subject}`} style={itemCard}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                {s.paper && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#fdba74" }}>{s.paper}</span>}
                <span style={{ fontWeight: 600, fontSize: 14 }}>{s.subject}</span>
                <span style={{ fontSize: 12, color: C.muted }}>{s.topics.length} {s.topics.length === 1 ? "topic" : "topics"}</span>
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>{s.topics.join(" · ")}</div>
              {editable && (
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button
                    style={ghost}
                    disabled={saving}
                    onClick={() => { setEditing(i); setDraft({ paper: s.paper ?? "", subject: s.subject, topics: s.topics.join("\n") }); setErr(null); }}
                  >
                    Edit
                  </button>
                  <button
                    style={{ ...ghost, color: C.red, marginLeft: "auto" }}
                    disabled={saving}
                    aria-label={`Remove subject ${s.subject}`}
                    onClick={() => { void save(subjects.filter((_, j) => j !== i), `Removed syllabus: ${s.subject}`); }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!editable ? (
        <div style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>Click “Edit Record” first to change the syllabus.</div>
      ) : editing === null ? (
        <button style={{ ...primary(false), marginTop: 14 }} onClick={() => { setEditing(-1); setErr(null); }}>
          + Add subject
        </button>
      ) : (
        <div style={{ ...itemCard, marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>{editing === -1 ? "New subject" : `Edit subject ${editing + 1}`}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={label} htmlFor="syl-paper">
                Paper (optional)
                <InfoTip text="Fill this in only when the syllabus differs from paper to paper. Use the same name as in the Exam Pattern, for example Tier-I." />
              </label>
              <input id="syl-paper" list="syl-papers" style={input} value={draft.paper} onChange={(e) => setDraft((d) => ({ ...d, paper: e.target.value }))} placeholder="Tier-I" />
              <datalist id="syl-papers">{paperNames.map((n) => <option key={n} value={n} />)}</datalist>
            </div>
            <div style={{ flex: 2, minWidth: 200 }}>
              <label style={label} htmlFor="syl-subject">Subject</label>
              <input id="syl-subject" style={input} value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} placeholder="Quantitative Aptitude" />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={label} htmlFor="syl-topics">
              Topics, one per line
              <InfoTip text="Paste the topics from the notification, one per line. If you paste a single line with commas, it is split at the commas. Bullets and numbers at the start of a line are removed." />
            </label>
            <textarea
              id="syl-topics"
              rows={7}
              style={{ ...input, lineHeight: 1.6 }}
              value={draft.topics}
              onChange={(e) => setDraft((d) => ({ ...d, topics: e.target.value }))}
              placeholder={"Number System\nPercentage\nRatio and Proportion\nProfit and Loss"}
            />
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{topicCount} {topicCount === 1 ? "topic" : "topics"} will be saved.</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
            <button
              style={primary(saving || !draft.subject.trim() || topicCount === 0)}
              disabled={saving || !draft.subject.trim() || topicCount === 0}
              onClick={() => { void submit(); }}
            >
              {saving ? "Saving…" : editing === -1 ? "Add subject" : "Save subject"}
            </button>
            <button style={{ ...ghost, color: C.muted }} onClick={() => { setEditing(null); setDraft(EMPTY_SUBJECT); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 10 }}>{err}</div>}
    </div>
  );
}
