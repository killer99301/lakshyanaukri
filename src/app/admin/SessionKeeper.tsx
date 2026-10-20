"use client";

// ═══════════════════════════════════════════════════════════
// Admin: keeping the session alive while someone is working
// ═══════════════════════════════════════════════════════════
//
// A session ends after 30 minutes without a request to the site. Reading a
// notice in another tab, or typing a long syllabus, makes no request, so the
// next save used to fail and the next click went to the login page.
//
// While the admin is actually using the page (a key, click or scroll in the
// last 10 minutes) and the tab is open, the session is touched every 5
// minutes. A page left alone still times out as before: nothing is touched
// once the activity stops.
//
// If the session has ended anyway, a banner says so, with a link that signs
// in on a new tab, so nothing typed on this page is lost.

import { useEffect, useRef, useState } from "react";

const TOUCH_EVERY_MS = 5 * 60 * 1000;
const ACTIVE_WITHIN_MS = 10 * 60 * 1000;

export function SessionKeeper() {
  const lastActivity = useRef(0);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    lastActivity.current = Date.now();
    const mark = () => { lastActivity.current = Date.now(); };
    const events = ["keydown", "mousedown", "scroll", "touchstart", "input"] as const;
    for (const e of events) window.addEventListener(e, mark, { passive: true, capture: true });

    const touch = async () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivity.current > ACTIVE_WITHIN_MS) return;
      try {
        const res = await fetch("/api/admin/auth/me", { cache: "no-store" });
        setEnded(res.status === 401);
      } catch { /* offline for a moment: try again next time */ }
    };
    const timer = window.setInterval(() => { void touch(); }, TOUCH_EVERY_MS);
    return () => {
      window.clearInterval(timer);
      for (const e of events) window.removeEventListener(e, mark, { capture: true });
    };
  }, []);

  if (!ended) return null;
  return (
    <div role="alert" style={{ position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 50, maxWidth: 720, margin: "0 auto", padding: "12px 16px", borderRadius: 10, background: "#2a1508", border: "1px solid rgba(249,115,22,0.55)", color: "#fed7aa", fontSize: 13, lineHeight: 1.5, boxShadow: "0 12px 32px rgba(0,0,0,0.45)" }}>
      Your admin session has ended, so saving will not work. {" "}
      <a href="/admin/login" target="_blank" rel="noreferrer" style={{ color: "#fdba74", fontWeight: 700 }}>Sign in again in a new tab</a>
      , then come back here and save: what you have typed on this page is kept.
    </div>
  );
}
