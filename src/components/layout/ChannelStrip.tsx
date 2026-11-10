"use client";

// A slim "follow our channels" strip at the foot of public pages, with the
// configured Telegram and WhatsApp links. Separate from the CMS's Telegram
// posting: this only links to the channels.
//
// It never covers an Apply button: it steps aside while one is on screen, and
// a spacer the strip's height keeps the page's last lines clear of it. Closing
// it is remembered on this device for two weeks (where the browser allows
// storage; otherwise only for this visit). Overlays (menus, the filter drawer)
// sit above it.

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Send, X } from "lucide-react";
import { siteConfig } from "@/config/site";

const KEY = "ln-channel-strip-closed-until";
const FOR_DAYS = 14;

function closedUntil(): number {
  try { return Number(window.localStorage.getItem(KEY) ?? 0) || 0; } catch { return 0; }
}

const noSubscription = () => () => {};

export function ChannelStrip() {
  const telegram = siteConfig.links.telegram;
  const whatsapp = siteConfig.links.whatsapp;
  // The server never shows it, so the server's page and the browser's agree; the browser decides once it runs.
  const notClosedBefore = useSyncExternalStore(noSubscription, () => closedUntil() <= Date.now(), () => false);
  const [closedNow, setClosedNow] = useState(false);
  const open = notClosedBefore && !closedNow;
  const [applyInView, setApplyInView] = useState(false);
  // The layout stays mounted between pages: each new page's Apply buttons are looked for again.
  const pathname = usePathname();

  useEffect(() => {
    if (!open || typeof IntersectionObserver === "undefined") return;
    const buttons = Array.from(document.querySelectorAll("[data-apply-kind]"));
    const visible = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
      }
      setApplyInView(visible.size > 0);
    });
    buttons.forEach((b) => io.observe(b));
    // Leaving the page: its buttons no longer count.
    return () => { io.disconnect(); setApplyInView(false); };
  }, [open, pathname]);

  if (!open || (!telegram && !whatsapp)) return null;

  const close = () => {
    setClosedNow(true);
    try { window.localStorage.setItem(KEY, String(Date.now() + FOR_DAYS * 86_400_000)); } catch { /* storage blocked: closed for this visit */ }
  };

  const btn = "inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white transition-colors whitespace-nowrap";

  return (
    <>
      {/* Keeps the end of the page clear of the strip. */}
      <div aria-hidden className="h-16 sm:h-14" />
      <aside
        aria-label="Follow LakshyaNaukri for job alerts"
        data-channel-strip
        className={`fixed inset-x-0 bottom-0 z-40 transition-transform duration-200 sm:bottom-3 sm:px-4 ${applyInView ? "translate-y-[150%]" : "translate-y-0"}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2 border-t border-[#E2E8F0] bg-white/95 px-3 py-2 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur sm:gap-3 sm:rounded-full sm:border sm:px-4 sm:shadow-lg">
          <p className="min-w-0 flex-1 text-xs font-semibold leading-tight text-[#0F172A]">
            <span className="hidden sm:inline">Never miss a government job update. </span>
            <span className="sm:hidden">Get job alerts</span>
            <span className="hidden sm:inline text-[#475569] font-medium">Follow LakshyaNaukri for recruitment alerts.</span>
          </p>
          {telegram && (
            <a href={telegram} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#229ED9] hover:bg-[#1C8CC2]`}>
              <Send className="h-3.5 w-3.5" aria-hidden /> Telegram
            </a>
          )}
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#25D366] hover:bg-[#1EBE5B] text-[#0B3D20]`}>
              WhatsApp
            </a>
          )}
          <button type="button" onClick={close} aria-label="Close the channel links" className="shrink-0 rounded-full p-1.5 text-[#64748B] hover:bg-slate-100 hover:text-[#0F172A]">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </aside>
    </>
  );
}
