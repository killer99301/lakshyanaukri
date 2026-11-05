"use client";

// ═══════════════════════════════════════════════════════════
// New Jobs Found (N3): the discovery leads, for the admin's review
// ═══════════════════════════════════════════════════════════
//
// What the portal collector saved: each lead with every place it was seen,
// what it may be in the CMS, and what needs a look. The admin reviews it here
// or opens it in Smart intake, where its links come in as research. Nothing
// here creates, changes, verifies or publishes a job; opening Smart intake
// does not record an import.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/cms/discovery/repository";
import { C, PANEL, inputStyle, labelStyle } from "../import/ui";
import { LeadCard, type ReviewAction } from "./LeadCard";
import { STATUS_LABEL } from "./lead-view";

const STATUSES = Object.keys(STATUS_LABEL) as Array<Lead["status"]>;

export default function NewJobsFound() {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState("last_seen");
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ sort, ...(status ? { status } : {}), ...(kind ? { kind } : {}) });
    fetch(`/api/admin/cms/discovery/leads?${q}`)
      .then(async (res) => ({ ok: res.ok, code: res.status, d: await res.json().catch(() => ({})) }))
      .then(({ ok, code, d }) => {
        if (!alive) return;
        if (!ok) { setLeads(null); setErr(d.error ?? `HTTP ${code}`); return; }
        setErr(null);
        setLeads(d.leads);
      })
      .catch(() => { if (alive) { setLeads(null); setErr("The leads could not be loaded. Check the connection and try again."); } });
    return () => { alive = false; };
  }, [status, kind, sort, reload]);

  const act = async (lead: Lead, action: ReviewAction, extra: { reason?: string; note?: string; recruitmentId?: string }) => {
    setBusy(lead.id); setErr(null); setSaved(null);
    const res = await fetch(`/api/admin/cms/discovery/leads/${lead.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setErr(d.error ?? `HTTP ${res.status}`); return; }
    setSaved(`Saved: “${lead.title.slice(0, 80)}” is now ${STATUS_LABEL[(d.lead as Lead).status]}.`);
    setReload((n) => n + 1);
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px", color: C.text }}>
      <div style={{ marginBottom: 12, fontSize: 12 }}><Link href="/admin/cms" style={{ color: C.accent }}>← All jobs</Link></div>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>New jobs found</h1>
      <p style={{ color: C.muted, fontSize: 13, margin: "0 0 16px", lineHeight: 1.5 }}>
        Leads the portal readers found. They are research, not jobs: nothing here is official or verified, and nothing is saved to a job
        until you bring a lead into Smart intake and save it there. Update leads (results, admit cards, extensions) are kept here for now.
      </p>
      <div data-lead-filters style={{ ...PANEL, padding: 12, display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ flex: "1 1 180px" }}><span style={labelStyle}>Status</span>
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 180px" }}><span style={labelStyle}>Type</span>
          <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
            <option value="">New jobs and updates</option>
            <option value="NEW">New jobs</option>
            <option value="UPDATE">Updates</option>
          </select>
        </label>
        <label style={{ flex: "1 1 180px" }}><span style={labelStyle}>Order</span>
          <select aria-label="Order" value={sort} onChange={(e) => setSort(e.target.value)} style={inputStyle}>
            <option value="last_seen">Seen most recently</option>
            <option value="first_seen">Found most recently</option>
          </select>
        </label>
      </div>
      {err && <div role="alert" style={{ color: C.red, marginBottom: 10 }}>{err}</div>}
      {saved && <div role="status" style={{ color: C.green, marginBottom: 10 }}>{saved}</div>}
      <div style={{ ...PANEL, padding: "4px 16px" }}>
        {leads === null && !err && <div style={{ padding: 12, color: C.muted }}>Loading…</div>}
        {leads !== null && leads.length === 0 && (
          <div data-leads-empty style={{ padding: 12, color: C.muted }}>
            {status || kind ? "No leads match these filters." : "No leads yet. Leads appear here once the portal collector has run."}
          </div>
        )}
        {leads?.map((l) => <LeadCard key={l.id} lead={l} busy={busy === l.id} onAction={(a, x) => { void act(l, a, x); }} />)}
      </div>
      {leads && leads.length > 0 && <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }} data-leads-count>{leads.length} lead{leads.length === 1 ? "" : "s"}</div>}
    </div>
  );
}
