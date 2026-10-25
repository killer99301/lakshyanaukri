"use client";

// Job discovery, on demand: the admin names a page that lists jobs; the
// server reads that one page and lists what it announces. Picking one opens
// it in Smart intake as research; an update to a job already in the CMS opens
// Smart intake on that job. Nothing is saved here.

import { useState } from "react";
import Link from "next/link";
import { C, PANEL, badge, inputStyle, labelStyle, quietBtn } from "./ui";

export interface FoundJob {
  title: string; url: string; kind: "NEW" | "UPDATE"; date?: string; official: boolean;
  maybe: Array<{ id: string; title: string }>;
}

export function DiscoverPanel({ onPick }: { onPick: (job: FoundJob) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<FoundJob[] | null>(null);

  const search = async () => {
    setBusy(true);
    setErr(null);
    setFound(null);
    const res = await fetch("/api/admin/cms/import/discover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(d.error ?? `HTTP ${res.status}`); return; }
    setFound(d.found);
  };

  if (!open) {
    return (
      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setOpen(true)} style={quietBtn}>Find jobs on a listing page…</button>
      </div>
    );
  }
  return (
    <div data-discover style={{ ...PANEL, padding: 16, marginBottom: 16, display: "grid", gap: 10, fontSize: 12, color: C.text }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#c7d2e6" }}>Find jobs on a page</div>
      <div style={{ color: C.muted, lineHeight: 1.5 }}>
        The address of a page that lists jobs: a portal&apos;s state page, or a commission&apos;s notices page. That one page is read (if its robots.txt allows); nothing is saved. A portal&apos;s page is research, never official.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ flex: "1 1 360px" }}><span style={labelStyle}>Listing page</span>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (e.g. a Bihar jobs page)" style={inputStyle} />
        </label>
        <button onClick={() => { void search(); }} disabled={busy || !url.trim()} style={quietBtn}>{busy ? "Reading the page…" : "Find jobs"}</button>
        <button onClick={() => { setOpen(false); setFound(null); setErr(null); }} style={{ ...quietBtn, color: C.muted, borderColor: C.border }}>Close</button>
      </div>
      {err && <div role="alert" style={{ color: C.red }}>{err}</div>}
      {found && found.length === 0 && <div style={{ color: C.muted }}>No recruitment links found on that page.</div>}
      {found && found.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          {found.map((f) => (
            <div key={f.url} data-found-job style={{ display: "flex", gap: 10, alignItems: "flex-start", borderTop: `1px solid ${C.border}`, paddingTop: 6, flexWrap: "wrap" }}>
              <span style={badge(f.kind === "NEW" ? C.green : C.amber)}>{f.kind === "NEW" ? "New" : "Update"}</span>
              <div style={{ flex: "1 1 360px", minWidth: 0 }}>
                <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: C.text, textDecoration: "none" }}>{f.title}</a>
                <div style={{ color: C.muted, fontSize: 11 }}>
                  {new URL(f.url).host}{f.official ? " · the body's own site" : " · portal or news site: research only"}{f.date ? ` · ${f.date}` : ""}
                </div>
                {f.maybe.length > 0 && (
                  <div style={{ color: C.amber, fontSize: 11 }}>
                    May already be in the CMS:{" "}
                    {f.maybe.map((m) => (
                      <span key={m.id} style={{ marginRight: 8 }}>
                        <Link href={`/admin/cms/${m.id}`} style={{ color: C.accent }}>{m.title}</Link>
                        {" "}(<Link href={`/admin/cms/import?record=${m.id}&url=${encodeURIComponent(f.url)}`} style={{ color: C.accent }}>bring this into it</Link>)
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => onPick(f)} style={{ ...quietBtn, padding: "2px 8px" }}>Smart intake →</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
