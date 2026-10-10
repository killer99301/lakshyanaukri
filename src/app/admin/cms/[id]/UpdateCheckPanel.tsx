"use client";

// ═══════════════════════════════════════════════════════════
// Admin: check a job for updates
// ═══════════════════════════════════════════════════════════
//
// Asks the AI what is new for this recruitment, from a page the admin gives
// or from a web search, and lists what it proposes: old value, new value,
// where it came from. Nothing is changed until the admin ticks proposals and
// presses the button.
//
// On a published job, "Apply and publish" reopens the record, saves the
// ticked changes as Pending through the normal field route, and publishes
// again. On a draft it only saves, because publishing would also put live
// whatever else is waiting in that draft.

import { useState } from "react";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import { savesFor, tickedByDefault, type UpdateProposal } from "@/lib/cms/update-check";

const C = {
  bg: "#070b16", card: "rgba(14,21,38,0.72)", border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8",
  accent: "#62b5ff", amber: "#d29922", red: "#f85149", green: "#3fb950",
};

interface CheckResult {
  mode: "page" | "search";
  sourceUrl: string | null;
  searchedSites: string[];
  summary: string;
  proposals: UpdateProposal[];
  dropped: number;
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

export function UpdateCheckPanel({ record, onRecordChange }: { record: RecruitmentRecord; onRecordChange: (record: RecruitmentRecord) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (record.draftState === "ARCHIVED") return null;
  const live = record.draftState === "PUBLISHED";

  async function check() {
    setChecking(true);
    setErr(null);
    setDone(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/cms/records/${record.id}/check-updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(url.trim() ? { url: url.trim() } : {}),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? `HTTP ${res.status}`); return; }
      const proposals: UpdateProposal[] = data.proposals ?? [];
      setResult({ mode: data.mode, sourceUrl: data.sourceUrl, searchedSites: data.searchedSites ?? [], summary: data.summary ?? "", proposals, dropped: data.dropped ?? 0 });
      setTicked(new Set(proposals.filter(tickedByDefault).map((p) => p.id)));
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

    if (live) {
      const approved = await call(`/api/admin/cms/records/${record.id}/approve`, { method: "POST" });
      if ("error" in approved) return stop("Could not approve the record", approved.error);
      current = approved.record;
      const published = await call(`/api/admin/cms/records/${record.id}/publish`, { method: "POST" });
      if ("error" in published) return stop("Could not publish", published.error);
      current = published.record;
    }

    onRecordChange(current);
    setDone(live
      ? `${accepted.length} change${accepted.length === 1 ? "" : "s"} applied and published. They are marked Pending until you verify them.`
      : `${accepted.length} change${accepted.length === 1 ? "" : "s"} saved to the draft as Pending. Publish when you are ready.`);
    setResult(null);
    setApplying(false);
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
        Leave the box empty to let the AI search the web, or paste the address of an official page or PDF for it to read. It only proposes; nothing changes until you accept. Each check uses one AI request.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          aria-label="Official page or PDF address (optional)"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… official page or PDF (optional)"
          style={{ flex: "1 1 280px", minWidth: 0, padding: "7px 10px", background: C.bg, border: "1px solid #2b3a5c", borderRadius: 6, color: C.text, fontSize: 13 }}
        />
        <button
          onClick={() => { void check(); }}
          disabled={checking || applying}
          style={{ padding: "7px 16px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: checking || applying ? "wait" : "pointer", opacity: checking || applying ? 0.6 : 1 }}
        >
          {checking ? "Checking…" : url.trim() ? "Read this page" : "Search the web"}
        </button>
      </div>

      {err && <div role="alert" style={{ color: C.red, fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>{err}</div>}
      {done && <div role="status" style={{ color: C.green, fontSize: 12, marginTop: 10 }}>{done}</div>}

      {result && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
            {result.mode === "page"
              ? <>Read from <span style={{ color: C.text }}>{result.sourceUrl}</span>.</>
              : result.searchedSites.length > 0
                ? <>Searched the web. Pages opened: <span style={{ color: C.text }}>{result.searchedSites.slice(0, 8).join(", ")}</span>.</>
                : <>Searched the web, but the search did not report which pages it opened, so no source below could be confirmed.</>}
            {result.summary ? <> {result.summary}</> : null}
          </div>

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
                      <span style={badge(p.official ? C.green : C.amber)}>{p.official ? "Official source" : "Not an official source"}</span>
                      {!p.confirmed && <span style={badge(C.amber)}>{p.kind === "LINK" ? "Open the link before accepting" : "Source not confirmed"}</span>}
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
                  {applying ? "Applying…" : live ? `Apply ${tickedCount} and publish` : `Apply ${tickedCount} to the draft`}
                </button>
                <span style={{ fontSize: 12, color: C.muted }}>
                  {live ? "Reopens the record, saves the ticked changes as Pending, and publishes again." : "Saves the ticked changes as Pending. This record is a draft, so nothing is published."}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
