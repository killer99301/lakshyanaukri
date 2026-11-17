"use client";

// ═══════════════════════════════════════════════════════════
// Today's date in India, the same on the server and in the browser (Nov 2026, React #418)
// ═══════════════════════════════════════════════════════════
//
// Public pages are generated ahead of time (at deploy, or when a job is published), so the HTML carries the date it
// was drawn on. If the browser computed "8 days left" from its own clock while hydrating, a page drawn yesterday would
// not match the HTML (React #418) and React would throw the server HTML away. So:
//   - The layout passes the India date the page was drawn on (`renderedOn`).
//   - While hydrating, every date-dependent component reads that same date: the first browser render matches the HTML.
//   - Straight after, React reads the visitor's current India date; components re-render once, only if it differs.
//   - The date is checked again at India's midnight and whenever the tab becomes visible or focused, so a page left
//     open overnight moves to the new day.
// One shared clock: a single timer and one set of listeners, however many components read it. A component re-renders
// only when the India date actually changes.

import React, { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { indiaDay, nextIndiaMidnight, noonInIndia } from "@/lib/lifecycle";

const RenderedOn = createContext<string | null>(null);

/** Gives every date-dependent component the India date this page was drawn on (YYYY-MM-DD). */
export function TodayProvider({ renderedOn, children }: { renderedOn: string; children: React.ReactNode }) {
  return <RenderedOn.Provider value={renderedOn}>{children}</RenderedOn.Provider>;
}

const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function start(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => listeners.forEach((l) => l());
  const arm = () => {
    clearTimeout(timer);
    // A second past India's midnight; a long sleep is re-checked when the tab comes back (timers pause in background tabs).
    const wait = Math.max(1_000, nextIndiaMidnight(new Date()).getTime() - Date.now() + 1_000);
    timer = setTimeout(() => { notify(); arm(); }, Math.min(wait, 2_147_000_000));
  };
  const recheck = () => { if (document.visibilityState !== "hidden") { notify(); arm(); } };
  arm();
  document.addEventListener("visibilitychange", recheck);
  window.addEventListener("focus", recheck);
  window.addEventListener("pageshow", recheck);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", recheck);
    window.removeEventListener("focus", recheck);
    window.removeEventListener("pageshow", recheck);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) stop = start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stop) { stop(); stop = null; }
  };
}

const currentDay = () => indiaDay(new Date());

/**
 * Today's date in India (YYYY-MM-DD): the page's own date while it is drawn and hydrated, then the visitor's current
 * India date. Outside a TodayProvider (e.g. the admin preview) it is simply the current India date.
 */
export function useIndiaToday(): string {
  const renderedOn = useContext(RenderedOn);
  return useSyncExternalStore(subscribe, currentDay, () => renderedOn ?? currentDay());
}

/** The same day as an instant (noon in India), for functions that take `now`. Stable for the whole day. */
export function useIndiaNow(): Date {
  const day = useIndiaToday();
  return useMemo(() => noonInIndia(day), [day]);
}
