"use client";

// ═══════════════════════════════════════════════════════════
// Admin: what needs attention today
// ═══════════════════════════════════════════════════════════
//
// Shown above the job list. Lists live jobs with something due, overdue or
// going stale, worked out from the dates and stages already on each record.
// It is a prompt to go and check the official source; it changes nothing.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AttentionLevel, JobAttention } from "@/lib/cms/attention";

const C = {
  card: "rgba(14,21,38,0.72)", border: "rgba(148,163,184,0.14)", text: "#e2e8f0", muted: "#8c9bb8",
  accent: "#62b5ff", amber: "#d29922", red: "#f85149", green: "#3fb950",
};

const LEVEL: Record<AttentionLevel, { label: string; color: string }> = {
  NOW: { label: "Now", color: C.red },
  SOON: { label: "Soon", color: C.amber },
  CHECK: { label: "Check", color: C.muted },
};

interface Loaded { jobs: JobAttention[]; liveCount: number; telegramReady: boolean; problem: string | null }

async function fetchAttention(): Promise<Loaded> {
  try {
    const res = await fetch("/api/admin/cms/attention");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return { jobs: data.jobs ?? [], liveCount: data.liveCount ?? 0, telegramReady: Boolean(data.telegramReady), problem: null };
  } catch (e) {
    return { jobs: [], liveCount: 0, telegramReady: false, problem: e instanceof Error ? e.message : String(e) };
  }
}

export function AttentionPanel() {
  const [data, setData] = useState<Loaded | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchAttention().then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, []);

  async function sendNow() {
    setSending(true);
    setSent(null);
    try {
      const res = await fetch("/api/admin/cms/attention", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json();
      setSent(body.sent === "sent" ? "Sent to your Telegram." : body.error ?? "Telegram did not accept the message.");
    } catch {
      setSent("Could not reach the server.");
    } finally {
      setSending(false);
    }
  }

  if (!data) return null;
  if (data.problem) {
    return <div role="alert" style={{ color: C.red, fontSize: 12, marginBottom: 16 }}>Could not work out what needs attention: {data.problem}</div>;
  }

  const pressing = data.jobs.filter((j) => j.items.some((i) => i.level !== "CHECK"));
  const shown = showAll ? data.jobs : pressing;
  const hidden = data.jobs.length - pressing.length;

  return (
    <section aria-label="Needs attention" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: shown.length > 0 ? 12 : 0 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5ff" }}>Needs attention</span>
          <span style={{ fontSize: 12, color: pressing.length > 0 ? C.amber : C.green, marginLeft: 10 }}>
            {pressing.length > 0
              ? `${pressing.length} of ${data.liveCount} live job${data.liveCount === 1 ? "" : "s"}`
              : `Nothing pressing across ${data.liveCount} live job${data.liveCount === 1 ? "" : "s"}`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {sent && <span role="status" style={{ fontSize: 12, color: C.muted }}>{sent}</span>}
          {hidden > 0 && (
            <button onClick={() => setShowAll((v) => !v)} style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 12, padding: 0 }}>
              {showAll ? "Show only what is pressing" : `Show ${hidden} more to check when free`}
            </button>
          )}
          <button
            onClick={() => { void sendNow(); }}
            disabled={sending || !data.telegramReady}
            title={data.telegramReady ? "Sends this list to your own Telegram chat now. The same message arrives every morning." : "Private Telegram messages are not set up yet."}
            style={{ background: "none", border: `1px solid ${C.border}`, color: data.telegramReady ? C.accent : C.muted, cursor: sending || !data.telegramReady ? "not-allowed" : "pointer", fontSize: 12, padding: "4px 10px", borderRadius: 6 }}
          >
            {sending ? "Sending…" : "Send to my Telegram"}
          </button>
        </div>
      </div>

      {shown.map((job) => (
        <div key={job.id} style={{ borderTop: `1px solid ${C.border}`, padding: "10px 0" }}>
          <Link href={`/admin/cms/${job.id}`} style={{ color: C.text, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>{job.title}</Link>
          <span style={{ color: C.muted, fontSize: 12, marginLeft: 8 }}>{job.organizationName}</span>
          {job.items.filter((i) => showAll || i.level !== "CHECK").map((item, n) => (
            <div key={n} style={{ display: "flex", gap: 8, alignItems: "baseline", marginTop: 5, fontSize: 12, lineHeight: 1.5 }}>
              <span style={{ color: LEVEL[item.level].color, fontWeight: 700, minWidth: 44, flexShrink: 0 }}>{LEVEL[item.level].label}</span>
              <span style={{ color: C.text, minWidth: 0 }}>{item.message}</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
