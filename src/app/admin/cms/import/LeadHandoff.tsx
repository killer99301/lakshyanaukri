"use client";

// Smart intake opened from New Jobs Found (N3): the lead's links come in as
// research sources. Saying so is this panel's job: a portal's page is never
// official, a link on an official site is not a check, and opening Smart
// intake does not record that the lead was imported.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Lead } from "@/lib/cms/discovery/repository";
import { MAX_HANDOFF_SOURCES, STATUS_LABEL, handoffUrls } from "../discovery/lead-view";
import { C, PANEL } from "./ui";

export type HandoffLead = Pick<Lead, "id" | "title" | "organizationId" | "organizationName" | "notificationNumber" | "status" | "sources">;

export function LeadHandoff({ leadId, onLead }: { leadId: string; onLead: (lead: HandoffLead, urls: string[]) => void }) {
  const [lead, setLead] = useState<HandoffLead | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const applied = useRef(false);
  // The page makes a new onLead on every render: kept in a ref, so the lead is read once per lead id.
  const callback = useRef(onLead);
  useEffect(() => { callback.current = onLead; }, [onLead]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/cms/discovery/leads/${encodeURIComponent(leadId)}`)
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!alive) return;
        if (!ok) { setErr(d.error ?? "The lead could not be read"); return; }
        setLead(d.lead);
        if (!applied.current) { applied.current = true; callback.current(d.lead, handoffUrls(d.lead).slice(0, MAX_HANDOFF_SOURCES)); }
      })
      .catch(() => { if (alive) setErr("The lead could not be read"); });
    return () => { alive = false; };
  }, [leadId]);

  if (err) return <div role="alert" data-lead-handoff-error style={{ color: C.red, marginBottom: 12 }}>From New Jobs Found: {err}. Nothing was filled in.</div>;
  if (!lead) return null;
  const urls = handoffUrls(lead as Lead);
  const shown = urls.slice(0, MAX_HANDOFF_SOURCES);
  return (
    <div data-lead-handoff style={{ ...PANEL, padding: 14, marginBottom: 14, fontSize: 12, color: C.text, display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 700 }}>From New Jobs Found: <span style={{ overflowWrap: "anywhere" }}>{lead.title}</span></div>
      <div style={{ color: C.muted, lineHeight: 1.5 }}>
        {shown.length === urls.length ? (urls.length === 1 ? "Its link is" : `Its ${urls.length} links are`) : `${shown.length} of its ${urls.length} links are`} added below as <b>research</b>: a portal&apos;s page is never
        official, and a link on an official site is where to look, not a check. Add the official notice to confirm anything. Every value still goes
        through the usual review, saved as Pending; nothing is published.
      </div>
      {urls.length > shown.length && (
        <div data-lead-handoff-more style={{ color: C.amber }}>Smart intake takes {MAX_HANDOFF_SOURCES} sources at once; the lead&apos;s other {urls.length - shown.length} link(s) stay listed in New jobs found.</div>
      )}
      <div data-lead-handoff-status style={{ color: C.muted }}>
        Opening Smart intake does not record an import: the lead stays “{STATUS_LABEL[lead.status]}” until you change it in{" "}
        <Link href="/admin/cms/discovery" style={{ color: C.accent }}>New jobs found</Link>.
      </div>
    </div>
  );
}
