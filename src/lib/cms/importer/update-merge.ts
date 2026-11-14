// ═══════════════════════════════════════════════════════════
// LN Update v1 → the job's fields, item by item (CMS 2.0, step U2)
// ═══════════════════════════════════════════════════════════
//
// Pure. Takes what the U1 reader read and the job as it is, and works out,
// field by field, the value the job would hold if the update were saved:
// every stage, paper, subject, topic, post, fee and link the text does not
// mention is carried over unchanged. Those values go into the ordinary Smart
// Intake proposal (buildProposal), so saving still goes through the editor's
// validators, the revision history and the owner's ticks; nothing is saved here.
//
// Rules:
//   - Items are matched by stage, paper, post and name together (findTarget).
//     Anything other than exactly one match is held for the owner, never applied.
//   - A partial list changes only the items it gives. A subject's topics are
//     added to, never replaced, unless the text says "Complete list".
//   - "Remove" and "Complete list" removals are offered unticked, with a warning.
//   - "Not specified" and "Not applicable" never clear anything.
//   - A value already verified stays protected by the proposal's own rule
//     (its replacement is never ticked by default and needs a confirmation).
//   - Announcements and supersessions are offered by update-announcements.ts (U3), not here.

import type { AgeCriteria, CmsRecruitmentPost, CmsSelectionInformation, CmsSelectionStage, ExamPatternPaper, FeeRow, RecruitmentRecord, SyllabusSubject } from "@/types/recruitment-record";
import type { ExamStage } from "@/types";
import type { ExtractedValue, Proposal } from "@/lib/cms/importer/proposal";
import type { FoundLink } from "@/lib/cms/importer/links";
import { hostOf, originFor } from "@/lib/cms/importer/trusted-domains";
import { fieldDef } from "@/lib/cms/importer/fields";
import { readFeeLines, legacyFees, feeKey } from "@/lib/cms/importer/fee-table";
import { findTarget, squash, type Context, type StageItem, type UpdateReading } from "@/lib/cms/importer/update-format";
import { selectionStageType } from "@/lib/cms/importer/extract";

export type ChangeKind = "ADDED" | "CHANGED" | "REMOVED" | "NOTED";
export interface ElementChange { fieldPath: string; kind: ChangeKind; element: string; detail: string; line?: number }

export interface UpdateMerge {
  /** Nothing may be offered (wrong job, unsupported version, no Job line). */
  refused?: string;
  /** One value per field the update changes: the field's whole value after the change, every other item kept. */
  values: ExtractedValue[];
  /** New links, each to be added beside the job's own. */
  links: FoundLink[];
  refusedValues: Array<{ fieldPath: string; reason: string }>;
  /** What changes, item by item, for the review. */
  changes: ElementChange[];
  /** Fields whose proposal must not be ticked by default, and why. */
  holds: Record<string, string[]>;
  /** For the whole import: the reader's notes, lines not read, what waits for a later step. */
  warnings: string[];
  /** The vacancy section's own lines, for the existing vacancy-table readers (never the whole update text). */
  vacancyText: string;
}

const clone = <T,>(v: T): T => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
const valueOf = <T,>(f: { value?: T } | undefined | null): T | undefined => (f && typeof f === "object" && "value" in f ? f.value : undefined);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const STATUS_TEXT: Record<string, string> = { NOT_DECLARED: "not declared", SCHEDULED: "scheduled", ADMIT_CARD_OUT: "admit card out", POSTPONED: "postponed", CONDUCTED: "conducted", RESULT_DECLARED: "result declared" };

function describeStage(s: Partial<ExamStage>): string {
  const when = s.dateDisplay ?? s.dateIso ?? "no date";
  return [s.status ? STATUS_TEXT[s.status] : null, `${when}${s.dateEndIso && !s.dateDisplay ? ` until ${s.dateEndIso}` : ""}`, s.certainty === "TENTATIVE" ? "tentative" : null].filter(Boolean).join(", ");
}
const withoutPost = (name: string, post?: string) => (post && name.endsWith(` – ${post}`) ? name.slice(0, -(` – ${post}`.length)) : name);
const label = (c: Context) => [c.stage, c.paper && c.paper !== c.stage ? c.paper : null, c.post ? `for ${c.post}` : null].filter(Boolean).join(", ");

export function mergeUpdate(input: { record: RecruitmentRecord | null; reading: UpdateReading; organizationId: string }): UpdateMerge {
  const { record, reading } = input;
  const out: UpdateMerge = { values: [], links: [], refusedValues: [], changes: [], holds: {}, warnings: [], vacancyText: "" };
  if (reading.format === null) return out;
  if (reading.refused) { out.refused = reading.refused; out.warnings.push(reading.refused); return out; }

  const change = (fieldPath: string, kind: ChangeKind, element: string, detail: string, line?: number) => out.changes.push({ fieldPath, kind, element, detail, ...(line ? { line } : {}) });
  const hold = (fieldPath: string, why: string) => { const list = (out.holds[fieldPath] ??= []); if (!list.includes(why)) list.push(why); };
  const source = reading.header.source ? `${reading.header.source}` : undefined;
  const consumed = new Set<number>();
  const offer = (fieldPath: string, value: unknown, line: number | undefined) => {
    const touched = out.changes.filter((c) => c.fieldPath === fieldPath && c.kind !== "NOTED");
    if (touched.length === 0) return;
    const firstLine = line ?? touched.find((c) => c.line)?.line;
    out.values.push({ fieldPath, value, ...(firstLine ? { quote: quoteOf(firstLine) } : {}),
      notes: [`LN Update: ${touched.length} change${touched.length === 1 ? "" : "s"}; everything else in this field is kept as it is`] });
  };
  const quoteOf = (line: number) => {
    for (const list of [reading.stages, reading.selection.items, reading.pattern, reading.syllabus, reading.links, reading.removals] as Array<Array<{ line: number; quote: string }>>) {
      const hit = list.find((x) => x.line === line);
      if (hit) return hit.quote;
    }
    for (const b of [...reading.pattern.flatMap((p) => p.sections), ...reading.syllabus.flatMap((s) => s.subjects)]) if (b.line === line) return b.quote;
    return reading.generalLines.find((g) => g.line === line)?.text.trim() ?? "";
  };

  mergeStages();
  mergeSelection();
  mergePattern();
  mergeSyllabus();
  mergeEligibility();
  mergeAge();
  mergeFees();
  mergeLinks();

  // Everything else the v0.3.1 readers gave (dates, how to apply, pay, vacancies, notice number…) is offered as before.
  const handled = new Set(["examStages", "selection", "examPattern", "syllabus", "eligibility", "age", "financial.feeGeneral", "financial.feeSCST", "financial.feeTable"]);
  for (const v of reading.values) if (!handled.has(v.fieldPath)) out.values.push({ fieldPath: v.fieldPath, value: v.value, quote: v.quote, ...(v.doubt ? { doubt: v.doubt } : {}), notes: ["read by code from a labelled line", ...(v.notes ?? [])] });
  out.refusedValues.push(...reading.refusedValues.map((r) => ({ fieldPath: r.fieldPath, reason: `labelled line: ${r.reason}` })));
  out.vacancyText = reading.generalLines.filter((g) => g.section === "vacancies").map((g) => g.text).join("\n");

  // The reader's notes, the lines it could not read, and what waits for a later step: said, never dropped.
  if (reading.identity.result === "UNSURE") out.warnings.push(`Check this text is about this job: ${reading.identity.reasons.join("; ")}.`);
  for (const a of reading.attention) if (a.code !== "IDENTITY") out.warnings.push(`LN Update${a.lines.length ? ` (line ${a.lines.join(", ")})` : ""}: ${a.message}`);
  for (const u of reading.unread) if (!consumed.has(u.line)) out.warnings.push(`Not read from the text (line ${u.line}): “${u.text}”: ${u.why}.`);
  // Announcements and supersessions are offered by update-announcements.ts (U3), beside these fields.
  for (const p of reading.pendingLinks) change(`links#${p.type}`, "NOTED", p.label, `the text says “${p.says}”: nothing is added or removed`, p.line);
  return out;

  // ── Exam stages ─────────────────────────────────────────

  function mergeStages() {
    const F = "examStages";
    const list: ExamStage[] = clone(record?.examStages ?? []);
    const touched = new Set<ExamStage>();
    let nextOrder = Math.max(0, ...list.map((s) => s.order)) + 1;
    for (const it of reading.stages) {
      const m = findTarget(list, { name: it.name, ...(it.post ? { post: it.post } : {}) }, (s) => ({ name: s.name }));
      if (it.state === "NOT_SPECIFIED") { change(F, "NOTED", it.name, "the text says this is not specified: nothing is changed", it.line); continue; }
      if (m.kind === "AMBIGUOUS") { hold(F, `“${it.name}”: ${m.why}`); change(F, "NOTED", it.name, `not applied: ${m.why}`, it.line); continue; }
      // A dated stage must say whether its date is confirmed or tentative; that is never guessed, so nothing of
      // this line is applied (half of it, a status without its date, could not be saved either).
      if (it.dateIso && !it.certainty && !(m.kind === "MATCH" && m.item.certainty)) {
        const why = `“${it.name}”: the text gives a date but not whether it is confirmed or tentative, so this line is not applied — add “Confirmed” or “Tentative”`;
        hold(F, why); out.warnings.push(`Exam stages (line ${it.line}): ${why}.`);
        change(F, "NOTED", it.name, "not applied: confirmed or tentative is not said", it.line);
        continue;
      }
      if (it.state === "NOT_APPLICABLE") {
        if (m.kind === "MATCH") { list.splice(list.indexOf(m.item), 1); change(F, "REMOVED", m.item.name, "the text says this stage is not applicable", it.line); hold(F, `the text removes the stage “${m.item.name}” (not applicable): check before saving`); }
        else change(F, "NOTED", it.name, "not applicable, and not on the job: nothing to do", it.line);
        continue;
      }
      if (m.kind === "MATCH") {
        const s = m.item;
        const before = describeStage(s);
        applyStage(s, it);
        touched.add(s);
        const after = describeStage(s);
        if (before !== after || it.notes || it.noticeUrl) change(F, "CHANGED", s.name, `${before} → ${after}${m.loose ? ` (the text calls it “${it.name}”)` : ""}`, it.line);
        else change(F, "NOTED", s.name, "already as the text says", it.line);
        if (m.loose) hold(F, `“${it.name}” was matched to the job's “${s.name}” by a partial name: check it is the same stage`);
        continue;
      }
      const s: ExamStage = { name: it.name, order: nextOrder++, status: it.status ?? (it.dateIso ? "SCHEDULED" : "NOT_DECLARED"), kind: it.kind };
      applyStage(s, it);
      list.push(s);
      touched.add(s);
      change(F, "ADDED", s.name, describeStage(s), it.line);
    }
    for (const r of reading.removals.filter((x) => x.target === "STAGE")) {
      const m = findTarget(list, { name: r.name }, (s) => ({ name: s.name }));
      if (m.kind === "MATCH") { list.splice(list.indexOf(m.item), 1); change(F, "REMOVED", m.item.name, "the text says to remove it", r.line); hold(F, `the text removes the stage “${m.item.name}”: check before saving`); }
      else if (m.kind === "AMBIGUOUS") hold(F, `“Remove: Stage: ${r.name}”: ${m.why}`);
    }
    if (reading.sections.examStages.scope === "COMPLETE_LIST") {
      for (const s of [...list]) if (!touched.has(s)) { list.splice(list.indexOf(s), 1); change(F, "REMOVED", s.name, "not in the text's complete list", reading.sections.examStages.line); hold(F, `the complete list leaves out “${s.name}”, so it would be removed: check before saving`); }
    }
    offer(F, list, undefined);
  }

  function applyStage(s: ExamStage, it: StageItem) {
    if (it.status) s.status = it.status;
    if (it.certainty) s.certainty = it.certainty;
    if (it.dateIso) {
      // A new date replaces the old one as a whole: first day, last day and the words for it.
      s.dateIso = it.dateIso;
      if (it.dateEndIso) s.dateEndIso = it.dateEndIso; else delete s.dateEndIso;
      if (it.dateDisplay) s.dateDisplay = it.dateDisplay; else delete s.dateDisplay;
      if (source) s.dateProvenance = source.slice(0, 200);
    } else if (it.dateDisplay) s.dateDisplay = it.dateDisplay;
    if (it.notes) s.notes = it.notes;
    if (it.noticeUrl) s.noticeUrl = it.noticeUrl;
  }

  // ── Selection process ───────────────────────────────────

  function mergeSelection() {
    const F = "selection";
    const base: CmsSelectionInformation = clone(valueOf(record?.selection) ?? {}) as CmsSelectionInformation;
    const stages: CmsSelectionStage[] = base.stages ?? [];
    const posts: CmsRecruitmentPost[] = clone(valueOf(record?.eligibility) ?? []) as CmsRecruitmentPost[];
    let postsChanged = false;
    const touched = new Set<CmsSelectionStage>();
    // A one-line v0.3.1 list ("Selection Process: Prelims, Mains, Interview") is read as items too.
    const listed = reading.values.filter((v) => v.fieldPath === "selection").flatMap((v) =>
      ((v.value as CmsSelectionInformation).stages ?? []).map((s) => ({ name: s.name, type: s.type, line: reading.generalLines.find((g) => g.text.trim() === v.quote.trim())?.line, state: "PROVIDED" as const, post: undefined as string | undefined, qualifying: undefined as boolean | undefined, description: s.description })));
    const items = [...reading.selection.items.map((i) => ({ ...i, line: i.line as number | undefined })), ...listed];
    let nextOrder = Math.max(0, ...stages.map((s) => s.order)) + 1;
    for (const it of items) {
      if (it.state !== "PROVIDED") { change(F, "NOTED", it.name, `the text says ${it.state === "NOT_SPECIFIED" ? "not specified" : "not applicable"}: nothing is changed`, it.line); continue; }
      if (it.post) {
        // A stage for one post: kept under that post (its own list of stages), never added for every post.
        const p = findTarget(posts, { name: it.post }, (x) => ({ name: x.post }));
        if (p.kind !== "MATCH") { hold("eligibility", `“${it.name}” is a selection stage for the post “${it.post}”, which is ${p.kind === "NONE" ? "not on the job" : "not clear"}`); change(F, "NOTED", it.name, `for “${it.post}”: not applied`, it.line); continue; }
        const own = p.item.selectionStages ?? [];
        if (!own.some((n) => squash(n) === squash(it.name))) { p.item.selectionStages = [...own, it.name]; postsChanged = true; change("eligibility", "CHANGED", p.item.post, `selection stage “${it.name}” added for this post`, it.line); }
        continue;
      }
      const m = findTarget(stages, { name: it.name }, (s) => ({ name: s.name }));
      if (m.kind === "AMBIGUOUS") { hold(F, `“${it.name}”: ${m.why}`); continue; }
      if (m.kind === "MATCH") {
        const s = m.item;
        const before = JSON.stringify(s);
        if (it.qualifying !== undefined) s.qualifying = it.qualifying;
        if (it.description) s.description = it.description;
        touched.add(s);
        if (JSON.stringify(s) !== before) change(F, "CHANGED", s.name, [it.qualifying ? "qualifying" : null, it.description ? `“${it.description}”` : null].filter(Boolean).join(", "), it.line);
        if (m.loose) hold(F, `“${it.name}” was matched to the job's “${s.name}” by a partial name: check it is the same stage`);
        continue;
      }
      const s: CmsSelectionStage = { name: it.name, order: nextOrder++, type: it.type ?? selectionStageType(it.name), ...(it.qualifying ? { qualifying: true } : {}), ...(it.description ? { description: it.description } : {}) };
      stages.push(s);
      touched.add(s);
      change(F, "ADDED", s.name, s.qualifying ? "qualifying" : "stage of selection", it.line);
    }
    const merit = reading.selection.merit;
    if (merit && merit.text !== base.finalMeritFormula) {
      change(F, base.finalMeritFormula ? "CHANGED" : "ADDED", "Final merit", `${base.finalMeritFormula ? `“${base.finalMeritFormula}” → ` : ""}“${merit.text}”`, merit.line);
      base.finalMeritFormula = merit.text;
    }
    for (const r of reading.removals.filter((x) => x.target === "SELECTION_STAGE" || x.target === "STAGE")) {
      const m = findTarget(stages, { name: r.name }, (s) => ({ name: s.name }));
      if (m.kind === "MATCH") { stages.splice(stages.indexOf(m.item), 1); change(F, "REMOVED", m.item.name, "the text says to remove it", r.line); hold(F, `the text removes the selection stage “${m.item.name}”: check before saving`); }
    }
    if (reading.sections.selection.scope === "COMPLETE_LIST") {
      for (const s of [...stages]) if (!touched.has(s)) { stages.splice(stages.indexOf(s), 1); change(F, "REMOVED", s.name, "not in the text's complete list"); hold(F, `the complete list leaves out “${s.name}”, so it would be removed: check before saving`); }
    }
    offer(F, { ...base, stages }, undefined);
    if (postsChanged) offerPosts(posts);
  }

  // ── Exam pattern ────────────────────────────────────────

  function describePaper(p: ExamPatternPaper): Context & { name: string } {
    const own = withoutPost(p.name, p.post);
    return p.stage ? { name: p.stage, paper: own, ...(p.post ? { post: p.post } : {}) } : { name: own, ...(p.post ? { post: p.post } : {}) };
  }

  function mergePattern() {
    const F = "examPattern";
    const papers: ExamPatternPaper[] = clone(valueOf(record?.examPattern) ?? []) as ExamPatternPaper[];
    const touched = new Set<ExamPatternPaper>();
    for (const b of reading.pattern) {
      const where = label(b.context) || b.name;
      if (b.state === "NOT_SPECIFIED") { change(F, "NOTED", where, "the text says not specified: nothing is changed", b.line); continue; }
      const stage = b.context.stage, paper = b.context.paper, post = b.context.post;
      if (!stage && !paper) { hold(F, `${where}: no stage given`); continue; }
      let m = findTarget(papers, { name: (stage ?? paper)!, ...(stage && paper ? { paper } : {}), ...(post ? { post } : {}) }, describePaper);
      if (m.kind === "NONE" && stage && paper) m = findTarget(papers, { name: paper, ...(post ? { post } : {}) }, (p) => ({ name: withoutPost(p.name, p.post), ...(p.post ? { post: p.post } : {}) }));
      if (m.kind === "AMBIGUOUS") { hold(F, `${where}: ${m.why}`); change(F, "NOTED", where, `not applied: ${m.why}`, b.line); continue; }
      if (b.state === "NOT_APPLICABLE") {
        if (m.kind === "MATCH") { papers.splice(papers.indexOf(m.item), 1); change(F, "REMOVED", m.item.name, "the text says this paper is not applicable", b.line); hold(F, `the text removes the paper “${m.item.name}” (not applicable): check before saving`); }
        continue;
      }
      for (const p of b.problems) hold(F, `${where}: ${p}`);
      if (m.kind === "MATCH") {
        const p = m.item;
        touched.add(p);
        const attrs: Array<[keyof ExamPatternPaper, unknown]> = [["mode", b.mode], ["durationMinutes", b.durationMinutes], ["negativeMarking", b.negativeMarking], ["totalQuestions", b.totalQuestions], ["totalMarks", b.totalMarks], ["note", b.note ?? (b.qualifying && !p.note ? "Qualifying in nature" : undefined)]];
        for (const [k, v] of attrs) {
          if (v === undefined || same(p[k], v)) continue;
          change(F, p[k] === undefined ? "ADDED" : "CHANGED", `${p.name}: ${k}`, `${p[k] === undefined ? "" : `${String(p[k])} → `}${String(v)}`, b.line);
          (p as unknown as Record<string, unknown>)[k] = v;
        }
        const mentioned = new Set<object>();
        for (const sec of b.sections) {
          const s = findTarget(p.sections, { name: sec.subject }, (x) => ({ name: x.subject }));
          if (s.kind === "AMBIGUOUS") { hold(F, `${p.name}, “${sec.subject}”: ${s.why}`); continue; }
          if (s.kind === "MATCH") {
            mentioned.add(s.item);
            if (s.item.questions !== sec.questions || s.item.marks !== sec.marks) {
              change(F, "CHANGED", `${p.name}: ${s.item.subject}`, `${s.item.questions ?? "?"} questions, ${s.item.marks ?? "?"} marks → ${sec.questions} questions, ${sec.marks} marks`, sec.line);
              s.item.questions = sec.questions; s.item.marks = sec.marks;
            }
            continue;
          }
          const added = { subject: sec.subject, questions: sec.questions, marks: sec.marks };
          p.sections.push(added); mentioned.add(added);
          change(F, "ADDED", `${p.name}: ${sec.subject}`, `${sec.questions} questions, ${sec.marks} marks`, sec.line);
        }
        if (b.scope === "COMPLETE_LIST") {
          for (const s of [...p.sections]) if (!mentioned.has(s)) { p.sections.splice(p.sections.indexOf(s), 1); change(F, "REMOVED", `${p.name}: ${s.subject}`, "not in the text's complete list", b.line); hold(F, `the complete list for ${p.name} leaves out “${s.subject}”, so it would be removed: check before saving`); }
        }
        // Printed totals are never worked out: one the subjects no longer add up to is said.
        const q = p.sections.reduce((n, s) => n + (s.questions ?? 0), 0), mk = p.sections.reduce((n, s) => n + (s.marks ?? 0), 0);
        if (b.totalQuestions === undefined && ((p.totalQuestions !== undefined && p.totalQuestions !== q) || (p.totalMarks !== undefined && p.totalMarks !== mk))) {
          hold(F, `${p.name}: the totals on record (${p.totalQuestions ?? "?"} questions, ${p.totalMarks ?? "?"} marks) no longer match the subjects (${q}, ${mk}); the text gives no new total — check the notice`);
        }
        continue;
      }
      const name = `${paper ?? stage}${post ? ` – ${post}` : ""}`;
      const p: ExamPatternPaper = { name, ...(stage && paper ? { stage } : {}), ...(post ? { post, ...(stage && !paper ? { stage } : {}) } : {}),
        ...(b.mode ? { mode: b.mode } : {}), ...(b.durationMinutes ? { durationMinutes: b.durationMinutes } : {}), ...(b.negativeMarking ? { negativeMarking: b.negativeMarking } : {}),
        sections: b.sections.map((s) => ({ subject: s.subject, questions: s.questions, marks: s.marks })),
        ...(b.totalQuestions !== undefined ? { totalQuestions: b.totalQuestions } : {}), ...(b.totalMarks !== undefined ? { totalMarks: b.totalMarks } : {}),
        ...(b.note ? { note: b.note } : b.qualifying ? { note: "Qualifying in nature" } : {}) };
      papers.push(p); touched.add(p);
      change(F, "ADDED", name, `${p.sections.length} subject(s)${p.durationMinutes ? `, ${p.durationMinutes} minutes` : ""}`, b.line);
    }
    for (const r of reading.removals.filter((x) => x.target === "PAPER" || (x.target === "SUBJECT" && x.section === "examPattern"))) {
      if (r.target === "PAPER") {
        const m = findTarget(papers, { name: r.name, ...(r.context.post ? { post: r.context.post } : {}) }, (p) => ({ name: withoutPost(p.name, p.post), ...(p.post ? { post: p.post } : {}) }));
        if (m.kind === "MATCH") { papers.splice(papers.indexOf(m.item), 1); change(F, "REMOVED", m.item.name, "the text says to remove it", r.line); hold(F, `the text removes the paper “${m.item.name}”: check before saving`); }
        continue;
      }
      const owner = r.context.stage ? findTarget(papers, { name: r.context.paper ?? r.context.stage, ...(r.context.post ? { post: r.context.post } : {}) }, describePaper) : null;
      const s = owner?.kind === "MATCH" ? findTarget(owner.item.sections, { name: r.name }, (x) => ({ name: x.subject })) : null;
      if (owner?.kind === "MATCH" && s?.kind === "MATCH") { owner.item.sections.splice(owner.item.sections.indexOf(s.item), 1); change(F, "REMOVED", `${owner.item.name}: ${s.item.subject}`, "the text says to remove it", r.line); hold(F, `the text removes “${s.item.subject}” from ${owner.item.name}: check before saving`); }
      else hold(F, `“Remove: Subject: ${r.name}” could not be tied to one paper of the job`);
    }
    if (reading.sections.examPattern.scope === "COMPLETE_LIST") {
      for (const p of [...papers]) if (!touched.has(p)) { papers.splice(papers.indexOf(p), 1); change(F, "REMOVED", p.name, "not in the text's complete list"); hold(F, `the complete list leaves out the paper “${p.name}”, so it would be removed: check before saving`); }
    }
    offer(F, papers, undefined);
  }

  // ── Syllabus ────────────────────────────────────────────

  function mergeSyllabus() {
    const F = "syllabus";
    const sec = reading.sections.syllabus;
    if (sec.state === "NOT_SPECIFIED") { change(F, "NOTED", "Syllabus", "the text says the notice does not specify a syllabus: the job's syllabus is kept, unchanged", sec.line); }
    if (sec.state === "NOT_APPLICABLE" && (valueOf(record?.syllabus)?.length ?? 0) > 0) {
      out.warnings.push("The text says a syllabus is not applicable, but the job has one. Nothing is removed; remove it in the editor if that is right.");
    }
    const list: SyllabusSubject[] = clone(valueOf(record?.syllabus) ?? []) as SyllabusSubject[];
    const stagesInText = [...new Set(reading.syllabus.map((b) => squash(b.context.paper ?? b.context.stage ?? "")).filter(Boolean))];
    // A job whose syllabus names no stage at all, updated for one stage only: its subjects are read as that stage's.
    const unnamed = list.length > 0 && list.every((s) => !s.paper) && stagesInText.length === 1;
    const group = (s: SyllabusSubject) => (s.post ? s.stage ?? withoutPost(s.paper ?? "", s.post) : s.paper);
    const touched = new Set<SyllabusSubject>();
    for (const b of reading.syllabus) {
      const where = label(b.context);
      if (!b.context.stage && !b.context.paper) { hold(F, "a syllabus block names no stage, so it is not applied"); continue; }
      if (b.state === "NOT_SPECIFIED") { change(F, "NOTED", where, "the text says not specified: nothing is changed", b.line); continue; }
      const paper = (b.context.paper ?? b.context.stage)!;
      const post = b.context.post;
      const describe = (s: SyllabusSubject) => ({ name: s.subject, ...(group(s) ? { paper: group(s) } : unnamed ? { paper } : {}), ...(s.post ? { post: s.post } : {}) });
      if (unnamed) hold(F, `the job's syllabus names no stage; it is read as “${paper}”'s — check that is right`);
      const mentioned = new Set<SyllabusSubject>();
      for (const subj of b.subjects) {
        const m = findTarget(list, { name: subj.subject, paper, ...(post ? { post } : {}) }, describe);
        if (subj.state === "NOT_SPECIFIED") { change(F, "NOTED", `${where}: ${subj.subject}`, "not specified in the notice: nothing is changed", subj.line); if (m.kind === "MATCH") mentioned.add(m.item); continue; }
        if (m.kind === "AMBIGUOUS") { hold(F, `${where}, “${subj.subject}”: ${m.why}`); change(F, "NOTED", `${where}: ${subj.subject}`, `not applied: ${m.why}`, subj.line); continue; }
        if (subj.state === "NOT_APPLICABLE") {
          if (m.kind === "MATCH") { list.splice(list.indexOf(m.item), 1); change(F, "REMOVED", `${where}: ${m.item.subject}`, "the text says not applicable", subj.line); hold(F, `the text removes “${m.item.subject}” (${where}): check before saving`); }
          continue;
        }
        if (m.kind === "MATCH") {
          const s = m.item;
          mentioned.add(s); touched.add(s);
          if (b.scope === "COMPLETE_LIST") {
            if (!same(s.topics.map(squash), subj.topics.map(squash))) {
              change(F, "CHANGED", `${where}: ${s.subject}`, `topics replaced (the text gives the complete list): ${s.topics.length} → ${subj.topics.length}`, subj.line);
              s.topics = [...subj.topics];
              hold(F, `${where}, “${s.subject}”: the complete list replaces its topics — check before saving`);
            }
          } else {
            // A partial list adds topics; it never takes any away.
            const fresh = subj.topics.filter((t) => !s.topics.some((x) => squash(x) === squash(t)));
            if (fresh.length) { s.topics = [...s.topics, ...fresh]; change(F, "CHANGED", `${where}: ${s.subject}`, `${fresh.length} topic(s) added: ${fresh.join("; ")}; the ${s.topics.length - fresh.length} on record are kept`, subj.line); }
          }
          if (m.loose) hold(F, `“${subj.subject}” was matched to “${s.subject}” by a partial name: check it is the same subject`);
          continue;
        }
        const s: SyllabusSubject = { paper: post ? `${paper} – ${post}` : paper, subject: subj.subject, topics: [...subj.topics], ...(post ? { post, stage: paper } : {}) };
        list.push(s); mentioned.add(s); touched.add(s);
        change(F, "ADDED", `${where}: ${subj.subject}`, `${subj.topics.length} topic(s)`, subj.line);
      }
      if (b.scope === "COMPLETE_LIST") {
        for (const s of [...list]) {
          const d = describe(s);
          if (!mentioned.has(s) && squash(d.paper ?? "") === squash(paper) && squash(d.post ?? "") === squash(post ?? "")) {
            list.splice(list.indexOf(s), 1);
            change(F, "REMOVED", `${where}: ${s.subject}`, "not in the text's complete list for this stage", b.line);
            hold(F, `the complete list for ${where} leaves out “${s.subject}”, so it would be removed: check before saving`);
          }
        }
      }
    }
    for (const r of reading.removals.filter((x) => x.target === "SUBJECT" && x.section === "syllabus")) {
      const paper = r.context.paper ?? r.context.stage;
      const m = paper ? findTarget(list, { name: r.name, paper, ...(r.context.post ? { post: r.context.post } : {}) }, (s) => ({ name: s.subject, ...(group(s) ? { paper: group(s) } : {}), ...(s.post ? { post: s.post } : {}) })) : null;
      if (m?.kind === "MATCH") { list.splice(list.indexOf(m.item), 1); change(F, "REMOVED", m.item.subject, "the text says to remove it", r.line); hold(F, `the text removes the subject “${m.item.subject}”: check before saving`); }
      else hold(F, `“Remove: Subject: ${r.name}” could not be tied to one subject of the job`);
    }
    if (sec.scope === "COMPLETE_LIST") {
      for (const s of [...list]) if (!touched.has(s)) { list.splice(list.indexOf(s), 1); change(F, "REMOVED", s.subject, "not in the text's complete syllabus"); hold(F, `the complete syllabus leaves out “${s.subject}”, so it would be removed: check before saving`); }
    }
    offer(F, list, undefined);
  }

  // ── Eligibility and posts ───────────────────────────────

  function offerPosts(posts: CmsRecruitmentPost[]) {
    const i = out.values.findIndex((v) => v.fieldPath === "eligibility");
    if (i >= 0) out.values.splice(i, 1);
    offer("eligibility", posts, undefined);
  }

  function mergeEligibility() {
    const F = "eligibility";
    const given = reading.values.filter((v) => v.fieldPath === F);
    const removals = reading.removals.filter((r) => r.target === "POST");
    if (given.length === 0 && removals.length === 0 && !out.changes.some((c) => c.fieldPath === F)) return;
    const posts: CmsRecruitmentPost[] = (out.values.find((v) => v.fieldPath === F)?.value as CmsRecruitmentPost[] | undefined) ?? clone(valueOf(record?.eligibility) ?? []) as CmsRecruitmentPost[];
    for (const v of given) {
      const line = reading.generalLines.find((g) => g.text.trim() === v.quote.trim())?.line;
      for (const p of v.value as CmsRecruitmentPost[]) {
        const m = findTarget(posts, { name: p.post }, (x) => ({ name: x.post }));
        if (m.kind === "AMBIGUOUS") { hold(F, `“${p.post}”: ${m.why}`); continue; }
        if (m.kind === "MATCH") {
          const before = JSON.stringify(m.item);
          if (p.qualification?.length) m.item.qualification = p.qualification;
          if (p.experience?.length) m.item.experience = p.experience;
          if (JSON.stringify(m.item) !== before) change(F, "CHANGED", m.item.post, [p.qualification?.length ? "qualification" : null, p.experience?.length ? "experience" : null].filter(Boolean).join(" and ") + " as the text gives it", line);
          continue;
        }
        posts.push(p);
        change(F, "ADDED", p.post, "new post", line);
      }
    }
    for (const r of removals) {
      const m = findTarget(posts, { name: r.name }, (x) => ({ name: x.post }));
      if (m.kind === "MATCH") { posts.splice(posts.indexOf(m.item), 1); change(F, "REMOVED", m.item.post, "the text says to remove this post", r.line); hold(F, `the text removes the post “${m.item.post}”: check before saving (its vacancy rows are not changed here)`); }
      else hold(F, `“Remove: Post: ${r.name}” is ${m.kind === "NONE" ? "not a post of this job" : "not clear"}`);
    }
    offerPosts(posts);
  }

  // ── Age ─────────────────────────────────────────────────

  function mergeAge() {
    const F = "age";
    const given = reading.values.find((v) => v.fieldPath === F);
    if (!given) return;
    const base = clone(valueOf(record?.age) ?? null) as AgeCriteria | null;
    const add = given.value as AgeCriteria;
    // Only what the text gives changes: a line with only the relaxations keeps the job's minimum and maximum.
    const merged: AgeCriteria = { ...(base ?? { relaxations: [] }) };
    for (const [k, v] of Object.entries(add) as Array<[keyof AgeCriteria, unknown]>) {
      if (v === undefined || (Array.isArray(v) && v.length === 0 && k !== "relaxations")) continue;
      if (k === "relaxations" && Array.isArray(v) && v.length === 0) continue;
      if (k === "postWise" && Array.isArray(v) && base?.postWise?.length) {
        const rows = clone(base.postWise);
        for (const r of v as NonNullable<AgeCriteria["postWise"]>) {
          const m = findTarget(rows, { name: r.post }, (x) => ({ name: x.post }));
          if (m.kind === "MATCH") rows[rows.indexOf(m.item)] = r; else if (m.kind === "NONE") rows.push(r); else hold(F, `“${r.post}”: ${m.why}`);
        }
        merged.postWise = rows;
        continue;
      }
      (merged as unknown as Record<string, unknown>)[k] = v;
    }
    if (!same(merged, base)) {
      const line = reading.generalLines.find((g) => g.text.trim() === given.quote.trim())?.line;
      change(F, base ? "CHANGED" : "ADDED", "Age", Object.keys(add).filter((k) => k !== "evidence").join(", "), line);
      out.values.push({ fieldPath: F, value: merged, quote: given.quote, ...(given.doubt ? { doubt: given.doubt } : {}), notes: ["LN Update: only what the text gives changes; the rest of the age limit is kept", ...(given.notes ?? [])] });
    }
  }

  // ── Fees, category by category ──────────────────────────

  function mergeFees() {
    const feeLines = reading.generalLines.filter((g) => g.section === "fees");
    const legacyGiven = reading.values.filter((v) => v.fieldPath === "financial.feeGeneral" || v.fieldPath === "financial.feeSCST");
    if (feeLines.length === 0) { for (const v of legacyGiven) out.values.push({ fieldPath: v.fieldPath, value: v.value, quote: v.quote, ...(v.doubt ? { doubt: v.doubt } : {}) }); return; }
    const fees = readFeeLines(feeLines);
    for (const l of fees.consumed) consumed.add(l);
    for (const p of fees.problems) { out.warnings.push(`Fees (line ${p.line}): ${p.message}.`); hold("financial.feeTable", p.message); }
    if (fees.rows.length === 0) { for (const v of legacyGiven) out.values.push({ fieldPath: v.fieldPath, value: v.value, quote: v.quote, ...(v.doubt ? { doubt: v.doubt } : {}) }); return; }
    const F = "financial.feeTable";
    const table: FeeRow[] = clone(valueOf(record?.financial?.feeTable) ?? []) as FeeRow[];
    for (const r of fees.rows) {
      const { line, quote: _q, ...row } = r; void _q;
      const at = table.findIndex((x) => feeKey(x) === feeKey(row));
      if (at >= 0) {
        if (!same(table[at], row)) { change(F, "CHANGED", `${row.category}${row.post ? ` (${row.post})` : ""}`, `₹${table[at].amount}${table[at].exempt ? " (exempt)" : ""} → ₹${row.amount}${row.exempt ? " (exempt)" : ""}`, line); table[at] = row; }
      } else {
        table.push(row);
        change(F, "ADDED", `${row.category}${row.post ? ` (${row.post})` : ""}`, row.exempt ? "exempt" : `₹${row.amount}`, line);
      }
    }
    offer(F, table, undefined);
    // The two summary fees, from the table only where it says them plainly.
    const legacy = legacyFees(table);
    if (legacy.why) { out.warnings.push(`Fees: ${legacy.why}.`); return; }
    const firstLine = fees.rows[0].line;
    for (const [path, value] of [["financial.feeGeneral", legacy.feeGeneral], ["financial.feeSCST", legacy.feeSCST]] as const) {
      if (value === undefined) continue;
      const cur = valueOf(record?.financial?.[path === "financial.feeGeneral" ? "feeGeneral" : "feeSCST"]);
      if (cur === value) continue;
      const pwbd = path === "financial.feeSCST" && !table.some((r) => r.groups.includes("pwbd") && r.amount === value);
      out.values.push({ fieldPath: path, value, quote: quoteOf(firstLine), notes: ["from the fee table above"],
        ...(pwbd ? { doubt: "the fee table gives this for SC/ST; PwBD's fee is not the same or not stated, and this field is for SC / ST / PwBD — check before ticking" } : {}) });
      change(path, cur === undefined || cur === null ? "ADDED" : "CHANGED", path === "financial.feeGeneral" ? "Fee (General / OBC)" : "Fee (SC / ST / PwBD)", `${cur ?? "—"} → ${value}`, firstLine);
    }
  }

  // ── Links ───────────────────────────────────────────────

  function mergeLinks() {
    const onJob = record?.links ?? [];
    for (const l of reading.links) {
      const origin = originFor(input.organizationId, hostOf(l.url));
      const official = (origin.role === "AUTHORITY" || origin.role === "PARTNER") && l.flags.every((f) => f === "tracking removed");
      out.links.push({ type: l.type, label: l.label.slice(0, 120), url: l.url, official, flags: l.flags, context: l.quote, ...(l.appliesTo ? { appliesTo: l.appliesTo } : {}) });
      const existing = onJob.find((x) => x.url === l.url);
      if (existing) { change(`links#${l.type}`, "NOTED", l.label, `already on the job${l.appliesTo && existing.appliesTo !== l.appliesTo ? `; “for ${l.appliesTo}” is not saved onto an existing link (edit it in Links)` : ""}`, l.line); continue; }
      const sameType = onJob.filter((x) => x.type === l.type && !x.savedFrom);
      change(`links#${l.type}`, "ADDED", l.label, `${l.url}${l.appliesTo ? ` (for ${l.appliesTo})` : ""}`, l.line);
      if (sameType.length && l.type !== "APPLY_ONLINE") {
        out.warnings.push(`The job already has a ${l.type.replace(/_/g, " ").toLowerCase()} link (${sameType.map((x) => x.url).join(", ")}); this adds ${l.url} beside it. If it replaces the old one, the text should also say “Remove: Link: <old address>”.`);
      }
    }
    const removals = reading.removals.filter((r) => r.target === "LINK");
    if (removals.length) {
      const list = clone(onJob);
      for (const r of removals) {
        const at = list.findIndex((x) => x.url === r.name);
        if (at >= 0) { change("links", "REMOVED", list[at].label, r.name, r.line); list.splice(at, 1); }
        else out.warnings.push(`“Remove: Link: ${r.name}”: that address is not on the job; nothing to remove.`);
      }
      if (list.length !== onJob.length) {
        out.values.push({ fieldPath: "links", value: list, quote: quoteOf(removals[0].line), notes: ["LN Update: the job's links without the ones the text removes"] });
        hold("links", "the text removes a link: check before saving");
      }
    }
  }
}

/**
 * After the ordinary proposal is built from these values: each item says what changes inside it, item by item;
 * a held field is never ticked by default; a field the update only adds to (nothing on the job changed or
 * removed, nothing verified replaced) may start ticked.
 */
export function annotateProposal(proposal: Proposal, merge: UpdateMerge, retrievalId: string): void {
  for (const item of proposal.items) {
    if (!item.claims.some((c) => c.retrievalId === retrievalId)) continue;
    const path = item.fieldPath;
    const changes = merge.changes.filter((c) => c.fieldPath === path);
    for (const c of changes) {
      const line = `${c.kind === "ADDED" ? "＋ New" : c.kind === "CHANGED" ? "✎ Changed" : c.kind === "REMOVED" ? "✕ Removed" : "· Note"}: ${c.element}: ${c.detail}`;
      if (!item.flags.includes(line)) item.flags.push(line);
    }
    if (path === "links") item.label = "Links: remove";
    // R1: the same changes, structured, for the grouped review.
    if (changes.length) item.changes = changes.map((c) => ({ kind: c.kind, element: c.element, detail: c.detail }));
    const held = merge.holds[path] ?? [];
    for (const h of held) if (!item.flags.includes(h)) item.flags.push(h);
    if (held.length || changes.some((c) => c.kind === "REMOVED") || item.conflict || item.action === "REPLACE_VERIFIED") item.attention = true;
    if (held.length) { item.defaultTicked = false; continue; }
    const real = changes.filter((c) => c.kind !== "NOTED");
    const onlyAdds = real.length > 0 && real.every((c) => c.kind === "ADDED");
    if (item.kind === "FIELD" && item.action === "REPLACE" && onlyAdds && !item.conflict && path !== "financial.feeGeneral" && path !== "financial.feeSCST") {
      item.defaultTicked = true;
      item.flags.push("only additions: nothing already on the job is changed or removed");
    }
  }
  for (const [path, why] of Object.entries(merge.holds)) {
    if (!proposal.items.some((i) => i.fieldPath === path)) for (const w of why) proposal.warnings.push(`${fieldDef(path).label}: ${w}`);
  }
  proposal.warnings.push(...merge.warnings);
}
