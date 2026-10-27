"use client";

// Step 2 of Smart intake: what was found, grouped by the editor's sections.
// The result first; quotes, pages and sources fold away under "View
// evidence". A tick only means "save this value as Pending in the draft":
// nothing here verifies anything. Warnings are said once, at the top,
// except where one field has its own problem.

import Link from "next/link";
import { C, PANEL, badge, inputStyle, primaryBtn, quietBtn, readableDates, showValue } from "./ui";
import { VacancyTableReview, type VacancyTableNote } from "./VacancyTableReview";
import { ScanPageImage } from "./ScanPage";
import { analyseVacancyTable, type VacancyTable } from "@/lib/vacancy-table";
import type { ReadingCoverage } from "@/lib/cms/importer/article";

export interface ReviewItem {
  id: string; kind: "FIELD" | "LINK"; fieldPath: string; label: string; value: unknown;
  claims: Array<{ retrievalId: string; page?: number | null; quote?: string | null; fromImage?: boolean }>;
  action: "FILL" | "MATCHES" | "REPLACE" | "REPLACE_VERIFIED"; conflict: boolean;
  defaultTicked: boolean; flags: string[]; current?: unknown;
}
export interface ReviewSource {
  id: string; label: string; declaredKind: string; authenticity: string;
  notFound: string[]; refused: Array<{ fieldPath: string; reason: string }>; articleSkipped?: string;
  vacancyTables?: VacancyTableNote | null;
  /** Which pages the whole-text reading read (stage B2.2). */
  reading?: ReadingCoverage | null;
  /** Scanned pages whose images are kept for this review (stage B2.4). */
  pageImages?: { jobId: string; sourceNo: number; pages: number[] } | null;
}

/** Where a source's scanned page image can be seen, while it is kept. */
const pageImageUrlOf = (src: ReviewSource | undefined) => (page: number): string | null =>
  src?.pageImages && src.pageImages.pages.includes(page) ? `/api/admin/cms/import/jobs/${src.pageImages.jobId}/pages/${src.pageImages.sourceNo}/${page}` : null;

/** "pages 1–76 read in 10 batches", and what was not read. */
function readingInWords(r: ReadingCoverage): { read: string; unread: string[] } {
  const range = (b: { first: number | null; last: number | null }) => (b.first === null ? "the text" : b.first === b.last ? `page ${b.first}` : `pages ${b.first}–${b.last}`);
  const ok = r.batches.filter((b) => b.status === "read");
  const read = r.mode === "batches"
    ? `Read in ${r.batches.length} page batches: ${ok.length} of ${r.batches.length} read${r.pages ? ` (${r.pages} pages)` : ""}${r.split?.length ? `; ${r.split.map(range).join(", ")} answered incompletely at first, so read again in halves` : ""}`
    : ok.length ? `Read whole${r.pages ? ` (${r.pages} pages)` : ""}` : "Not read";
  return { read, unread: [
    ...r.batches.filter((b) => b.status !== "read").map((b) => `${range(b)}: not read — ${b.reason ?? "unknown"}`),
    ...(r.unavailable ?? []).map((u) => `${range(u)}: not read — ${u.reason}`),
    ...(r.noTextPages.length ? [`pages ${r.noTextPages.join(", ")}: no text (scanned)`] : []),
    ...(r.suspectPages?.length ? [`scanned pages ${r.suspectPages.join(", ")}: the AI found almost nothing there, twice; check them`] : []),
  ] };
}

/** A vacancy table in one line, for "Replaces:" (the full table is shown above it). */
const tableInBrief = (v: unknown) => {
  const t = v as VacancyTable | undefined;
  if (!t?.rows) return "—";
  const total = analyseVacancyTable(t).grandTotal;
  return `the job's table: ${t.rows.length} rows${total ? `, ${total.complete ? "" : "at least "}${total.value.toLocaleString("en-IN")} vacancies` : ""}`;
};

const SECTIONS: Array<{ name: string; match: (p: string) => boolean }> = [
  { name: "Basic information", match: (p) => p.startsWith("identity.") },
  { name: "Important dates", match: (p) => p.startsWith("dates.") },
  { name: "Vacancies", match: (p) => p.startsWith("vacancies.") },
  { name: "Eligibility", match: (p) => p === "eligibility" },
  { name: "Age limit", match: (p) => p === "age" },
  { name: "Fees and pay", match: (p) => p.startsWith("financial.") },
  { name: "Selection process", match: (p) => p === "selection" },
  { name: "Exam stages", match: (p) => p === "examStages" },
  { name: "Exam pattern", match: (p) => p === "examPattern" },
  { name: "Syllabus", match: (p) => p === "syllabus" },
  { name: "How to apply", match: (p) => p === "howToApply" },
  { name: "Links", match: (p) => p.startsWith("links#") },
  { name: "Notes (admin only, never published)", match: (p) => p === "conditions" },
];

const SOURCE_LOOK: Record<string, { label: string; color: string }> = {
  CONFIRMED: { label: "Official — confirmed", color: C.green },
  ATTESTED: { label: "Official — your word", color: C.amber },
  UNCONFIRMED: { label: "Official — not confirmed", color: C.red },
  NOT_APPLICABLE: { label: "Research — not official", color: C.orange },
};

/** Flags every value of a research-only import carries; said once at the top instead. */
const SAID_ONCE = /^from research only|^found in research text|^no confirmed official document states this/;

export function ReviewPanel(props: {
  title: string;
  organization: string;
  existing: boolean;
  items: ReviewItem[];
  sources: ReviewSource[];
  /** The AI requests this preview made (resends included). */
  aiRequests?: { sent: number; retried: number; failed: number };
  warnings: string[];
  replaced: Array<{ fieldPath: string; value: unknown; by: string }>;
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
}) {
  const { items, sources, ticked } = props;
  const allResearch = sources.every((s) => s.declaredKind === "RESEARCH");
  const ownFlags = (i: ReviewItem) => i.flags.filter((f) => !(allResearch && SAID_ONCE.test(f))).map(readableDates);
  const sections = SECTIONS
    .map((s) => ({ ...s, items: items.filter((i) => s.match(i.fieldPath)) }))
    .filter((s) => s.items.length > 0);
  const tableItem = items.find((i) => i.fieldPath === "vacancies.table");
  const tableTotal = tableItem ? analyseVacancyTable(tableItem.value as VacancyTable).grandTotal : null;
  const vacancies = tableTotal?.value ?? items.find((i) => i.fieldPath === "vacancies.total")?.value;
  const conflicts = new Set(items.filter((i) => i.conflict).map((i) => i.fieldPath)).size;
  const passed = items.filter((i) => i.flags.some((f) => /has passed/.test(f)));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const leftOut = sources.reduce((n, s) => n + s.refused.length, 0);

  const before: string[] = [
    ...(allResearch ? ["Everything here comes from research (an article or ChatGPT), not the official notification. It is saved as Pending — not verified."] : []),
    ...props.warnings.filter((w) => !(allResearch && /^Every source here is research/.test(w))),
    ...passed.map((i) => `${i.label}: ${showValue(i.value, i.fieldPath)} has already passed. It is kept as written; check for an extension.`),
    ...(conflicts > 0 ? [`${conflicts} field${conflicts === 1 ? " has" : "s have"} values that disagree. Pick one in each, or none.`] : []),
  ];

  return (
    <div data-import-preview style={{ display: "grid", gap: 14 }}>
      {/* Summary */}
      <div style={{ ...PANEL, padding: 16, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{props.title || "This job"}</div>
            <div style={{ fontSize: 13, color: C.muted }}>{props.organization}</div>
          </div>
          <button onClick={props.onBack} disabled={props.busy} style={{ ...quietBtn, color: C.muted, borderColor: C.border }}>← Change the sources</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
          {typeof vacancies === "number" && <span style={badge(C.accent)}>{tableTotal && !tableTotal.complete ? "at least " : ""}{vacancies.toLocaleString("en-IN")} vacancies</span>}
          <span style={badge(C.accent)}>{sections.length} section{sections.length === 1 ? "" : "s"} found</span>
          {sources.map((s) => {
            const look = SOURCE_LOOK[s.authenticity] ?? SOURCE_LOOK.UNCONFIRMED;
            return <span key={s.id} style={badge(look.color)} title={s.label}>{look.label}</span>;
          })}
        </div>
        {before.length > 0 && (
          <div data-import-warnings role="alert" style={{ border: `1px solid ${C.amber}66`, background: `${C.amber}12`, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: C.text, display: "grid", gap: 4 }}>
            <strong style={{ color: C.amber }}>Before saving</strong>
            {before.map((w) => <div key={w}>• {readableDates(w)}</div>)}
          </div>
        )}
        {props.duplicates.length > 0 && (
          <div role="alert" style={{ border: `1px solid ${C.red}66`, background: `${C.red}12`, borderRadius: 8, padding: 10, fontSize: 12, color: C.text }}>
            <strong>A job like this already exists:</strong>{" "}
            {props.duplicates.map((d) => <Link key={d.id} href={`/admin/cms/${d.id}`} style={{ color: C.accent, marginRight: 8 }}>{d.title || d.id}</Link>)}
            <div style={{ color: C.muted, marginTop: 4 }}>Bring this into that job instead, or say why this is a separate job:</div>
            <input value={props.overrideReason} onChange={(e) => props.setOverrideReason(e.target.value)} placeholder="e.g. a separate notice for a different post" style={{ ...inputStyle, marginTop: 6 }} />
          </div>
        )}
        {props.replaced.length > 0 && (
          <div style={{ fontSize: 12, color: C.muted }}>
            Replaced by the corrigendum: {props.replaced.map((r) => `${r.fieldPath} was ${r.fieldPath === "vacancies.table" ? tableInBrief(r.value) : showValue(r.value, r.fieldPath)}`).join("; ")}
          </div>
        )}
        <div data-tick-meaning style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
          <strong style={{ color: C.text }}>A tick means “save this value as Pending in the draft”.</strong> It does not verify anything: you check values against the official notification afterwards, in the job editor. Values that disagree start unticked.
        </div>
      </div>

      {/* Sections */}
      {sections.map((s) => {
        const fields = [...new Set(s.items.map((i) => i.fieldPath))];
        const review = s.items.some((i) => i.conflict || ownFlags(i).length > 0 || i.action === "REPLACE" || i.action === "REPLACE_VERIFIED");
        return (
          <section key={s.name} data-review-section={s.name} style={{ ...PANEL, padding: "12px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{s.name}</div>
              <span style={badge(review ? C.amber : C.green)}>{review ? "Review needed" : "Found"}</span>
            </div>
            {fields.map((path) => {
              const group = s.items.filter((i) => i.fieldPath === path);
              return (
                <div key={path} style={{ borderTop: `1px solid ${C.border}`, padding: "8px 0", display: "grid", gap: 6 }}>
                  {group.length > 1 && group[0].conflict && (
                    <div style={{ fontSize: 12, color: C.red }}>{group[0].label}: the sources disagree — tick one, or none.</div>
                  )}
                  {group.map((i) => (
                    <div key={i.id} data-import-item={i.id} style={{ display: "grid", gridTemplateColumns: "20px minmax(120px, 190px) 1fr", gap: 10, alignItems: "start", fontSize: 13 }}>
                      <input type="checkbox" aria-label={`Save ${i.label} as Pending`} checked={ticked.has(i.id)} onChange={() => props.onToggle(i)} style={{ marginTop: 3 }} />
                      <div style={{ color: C.muted, fontSize: 12, paddingTop: 1 }}>{i.label}</div>
                      <div style={{ minWidth: 0 }}>
                        {i.fieldPath === "vacancies.table"
                          ? <VacancyTableReview table={i.value as VacancyTable} note={sourceById.get(i.claims[0]?.retrievalId ?? "")?.vacancyTables ?? null}
                              pageImageUrl={pageImageUrlOf(sourceById.get(i.claims[0]?.retrievalId ?? ""))} />
                          : <div style={{ color: C.text, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{showValue(i.value, i.fieldPath)}</div>}
                        {(i.action === "REPLACE" || i.action === "REPLACE_VERIFIED") && (
                          <div style={{ fontSize: 12, color: i.action === "REPLACE_VERIFIED" ? C.red : C.amber, marginTop: 2 }}>
                            {i.action === "REPLACE_VERIFIED" ? "Replaces a checked value: " : "Replaces: "}
                            <span style={{ color: C.muted }}>{i.current === undefined ? "—" : i.fieldPath === "vacancies.table" ? tableInBrief(i.current) : showValue(i.current, i.fieldPath)}</span>
                          </div>
                        )}
                        {i.action === "MATCHES" && <div style={{ fontSize: 11, color: C.muted }}>Same as the job has now — adds this source as evidence.</div>}
                        {ownFlags(i).map((f) => <div key={f} style={{ fontSize: 12, color: C.amber, marginTop: 2 }}>⚠ {f}</div>)}
                        <details style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                          <summary style={{ cursor: "pointer" }}>View evidence</summary>
                          {i.claims.map((c, n) => {
                            const imageUrl = c.fromImage && c.page ? pageImageUrlOf(sourceById.get(c.retrievalId))(c.page) : null;
                            return (
                              <div key={n} style={{ marginTop: 4 }}>
                                <span style={{ color: C.text }}>{sourceById.get(c.retrievalId)?.label ?? "source"}</span>{c.page ? `, page ${c.page}` : ""}
                                {c.fromImage && <span style={{ ...badge(C.orange), marginLeft: 6 }}>AI-read from the page image</span>}
                                {c.quote && <div style={{ fontStyle: "italic", overflowWrap: "anywhere" }}>“{c.quote.slice(0, 300)}”</div>}
                                {imageUrl && c.page && (
                                  <details style={{ marginTop: 2 }}>
                                    <summary style={{ cursor: "pointer" }}>See page {c.page} as scanned</summary>
                                    <ScanPageImage url={imageUrl} page={c.page} />
                                  </details>
                                )}
                              </div>
                            );
                          })}
                        </details>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}

      {/* Sources, what was not found or left out, what is kept */}
      <details style={{ ...PANEL, padding: "10px 16px", fontSize: 12, color: C.muted }}>
        <summary style={{ cursor: "pointer", color: C.text }}>Sources{leftOut > 0 ? ` — ${leftOut} value${leftOut === 1 ? "" : "s"} left out` : ""}</summary>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {sources.map((s) => (
            <div key={s.id} style={{ lineHeight: 1.5 }}>
              <span style={{ color: C.text }}>{s.label}</span>
              {s.notFound.length > 0 && <div>Not in it: {s.notFound.join(", ")}</div>}
              {s.refused.length > 0 && <div style={{ color: C.amber }}>Left out (did not pass the checks): {s.refused.map((r) => `${r.fieldPath} — ${r.reason}`).join("; ")}</div>}
              {s.articleSkipped && <div style={{ color: C.amber }}>The whole-text reading did not run: {s.articleSkipped}</div>}
              {s.reading && (() => {
                const w = readingInWords(s.reading);
                return (
                  <div data-reading-coverage>
                    <div>{w.read}.</div>
                    {w.unread.map((u) => <div key={u} style={{ color: C.amber }}>{u}</div>)}
                  </div>
                );
              })()}
            </div>
          ))}
          {props.aiRequests && props.aiRequests.sent > 0 && (
            <div data-ai-requests>AI requests for this preview: {props.aiRequests.sent}{props.aiRequests.retried ? ` (${props.aiRequests.retried} resent after a refusal for load)` : ""}, each counted against the daily allowance.</div>
          )}
          <div>Kept with the job: each source&apos;s text, fingerprint (SHA-256), size, pages and address. Not kept: the original PDF or image.</div>
        </div>
      </details>

      {/* Step 3 */}
      <div style={{ ...PANEL, padding: 16, display: "grid", gap: 8 }}>
        {props.needsVerifiedConfirm && (
          <label style={{ display: "flex", gap: 8, fontSize: 12, color: C.red }}>
            <input type="checkbox" checked={props.confirmVerified} onChange={(e) => props.setConfirmVerified(e.target.checked)} />
            I am replacing values that were checked. They will need checking again.
          </label>
        )}
        {props.err && <div role="alert" style={{ color: C.red, fontSize: 13 }}>{props.err}</div>}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={props.onSave} disabled={props.busy || ticked.size === 0 || (props.needsVerifiedConfirm && !props.confirmVerified)} style={{ ...primaryBtn, opacity: props.busy || ticked.size === 0 ? 0.6 : 1 }}>
            {props.busy ? "Saving…" : `${props.existing ? "Save to the job's draft" : "Save as draft"} (${ticked.size} value${ticked.size === 1 ? "" : "s"})`}
          </button>
          <span style={{ fontSize: 12, color: C.muted }}>Saved together as Pending, or not at all. Nothing is published or verified.</span>
        </div>
      </div>
    </div>
  );
}
