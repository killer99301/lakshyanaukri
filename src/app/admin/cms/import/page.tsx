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

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DiscoverPanel, type FoundJob } from "./DiscoverPanel";
import { ReviewPanel } from "./ReviewPanel";
import { OpenReadings, ReadingJobPanel, describePdf } from "./ReadingJob";
import { C, PANEL, badge, inputStyle, labelStyle, primaryBtn, quietBtn } from "./ui";

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
  proposal: { items: Item[]; replacedInImport: Array<{ fieldPath: string; value: unknown; by: string }>; warnings?: string[]; meta: { sources: SourceMeta[]; duplicates: Array<{ id: string; title: string; reason: string }>; aiRequests?: { sent: number; retried: number; failed: number } } };
}

const KIND_LABELS: Record<Kind, string> = {
  OFFICIAL_NOTIFICATION: "Official notification",
  OFFICIAL_CORRIGENDUM: "Corrigendum / revised notice",
  OFFICIAL_PAGE: "Official web page",
  RESEARCH: "Research (ChatGPT, Claude, a portal)",
  OTHER: "Other",
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
  // ?url=… (from "Find jobs on a page"): that page comes in as research.
  const startUrl = params.get("url");
  const [sources, setSources] = useState<SourceDraft[]>(() => startUrl
    ? [{ ...newSource("RESEARCH", "url"), url: startUrl }, newSource("OFFICIAL_NOTIFICATION", "upload")]
    : [newSource("OFFICIAL_NOTIFICATION", "upload"), newSource("RESEARCH", "paste")]);
  const pickFound = (f: FoundJob) => {
    const kind: Kind = !f.official ? "RESEARCH" : /\.pdf(\?|$)/i.test(f.url) ? "OFFICIAL_NOTIFICATION" : "OFFICIAL_PAGE";
    // "BTSC FSO Recruitment 2026 Notification Out For 105 Posts, Apply Online" → "BTSC FSO Recruitment 2026"
    const title = f.title.replace(/\s+(notification\s+)?out\b.*$/i, "").replace(/,.*$/, "").trim() || f.title;
    setNewJob((n) => ({ ...n, title: title.slice(0, 160) }));
    setSources([{ ...newSource(kind, "url"), url: f.url }, newSource("OFFICIAL_NOTIFICATION", "upload")]);
    setPreview(null);
    document.querySelector("[data-import-job]")?.scrollIntoView({ block: "start" });
  };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [confirmVerified, setConfirmVerified] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [applied, setApplied] = useState<{ recruitmentId: string; replayed: boolean } | null>(null);
  // A long document's reading (stage B2.3): its id is in the address (?job=…), so a reload or a return carries on.
  const jobParam = params.get("job");
  const [reading, setReading] = useState<{ id: string; files: Map<number, File> } | null>(() => (jobParam ? { id: jobParam, files: new Map() } : null));
  const [readingTitle, setReadingTitle] = useState("");
  const setJobInAddress = (jobId: string | null) => {
    const url = new URL(window.location.href);
    if (jobId) url.searchParams.set("job", jobId); else url.searchParams.delete("job");
    window.history.replaceState(null, "", url);
  };
  const onReadingPreview = (d: { importId: string; proposal: unknown }, title: string | null) => {
    const pv = d as Preview;
    setPreview(pv);
    setTicked(new Set(pv.proposal.items.filter((i) => i.defaultTicked).map((i) => i.id)));
    setConfirmVerified(false);
    if (title) setReadingTitle(title);
  };

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

  /** PDFs (split in this browser) and pasted text are read as a reading job: any size, in steps, resumable. */
  const isPdf = (s: SourceDraft) => s.method === "upload" && !!s.file && (s.file.type === "application/pdf" || /\.pdf$/i.test(s.file.name)) && !s.scanText;
  const startReading = async () => {
    setBusy(true);
    setErr(null);
    setPreview(null);
    setApplied(null);
    try {
      const files = new Map<number, File>();
      const list: Array<Record<string, unknown>> = [];
      for (const [i, s] of sources.entries()) {
        const base = { declaredKind: s.declaredKind, url: s.url || undefined, attestation: s.attest ? s.attestation : undefined, versionLabel: s.versionLabel || undefined, documentDate: s.documentDate || undefined };
        if (s.method === "paste") { list.push({ ...base, pastedText: s.text }); continue; }
        const d = await describePdf(s.file!); // an encrypted or damaged PDF stops here, with why
        files.set(i + 1, s.file!);
        list.push({ ...base, fileName: s.file!.name, pages: d.pages, byteSize: s.file!.size, sha256: d.sha256 });
      }
      const res = await fetch("/api/admin/cms/import/jobs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: recordId ? "EXISTING" : "NEW", recruitmentId: recordId ?? undefined, sources: list,
          newJob: recordId ? undefined : { ...newJob, recruitmentYear: Number(newJob.recruitmentYear), notificationNumber: newJob.notificationNumber || undefined },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setJobInAddress(d.jobId);
      setReadingTitle(newJob.title);
      setReading({ id: d.jobId, files });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const makePreview = async () => {
    if (sources.some(isPdf) && sources.every((s) => isPdf(s) || s.method === "paste")) { await startReading(); return; }
    if (sources.some((s) => s.method === "upload" && s.file && s.file.size > 4 * 1024 * 1024)) {
      setErr("A PDF over 4 MB is read as a long reading, which takes PDFs and pasted text. Remove the address or image source here, and bring it into the same job afterwards.");
      return;
    }
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
  };

  const items = useMemo(() => preview?.proposal.items ?? [], [preview]);
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
    setReading(null);
    setJobInAddress(null);
  };

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#f1f5ff", margin: 0 }}>{recordId ? "Smart intake into this job" : "Smart intake"}</h1>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4, maxWidth: 760, lineHeight: 1.5 }}>
            Give it an article, the notice PDF, a screenshot or a link. It fills the job&apos;s sections; you review and save a draft. AI Assist and manual entry work as before.
          </div>
          {on && (
            <ol data-import-steps style={{ display: "flex", gap: 6, listStyle: "none", padding: 0, margin: "10px 0 0", flexWrap: "wrap" }}>
              {["Provide information", "Review", "Save as draft"].map((label, n) => {
                const step = applied ? 2 : preview ? 1 : 0;
                return (
                  <li key={label} aria-current={n === step ? "step" : undefined} style={{
                    fontSize: 12, padding: "4px 10px", borderRadius: 999,
                    border: `1px solid ${n === step ? C.accent : C.border}`, color: n === step ? C.text : C.muted, background: n === step ? `${C.accent}18` : "transparent",
                  }}>{n + 1}. {label}</li>
                );
              })}
            </ol>
          )}
        </div>
        <Link href={recordId ? `/admin/cms/${recordId}` : "/admin/cms"} style={{ color: C.accent, fontSize: 13, textDecoration: "none" }}>← {recordId ? "Back to the job" : "All jobs"}</Link>
      </div>

      <SwitchPanel on={on} onChange={setOn} />

      {on === null ? <div style={{ color: C.muted, fontSize: 13 }}>Checking the importer switch…</div> : on === false ? null : applied ? (
        <div data-import-applied style={{ ...PANEL, padding: 18, color: C.text, fontSize: 14, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, color: C.green }}>{applied.replayed ? "This was already saved." : "Saved as a draft."} Nothing is published or verified.</div>
          <div style={{ color: C.muted, fontSize: 13 }}>Open the job: its sections hold these values as Pending. “Check before publishing” lists the key details to check against the official notification before it can go live.</div>
          <Link href={`/admin/cms/${applied.recruitmentId}`} style={{ ...primaryBtn, display: "inline-block", marginTop: 12, textDecoration: "none" }}>Open the job</Link>
        </div>
      ) : (
        <>
          {!preview && !reading && !recordId && <DiscoverPanel onPick={pickFound} />}
          {!preview && !reading && <OpenReadings />}
          {!preview && reading && (
            <ReadingJobPanel key={reading.id} jobId={reading.id} files={reading.files} onPreview={onReadingPreview}
              onClose={() => { setReading(null); setJobInAddress(null); }} />
          )}

          {!preview && !reading && (<>
          {/* The job */}
          <div data-import-job style={{ ...PANEL, padding: 16, marginBottom: 16 }}>
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
              <button onClick={() => { void makePreview(); }} disabled={busy || sources.length === 0} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy && !preview ? "Reading the sources…" : "Read and fill the job →"}</button>
            </div>
            <div data-import-retention style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
              Kept with the job: the text of each source, its fingerprint (SHA-256), size, pages and address. Not kept: the original PDF or image, so keep your own copy.
            </div>
            {err && !preview && <div role="alert" style={{ color: C.red, fontSize: 13 }}>{err}</div>}
          </div>
          </>)}

          {/* Review */}
          {preview && (
            <ReviewPanel
              title={recordId ? job?.title ?? "" : newJob.title || readingTitle}
              organization={recordId ? "" : newJob.organizationName}
              existing={!!recordId}
              items={items}
              sources={preview.proposal.meta.sources}
              aiRequests={preview.proposal.meta.aiRequests}
              warnings={preview.proposal.warnings ?? []}
              replaced={preview.proposal.replacedInImport}
              ticked={ticked}
              onToggle={(i) => { const item = items.find((x) => x.id === i.id); if (item) toggle(item); }}
              duplicates={duplicates}
              overrideReason={overrideReason}
              setOverrideReason={setOverrideReason}
              needsVerifiedConfirm={needsVerifiedConfirm}
              confirmVerified={confirmVerified}
              setConfirmVerified={setConfirmVerified}
              busy={busy}
              err={err}
              onSave={() => { void apply(); }}
              onBack={() => { void discard(); }}
            />
          )}
        </>
      )}
    </div>
  );
}
