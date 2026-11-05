"use client";

// Updates needed on this job (U2): the update leads matched to it, the ones
// that may be about it (kept apart until the admin chooses it), and its date
// reminders. Read only: nothing here changes the job, runs an AI request or
// fetches anything. The admin brings a lead into the job with Smart intake.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/cms/discovery/repository";
import type { AttentionItem } from "@/lib/cms/attention";
import { STATUS_LABEL, intakeHref, safeHref, updateType } from "../discovery/lead-view";

const C = { border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8", accent: "#62b5ff", amber: "#d29922", red: "#f85149", card: "rgba(14,21,38,0.72)" };

interface JobUpdates { today: string; job: { id: string; title: string; live: boolean }; matched: Lead[]; possible: Lead[]; attention: AttentionItem[] }

export function LeadLine({ lead, recordId, possible }: { lead: Lead; recordId: string; possible: boolean }) {
  const candidate = lead.match.candidates.find((c) => c.id === recordId);
  return (
    <div data-job-update={lead.id} data-job-update-tie={possible ? "POSSIBLE" : "MATCHED"} style={{ borderTop: `1px solid ${C.border}`, padding: "8px 0", display: "grid", gap: 3 }}>
      <div><b>{updateType(lead.title)}</b> · <span style={{ overflowWrap: "anywhere" }}>{lead.title}</span> <span style={{ color: C.muted }}>({STATUS_LABEL[lead.status]})</span></div>
      <div style={{ color: C.muted }}>
        {possible ? <span style={{ color: C.amber }}>May be about this job — not treated as this job&apos;s until you choose it: {candidate?.reason ?? lead.match.reason}</span> : <>Why it is tied to this job: {lead.match.reason}</>}
      </div>
      <div style={{ color: C.muted }}>
        Seen on: {lead.sources.map((s, i) => {
          const href = safeHref(s.itemUrl);
          return <span key={`${s.sourceId}${i}`}>{i ? "; " : ""}{href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" style={{ color: C.accent }}>{s.sourceName}</a> : s.sourceName} {s.official ? "(official site)" : "(portal: research)"}{s.nearbyDate ? ` ${s.nearbyDate}` : ""}</span>;
        })} · found {lead.firstSeenAt.slice(0, 10)}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href={intakeHref(lead, recordId)} data-job-update-intake style={{ color: C.accent }}>
          {possible ? "This is the job — bring the lead into it in Smart intake" : "Bring into this job in Smart intake"} →
        </Link>
        <Link href={`/admin/cms/updates`} style={{ color: C.muted }}>Review it in Updates needed</Link>
      </div>
    </div>
  );
}

export function UpdatesNeededPanel({ recordId }: { recordId: string }) {
  const [data, setData] = useState<JobUpdates | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/cms/discovery/updates?recordId=${encodeURIComponent(recordId)}`)
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => { if (!alive) return; if (ok) setData(d); else setErr(d.error ?? "Updates needed could not be read"); })
      .catch(() => { if (alive) setErr("Updates needed could not be read"); });
    return () => { alive = false; };
  }, [recordId]);

  if (err) return <div data-job-updates-error style={{ color: C.muted, fontSize: 12, marginBottom: 12 }}>Updates needed: {err}</div>;
  if (!data) return null;
  const open = (l: Lead) => l.status !== "DISMISSED" && l.status !== "DUPLICATE";
  const matched = data.matched.filter(open), possible = data.possible.filter(open);
  const count = matched.length + possible.length + data.attention.length;
  return (
    <section data-job-updates aria-label="Updates needed" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 16, fontSize: 12, color: C.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Updates needed {count ? `(${count})` : ""}</span>
        <Link href="/admin/cms/updates" style={{ color: C.accent }}>All updates needed →</Link>
      </div>
      {count === 0 && <div data-job-updates-empty style={{ color: C.muted, marginTop: 6 }}>Nothing found on portals for this job, and no date reminder.</div>}
      {(matched.length > 0 || possible.length > 0) && (
        <div style={{ color: C.muted, margin: "6px 0 2px" }}>Found on portals: research, not a confirmed change. Check each against the official notice; Smart intake saves nothing until you tick and save, and a checked value is replaced only with a second confirmation.</div>
      )}
      {matched.map((l) => <LeadLine key={l.id} lead={l} recordId={recordId} possible={false} />)}
      {possible.map((l) => <LeadLine key={l.id} lead={l} recordId={recordId} possible />)}
      {data.attention.length > 0 && (
        <div data-job-attention style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600 }}>Date reminders <span style={{ color: C.muted, fontWeight: 400 }}>— from this job&apos;s own dates, not an update</span></div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {data.attention.map((i) => <li key={i.code} data-job-attention-item={i.code} style={{ color: i.level === "NOW" ? C.red : i.level === "SOON" ? C.amber : C.muted }}>{i.message}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
