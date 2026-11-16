"use client";

// "Get job alerts": the configured Telegram and WhatsApp links as a plain card in the page, just above the footer.
// Separate from the CMS's Telegram posting: this only links to the channels.
//
// 16 Nov 2026: this replaces the floating "follow our channels" strip, which was fixed to the bottom of the screen
// and covered the text being read (on phones permanently, on larger screens while scrolling). The card is part of
// the page, so it never covers text, buttons or an Apply link, and needs no closing. Phones: stacked, as tested;
// tablets and desktops: one compact row. Not on the homepage, which has its own "Stay connected" section.

import React from "react";
import { usePathname } from "next/navigation";
import { Send } from "lucide-react";
import { siteConfig } from "@/config/site";
import { Container } from "@/components/ui/Container";

export function ChannelCard() {
  const telegram = siteConfig.links.telegram;
  const whatsapp = siteConfig.links.whatsapp;
  const pathname = usePathname();
  if ((!telegram && !whatsapp) || pathname === "/") return null;
  // Readable button text (WCAG AA): Telegram white on #16739F (5.3:1); WhatsApp #0B3D20 on #25D366 (6.2:1).
  const btn = "inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-full px-3 sm:px-4 py-2 text-xs font-bold transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A] focus-visible:ring-offset-2";
  return (
    <aside aria-label="Job alerts on Telegram and WhatsApp" data-channel-card>
      <Container className="pb-6 pt-2">
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-2xs sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-5 sm:py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-[#0F172A]">Get job alerts</p>
            <p className="mt-1 text-xs leading-relaxed text-[#475569] sm:mt-0.5">
              Follow LakshyaNaukri for new notifications, admit cards and results.
            </p>
          </div>
          <div className="mt-3 flex gap-2 sm:mt-0 sm:shrink-0">
            {telegram && (
              <a href={telegram} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#16739F] text-white hover:bg-[#0F6EA3]`}>
                <Send className="h-3.5 w-3.5" aria-hidden /> Telegram
              </a>
            )}
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#25D366] text-[#0B3D20] hover:bg-[#1EBE5B]`}>
                WhatsApp
              </a>
            )}
          </div>
        </div>
      </Container>
    </aside>
  );
}
