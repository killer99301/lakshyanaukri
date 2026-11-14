"use client";

// CMS 2.0 R1 (U4): the review of ONE LN Update, grouped by what happens to the job rather than by section:
//   Needs attention → Changed → New → Unchanged (and every section the text did not mention, kept) → Not read.
// Each change shows the job's value now and after, the line of the text it came from, and its own tick.
// Ticks mean what they always meant: save these values as Pending in the draft, together or not at all
// (fields and announcements in one transaction). Nothing is published, verified or sent anywhere from here.
// Other imports keep the classic review (ReviewPanel); this one can switch to it too.

import Link from "next/link";
import { C, PANEL, badge, inputStyle, primaryBtn, quietBtn, readableDates, showValue } from "./ui";
import { VacancyTableReview } from "./VacancyTableReview";
import type { ReviewItem, ReviewSource } from "./ReviewPanel";
import type { VacancyTable } from "@/lib/vacancy-table";
import { heldTablesOf, type HeldNote } from "@/lib/cms/importer/held-tables";

export interface UpdateSummary {
  notRead: string[];
  attention: string[];
  kept: string[];
  header: { updateType?: string; source?: string; sourceDate?: string; sourceLink?: string; identity: string };
}
type Change = { kind: "ADDED" | "CHANGED" | "REMOVED" | "NOTED"; element: string; detail: string };
type Item = ReviewItem & { changes?: Change[]; attention?: boolean };
type Group = "ATTENTION" | "CHANGED" | "NEW" | "UNCHANGED";

const ORDER: Array<[string, (p: string) => boolean]> = [
  ["Basic information", (p) => p.startsWith("identity.")], ["Important dates", (p) => p.startsWith("dates.")],
  ["Exam stages", (p) => p === "examStages"], ["Selection process", (p) => p === "selection"], ["Exam pattern", (p) => p === "examPattern"],
  ["Syllabus", (p) => p === "syllabus"], ["Posts and eligibility", (p) => p === "eligibility"], ["Age limit", (p) => p === "age"],
  ["Vacancies", (p) => p.startsWith("vacancies.")], ["Fees and pay", (p) => p.startsWith("financial.")], ["How to apply", (p) => p === "howToApply"],
  ["Links", (p) => p.startsWith("links#") || p === "links"], ["Announcements", (p) => p.startsWith("updates#")], ["Notes", () => true],
];
const sectionOf = (p: string) => ORDER.findIndex(([, m]) => m(p));
const KIND: Record<Change["kind"], { mark: string; color: string; word: string }> = {
  ADDED: { mark: "＋", color: C.green, word: "New" }, CHANGED: { mark: "✎", color: C.accent, word: "Changed" },
  REMOVED: { mark: "✕", color: C.red, word: "Removed" }, NOTED: { mark: "·", color: C.muted, word: "Note" },
};
const GROUPS: Record<Group, { title: string; color: string; hint: string }> = {
  ATTENTION: { title: "Needs attention", color: C.amber, hint: "Held, ambiguous, a removal, a conflict or a checked value. Never ticked for you: decide each one." },
  CHANGED: { title: "Changed", color: C.accent, hint: "Values the job has now that this update changes." },
  NEW: { title: "New", color: C.green, hint: "Added to the job; nothing already there is changed or removed." },
  UNCHANGED: { title: "Unchanged", color: C.muted, hint: "Same as the job has now: nothing to save." },
};

/** Which group an item belongs to: attention first, then what it does to the job. */
export function groupOf(i: Item): Group {
  if (i.attention || i.conflict || i.action === "REPLACE_VERIFIED" || (!i.defaultTicked && i.action !== "MATCHES" && i.flags.some((f) => /needs attention|held|not ticked|probably already/i.test(f)))) return "ATTENTION";
  if (i.action === "MATCHES") return "UNCHANGED";
  const real = (i.changes ?? []).filter((c) => c.kind !== "NOTED");
  if (i.action === "FILL" || (real.length > 0 && real.every((c) => c.kind === "ADDED"))) return "NEW";
  return "CHANGED";
}

const isChangeLine = (f: string) => /^[＋✎✕·] (New|Changed|Removed|Note): /.test(f);
// Said once at the top instead of on every item: the text is research, and each item already lists its changes.
const SAID_ONCE = /^(from research only|found in research text|LN Update: \d+ changes?;)/i;
const shown = (v: unknown, path: string) => (v === undefined || v === null || v === "" ? "—" : showValue(v, path));

export function UpdateReview(props: {
  title: string;
  existing: boolean;
  items: Item[];
  sources: ReviewSource[];
  summary: UpdateSummary;
  ticked: Set<string>;
  onToggle: (item: ReviewItem) => void;
  duplicates: Array<{ id: string; title: string }>;
  overrideReason: string;
  setOverrideReason: (s: string) => void;
  needsVerifiedConfirm: boolean;
  confirmVerified: boolean;
  setConfirmVerified: (b: boolean) => void;
  busy: boolean;
  err: string | null;
  onSave: () => void;
  onBack: () => void;
  onClassic: () => void;
}) {
  const { items, ticked, summary } = props;
  const h = summary.header;
  const byGroup = (g: Group) => items.filter((i) => groupOf(i) === g).sort((a, b) => sectionOf(a.fieldPath) - sectionOf(b.fieldPath));
  const held = props.sources.flatMap((s) => heldTablesOf(s.vacancyTables as HeldNote | null | undefined, s));
  const offered = items.filter((i) => i.action !== "MATCHES");
  const attention = byGroup("ATTENTION");
  const research = props.sources.length > 0 && props.sources.every((s) => s.declaredKind === "RESEARCH");
  const quoteOf = (i: Item) => i.claims.find((c) => c.quote)?.quote ?? null;

  const card = (i: Item) => {
    const changes = (i.changes ?? []).filter((c) => c.kind !== "NOTED" || groupOf(i) !== "UNCHANGED");
    const flags = i.flags.filter((f) => !isChangeLine(f) && !SAID_ONCE.test(f)).map(readableDates);
    const simple = !changes.length && i.fieldPath !== "vacancies.table";
    const conflictMates = i.conflict ? items.filter((o) => o.fieldPath === i.fieldPath && o.id !== i.id).length : 0;
    return (
      <div key={i.id} data-update-item={i.id} data-update-group={groupOf(i)} style={{ display: "grid", gridTemplateColumns: "24px minmax(0, 1fr)", gap: 10, padding: "12px 0", borderTop: `1px solid ${C.border}` }}>
        {i.action === "MATCHES"
          ? <span aria-hidden style={{ color: C.muted, fontSize: 14, paddingTop: 1 }}>=</span>
          : <input type="checkbox" aria-label={`Save: ${i.label}`} checked={ticked.has(i.id)} onChange={() => props.onToggle(i)} style={{ width: 18, height: 18, marginTop: 2, accentColor: C.accent }} />}
        <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
            <span style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{ORDER[sectionOf(i.fieldPath)]?.[0]}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{i.label}</span>
            {i.action === "REPLACE_VERIFIED" && <span style={badge(C.red)}>replaces a checked value</span>}
            {i.conflict && <span style={badge(C.red)}>{conflictMates ? `conflict: tick one of ${conflictMates + 1}, or none` : "conflict"}</span>}
          </div>
          {changes.length > 0 && (
            <ul data-update-changes style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 3 }}>
              {changes.map((c, n) => (
                <li key={n} style={{ fontSize: 13, color: C.text, overflowWrap: "anywhere" }}>
                  <span style={{ color: KIND[c.kind].color, fontWeight: 800 }}>{KIND[c.kind].mark} {KIND[c.kind].word}</span> · <b>{c.element}</b>: {readableDates(c.detail)}
                </li>
              ))}
            </ul>
          )}
          {simple ? (
            <div data-update-diff style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
              {props.existing && i.action !== "FILL" && i.action !== "MATCHES" && (
                <div style={{ background: "rgba(148,163,184,0.10)", borderRadius: 8, padding: "6px 10px", fontSize: 13, color: C.muted, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em" }}>NOW</div>{shown(i.current, i.fieldPath)}
                </div>
              )}
              <div style={{ background: i.action === "MATCHES" ? "transparent" : `${C.green}14`, borderRadius: 8, padding: "6px 10px", fontSize: 13, color: C.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", color: C.muted }}>{i.action === "MATCHES" ? "ON THE JOB" : "AFTER"}</div>{shown(i.value, i.fieldPath)}
              </div>
            </div>
          ) : (
            <details style={{ fontSize: 12, color: C.muted }}>
              <summary style={{ cursor: "pointer" }}>Whole field: now and after</summary>
              {i.fieldPath === "vacancies.table"
                ? <VacancyTableReview table={i.value as VacancyTable} note={null} pageImageUrl={() => null} research />
                : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, marginTop: 6 }}>
                    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><b>Now</b><br />{shown(i.current, i.fieldPath)}</div>
                    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: C.text }}><b>After</b><br />{shown(i.value, i.fieldPath)}</div>
                  </div>
                )}
            </details>
          )}
          {quoteOf(i) && <div data-update-evidence style={{ fontSize: 12, color: C.muted, borderLeft: `3px solid ${C.border}`, paddingLeft: 8, overflowWrap: "anywhere" }}>From the text: “{quoteOf(i)!.slice(0, 240)}”</div>}
          {flags.map((f) => <div key={f} style={{ fontSize: 12, color: /needs attention|held|not ticked|conflict|probably already|refuse|not shown on the public page/i.test(f) ? C.amber : C.muted }}>{/needs attention|held|not ticked|probably already|not shown on the public page/i.test(f) ? "⚠ " : ""}{f}</div>)}
        </div>
      </div>
    );
  };

  const group = (g: Group, list: Item[], extra?: React.ReactNode, open = true, notes = 0) => (list.length === 0 && !extra ? null : (
    <details key={g} open={open} data-update-section={g} style={{ ...PANEL, padding: "12px 16px" }}>
      <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", listStyle: "none" }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{GROUPS[g].title}</span>
        <span style={badge(GROUPS[g].color)}>{list.length + notes}</span>
      </summary>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{GROUPS[g].hint}</div>
      {extra}
      {list.map(card)}
    </details>
  ));

  return (
    <div data-update-review style={{ display: "grid", gap: 12, paddingBottom: 96 }}>
      <div style={{ ...PANEL, padding: 16, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 800, letterSpacing: "0.08em" }}>{props.existing ? "UPDATE THIS JOB" : "ADD A JOB"} · LN UPDATE</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: C.text }}>{props.title || "This job"}</div>
            <div style={{ fontSize: 13, color: C.muted }}>{[h.updateType?.replace(/_/g, " ").toLowerCase(), h.source, h.sourceDate && !/dated/i.test(h.source ?? "") ? readableDates(h.sourceDate) : null].filter(Boolean).join(" · ")}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={props.onClassic} style={{ ...quietBtn, color: C.muted, borderColor: C.border }}>Classic view</button>
            <button onClick={props.onBack} disabled={props.busy} style={{ ...quietBtn, color: C.muted, borderColor: C.border }}>← Change the text</button>
          </div>
        </div>
        <div data-update-identity role="status" style={{ fontSize: 13, padding: "8px 10px", borderRadius: 8,
          color: h.identity === "MATCH" ? C.green : C.amber, background: h.identity === "MATCH" ? `${C.green}14` : `${C.amber}14` }}>
          {h.identity === "MATCH" ? "✓ This text is about this job (organisation and title match)." : h.identity === "NOT_CHECKED" ? "A new job: there is nothing to compare the text with." : "⚠ Check that this text is about this job: see Needs attention."}
          {" "}{offered.length} change{offered.length === 1 ? "" : "s"} offered · {attention.length + summary.attention.length + held.length} need{attention.length + summary.attention.length + held.length === 1 ? "s" : ""} you · everything not in the text stays as it is.
        </div>
        {research && (
          <div data-update-research style={{ fontSize: 12, color: C.muted }}>
            This text was prepared by GPT or from research, not read from an official document: everything is saved as Pending, never as verified. Check key details against the official notice before publishing.
          </div>
        )}
        {props.duplicates.length > 0 && (
          <div role="alert" style={{ border: `1px solid ${C.red}66`, background: `${C.red}12`, borderRadius: 8, padding: 10, fontSize: 12, color: C.text }}>
            <strong>A job like this already exists:</strong>{" "}
            {props.duplicates.map((d) => <Link key={d.id} href={`/admin/cms/${d.id}`} style={{ color: C.accent, marginRight: 8 }}>{d.title || d.id}</Link>)}
            <input value={props.overrideReason} onChange={(e) => props.setOverrideReason(e.target.value)} placeholder="Or say why this is a separate job" style={{ ...inputStyle, marginTop: 6 }} />
          </div>
        )}
      </div>

      {group("ATTENTION", attention, (summary.attention.length > 0 || held.length > 0) ? (
        <ul data-update-attention-notes style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: C.amber, display: "grid", gap: 3 }}>
          {summary.attention.map((w) => <li key={w} style={{ overflowWrap: "anywhere" }}>{readableDates(w)}</li>)}
          {held.map((t) => <li key={t.key}>Vacancy figures “{t.title}” held, not offered: {t.why}. Add them from the job&apos;s vacancy editor after saving.</li>)}
        </ul>
      ) : undefined, true, summary.attention.length + held.length)}
      {group("CHANGED", byGroup("CHANGED"))}
      {group("NEW", byGroup("NEW"))}
      {group("UNCHANGED", byGroup("UNCHANGED"), summary.kept.length > 0 ? (
        <div data-update-kept style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Not in this update, so kept exactly as they are: <b style={{ color: C.text }}>{summary.kept.join(", ")}</b>.</div>
      ) : undefined, false)}
      {summary.notRead.length > 0 && (
        <details data-update-section="NOT_READ" style={{ ...PANEL, padding: "12px 16px" }}>
          <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 10, listStyle: "none" }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: C.text }}>Not read from the text</span><span style={badge(C.amber)}>{summary.notRead.length}</span>
          </summary>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>These lines were not understood, so nothing was taken from them. Ask GPT to rewrite them in the LN Update format, or enter them by hand.</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: C.text, display: "grid", gap: 3 }}>
            {summary.notRead.map((w) => <li key={w} style={{ overflowWrap: "anywhere" }}>{w.replace(/^Not read from the text /, "")}</li>)}
          </ul>
        </details>
      )}

      <div data-update-savebar style={{ position: "sticky", bottom: 0, zIndex: 5, ...PANEL, padding: "12px 16px", display: "grid", gap: 8, boxShadow: "0 -8px 24px rgba(0,0,0,0.35)" }}>
        {props.needsVerifiedConfirm && (
          <label style={{ display: "flex", gap: 8, fontSize: 12, color: C.red }}>
            <input type="checkbox" checked={props.confirmVerified} onChange={(e) => props.setConfirmVerified(e.target.checked)} />
            I am replacing values that were checked. They will need checking again.
          </label>
        )}
        {props.err && <div role="alert" style={{ color: C.red, fontSize: 13 }}>{props.err}</div>}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: C.muted }}><b style={{ color: C.text }}>{ticked.size} of {offered.length} ticked</b> · saved together as Pending, or not at all · nothing is published or sent to Telegram from here</span>
          <button data-save-import onClick={props.onSave} disabled={props.busy || (ticked.size === 0 && held.length === 0) || (props.needsVerifiedConfirm && !props.confirmVerified)}
            style={{ ...primaryBtn, opacity: props.busy || ticked.size === 0 ? 0.6 : 1 }}>
            {props.busy ? "Saving…" : props.existing ? "Save to the job's draft" : "Save as draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
