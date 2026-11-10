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
  /** The "Last Date" the row gives, and whether it has passed: separate from whether the job is in the CMS. */
  lastDate?: string; applications?: "OPEN" | "LAST_DATE_PASSED" | "UNKNOWN";
  /** A standalone eligibility exam (UGC NET, CTET, a TET or SET, GATE): shown as found, never as a recruitment. */
  eligibilityExam?: boolean;
  organizationId?: string; organizationName?: string; notificationNumber?: string;
  /** CMS bodies the title fits equally well: none chosen. */
  organizationUnclear?: string[];
  /** How it compares with the CMS's jobs, as the portal collector matches its leads. */
  match?: string; matchReason?: string | null;
  maybe: Array<{ id: string; title: string; kind?: string; reason?: string }>;
  /** Like titles with another notice number: probably other recruitments. */
  differentNotice?: Array<{ id: string; title: string; reason: string }>;
}

const MATCH_WORDS: Record<string, string> = {
  DUPLICATE: "Already in the CMS", STRONG: "Strong match to a CMS job", POSSIBLE: "May already be in the CMS",
};

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const [y, m, d] = iso.split("-"); return `${Number(d)} ${MONTH[Number(m) - 1]} ${y}`; };

/** Applications, by the last date the portal's row gives: never "closed" for certain, since dates get extended. */
export function applicationsLine(f: Pick<FoundJob, "lastDate" | "applications" | "date">): { text: string; tone: "ok" | "warn" | "muted" } {
  if (f.lastDate && f.applications === "LAST_DATE_PASSED") return { text: `Last date ${day(f.lastDate)} has passed — closed unless it was extended; check the official site`, tone: "warn" };
  if (f.lastDate) return { text: `Last date ${day(f.lastDate)} (as the portal gives it)`, tone: "ok" };
  return { text: f.date ? `No last date given (date shown: ${day(f.date)})` : "No last date given", tone: "muted" };
}

/** The CMS jobs to name with the match itself, and the rest as only alike: a duplicate's headline names only its job. */
export function splitMaybe(f: Pick<FoundJob, "match" | "maybe">): { headline: FoundJob["maybe"]; alike: FoundJob["maybe"] } {
  if (f.match === "DUPLICATE" || f.match === "STRONG") return { headline: f.maybe.filter((m) => m.kind === f.match), alike: f.maybe.filter((m) => m.kind !== f.match) };
  return { headline: f.maybe, alike: [] };
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
          {found.map((f) => <FoundRow key={f.url} f={f} onPick={onPick} />)}
        </div>
      )}
    </div>
  );
}


/** One listing as found: what it is, its last date, and how it compares with the CMS's jobs. */
export function FoundRow({ f, onPick }: { f: FoundJob; onPick: (job: FoundJob) => void }) {
  return (
    <div data-found-job style={{ display: "flex", gap: 10, alignItems: "flex-start", borderTop: `1px solid ${C.border}`, paddingTop: 6, flexWrap: "wrap" }}>
      {f.eligibilityExam
        ? <span data-eligibility-exam style={badge(C.muted)}>{f.kind === "UPDATE" ? "Eligibility exam update — not a recruitment" : "Eligibility exam — not a recruitment"}</span>
        : <span style={badge(f.kind === "NEW" ? C.green : C.amber)}>{f.kind === "NEW" ? "Recruitment" : "Update"}</span>}
      <div style={{ flex: "1 1 360px", minWidth: 0 }}>
        <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: C.text, textDecoration: "none" }}>{f.title}</a>
        <div style={{ color: C.muted, fontSize: 11 }}>
          {new URL(f.url).host}{f.official ? " · the body's own site" : " · portal or news site: research only"}
          {f.organizationName ? ` · ${f.organizationName}` : f.organizationUnclear?.length ? ` · organisation unclear: ${f.organizationUnclear.join(" or ")}` : " · organisation not recognised"}{f.notificationNumber ? ` · notice ${f.notificationNumber}` : ""}
        </div>
        {(() => { const a = applicationsLine(f); return (
          <div data-found-applications={f.applications ?? "UNKNOWN"} style={{ color: a.tone === "warn" ? C.amber : C.muted, fontSize: 11 }}>{a.text}</div>
        ); })()}
        {(() => {
          const { headline, alike } = splitMaybe(f);
          const jobLink = (m: { id: string; title: string; reason?: string }) => (
            <span key={m.id} style={{ marginRight: 8 }} title={m.reason}>
              <Link href={`/admin/cms/${m.id}`} style={{ color: C.accent }}>{m.title}</Link>
              {" "}(<Link href={`/admin/cms/import?record=${m.id}&url=${encodeURIComponent(f.url)}`} style={{ color: C.accent }}>bring this into it</Link>)
            </span>
          );
          return (
            <>
              {headline.length > 0
                ? (
                  <div data-found-match={f.match ?? ""} style={{ color: f.match === "DUPLICATE" ? C.muted : C.amber, fontSize: 11 }}>
                    {MATCH_WORDS[f.match ?? ""] ?? "May already be in the CMS"}{f.matchReason ? ` (${f.matchReason})` : ""}:{" "}
                    {headline.map(jobLink)}
                  </div>
                )
                : <div data-found-match="none" style={{ color: C.muted, fontSize: 11 }}>Not in the CMS: no job like it{f.matchReason && f.matchReason.includes("no job in the CMS yet") ? ` (${f.matchReason.split(";")[0]})` : ""}</div>}
              {alike.length > 0 && (
                <div data-found-alike style={{ color: C.muted, fontSize: 11 }}>Also alike, not the same job: {alike.map(jobLink)}</div>
              )}
              {(f.differentNotice?.length ?? 0) > 0 && (
                <div data-found-other-notice style={{ color: C.muted, fontSize: 11 }}>
                  Like title, another notice number (probably another recruitment):{" "}
                  {f.differentNotice!.map((m) => <span key={m.id} style={{ marginRight: 8 }} title={m.reason}><Link href={`/admin/cms/${m.id}`} style={{ color: C.accent }}>{m.title}</Link></span>)}
                </div>
              )}
            </>
          );
        })()}
      </div>
      <button onClick={() => onPick(f)} style={{ ...quietBtn, padding: "2px 8px" }}>Smart intake →</button>
    </div>
  );
}
