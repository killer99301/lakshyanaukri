"use client";

// ═══════════════════════════════════════════════════════════
// Admin: import a job from several sources at once
// ═══════════════════════════════════════════════════════════
//
// Add sources (official PDF, official page, ChatGPT or portal research),
// make a preview, tick what to keep, apply. Nothing is saved before Apply,
// every saved value is Pending, and an imported job cannot be published until
// a person has checked its critical fields on the job's page.
// With ?record=<id> it imports into that job instead of creating one.

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { C, PANEL, badge, inputStyle, labelStyle, primaryBtn, quietBtn, showValue } from "./ui";

type Kind = "OFFICIAL_NOTIFICATION" | "OFFICIAL_CORRIGENDUM" | "OFFICIAL_PAGE" | "RESEARCH" | "OTHER";
type Method = "paste" | "upload" | "url";

interface SourceDraft {
  key: number;
  declaredKind: Kind;
  method: Method;
  url: string;
  text: string;
  file: File | null;
  attest: boolean;
  attestation: string;
  versionLabel: string;
  documentDate: string;
  /** Text the scan reader wrote out for an uploaded scan. */
  scanText: string;
}

interface Claim { retrievalId: string; quote?: string; page?: number | null }
interface Item {
  id: string; kind: "FIELD" | "LINK"; fieldPath: string; label: string; value: unknown; claims: Claim[];
  action: "FILL" | "MATCHES" | "REPLACE" | "REPLACE_VERIFIED"; conflict: boolean; supersedes: string[];
  defaultTicked: boolean; flags: string[]; current?: unknown;
}
interface SourceMeta {
  id: string; label: string; declaredKind: Kind; authenticity: string; originRole: string; method: string; originUrl: string | null;
  notFound: string[]; refused: Array<{ fieldPath: string; reason: string }>; summary: string | null; articleSkipped?: string;
}
interface Preview {
  importId: string;
  proposal: { items: Item[]; replacedInImport: Array<{ fieldPath: string; value: unknown; by: string }>; warnings?: string[]; meta: { sources: SourceMeta[]; duplicates: Array<{ id: string; title: string; reason: string }> } };
}

const KIND_LABELS: Record<Kind, string> = {
  OFFICIAL_NOTIFICATION: "Official notification",
  OFFICIAL_CORRIGENDUM: "Corrigendum / revised notice",
  OFFICIAL_PAGE: "Official web page",
  RESEARCH: "Research (ChatGPT, Claude, a portal)",
  OTHER: "Other",
};
const ACTION_LOOK: Record<Item["action"], { label: string; color: string }> = {
  FILL: { label: "Fill", color: C.green },
  MATCHES: { label: "Same as now — adds evidence", color: C.muted },
  REPLACE: { label: "Replace", color: C.amber },
  REPLACE_VERIFIED: { label: "Replace a verified value", color: C.red },
};
const AUTH_LOOK: Record<string, { label: string; color: string }> = {
  CONFIRMED: { label: "Confirmed", color: C.green },
  ATTESTED: { label: "Attested by you", color: C.amber },
  UNCONFIRMED: { label: "Not confirmed", color: C.red },
  NOT_APPLICABLE: { label: "Research — never official", color: C.orange },
};

let nextKey = 1;
const newSource = (declaredKind: Kind, method: Method): SourceDraft => ({
  key: nextKey++, declaredKind, method, url: "", text: "", file: null, attest: false, attestation: "", versionLabel: "", documentDate: "", scanText: "",
});

export default function ImportPage() {
  return (
    <Suspense fallback={<div style={{ color: C.muted, padding: 40 }}>Loading…</div>}>
      <Importer />
    </Suspense>
  );
}

function SwitchPanel({ on, onChange }: { on: boolean | null; onChange: (on: boolean) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const flip = async () => {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/admin/cms/import/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: !on, confirm: true }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    setConfirming(false);
    if (!res.ok) { setErr(d.error ?? `HTTP ${res.status}`); return; }
    onChange(d.on === true);
  };
  if (on === null) return null;
  return (
    <div data-importer-switch style={{ ...PANEL, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: C.text }}>
      <span style={badge(on ? C.green : C.muted)}>{on ? "Importer on" : "Importer off"}</span>
      <span style={{ flex: "1 1 300px", color: C.muted, fontSize: 12 }}>
        {on ? "Admins can make previews and apply imports. Switching off takes effect at once; imported jobs stay checkable and gated."
          : "The importer is off: nothing can be imported. The rest of the CMS works as usual."}
      </span>
      {!confirming ? (
        <button onClick={() => setConfirming(true)} style={quietBtn}>{on ? "Switch off" : "Switch on"}</button>
      ) : (
        <span style={{ display: "flex", gap: 6 }}>
          <button onClick={() => { void flip(); }} disabled={busy} style={{ ...quietBtn, borderColor: C.amber, color: C.amber }}>{busy ? "…" : on ? "Yes, switch off" : "Yes, switch on"}</button>
          <button onClick={() => setConfirming(false)} style={{ ...quietBtn, color: C.muted, borderColor: C.border }}>Cancel</button>
        </span>
      )}
      {err && <span role="alert" style={{ color: C.red, fontSize: 12, width: "100%" }}>{err}</span>}
    </div>
  );
}

function SourceEditor({ s, onChange, onRemove, subject }: { s: SourceDraft; onChange: (s: SourceDraft) => void; onRemove: () => void; subject: string }) {
  const [reading, setReading] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);
  const official = s.declaredKind !== "RESEARCH";
  const readScan = async () => {
    if (!s.file) return;
    setReading(true);
    setReadErr(null);
    const f = new FormData();
    f.set("file", s.file);
    f.set("subject", subject);
    const res = await fetch("/api/admin/cms/import/read-scan", { method: "POST", body: f });
    const d = await res.json().catch(() => ({}));
    setReading(false);
    if (!res.ok) { setReadErr(d.error ?? `HTTP ${res.status}`); return; }
    onChange({ ...s, scanText: d.text });
  };
  return (
    <div data-import-source style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
        <label><span style={labelStyle}>What it is</span>
          <select value={s.declaredKind} onChange={(e) => onChange({ ...s, declaredKind: e.target.value as Kind })} style={inputStyle}>
            {(Object.keys(KIND_LABELS) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </label>
        <label><span style={labelStyle}>How it comes in</span>
          <select value={s.method} onChange={(e) => onChange({ ...s, method: e.target.value as Method })} style={inputStyle}>
            <option value="paste">Paste the text</option>
            <option value="upload">Upload a PDF, photo or screenshot</option>
            <option value="url">Address — the server fetches it</option>
          </select>
        </label>
        <button onClick={onRemove} style={{ ...quietBtn, color: C.muted, borderColor: C.border }}>Remove</button>
      </div>

      {(s.method === "url" || official) && (
        <label><span style={labelStyle}>{s.method === "url" ? "Address" : "Where it came from (its address)"}</span>
          <input type="url" value={s.url} onChange={(e) => onChange({ ...s, url: e.target.value })} placeholder="https://…" style={inputStyle} />
        </label>
      )}
      {s.method === "paste" && (
        <label><span style={labelStyle}>{s.declaredKind === "RESEARCH" ? "Paste the research (the whole ChatGPT or Claude answer)" : "Paste the text of the notice"}</span>
          <textarea value={s.text} onChange={(e) => onChange({ ...s, text: e.target.value })} rows={8} style={{ ...inputStyle, resize: "vertical" }} />
        </label>
      )}
      {s.method === "upload" && (
        <div style={{ display: "grid", gap: 6 }}>
          <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => onChange({ ...s, file: e.target.files?.[0] ?? null, scanText: "" })} style={{ color: C.text, fontSize: 12 }} />
          {s.file && s.file.type.startsWith("image/") ? (
            <span style={{ fontSize: 11, color: C.muted }}>Up to 4 MB. The AI writes out what the image shows when you make the preview; compare every value with the image before checking it.</span>
          ) : (
            <span style={{ fontSize: 11, color: C.muted }}>
              Up to 4 MB. A scan without a text layer needs reading first:{" "}
              <button onClick={() => { void readScan(); }} disabled={!s.file || reading} style={{ ...quietBtn, padding: "2px 8px" }}>{reading ? "Reading…" : "Read the scan"}</button>
              {s.scanText && <span style={{ color: C.green }}> — read ({s.scanText.length.toLocaleString("en-IN")} characters)</span>}
            </span>
          )}
          {readErr && <span role="alert" style={{ color: C.red, fontSize: 12 }}>{readErr}</span>}
        </div>
      )}
      {official && s.method !== "url" && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: C.muted }}>
          <input type="checkbox" checked={s.attest} onChange={(e) => onChange({ ...s, attest: e.target.checked })} style={{ marginTop: 2 }} />
          <span>The official site blocks the server, so I downloaded or copied this myself from the address above.
            {s.attest && (
              <input value={s.attestation} onChange={(e) => onChange({ ...s, attestation: e.target.value })} placeholder="e.g. Downloaded from rrbcdg.gov.in on 25 Oct 2026; the site blocks automated access" style={{ ...inputStyle, marginTop: 6 }} />
            )}
          </span>
        </label>
      )}
      {s.declaredKind === "OFFICIAL_CORRIGENDUM" && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
          <label><span style={labelStyle}>Version</span><input value={s.versionLabel} onChange={(e) => onChange({ ...s, versionLabel: e.target.value })} placeholder="Corrigendum 1" style={inputStyle} /></label>
          <label><span style={labelStyle}>Dated</span><input type="date" value={s.documentDate} onChange={(e) => onChange({ ...s, documentDate: e.target.value })} style={inputStyle} /></label>
        </div>
      )}
    </div>
  );
}

function Importer() {
  const params = useSearchParams();
  const recordId = params.get("record");
  const [on, setOn] = useState<boolean | null>(null);
  const [job, setJob] = useState<{ title: string; draftState: string } | null>(null);
  const [newJob, setNewJob] = useState({ organizationId: "", organizationName: "", recruitmentYear: String(new Date().getFullYear()), title: "", govType: "Central Govt", notificationNumber: "" });
  const [sources, setSources] = useState<SourceDraft[]>([newSource("OFFICIAL_NOTIFICATION", "upload"), newSource("RESEARCH", "paste")]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [confirmVerified, setConfirmVerified] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [applied, setApplied] = useState<{ recruitmentId: string; replayed: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/admin/cms/import/switch").then((r) => r.json()).then((d) => setOn(d.on === true)).catch(() => setOn(false));
    if (recordId) {
      fetch(`/api/admin/cms/records/${recordId}`).then((r) => r.json()).then((d) => {
        const r = d.record ?? d;
        setJob({ title: r.identity?.title?.value ?? "", draftState: r.draftState });
      }).catch(() => setJob(null));
    }
  }, [recordId]);

  const subject = recordId ? job?.title ?? "" : `${newJob.title} — ${newJob.organizationName}`;

  const makePreview = useCallback(async () => {
    setBusy(true);
    setErr(null);
    setPreview(null);
    setApplied(null);
    const f = new FormData();
    f.set("mode", recordId ? "EXISTING" : "NEW");
    if (recordId) f.set("recordId", recordId);
    if (recordId) f.set("recruitmentId", recordId);
    else f.set("newJob", JSON.stringify({ ...newJob, recruitmentYear: Number(newJob.recruitmentYear), notificationNumber: newJob.notificationNumber || undefined }));
    const list = sources.map((s, i) => {
      if (s.method === "upload" && s.file) f.set(`file${i}`, s.file);
      return {
        declaredKind: s.declaredKind, method: s.method, url: s.url || undefined,
        text: s.method === "paste" ? s.text : s.scanText || undefined,
        file: s.method === "upload" ? `file${i}` : undefined,
        attestation: s.attest ? s.attestation : undefined,
        versionLabel: s.versionLabel || undefined, documentDate: s.documentDate || undefined,
      };
    });
    f.set("sources", JSON.stringify(list));
    const res = await fetch("/api/admin/cms/import/preview", { method: "POST", body: f });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(d.error ?? `HTTP ${res.status}`); return; }
    setPreview(d as Preview);
    setTicked(new Set((d as Preview).proposal.items.filter((i) => i.defaultTicked).map((i) => i.id)));
    setConfirmVerified(false);
  }, [newJob, recordId, sources]);

  const items = useMemo(() => preview?.proposal.items ?? [], [preview]);
  const sourceById = useMemo(() => new Map((preview?.proposal.meta.sources ?? []).map((s) => [s.id, s])), [preview]);
  const toggle = (item: Item) => setTicked((prev) => {
    const next = new Set(prev);
    if (next.has(item.id)) next.delete(item.id);
    else {
      // Conflicting values: one at most.
      if (item.conflict) for (const other of items) if (other.fieldPath === item.fieldPath && other.id !== item.id) next.delete(other.id);
      next.add(item.id);
    }
    return next;
  });
  const needsVerifiedConfirm = items.some((i) => ticked.has(i.id) && i.action === "REPLACE_VERIFIED");
  const duplicates = preview?.proposal.meta.duplicates ?? [];

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/admin/cms/import/${preview.importId}/apply`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ selected: [...ticked], confirmReplaceVerified: confirmVerified, ...(overrideReason.trim() ? { override: { reason: overrideReason.trim() } } : {}) }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(d.error ?? `HTTP ${res.status}`); return; }
    setApplied(d);
  };
  const discard = async () => {
    if (!preview) return;
    await fetch(`/api/admin/cms/import/${preview.importId}/discard`, { method: "POST" });
    setPreview(null);
  };

  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) m.set(i.fieldPath, [...(m.get(i.fieldPath) ?? []), i]);
    return [...m.entries()];
  }, [items]);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#f1f5ff", margin: 0 }}>{recordId ? "Smart intake into this job" : "Smart intake"}</h1>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4, maxWidth: 760, lineHeight: 1.5 }}>
            Paste a whole article or ChatGPT answer, upload the notice PDF or a screenshot, or give an address. Every section of the job is filled from what they say; you tick what to keep. Values are saved as Pending, and the job cannot be published until you check its critical fields against the official notice. AI Assist and manual entry work as before.
          </div>
          <div data-import-retention style={{ fontSize: 11, color: C.muted, marginTop: 6, maxWidth: 760, lineHeight: 1.5 }}>
            Kept: the text of each source, its fingerprint (SHA-256), size, pages and address. Not kept: the original PDF or image file, so keep your own copy if you may need it again.
          </div>
        </div>
        <Link href={recordId ? `/admin/cms/${recordId}` : "/admin/cms"} style={{ color: C.accent, fontSize: 13, textDecoration: "none" }}>← {recordId ? "Back to the job" : "All jobs"}</Link>
      </div>

      <SwitchPanel on={on} onChange={setOn} />

      {on === null ? <div style={{ color: C.muted, fontSize: 13 }}>Checking the importer switch…</div> : on === false ? null : applied ? (
        <div data-import-applied style={{ ...PANEL, padding: 18, color: C.text, fontSize: 14, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, color: C.green }}>{applied.replayed ? "This import was already applied." : "Applied."} Nothing is published.</div>
          <div style={{ color: C.muted, fontSize: 13 }}>Open the job and work through “Check before publishing”: every critical field needs a person’s check against the official document.</div>
          <Link href={`/admin/cms/${applied.recruitmentId}`} style={{ ...primaryBtn, display: "inline-block", marginTop: 12, textDecoration: "none" }}>Open the job</Link>
        </div>
      ) : (
        <>
          {/* The job */}
          <div style={{ ...PANEL, padding: 16, marginBottom: 16 }}>
            {recordId ? (
              <div style={{ color: C.text, fontSize: 14 }}>
                <span style={labelStyle}>Importing into</span>
                <strong>{job?.title || "…"}</strong>
                {job && job.draftState !== "DRAFT" && job.draftState !== "APPROVED" && (
                  <div role="alert" style={{ color: C.amber, fontSize: 12, marginTop: 6 }}>This job is live. Open it for editing on its page first.</div>
                )}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                <label><span style={labelStyle}>Title</span><input value={newJob.title} onChange={(e) => setNewJob({ ...newJob, title: e.target.value })} placeholder="LIC HFL Apprentice Recruitment 2026" style={inputStyle} /></label>
                <label><span style={labelStyle}>Organisation name</span><input value={newJob.organizationName} onChange={(e) => setNewJob({ ...newJob, organizationName: e.target.value })} placeholder="LIC Housing Finance Limited" style={inputStyle} /></label>
                <label><span style={labelStyle}>Organisation ID</span><input value={newJob.organizationId} onChange={(e) => setNewJob({ ...newJob, organizationId: e.target.value.toLowerCase() })} placeholder="lic-hfl" style={inputStyle} /></label>
                <label><span style={labelStyle}>Year</span><input value={newJob.recruitmentYear} onChange={(e) => setNewJob({ ...newJob, recruitmentYear: e.target.value })} inputMode="numeric" style={inputStyle} /></label>
                <label><span style={labelStyle}>Government type</span>
                  <select value={newJob.govType} onChange={(e) => setNewJob({ ...newJob, govType: e.target.value })} style={inputStyle}>
                    <option>Central Govt</option><option>State Govt</option><option>PSU</option>
                  </select>
                </label>
                <label><span style={labelStyle}>Notification number (if known)</span><input value={newJob.notificationNumber} onChange={(e) => setNewJob({ ...newJob, notificationNumber: e.target.value })} style={inputStyle} /></label>
              </div>
            )}
          </div>

          {/* Sources */}
          <div style={{ ...PANEL, padding: 16, marginBottom: 16, display: "grid", gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#c7d2e6" }}>Sources</div>
            {sources.map((s) => (
              <SourceEditor key={s.key} s={s} subject={subject}
                onChange={(n) => setSources((all) => all.map((x) => (x.key === s.key ? n : x)))}
                onRemove={() => setSources((all) => all.filter((x) => x.key !== s.key))} />
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {sources.length < 4 && <button onClick={() => setSources((all) => [...all, newSource("OFFICIAL_PAGE", "url")])} style={quietBtn}>+ Add a source</button>}
              <button onClick={() => { void makePreview(); }} disabled={busy || sources.length === 0} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy && !preview ? "Reading the sources…" : "Make the preview"}</button>
            </div>
            {err && !preview && <div role="alert" style={{ color: C.red, fontSize: 13 }}>{err}</div>}
          </div>

          {/* Preview */}
          {preview && (
            <div data-import-preview style={{ ...PANEL, padding: 16, display: "grid", gap: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#c7d2e6" }}>Preview — nothing is saved yet</div>

              {(preview.proposal.warnings ?? []).length > 0 && (
                <div data-import-warnings role="alert" style={{ border: `1px solid ${C.amber}66`, background: `${C.amber}12`, borderRadius: 8, padding: 10, fontSize: 12, color: C.text, display: "grid", gap: 4 }}>
                  {(preview.proposal.warnings ?? []).map((w) => <div key={w}>⚠ {w}</div>)}
                </div>
              )}

              <div style={{ display: "grid", gap: 8 }}>
                {preview.proposal.meta.sources.map((s) => (
                  <div key={s.id} style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>
                    <span style={badge((AUTH_LOOK[s.authenticity] ?? AUTH_LOOK.UNCONFIRMED).color)}>{(AUTH_LOOK[s.authenticity] ?? AUTH_LOOK.UNCONFIRMED).label}</span>{" "}
                    {s.label}
                    {s.notFound.length > 0 && <div style={{ color: C.muted }}>Not found in it: {s.notFound.join(", ")}</div>}
                    {s.refused.length > 0 && <div style={{ color: C.amber }}>Left out: {s.refused.map((r) => `${r.fieldPath} (${r.reason})`).join("; ")}</div>}
                    {s.articleSkipped && <div style={{ color: C.amber }}>The whole-text reading did not run: {s.articleSkipped}</div>}
                  </div>
                ))}
              </div>

              {duplicates.length > 0 && (
                <div role="alert" style={{ border: `1px solid ${C.red}66`, background: `${C.red}12`, borderRadius: 8, padding: 10, fontSize: 12, color: C.text }}>
                  <strong>A job like this already exists:</strong>{" "}
                  {duplicates.map((d) => <Link key={d.id} href={`/admin/cms/${d.id}`} style={{ color: C.accent, marginRight: 8 }}>{d.title || d.id}</Link>)}
                  <div style={{ color: C.muted, marginTop: 4 }}>Import into that job instead, or say why this is a separate job:</div>
                  <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. a separate notice for a different post" style={{ ...inputStyle, marginTop: 6 }} />
                </div>
              )}

              {preview.proposal.replacedInImport.length > 0 && (
                <div style={{ fontSize: 12, color: C.muted }}>
                  Replaced by the corrigendum: {preview.proposal.replacedInImport.map((r) => `${r.fieldPath} was ${showValue(r.value)}`).join("; ")}
                </div>
              )}

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>{["", "Field", "Proposed", "Now", "Sources"].map((h) => (
                      <th key={h} style={{ textAlign: "left", color: C.muted, fontWeight: 600, padding: "6px 8px 6px 0", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {groups.flatMap(([, group]) => group.map((i, k) => (
                      <tr key={i.id} data-import-item={i.id} style={{ verticalAlign: "top", borderTop: k === 0 ? `1px solid ${C.border}` : "none" }}>
                        <td style={{ padding: "8px 8px 8px 0" }}>
                          <input type="checkbox" aria-label={`Keep ${i.label}`} checked={ticked.has(i.id)} onChange={() => toggle(i)} />
                        </td>
                        <td style={{ padding: "8px 8px 8px 0", color: C.text, minWidth: 140 }}>
                          {k === 0 && <strong>{i.label}</strong>}
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                            <span style={badge(ACTION_LOOK[i.action].color)}>{ACTION_LOOK[i.action].label}</span>
                            {i.conflict && <span style={badge(C.red)}>Sources disagree — pick one</span>}
                          </div>
                        </td>
                        <td style={{ padding: "8px 8px 8px 0", color: C.text, whiteSpace: "pre-wrap", maxWidth: 340, overflowWrap: "anywhere" }}>
                          {showValue(i.value)}
                          {i.flags.map((f) => <div key={f} style={{ color: C.amber, marginTop: 4 }}>⚠ {f}</div>)}
                        </td>
                        <td style={{ padding: "8px 8px 8px 0", color: C.muted, whiteSpace: "pre-wrap", maxWidth: 220, overflowWrap: "anywhere" }}>{i.current === undefined ? "—" : showValue(i.current)}</td>
                        <td style={{ padding: "8px 0", color: C.muted, maxWidth: 300 }}>
                          {i.claims.map((c, n) => (
                            <div key={n} style={{ marginBottom: 4 }}>
                              <span style={{ color: C.text }}>{sourceById.get(c.retrievalId)?.label ?? "source"}</span>
                              {c.page ? `, p.${c.page}` : ""}
                              {c.quote && <div style={{ fontStyle: "italic", overflowWrap: "anywhere" }}>“{c.quote.slice(0, 220)}”</div>}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>

              {needsVerifiedConfirm && (
                <label style={{ display: "flex", gap: 8, fontSize: 12, color: C.red }}>
                  <input type="checkbox" checked={confirmVerified} onChange={(e) => setConfirmVerified(e.target.checked)} />
                  I am replacing values that were verified. They will need checking again.
                </label>
              )}
              {err && <div role="alert" style={{ color: C.red, fontSize: 13 }}>{err}</div>}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => { void apply(); }} disabled={busy || ticked.size === 0 || (needsVerifiedConfirm && !confirmVerified)} style={{ ...primaryBtn, opacity: busy || ticked.size === 0 ? 0.6 : 1 }}>
                  {busy ? "Applying…" : `Apply ${ticked.size} ticked item${ticked.size === 1 ? "" : "s"}`}
                </button>
                <button onClick={() => { void discard(); }} disabled={busy} style={{ ...quietBtn, color: C.muted, borderColor: C.border }}>Discard the preview</button>
                <span style={{ fontSize: 11, color: C.muted }}>Applied in one step: either everything ticked is saved, or nothing is.</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
