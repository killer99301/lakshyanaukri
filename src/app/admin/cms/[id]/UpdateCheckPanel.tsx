"use client";

// ═══════════════════════════════════════════════════════════
// Admin: check a job for updates
// ═══════════════════════════════════════════════════════════
//
// Asks the AI what is new for this recruitment, from a source the admin gives
// (an address, pasted text, a PDF or a photo; never a web search: update-
// workflow safety fix, 11 Nov 2026), and lists what it proposes: old value,
// new value, where it came from. Nothing is changed until the admin ticks
// proposals and presses the button.
//
// Applying saves the ticked changes as Pending through the normal field route.
// On a published job it first opens the job for editing, exactly as "Open for
// editing" does; it never approves or publishes. The public keeps the last
// published version until the owner publishes from the publication review,
// which this panel then points to.

import { useState } from "react";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { savesFor, tickedByDefault, type UpdateProposal } from "@/lib/cms/update-check";

const C = {
  bg: "#070b16", card: "rgba(14,21,38,0.72)", border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8",
  accent: "#62b5ff", amber: "#d29922", red: "#f85149", green: "#3fb950",
};

interface CheckResult {
  mode: "page" | "search" | "text" | "pdf" | "photo" | "scan";
  sourceUrl: string | null;
  searchedSites: string[];
  summary: string;
  proposals: UpdateProposal[];
  dropped: number;
  droppedNotes: string[];
}

type Outcome = { record: RecruitmentRecord } | { error: string };

async function call(url: string, init: RequestInit): Promise<Outcome> {
  try {
    const res = await fetch(url, init);
    const data = await res.json();
    if (!res.ok || !data.record) return { error: data.error === "CONFLICT" ? "The record was changed somewhere else. Reload the page." : data.error ?? `HTTP ${res.status}` };
    return { record: data.record as RecruitmentRecord };
  } catch {
    return { error: "Could not reach the server." };
  }
}

const badge = (color: string): React.CSSProperties => ({
  fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color,
  border: `1px solid ${color}55`, background: `${color}14`, borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap",
});

/** A lead's address carried into the check ("?source=…" from Updates needed): an http(s) address, or nothing. */
export function sourceFromSearch(search: string): string {
  const raw = new URLSearchParams(search).get("source") ?? "";
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

export function UpdateCheckPanel({ record, onRecordChange, initialSource = "" }: {
  record: RecruitmentRecord;
  onRecordChange: (record: RecruitmentRecord) => void;
  /** An address brought from an Updates needed lead: shown in the box for the admin to inspect. Never checked automatically. */
  initialSource?: string;
}) {
  const [open, setOpen] = useState(Boolean(initialSource));
  const [url, setUrl] = useState(initialSource);
  const [pasted, setPasted] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (record.draftState === "ARCHIVED") return null;
  const live = record.draftState === "PUBLISHED";

  // With a file, the PDF itself is sent; with pasted text, that text. Either
  // way the address, if given, only records where it came from.
  async function check(file?: File) {
    // A source is required: the AI is never asked to search the web (no grounded or paid requests).
    if (!file && !url.trim() && !pasted.trim()) {
      setErr("Give a source first: the official page or PDF address, the notice text, or an uploaded PDF or photo.");
      return;
    }
    setChecking(true);
    setErr(null);
    setDone(null);
    setResult(null);
    try {
      let res: Response;
      if (file) {
        const form = new FormData();
        form.set("file", file);
        if (url.trim()) form.set("url", url.trim());
        res = await fetch(`/api/admin/cms/records/${record.id}/check-updates`, { method: "POST", body: form });
      } else {
        res = await fetch(`/api/admin/cms/records/${record.id}/check-updates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...(url.trim() ? { url: url.trim() } : {}), ...(pasted.trim() ? { text: pasted.trim() } : {}) }),
        });
      }
      if (res.status === 413) { setErr("This file is larger than 4 MB, which is the most that can be uploaded here."); return; }
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? `HTTP ${res.status}`); return; }
      const proposals: UpdateProposal[] = data.proposals ?? [];
      setResult({ mode: data.mode, sourceUrl: data.sourceUrl, searchedSites: data.searchedSites ?? [], summary: data.summary ?? "", proposals, dropped: data.dropped ?? 0, droppedNotes: data.droppedNotes ?? [] });
      setTicked(new Set(proposals.filter(tickedByDefault).map((p) => p.id)));
      setPasted("");
    } catch {
      setErr("Could not reach the server.");
    } finally {
      setChecking(false);
    }
  }

  async function apply() {
    if (!result) return;
    const accepted = result.proposals.filter((p) => ticked.has(p.id));
    if (accepted.length === 0) return;
    setApplying(true);
    setErr(null);
    setDone(null);

    let current = record;
    let saved = 0;
    const stop = (where: string, why: string) => {
      onRecordChange(current);
      setErr(
        `${where}: ${why} ` +
        (current.draftState === "PUBLISHED"
          ? "Nothing was changed."
          : `${saved} change${saved === 1 ? " is" : "s are"} saved in the draft and nothing new is public yet. Finish from the record itself.`),
      );
      setApplying(false);
    };

    if (live) {
      const out = await call(`/api/admin/cms/records/${record.id}/revert`, { method: "POST" });
      if ("error" in out) return stop("Could not open the record for editing", out.error);
      current = out.record;
    }

    for (const save of savesFor(current, accepted)) {
      const out = await call(`/api/admin/cms/records/${record.id}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldPath: save.fieldPath,
          field: { value: save.value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: false },
          clientRevision: current.recordRevision,
          reason: save.reason,
        }),
      });
      if ("error" in out) return stop("A change could not be saved", out.error.replace(/^.*invariant:\s*/, ""));
      current = out.record;
      saved++;
    }

    onRecordChange(current);
    setDone(live
      ? `${accepted.length} change${accepted.length === 1 ? "" : "s"} saved to the draft as Pending. The live page is unchanged until you publish from the publication review.`
      : `${accepted.length} change${accepted.length === 1 ? "" : "s"} saved to the draft as Pending. Publish from the publication review when you are ready.`);
    setResult(null);
    setApplying(false);
    // Nothing is approved or published here: the owner's publication review is where it goes live.
    document.querySelector("[data-publication-review]")?.scrollIntoView({ block: "start" });
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 16 }}>
        <button
          onClick={() => setOpen(true)}
          title="Asks the AI what is new for this recruitment and lists proposed changes. Nothing changes until you accept them."
          style={{ background: "none", border: `1px dashed ${C.border}`, color: C.accent, cursor: "pointer", fontSize: 12, padding: "6px 12px", borderRadius: 6 }}
        >
          Check for updates
        </button>
        {done && <span role="status" style={{ color: C.green, fontSize: 12, marginLeft: 10 }}>{done}</span>}
      </div>
    );
  }

  const tickedCount = result ? result.proposals.filter((p) => ticked.has(p.id)).length : 0;

  return (
    <section aria-label="Check for updates" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5ff" }}>Check for updates</span>
        <button onClick={() => { setOpen(false); setResult(null); setErr(null); }} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 12 }}>Close</button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, margin: "6px 0 10px", lineHeight: 1.5 }}>
        Give a source: the address of an official page or PDF for the site to fetch; when the official site blocks that, paste the notice text or upload the PDF yourself; or upload a photo of a newspaper cutting. It only proposes; nothing changes until you accept, and nothing goes live until you publish from the publication review. Each check uses one AI request.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          aria-label="Official page or PDF address"
          data-check-source
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… official page or PDF"
          style={{ flex: "1 1 280px", minWidth: 0, padding: "7px 10px", background: C.bg, border: "1px solid #2b3a5c", borderRadius: 6, color: C.text, fontSize: 13 }}
        />
        <button
          onClick={() => { void check(); }}
          disabled={checking || applying || (!url.trim() && !pasted.trim())}
          data-check-button
          style={{ padding: "7px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: checking || applying ? "wait" : "pointer", opacity: checking || applying || (!url.trim() && !pasted.trim()) ? 0.5 : 1 }}
        >
          {checking ? "Checking…" : pasted.trim() ? "Read the pasted text" : url.trim() ? "Read this page" : "Give a source to check"}
        </button>
      </div>
      <textarea
        aria-label="Notice text (optional)"
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        placeholder="Or paste the text of the notice here (copy it from the official page or PDF)"
        style={{ width: "100%", height: pasted ? 140 : 44, marginTop: 8, padding: "7px 10px", background: C.bg, border: "1px solid #2b3a5c", borderRadius: 6, color: C.text, fontSize: 12, boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }}
      />
      <label style={{ display: "inline-block", marginTop: 6, fontSize: 12, color: checking || applying ? C.muted : C.accent, cursor: checking || applying ? "wait" : "pointer" }}>
        or upload the notice PDF, or a photo of a newspaper cutting (up to 4 MB)
        <input
          type="file"
          accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
          disabled={checking || applying}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void check(f); }}
          style={{ display: "none" }}
        />
      </label>

      {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>{err}</div>}
      {done && <div role="status" style={{ color: C.green, fontSize: 12, marginTop: 10 }}>{done}</div>}

      {result && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
            {result.mode === "photo" || result.mode === "scan"
              ? <>Read by the AI from the {result.mode === "photo" ? "photo" : "scanned PDF"} you uploaded. A picture cannot be checked word for word, so nothing below is ticked for you: compare each one with the cutting before you accept it.</>
              : result.mode === "text" || result.mode === "pdf"
              ? <>Read from the {result.mode === "pdf" ? "PDF you uploaded" : "text you pasted"}{result.sourceUrl ? <> (<span style={{ color: C.text }}>{result.sourceUrl}</span>)</> : null}.</>
              : result.mode === "page"
              ? <>Read from <span style={{ color: C.text }}>{result.sourceUrl}</span>.</>
              : result.searchedSites.length > 0
                ? <>Searched the web. Pages opened: <span style={{ color: C.text }}>{result.searchedSites.slice(0, 8).join(", ")}</span>.</>
                : <>Searched the web, but the search did not report which pages it opened, so no source below could be confirmed.</>}
            {result.summary ? <> {result.summary}</> : null}
          </div>

          {result.droppedNotes.length > 0 && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
              Left out, because it was already on the record or not in a form the site can use: {result.droppedNotes.map((n) => `“${n}”`).join("; ")}
            </div>
          )}

          {result.proposals.length === 0 ? (
            <div role="status" style={{ fontSize: 13, color: C.text, marginTop: 10 }}>
              Nothing new was found{result.dropped > 0 ? ` (${result.dropped} suggestion${result.dropped === 1 ? " was" : "s were"} already on the record or unusable)` : ""}. That is not proof nothing changed: check the official site if this job is due for news.
            </div>
          ) : (
            <>
              {result.proposals.map((p) => (
                <label key={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", borderTop: `1px solid ${C.border}`, padding: "10px 0", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={ticked.has(p.id)}
                    onChange={(e) => setTicked((prev) => { const next = new Set(prev); if (e.target.checked) next.add(p.id); else next.delete(p.id); return next; })}
                    style={{ marginTop: 3 }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{p.label}</span>
                      <span style={badge(p.official ? C.green : p.supplied && !p.sourceHost ? C.muted : C.amber)}>{p.official ? "Official source" : p.supplied && !p.sourceHost ? "From what you supplied" : "Not an official source"}</span>
                      {!p.confirmed && <span style={badge(C.amber)}>{p.kind === "LINK" ? "Open the link before accepting" : result.mode === "photo" || result.mode === "scan" ? "Compare with the picture" : "Source not confirmed"}</span>}
                    </div>
                    <div style={{ fontSize: 13, color: C.text, marginTop: 4, overflowWrap: "anywhere" }}>
                      <span style={{ color: C.muted }}>{p.oldText}</span> → <b>{p.kind === "LINK" ? <a href={p.newText} target="_blank" rel="noreferrer" style={{ color: C.accent }}>{p.newText}</a> : p.newText}</b>
                    </div>
                    {(p.evidence || p.sourceHost) && (
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5, overflowWrap: "anywhere" }}>
                        {p.evidence ? <>“{p.evidence}”</> : null}{p.sourceHost ? <> — {p.sourceHost}</> : null}
                      </div>
                    )}
                  </div>
                </label>
              ))}
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                <button
                  onClick={() => { void apply(); }}
                  disabled={applying || tickedCount === 0}
                  style={{ padding: "7px 18px", background: "linear-gradient(135deg, #f97316, #fb7185)", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: applying || tickedCount === 0 ? "not-allowed" : "pointer", opacity: applying || tickedCount === 0 ? 0.6 : 1 }}
                >
                  {applying ? "Applying…" : `Apply ${tickedCount} to the draft`}
                </button>
                <span style={{ fontSize: 12, color: C.muted }}>
                  {live ? "Opens the job for editing and saves the ticked changes as Pending. The live page stays as it is until you publish from the publication review." : "Saves the ticked changes as Pending. Nothing is published until you publish from the publication review."}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
