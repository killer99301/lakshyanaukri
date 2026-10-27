"use client";

// A long document's reading (stage B2.3): the PDF is split here, in the
// browser, into pieces of whole pages and sent one by one; the server reads
// every piece's text and keeps the reading's progress. While this panel is
// open it asks for one step after another. Leaving the page pauses nothing
// on the server and loses nothing: opening the reading again (its address
// carries ?job=…) carries on from what is done. Pages not read are always
// named; "Complete" is shown only when every page was read.

import { useCallback, useEffect, useRef, useState } from "react";
import { C, PANEL, badge, primaryBtn, quietBtn } from "./ui";

/** One piece a little under the server's 4 MB, for the request around it. */
const PIECE_BYTES = 3.9 * 1024 * 1024;
const PIECE_PAGES = 40;
/** How long opening a reading may take before the panel says so and offers to try again. */
const OPEN_TIMEOUT_MS = 30_000;

export interface JobProgress {
  jobId: string; state: "UPLOADING" | "READING" | "PAUSED" | "FINISHING" | "DONE" | "CANCELLED" | "FAILED"; stateNote: string | null; importId: string | null; title: string | null;
  sources: Array<{ no: number; kind: "pdf" | "text"; fileName: string; sha256: string; pages: number; uploadedPages: number; noTextPages: number[];
    unavailable: Array<{ first: number; last: number; reason: string }>; textPages: number; processedPages: number;
    /** Scanned pages: those whose own image is uploaded, and those read from it by the AI. */
    scanImages: number[]; scanRead: number[];
    /** Scanned pages where the AI found almost nothing, twice: to be checked against the page. */
    scanSuspect: number[] }>;
  tasks: { total: number; done: number; running: number; pending: number; failed: number };
  failedTasks: Array<{ sourceNo: number; kind: string; first: number | null; last: number | null; reason: string }>;
  ai: { estimate: number | null; sent: number; retried: number; failed: number };
  allowance: { used: number; cap: number };
  complete: boolean;
}
interface Estimate { estimate: number; allowance: { used: number; cap: number }; missing: Array<{ sourceNo: number; first: number; last: number; reason: string }> }

const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
  return d;
};
const range = (a: number | null, b: number | null) => (a === null ? "the whole text" : a === b ? `page ${a}` : `pages ${a}–${b}`);
/** Pages this browser can still send: never uploaded, or a scanned page whose own image is not uploaded. */
const sendable = (u: { reason: string }) => u.reason === "not uploaded" || u.reason === "scanned page: its image is not uploaded";
const STATE_WORDS: Record<JobProgress["state"], string> = {
  UPLOADING: "Uploading", READING: "Reading", PAUSED: "Paused", FINISHING: "Building the preview", DONE: "Finished", CANCELLED: "Cancelled", FAILED: "Failed",
};

/** Reads the file, opens it with pdf-lib (an encrypted or damaged PDF is refused here), and gives its pages and fingerprint. */
export async function describePdf(file: File): Promise<{ pages: number; sha256: string; bytes: Uint8Array }> {
  const { openPdf, sha256Hex } = await import("@/lib/cms/importer/pdf-split");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { pages } = await openPdf(bytes);
  return { pages, sha256: await sha256Hex(bytes), bytes };
}

export function ReadingJobPanel(props: {
  jobId: string;
  /** The PDFs chosen for this reading in this page, by source number (absent after a reload). */
  files: Map<number, File>;
  onPreview: (preview: { importId: string; proposal: unknown }, title: string | null) => void;
  onClose: () => void;
}) {
  const { jobId, onPreview } = props;
  const [p, setP] = useState<JobProgress | null>(null);
  const [est, setEst] = useState<Estimate | null>(null);
  const [allowMissing, setAllowMissing] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [files, setFiles] = useState(props.files);
  const alive = useRef(true);
  const stepping = useRef(false);
  const uploadingRef = useRef(false);
  const shown = useRef(false);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/admin/cms/import/jobs/${jobId}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(d.error ?? `HTTP ${res.status}`); return null; }
    setP(d.progress);
    return d.progress as JobProgress;
  }, [jobId]);

  /** Sends the pieces of each PDF not yet uploaded; a piece is tried three times before the upload stops and says which pages. */
  const upload = useCallback(async (progress: JobProgress) => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    try {
      const { openPdf, splitPdf, onePage } = await import("@/lib/cms/importer/pdf-split");
      /** Sends a form, three tries; returns the server's answer or throws with the pages it was for. */
      const send = async (fields: Record<string, string>, bytes: Uint8Array, name: string, what: string) => {
        let last: unknown = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const f = new FormData();
            for (const [k, v] of Object.entries(fields)) f.set(k, v);
            f.set("file", new Blob([bytes as unknown as ArrayBuffer], { type: "application/pdf" }), name);
            const res = await fetch(`/api/admin/cms/import/jobs/${jobId}/parts`, { method: "POST", body: f });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
            return d as { noTextPages?: number[] };
          } catch (e) {
            last = e;
            await new Promise((r) => setTimeout(r, 2000 * attempt));
          }
        }
        throw new Error(`${what} could not be sent (${last instanceof Error ? last.message : "network"}). Send the rest again.`);
      };
      for (const s of progress.sources.filter((x) => x.kind === "pdf")) {
        // Pieces not uploaded (or unreadable), and scanned pages whose own image is not uploaded.
        const pieceMissing = s.unavailable.filter((u) => !u.reason.startsWith("scanned page:"));
        const scanMissing = s.unavailable.filter((u) => u.reason === "scanned page: its image is not uploaded").map((u) => u.first);
        if (pieceMissing.length === 0 && scanMissing.length === 0) continue;
        const file = files.get(s.no);
        if (!file) continue;
        const { doc } = await openPdf(new Uint8Array(await file.arrayBuffer()));
        /** A scanned page as its own one-page PDF, to be read from its image; never shrunk when too large. */
        const sendScan = async (n: number) => {
          if (!alive.current) return;
          setSending(`${s.fileName}: sending scanned page ${n} of ${s.pages}`);
          const bytes = await onePage(doc, n);
          if (bytes.byteLength > PIECE_BYTES) {
            await post(`/api/admin/cms/import/jobs/${jobId}/parts`, { sourceNo: s.no, scanPage: n, reason: `page ${n} alone is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB, over the 4 MB a page may be` });
            return;
          }
          await send({ sourceNo: String(s.no), scanPage: String(n) }, bytes, `page-${n}.pdf`, `scanned page ${n}`);
        };
        const needed = (a: number, b: number) => pieceMissing.some((m) => m.first <= b && m.last >= a);
        const sentScans = new Set<number>();
        for await (const piece of splitPdf(doc, { maxBytes: PIECE_BYTES, maxPages: PIECE_PAGES })) {
          if (!alive.current) return;
          if (!needed(piece.first, piece.last)) continue;
          setSending(`${s.fileName}: sending ${range(piece.first, piece.last)} of ${s.pages}`);
          if ("oversized" in piece) {
            await post(`/api/admin/cms/import/jobs/${jobId}/parts`, { sourceNo: s.no, first: piece.first, last: piece.last, reason: piece.reason });
            continue;
          }
          const answer = await send({ sourceNo: String(s.no), first: String(piece.first), last: String(piece.last) }, piece.bytes, `pages-${piece.first}-${piece.last}.pdf`, range(piece.first, piece.last));
          // The server found these pages without text: each goes as its own page, to be read from its image.
          for (const n of answer.noTextPages ?? []) { await sendScan(n); sentScans.add(n); }
          await refresh();
        }
        for (const n of scanMissing) if (!sentScans.has(n)) await sendScan(n);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      uploadingRef.current = false;
      setSending(null);
      const now = await refresh();
      if (now?.state === "UPLOADING") setEst(await post(`/api/admin/cms/import/jobs/${jobId}/action`, { action: "estimate" }).catch(() => null));
    }
  }, [files, jobId, refresh]);

  /** One step after another while the reading is READING and this panel is open; a dropped connection is waited out. */
  const loop = useCallback(async () => {
    if (stepping.current) return;
    stepping.current = true;
    try {
      while (alive.current) {
        try {
          const d = await post(`/api/admin/cms/import/jobs/${jobId}/action`, { action: "step" });
          setOffline(false);
          setP(d.progress);
          // Another tab may be building the preview: wait and look again.
          if (d.progress.state === "FINISHING") { await new Promise((r) => setTimeout(r, 3000)); continue; }
          if (d.progress.state !== "READING") break;
        } catch (e) {
          if (e instanceof Error && /not found|switched off/i.test(e.message)) { setErr(e.message); break; }
          setOffline(true); // the step is kept on the server; try again shortly
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    } finally {
      stepping.current = false;
    }
  }, [jobId]);

  // The reading as it stands, on open: within 30 s, or a useful error with a way out; never "Opening…" for ever.
  const [openTry, setOpenTry] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OPEN_TIMEOUT_MS);
    fetch(`/api/admin/cms/import/jobs/${jobId}`, { signal: ctrl.signal })
      .then(async (r) => ({ ok: r.ok, status: r.status, d: await r.json().catch(() => ({})) }))
      .then(({ ok, status, d }) => {
        if (ok && d?.progress?.state) { setP(d.progress); setErr(null); setSlow(false); }
        else setErr(ok ? "The server's answer about this reading was incomplete." : d?.error ?? `The reading could not be opened (HTTP ${status}).`);
      })
      .catch((e) => {
        if (ctrl.signal.aborted && openTry % 2 === 0) { setSlow(true); setOpenTry((n) => n + 1); return; } // slow once: try again by itself
        setSlow(false);
        setErr(e?.name === "AbortError"
          ? `The reading did not open within ${(2 * OPEN_TIMEOUT_MS) / 1000} seconds. Nothing is lost: try again.`
          : "The reading could not be opened: the connection failed. Nothing is lost: try again.");
      })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [jobId, openTry]);
  const onPreviewRef = useRef(onPreview);
  useEffect(() => { onPreviewRef.current = onPreview; }, [onPreview]);

  // Whenever the state changes: upload what is missing, step, or show the preview.
  useEffect(() => {
    if (!p) return;
    if (p.state === "UPLOADING") {
      if (p.sources.some((s) => s.kind === "pdf" && s.unavailable.some(sendable) && files.has(s.no))) {
        const t = setTimeout(() => { void upload(p); }, 0); // after this render, not inside it
        return () => clearTimeout(t);
      }
      else if (!est) void post(`/api/admin/cms/import/jobs/${jobId}/action`, { action: "estimate" }).then(setEst).catch((e) => setErr(e.message));
    }
    if (p.state === "READING" || p.state === "FINISHING") void loop();
    if (p.state === "DONE" && p.importId && !shown.current) {
      shown.current = true;
      void fetch(`/api/admin/cms/import/${p.importId}`).then((r) => r.json()).then((d) => onPreviewRef.current({ importId: p.importId!, proposal: d.import.proposal }, p.title));
    }
  }, [p, est, files, jobId, loop, upload]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setErr(null);
    try {
      const d = await post(`/api/admin/cms/import/jobs/${jobId}/action`, { action, ...extra });
      if (d.progress) setP(d.progress); else await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const reselect = async (no: number, file: File | null) => {
    if (!file || !p) return;
    setErr(null);
    try {
      const { sha256 } = await describePdf(file);
      if (sha256 !== p.sources.find((s) => s.no === no)?.sha256) { setErr(`${file.name} is not the same file this reading started with.`); return; }
      setFiles((m) => new Map(m).set(no, file));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  if (!p) {
    return (
      <div data-reading-opening style={{ ...PANEL, padding: 16, color: C.muted, fontSize: 13, display: "grid", gap: 8 }}>
        {err ? <div role="alert" style={{ color: C.amber }}>{err}</div> : <div>{slow ? "Still opening the reading: the server is slow to answer…" : "Opening the reading…"}</div>}
        {err && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setErr(null); setOpenTry((n) => n + 2 - (n % 2)); }} style={quietBtn}>Try again</button>
            <button onClick={props.onClose} style={quietBtn}>Back to Smart intake</button>
          </div>
        )}
      </div>
    );
  }
  const ended = p.state === "DONE" || p.state === "CANCELLED" || p.state === "FAILED";
  const totalPages = p.sources.reduce((n, s) => n + (s.kind === "pdf" ? s.pages : 0), 0);
  const uploaded = p.sources.reduce((n, s) => n + (s.kind === "pdf" ? s.uploadedPages : 0), 0);
  const textPages = p.sources.reduce((n, s) => n + s.textPages, 0);
  const processed = p.sources.reduce((n, s) => n + s.processedPages, 0);
  const scanned = p.sources.reduce((n, s) => n + s.noTextPages.length, 0);
  const scanRead = p.sources.reduce((n, s) => n + s.scanRead.length, 0);
  const stateColor = p.state === "DONE" ? (p.complete ? C.green : C.amber) : p.state === "CANCELLED" || p.state === "FAILED" ? C.red : p.state === "PAUSED" ? C.amber : C.accent;

  return (
    <div data-reading-job={p.state} style={{ ...PANEL, padding: 16, display: "grid", gap: 10, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontWeight: 700, color: C.text }}>Reading the document</div>
        <span data-reading-status style={badge(stateColor)}>
          {p.state === "DONE" ? (p.complete ? "Complete" : "Finished — incomplete") : STATE_WORDS[p.state]}
        </span>
      </div>

      {/* The numbers */}
      <div data-reading-numbers style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        {totalPages > 0 && <Stat label="Pages uploaded" value={`${uploaded} of ${totalPages}`} />}
        <Stat label="Pages read" value={`${processed} of ${textPages}`} />
        <Stat label="Pages remaining" value={String(Math.max(0, textPages - processed))} />
        <Stat label="AI requests used" value={`${p.ai.sent}${p.ai.estimate !== null ? ` (about ${p.ai.estimate} expected)` : ""}`} sub={p.ai.retried ? `${p.ai.retried} resent after a refusal for load` : undefined} />
        <Stat label="Today's allowance" value={`${p.allowance.used} of ${p.allowance.cap} used`} />
        <Stat label="Parts of the reading" value={`${p.tasks.done} of ${p.tasks.total} done`} sub={p.tasks.failed ? `${p.tasks.failed} failed` : undefined} />
        {scanned > 0 && <Stat label="Scanned pages read from the image" value={`${scanRead} of ${scanned}`} sub="AI-read: to be checked against each page" />}
      </div>
      {sending && <div style={{ color: C.muted }}>{sending}…</div>}
      {offline && <div role="status" style={{ color: C.amber }}>The connection dropped. Nothing done is lost; trying again…</div>}
      {p.stateNote && <div style={{ color: p.state === "PAUSED" ? C.amber : C.muted }}>{p.stateNote}</div>}

      {/* What is not read */}
      {p.sources.map((s) => (s.unavailable.length + s.noTextPages.filter((n) => !s.scanRead.includes(n)).length + s.scanSuspect.length > 0 || p.failedTasks.some((f) => f.sourceNo === s.no)) && (
        <div key={s.no} data-reading-missing style={{ border: `1px solid ${C.amber}55`, borderRadius: 8, padding: "8px 10px", display: "grid", gap: 3, fontSize: 12 }}>
          <strong style={{ color: C.amber }}>{s.fileName}: not read</strong>
          {s.unavailable.map((u) => <div key={`u${u.first}`}>{range(u.first, u.last)} — {u.reason}</div>)}
          {s.noTextPages.filter((n) => !s.scanRead.includes(n) && !s.unavailable.some((u) => u.first <= n && u.last >= n)).length > 0 && (
            <div>pages {s.noTextPages.filter((n) => !s.scanRead.includes(n) && !s.unavailable.some((u) => u.first <= n && u.last >= n)).join(", ")} — scanned, not read from the image yet</div>
          )}
          {s.scanSuspect.length > 0 && <div>scanned {s.scanSuspect.length === 1 ? "page" : "pages"} {s.scanSuspect.join(", ")} — the AI found almost nothing there, twice: check the {s.scanSuspect.length === 1 ? "page" : "pages"}</div>}
          {p.failedTasks.filter((f) => f.sourceNo === s.no).map((f, i) => <div key={`f${i}`}>{f.kind === "TEXT_BATCH" ? range(f.first, f.last) : f.kind === "SCAN_PAGE" ? `scanned page ${f.first} (read from its image)` : f.kind.replace("SECTION_", "section reader: ").toLowerCase()} — failed: {f.reason}</div>)}
          {p.state === "UPLOADING" && s.kind === "pdf" && s.unavailable.some(sendable) && !files.has(s.no) && (
            <label style={{ color: C.text }}>Select {s.fileName} again to send the rest: <input type="file" accept="application/pdf" onChange={(e) => { void reselect(s.no, e.target.files?.[0] ?? null); }} /></label>
          )}
        </div>
      ))}

      {/* Before starting */}
      {p.state === "UPLOADING" && est && !sending && (
        <div data-reading-estimate style={{ display: "grid", gap: 6 }}>
          <div>Reading this takes about <strong>{est.estimate}</strong> AI requests. Today: {est.allowance.used} of {est.allowance.cap} used.
            {est.estimate > est.allowance.cap - est.allowance.used && <span style={{ color: C.amber }}> That is more than is left today: the reading will pause when the allowance runs out, and carry on when you resume.</span>}
          </div>
          {est.missing.length > 0 && (
            <label style={{ display: "flex", gap: 6, color: C.amber }}>
              <input type="checkbox" checked={allowMissing} onChange={(e) => setAllowMissing(e.target.checked)} />
              Read without the pages not uploaded or not readable (they will be listed as not read)
            </label>
          )}
          <div><button onClick={() => { void act("start", { allowMissing }); }} disabled={est.missing.length > 0 && !allowMissing} style={primaryBtn}>Start reading</button></div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {p.state === "READING" && <button onClick={() => { void act("pause"); }} style={quietBtn}>Pause</button>}
        {p.state === "PAUSED" && <button onClick={() => { void act("resume"); }} style={quietBtn}>Resume</button>}
        {p.state === "PAUSED" && p.tasks.failed > 0 && <button onClick={() => { void act("retry"); }} style={quietBtn}>Retry failed pages</button>}
        {p.state === "PAUSED" && p.tasks.failed > 0 && p.tasks.pending === 0 && (
          <button onClick={() => { void act("finish", { acceptFailed: true }); }} style={quietBtn}>Finish without them</button>
        )}
        {p.state === "UPLOADING" && !sending && p.sources.some((s) => files.has(s.no) && s.unavailable.some(sendable)) && <button onClick={() => { setErr(null); void upload(p); }} style={quietBtn}>Send the rest again</button>}
        {!ended && <button onClick={() => { if (confirm("Cancel this reading? Its uploaded pieces are deleted.")) void act("cancel"); }} style={{ ...quietBtn, color: C.red, borderColor: `${C.red}66` }}>Cancel</button>}
        {ended && p.state !== "DONE" && <button onClick={props.onClose} style={quietBtn}>Start again</button>}
      </div>
      {err && <div role="alert" style={{ color: C.red }}>{err}</div>}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px" }}>
      <div style={{ fontSize: 11, color: C.muted }}>{label}</div>
      <div style={{ color: C.text, fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.amber }}>{sub}</div>}
    </div>
  );
}

/** The admin's readings not finished, to reopen. */
export function OpenReadings() {
  const [jobs, setJobs] = useState<Array<{ jobId: string; state: string; title: string | null; recruitmentId: string | null; files: string[] }>>([]);
  useEffect(() => { fetch("/api/admin/cms/import/jobs").then((r) => r.json()).then((d) => setJobs(d.jobs ?? [])).catch(() => setJobs([])); }, []);
  if (jobs.length === 0) return null;
  return (
    <div data-open-readings style={{ ...PANEL, padding: "10px 16px", fontSize: 12, color: C.muted, display: "grid", gap: 4 }}>
      <strong style={{ color: C.text }}>Readings not finished</strong>
      {jobs.map((j) => (
        <a key={j.jobId} href={`/admin/cms/import?${j.recruitmentId ? `record=${j.recruitmentId}&` : ""}job=${j.jobId}`} style={{ color: C.accent }}>
          {j.title ?? "Into a job"} — {j.files.join(", ")} ({STATE_WORDS[j.state as JobProgress["state"]] ?? j.state})
        </a>
      ))}
    </div>
  );
}
