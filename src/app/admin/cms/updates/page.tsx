"use client";

// ═══════════════════════════════════════════════════════════
// Updates needed (U1): what may have changed on jobs already in the CMS
// ═══════════════════════════════════════════════════════════
//
// Two different things, kept apart and named for what they are:
//   - update leads: results, admit cards, extensions… seen on portals.
//     Research, not a confirmed change; each says which CMS job it is tied
//     to, and why (or that no job was matched, or that the admin must choose).
//   - date reminders: worked out from each live job's own dates (a closing
//     date near, a stage date passed). A prompt to look, not an update.
// Nothing here changes a job, runs an AI request or fetches anything. The
// review actions are New Jobs Found's own (one status system).

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/cms/discovery/repository";
import type { JobAttention } from "@/lib/cms/attention";
import { C, PANEL, badge } from "../import/ui";
import { LeadCard, type ReviewAction } from "../discovery/LeadCard";
import { STATUS_LABEL, tieOf, type UpdateTie } from "../discovery/lead-view";

const GROUPS: Array<{ tie: UpdateTie; title: string; note: string }> = [
  { tie: "MATCHED", title: "Tied to a CMS job", note: "Matched by notice number, or by organisation, year and title. Still research: check it against the official notice before changing the job." },
  { tie: "POSSIBLE", title: "May be about a CMS job — choose", note: "The titles agree but nothing confirms the job. It is not treated as that job's until you choose it." },
  { tie: "NONE", title: "No CMS job matched", note: "Kept here so nothing is lost. When you know the job, open it and use Smart intake into it." },
];

export default function UpdatesNeeded() {
  const [data, setData] = useState<{ today: string; leads: Lead[]; attention: JobAttention[]; liveCount: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/cms/discovery/updates")
      .then(async (res) => ({ ok: res.ok, code: res.status, d: await res.json().catch(() => ({})) }))
      .then(({ ok, code, d }) => { if (!alive) return; if (!ok) { setData(null); setErr(d.error ?? `HTTP ${code}`); return; } setErr(null); setData(d); })
      .catch(() => { if (alive) { setData(null); setErr("Updates needed could not be loaded. Check the connection and try again."); } });
    return () => { alive = false; };
  }, [reload]);

  const act = async (lead: Lead, action: ReviewAction, extra: { reason?: string; note?: string; recruitmentId?: string }) => {
    setBusy(lead.id); setErr(null); setSaved(null);
    const res = await fetch(`/api/admin/cms/discovery/leads/${lead.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setErr(d.error ?? `HTTP ${res.status}`); return; }
    setSaved(`Saved: “${lead.title.slice(0, 80)}” is now ${STATUS_LABEL[(d.lead as Lead).status]}.`);
    setReload((n) => n + 1);
  };

  const open = (l: Lead) => showClosed || (l.status !== "DISMISSED" && l.status !== "DUPLICATE");
  const leads = data?.leads.filter(open) ?? [];
  const hidden = (data?.leads.length ?? 0) - leads.length;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px", color: C.text }}>
      <div style={{ marginBottom: 12, fontSize: 12, display: "flex", gap: 14 }}>
        <Link href="/admin/cms" style={{ color: C.accent }}>← All jobs</Link>
        <Link href="/admin/cms/discovery" style={{ color: C.accent }}>New jobs found</Link>
      </div>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Updates needed</h1>
      <p style={{ color: C.muted, fontSize: 13, margin: "0 0 16px", lineHeight: 1.5 }}>
        What may have changed on jobs already in the CMS. A portal&apos;s update is a lead to check, not a confirmed change; a date reminder comes from the job&apos;s own dates.
        Nothing here changes a job: you bring a lead into the job with Smart intake, where every value is reviewed and saved as Pending, and a checked value is replaced only with a second confirmation.
      </p>
      {err && <div role="alert" style={{ color: C.red, marginBottom: 10 }}>{err}</div>}
      {saved && <div role="status" style={{ color: C.green, marginBottom: 10 }}>{saved}</div>}
      {!data && !err && <div style={{ color: C.muted }}>Loading…</div>}

      {data && (
        <>
          <section data-updates-leads style={{ ...PANEL, padding: "12px 16px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
              <h2 style={{ fontSize: 15, margin: 0 }}>Updates found on portals <span style={{ color: C.muted, fontWeight: 400 }}>— research, not confirmed</span></h2>
              <label style={{ fontSize: 12, color: C.muted, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show dismissed and duplicate ({hidden})
              </label>
            </div>
            {leads.length === 0 && <div data-updates-empty style={{ color: C.muted, padding: "10px 0", fontSize: 12 }}>No update leads{hidden ? " open" : ""}. Update leads appear once the portal collector has run.</div>}
            {GROUPS.map((g) => {
              const inGroup = leads.filter((l) => tieOf(l) === g.tie);
              if (!inGroup.length) return null;
              return (
                <div key={g.tie} data-updates-group={g.tie} style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{g.title} <span style={badge(C.muted)}>{inGroup.length}</span></div>
                  <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{g.note}</div>
                  {inGroup.map((l) => <LeadCard key={l.id} lead={l} busy={busy === l.id} onAction={(a, x) => { void act(l, a, x); }} />)}
                </div>
              );
            })}
          </section>

          <section data-updates-attention style={{ ...PANEL, padding: "12px 16px" }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>Date reminders on live jobs <span style={{ color: C.muted, fontWeight: 400 }}>— from each job&apos;s own dates, not an update</span></h2>
            <div style={{ color: C.muted, fontSize: 12, margin: "4px 0 8px" }}>Worked out on {data.today} from {data.liveCount} live job{data.liveCount === 1 ? "" : "s"}. Each is a prompt to check the official site.</div>
            {data.attention.length === 0 && <div data-attention-empty style={{ color: C.muted, fontSize: 12 }}>Nothing due on any live job.</div>}
            {data.attention.map((j) => (
              <div key={j.id} data-attention-job={j.id} style={{ borderTop: `1px solid ${C.border}`, padding: "8px 0", fontSize: 12 }}>
                <Link href={`/admin/cms/${j.id}`} style={{ color: C.accent, fontWeight: 600 }}>{j.title}</Link> <span style={{ color: C.muted }}>{j.organizationName}</span>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {j.items.map((i) => <li key={i.code} data-attention-item={i.code} style={{ color: i.level === "NOW" ? C.red : i.level === "SOON" ? C.amber : C.muted }}>{i.message}</li>)}
                </ul>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
