// R3 (CMS 2.0, Nov 2026): "Previous" on the admit card, result and answer key pages. Built from the stored,
// reviewed announcements (never from links), so a notice's history stays even after its link is removed. Shows
// the latest few here; the full, paginated list is the archive filtered by this type. Server component.

import Link from "next/link";
import type { FeedEntry, FeedTypeSlug } from "@/lib/updates-feed";
import { feedHref } from "@/lib/updates-feed";
import { UpdateList } from "./UpdateRow";

export function PreviousUpdates({ entries, type, noun, limit = 8 }: { entries: FeedEntry[]; type: FeedTypeSlug; noun: string; limit?: number }) {
  const mine = entries.filter((e) => e.type === type);
  const current = mine.filter((e) => e.state === "CURRENT");
  const previous = mine.filter((e) => e.state !== "CURRENT");
  return (
    <section data-previous-updates={type} aria-labelledby={`previous-${type}`} className="space-y-4">
      <div>
        <h2 id={`previous-${type}`} className="text-lg font-black text-[#0F172A] tracking-tight">Recorded {noun} notices</h2>
        <p className="text-xs text-[#475569]">From the reviewed notices of jobs on this site: current first, then earlier ones, kept with their status.</p>
      </div>
      {mine.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-ln-line bg-white/70 p-5 text-sm text-ln-muted">No {noun} notices recorded yet. They appear here as they are published.</p>
      ) : (
        <div className="rounded-2xl border border-ln-line bg-white px-4 sm:px-5">
          {current.length > 0 && <>
            <h3 className="border-b border-ln-line py-3 text-sm font-black text-ln-ink">Current</h3>
            <UpdateList entries={current} label={`Current ${noun} notices`} compact />
          </>}
          <h3 className={`border-b border-ln-line py-3 text-sm font-black text-ln-ink ${current.length > 0 ? "border-t" : ""}`}>Previous</h3>
          {previous.length > 0
            ? <UpdateList entries={previous.slice(0, limit)} label={`Previous ${noun} notices`} compact />
            : <p className="py-4 text-sm text-ln-muted">No earlier {noun} notices yet.</p>}
          <p className="border-t border-ln-line py-3 text-sm">
            <Link href={feedHref({ type })} className="font-bold text-[#C2410C] hover:underline">All {noun} notices ({mine.length}) →</Link>
          </p>
        </div>
      )}
    </section>
  );
}
