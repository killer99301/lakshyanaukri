"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAIN_NAV_ITEMS } from "@/lib/constants";
import { Button } from "../ui/Button";
import { siteConfig } from "@/config/site";

export const MobileNav: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const pathname = usePathname();

  const toggleOpen = () => setIsOpen((prev) => !prev);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);

  // A new page closes the menu (links also close it on click).
  const [openedOn, setOpenedOn] = useState(pathname);
  if (pathname !== openedOn) { setOpenedOn(pathname); if (isOpen) setIsOpen(false); }

  // While open, the page behind does not scroll (16 Nov 2026): the page root's overflow is locked and put back exactly
  // as it was on close, Escape, navigation or unmount. The page's scroll position is kept (overflow: hidden does not
  // move it). The panel scrolls on its own, and overscroll-contain stops its scrolling from carrying on to the page.
  useEffect(() => {
    if (!isOpen) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { root.style.overflow = before; };
  }, [isOpen]);

  // While open, keyboard focus stays in the menu: the menu button and the panel's visible controls, in order. Tab after
  // the last goes to the button, Shift+Tab from the button goes to the last; focus can never land on the page hidden
  // behind the panel. Collapsed sections are not rendered, so they are never in the cycle. Escape closes the menu and
  // puts focus back on its button; the button closes it too. After closing, the page's normal Tab order is back.
  useEffect(() => {
    if (!isOpen) return;
    const focusables = (): HTMLElement[] => [
      ...(toggle.current ? [toggle.current] : []),
      ...Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
        .filter((el) => el.getClientRects().length > 0),
    ];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setIsOpen(false); toggle.current?.focus(); return; }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = at === -1 ? (e.shiftKey ? list.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + list.length) % list.length;
      e.preventDefault();
      list[next].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // Used below xl (1280 px): phones, tablets and small laptops, where the full link row does not fit (16 Nov 2026:
  // it used to stop at md, 768 px, and the link row was cut off between 768 and about 1150 px).
  return (
    <div className="xl:hidden">
      <button
        type="button"
        ref={toggle}
        onClick={toggleOpen}
        aria-label="Toggle mobile menu"
        aria-expanded={isOpen}
        aria-controls="mobile-nav-panel"
        className="p-2 text-[#0F172A] hover:text-[#EA580C] hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
      >
        {isOpen ? <X className="h-6 w-6" aria-hidden /> : <Menu className="h-6 w-6" aria-hidden />}
      </button>

      {isOpen && (
        <nav ref={panel} id="mobile-nav-panel" aria-label="Main" className="fixed inset-x-0 top-16 bottom-0 z-50 bg-white border-b border-[#E2E8F0] overflow-y-auto overscroll-contain shadow-2xl">
          <div className="px-4 py-6 space-y-4 max-w-lg mx-auto">
            <div className="space-y-1">
              {MAIN_NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                const hasSubitems = item.items && item.items.length > 0;
                const isExpanded = expandedItem === item.title;

                return (
                  <div key={item.title} className="border-b border-slate-100 last:border-none pb-1">
                    {hasSubitems ? (
                      <div>
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedItem(isExpanded ? null : item.title)}
                          className={cn(
                            "flex items-center justify-between w-full py-3 px-3 text-base font-semibold rounded-lg transition-colors",
                            isActive ? "text-[#EA580C] bg-[#FFF7ED]" : "text-[#0F172A]"
                          )}
                        >
                          <span>{item.title}</span>
                          <ChevronDown
                            className={cn(
                              "h-5 w-5 text-slate-400 transition-transform",
                              isExpanded && "rotate-180 text-[#EA580C]"
                            )}
                          />
                        </button>
                        {isExpanded && (
                          <div className="pl-4 pr-2 py-1 space-y-1 bg-slate-50 rounded-lg mb-2">
                            {item.items?.map((subitem) => (
                              <Link
                                key={subitem.title}
                                href={subitem.href}
                                onClick={() => setIsOpen(false)}
                                className="block py-2 px-3 text-sm font-medium text-[#475569] hover:text-[#EA580C]"
                              >
                                {subitem.title}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <Link
                        href={item.href}
                        onClick={() => setIsOpen(false)}
                        className={cn(
                          "block py-3 px-3 text-base font-semibold rounded-lg transition-colors",
                          isActive ? "text-[#EA580C] bg-[#FFF7ED]" : "text-[#0F172A]"
                        )}
                      >
                        {item.title}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pt-4 border-t border-[#E2E8F0] space-y-2">
              <Link href="/jobs" onClick={() => setIsOpen(false)} className="block w-full">
                <Button variant="primary" className="w-full justify-center text-xs font-bold py-2.5">
                  Browse All Jobs & Recruitments
                </Button>
              </Link>
              <a href={siteConfig.links.telegram} target="_blank" rel="noopener noreferrer" onClick={() => setIsOpen(false)} className="block w-full">
                <Button variant="outline" className="w-full justify-center text-xs font-bold py-2.5 border-slate-300">
                  Join our Telegram channel
                </Button>
              </a>
              {siteConfig.links.whatsapp && (
                <a href={siteConfig.links.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => setIsOpen(false)} className="block w-full">
                  <Button variant="outline" className="w-full justify-center text-xs font-bold py-2.5 border-slate-300">
                    Follow our WhatsApp channel
                  </Button>
                </a>
              )}
            </div>
          </div>
        </nav>
      )}
    </div>
  );
};
