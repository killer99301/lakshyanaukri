"use client";

// New Jobs Found (N3): one lead, with every place it was seen, what it may be
// in the CMS, what needs a look, and the admin's review actions.

import { useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/cms/discovery/repository";
import { C, badge, inputStyle, quietBtn } from "../import/ui";
import { STATUS_LABEL, attention, checkUpdatesHref, classify, intakeHref, safeHref, updateType, type Tone } from "./lead-view";

export type ReviewAction = "READY_FOR_REVIEW" | "NEEDS_SOURCE" | "NEEDS_CORRECTION" | "DUPLICATE" | "DISMISS" | "REOPEN";
const TONE: Record<Tone, string> = { green: C.green, amber: C.amber, red: C.red, muted: C.muted, accent: C.accent };
const day = (iso: string) => iso.slice(0, 10);

export function LeadCard({ lead, busy, onAction }: {
  lead: Lead; busy?: boolean;
  onAction: (action: ReviewAction, extra: { reason?: string; note?: string; recruitmentId?: string }) => void;
}) {
  const [asking, setAsking] = useState<null | "DISMISS" | "DUPLICATE">(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [job, setJob] = useState("");
  const cls = classify(lead);
  const linked = lead.match.recruitmentId && lead.match.kind !== "POSSIBLE" ? lead.match.candidates.find((c) => c.id === lead.match.recruitmentId) : null;
  const closed = lead.status === "DISMISSED" || lead.status === "DUPLICATE";
  const act = (a: ReviewAction, extra: { reason?: string; recruitmentId?: string } = {}) => { onAction(a, { ...extra, ...(note.trim() ? { note } : {}) }); setAsking(null); setReason(""); setNote(""); };

  return (
    <div data-lead={lead.id} data-lead-status={lead.status} data-lead-kind={lead.kind} data-lead-match={lead.match.kind}
      style={{ borderTop: `1px solid ${C.border}`, padding: "12px 0", display: "grid", gap: 6, fontSize: 12, color: C.text }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span data-lead-class style={badge(TONE[cls.tone])}>{cls.label}</span>
        {lead.kind === "UPDATE" && <span data-lead-update-type style={badge(C.amber)}>{updateType(lead.title)} · found on a portal, not confirmed</span>}
        <span data-lead-status-badge style={badge(closed ? C.muted : C.accent)}>{STATUS_LABEL[lead.status]}</span>
        <span style={{ fontSize: 14, fontWeight: 600, flex: "1 1 320px", minWidth: 0, overflowWrap: "anywhere" }} data-lead-title>{lead.title}</span>
      </div>
      <div style={{ color: C.muted }}>
        {lead.organizationId ? <>Organisation: <b style={{ color: C.text }}>{lead.organizationName ?? lead.organizationId}</b></> : <span style={{ color: C.amber }}>Organisation not recognised</span>}
        {lead.notificationNumber ? <> · Notice <b style={{ color: C.text }}>{lead.notificationNumber}</b></> : null}
        {` · first seen ${day(lead.firstSeenAt)} · last seen ${day(lead.lastSeenAt)} · seen in ${lead.seenRuns} run${lead.seenRuns === 1 ? "" : "s"}`}
      </div>
      {lead.statusReason && <div data-lead-reason style={{ color: C.muted }}>Reason: {lead.statusReason}</div>}

      <div data-lead-sources style={{ display: "grid", gap: 2 }}>
        <div style={{ color: C.muted }}>Seen on {lead.sources.length} source{lead.sources.length === 1 ? "" : "s"}:</div>
        {lead.sources.map((s) => {
          const href = safeHref(s.itemUrl);
          return (
            <div key={`${s.sourceId}:${s.itemUrl}`} data-lead-source style={{ paddingLeft: 10, overflowWrap: "anywhere" }}>
              {s.sourceName} {s.official ? <span style={{ color: C.green }}>(official site)</span> : <span style={{ color: C.muted }}>(portal: research)</span>} —{" "}
              {href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" style={{ color: C.accent }}>{s.titleSeen}</a> : <span data-unsafe-link>{s.titleSeen} (link not shown: {s.itemUrl})</span>}
              {s.nearbyDate ? ` · ${s.nearbyDate}` : ""}
            </div>
          );
        })}
      </div>

      {linked && (
        <div data-lead-linked style={{ color: lead.match.kind === "DUPLICATE" ? C.muted : C.accent }}>
          {lead.kind === "UPDATE" ? "About the CMS job" : lead.match.kind === "DUPLICATE" ? "Already in the CMS" : "Matches"}: <Link href={`/admin/cms/${linked.id}`} style={{ color: C.accent }}>{linked.title}</Link> — {lead.match.reason}
        </div>
      )}
      {lead.match.kind === "POSSIBLE" && lead.match.candidates.length > 0 && (
        <div data-lead-candidates style={{ color: C.amber, display: "grid", gap: 2 }}>
          <div>May be one of these CMS jobs. Nothing is merged: choose the job before bringing the lead into it.</div>
          {lead.match.candidates.map((c) => (
            <div key={c.id} style={{ paddingLeft: 10 }}>
              <Link href={`/admin/cms/${c.id}`} style={{ color: C.accent }}>{c.title}</Link> <span style={{ color: C.muted }}>({c.reason})</span>{" "}
              <Link href={intakeHref(lead, c.id)} data-review-against={c.id} style={{ color: C.accent }}>This is the job — review the lead against it</Link>
            </div>
          ))}
        </div>
      )}
      {lead.kind === "UPDATE" && !linked && lead.match.kind !== "POSSIBLE" && (
        <div data-lead-unmatched style={{ color: C.amber }}>No CMS job was matched to this update. It stays listed here; when you know which job it is about, open that job and use Smart intake into it.</div>
      )}
      <ul data-lead-attention style={{ margin: 0, paddingLeft: 18, color: C.amber }}>
        {attention(lead).map((a) => <li key={a}>{a}</li>)}
      </ul>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {/* An update is never opened as a new job: it is brought into the job it is about. */}
        {lead.kind === "NEW" && <Link href={intakeHref(lead)} data-open-intake style={{ ...quietBtn, textDecoration: "none" }}>Open in Smart intake as a new job →</Link>}
        {linked && <Link href={intakeHref(lead, linked.id)} data-review-against={linked.id} style={{ ...quietBtn, textDecoration: "none" }}>{lead.kind === "UPDATE" ? `Bring into “${linked.title}” in Smart intake` : `Review against “${linked.title}”`} →</Link>}
        {linked && lead.kind === "UPDATE" && (
          <Link href={checkUpdatesHref(linked.id)} data-check-updates-link style={{ ...quietBtn, textDecoration: "none" }} title="Opens the job; its Check for updates uses one AI request, and only when you press Check there">Check for updates on the job (AI, only when you press Check) →</Link>
        )}
        {!closed && (["READY_FOR_REVIEW", "NEEDS_SOURCE", "NEEDS_CORRECTION"] as const).filter((a) => a !== lead.status).map((a) => (
          <button key={a} disabled={busy} onClick={() => act(a)} style={quietBtn}>{STATUS_LABEL[a]}</button>
        ))}
        {!closed && lead.match.candidates.length > 0 && <button disabled={busy} onClick={() => setAsking("DUPLICATE")} style={quietBtn}>Duplicate…</button>}
        {!closed && <button disabled={busy} onClick={() => setAsking("DISMISS")} style={{ ...quietBtn, color: C.red, borderColor: `${C.red}66` }}>Dismiss…</button>}
        {closed && <button disabled={busy} onClick={() => act("REOPEN")} style={quietBtn}>Reopen</button>}
      </div>
      {asking && (
        <div data-lead-ask={asking} style={{ display: "grid", gap: 6, maxWidth: 640 }}>
          {asking === "DUPLICATE" && (
            <select aria-label="The CMS job it duplicates" value={job} onChange={(e) => setJob(e.target.value)} style={inputStyle}>
              <option value="">Choose the CMS job it duplicates…</option>
              {lead.match.candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
          <input aria-label={asking === "DISMISS" ? "Why it is dismissed" : "Reason (optional)"} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={asking === "DISMISS" ? "Why it is dismissed (required)" : "Reason (optional)"} maxLength={500} style={inputStyle} />
          <input aria-label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={2000} style={inputStyle} />
          <div style={{ display: "flex", gap: 6 }}>
            <button disabled={busy || (asking === "DISMISS" ? reason.trim().length < 3 : !job)} onClick={() => act(asking, asking === "DUPLICATE" ? { reason, recruitmentId: job } : { reason })} style={quietBtn}>
              {asking === "DISMISS" ? "Dismiss the lead" : "Mark as duplicate"}
            </button>
            <button onClick={() => setAsking(null)} style={{ ...quietBtn, color: C.muted, borderColor: C.border }}>Cancel</button>
          </div>
        </div>
      )}
      {lead.notes && <details><summary style={{ color: C.muted, cursor: "pointer" }}>Notes and earlier statuses</summary><pre data-lead-notes style={{ whiteSpace: "pre-wrap", color: C.muted, margin: 0, fontFamily: "inherit" }}>{lead.notes}</pre></details>}
    </div>
  );
}
