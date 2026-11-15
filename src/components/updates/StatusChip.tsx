// R3 (CMS 2.0, Nov 2026): one status chip for the archive, the category pages and the homepage. The word is
// always written out, so the state never depends on colour alone. Server component, no JavaScript.

import type { AnnouncementEventKind } from "@/types";
import type { FeedState } from "@/lib/updates-feed";

export type ChipTone = "open" | "action" | "urgent" | "past" | "void" | "soon";

const TONE: Record<ChipTone, string> = {
  open: "text-ln-open bg-ln-open-soft border-ln-open-line",
  action: "text-ln-action bg-ln-action-soft border-ln-action-line",
  urgent: "text-ln-urgent bg-ln-urgent-soft border-ln-urgent-line",
  past: "text-ln-past bg-ln-past-soft border-ln-past-line",
  void: "text-ln-void bg-ln-void-soft border-ln-void-line",
  // Tentative: a dashed outline, as in the design system.
  soon: "text-ln-soon bg-ln-soon-soft border-ln-soon-line border-dashed",
};

export function StatusChip({ tone, children, title }: { tone: ChipTone; children: React.ReactNode; title?: string }) {
  return (
    <span data-chip={tone} title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold tracking-wide ${TONE[tone]}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** The chip for an entry's state: Current, Closed or Superseded. */
export function StateChip({ state }: { state: FeedState }) {
  if (state === "CURRENT") return <StatusChip tone="open">Current</StatusChip>;
  if (state === "SUPERSEDED") return <StatusChip tone="void">Superseded</StatusChip>;
  return <StatusChip tone="past">Closed</StatusChip>;
}

/** The chip for what kind of news it is. Postponements and cancellations are urgent; the rest call for action. */
export function KindChip({ kind, label, past }: { kind: AnnouncementEventKind; label: string; past?: boolean }) {
  const tone: ChipTone = past ? "past" : kind === "POSTPONEMENT" || kind === "CANCELLATION" ? "urgent" : kind === "EXTENSION" || kind === "NEW_RECRUITMENT" ? "open" : "action";
  return <StatusChip tone={tone}>{label}</StatusChip>;
}
