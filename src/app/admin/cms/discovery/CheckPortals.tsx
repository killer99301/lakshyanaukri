"use client";

// Check portals now (N4): the admin starts one collector run and sees what it did.
// Whether a run reads the real portals is decided on the server; here it is said
// plainly: off (nothing is fetched), a test run on saved pages (not a portal scan),
// or a live scan.

import { useEffect, useState } from "react";
import { C, PANEL, badge, quietBtn } from "../import/ui";

type Mode = "off" | "fixtures" | "live";
interface SourceOutcome { id: string; url: string; status: string; items: number; error?: string }
interface Summary { mode: Exclude<Mode, "off">; startedAt: string; finishedAt: string; complete: boolean; sources: SourceOutcome[];
  counts: { newLeads: number; alreadyKnown: number; moreSources: number; failedSources: number; sourcesRead: number } }

const MODE_TEXT: Record<Mode, string> = {
  off: "Live portal scans are not enabled on this site yet. Nothing is fetched from here.",
  fixtures: "Test mode: a run reads saved test pages on this computer, not the real portals.",
  live: "A run reads each enabled portal's listing page once, if its robots.txt allows.",
};

export function CheckPortals({ onDone }: { onDone: () => void }) {
  const [info, setInfo] = useState<{ mode: Mode; sources: Array<{ id: string; name: string }> } | null>(null);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/cms/discovery/run").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) setInfo(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const run = async () => {
    if (running) return;
    setRunning(true); setErr(null); setSummary(null);
    try {
      const res = await fetch("/api/admin/cms/discovery/run", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setErr(d.error ?? `HTTP ${res.status}`);
      else { setSummary(d); onDone(); }
    } catch { setErr("The portal check could not be reached. Check the connection and try again."); }
    setRunning(false);
  };

  const mode = info?.mode ?? "off";
  return (
    <div data-check-portals data-check-mode={mode} style={{ ...PANEL, padding: 12, marginBottom: 12, display: "grid", gap: 8, fontSize: 12, color: C.text }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button data-check-portals-run onClick={() => { void run(); }} disabled={running || mode === "off" || !info} style={{ ...quietBtn, opacity: mode === "off" ? 0.5 : 1 }}>
          {running ? "Checking portals…" : "Check portals now"}
        </button>
        <span style={badge(mode === "live" ? C.green : mode === "fixtures" ? C.amber : C.muted)}>{mode === "live" ? "Live" : mode === "fixtures" ? "Test pages" : "Off"}</span>
        <span style={{ color: C.muted }}>{MODE_TEXT[mode]}</span>
      </div>
      {info && info.sources.length > 0 && <div style={{ color: C.muted }}>Sources: {info.sources.map((s) => s.name).join(", ")}.</div>}
      {err && <div role="alert" data-check-portals-error style={{ color: C.red }}>{err}</div>}
      {summary && (
        <div data-check-portals-summary data-complete={summary.complete ? "yes" : "no"} style={{ display: "grid", gap: 4 }}>
          <div role="status" style={{ color: summary.complete ? C.green : C.amber, fontWeight: 600 }}>
            {summary.mode === "fixtures" ? "Test run on saved pages (not a portal scan): " : "Portal check: "}
            {summary.complete ? "every source was read." : `${summary.counts.failedSources} source${summary.counts.failedSources === 1 ? "" : "s"} could not be read; the others were.`}
          </div>
          <div data-check-portals-counts>
            New leads: <b>{summary.counts.newLeads}</b> · Already known: <b>{summary.counts.alreadyKnown}</b> · Known, seen on another source too: <b>{summary.counts.moreSources}</b> · Sources read: <b>{summary.counts.sourcesRead}</b> · Sources that failed: <b>{summary.counts.failedSources}</b>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: C.muted }}>
            {summary.sources.map((s) => (
              <li key={s.id} data-check-source={s.id} data-check-source-status={s.status} style={{ color: s.status === "OK" || s.status === "EMPTY" ? C.muted : C.red }}>
                {s.id}: {s.status === "OK" ? `${s.items} link${s.items === 1 ? "" : "s"} read` : s.status === "EMPTY" ? "read, nothing found" : `not read — ${s.error ?? s.status}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
