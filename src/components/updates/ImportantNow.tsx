// R3 (CMS 2.0, Nov 2026): the homepage's "Important now". Each card is one job's own important update, chosen by
// the job page's rule (importantNow → pickImportantUpdate): urgent or calling for action, never routine news. The
// strip is left out entirely when there is none, so a thin feed never shows an empty box. No hooks: it renders the
// same on the server and in the homepage's client tree.

import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import type { FeedEntry } from "@/lib/updates-feed";
import { KindChip, StatusChip } from "./StatusChip";

export function ImportantNow({ entries }: { entries: FeedEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section data-important-now aria-labelledby="important-now-heading" className="border-b border-[#E2E8F0] bg-white">
      <div className="container mx-auto max-w-7xl px-4 py-6 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 id="important-now-heading" className="text-lg sm:text-xl font-black tracking-tight text-ln-ink">Important now</h2>
          <Link href="/updates" className="inline-flex items-center gap-1 text-sm font-bold text-[#C2410C] hover:underline">All updates <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
          {entries.map((e) => (
            <li key={e.key} data-important-now-item className={`flex flex-col gap-2 rounded-2xl border p-4 ${e.kind === "POSTPONEMENT" || e.kind === "CANCELLATION" ? "border-ln-urgent-line bg-ln-urgent-soft/50" : "border-ln-line bg-[#FBFAF7]"}`}>
              <div className="flex flex-wrap gap-1.5">
                <KindChip kind={e.kind} label={e.kindLabel} />
                {e.stage?.tentative && <StatusChip tone="soon">Tentative</StatusChip>}
              </div>
              <h3 className="text-[15px] font-bold leading-snug text-ln-ink">
                <Link href={`/jobs/${e.job.slug}#updates-history`} className="hover:underline underline-offset-2">{e.title}</Link>
              </h3>
              <p className="text-[12.5px] leading-snug text-ln-muted">{e.job.title}{e.stage?.when ? ` · ${e.stage.when}` : ""}</p>
              <div className="mt-auto pt-1">
                {e.action
                  ? <a href={e.action.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-ln-action px-3 text-[13px] font-bold text-white hover:opacity-90">{e.action.label}<ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /><span className="sr-only"> (official site, opens in a new tab)</span></a>
                  : <Link href={`/jobs/${e.job.slug}#updates-history`} className="inline-flex min-h-10 items-center text-[13px] font-bold text-[#C2410C] hover:underline">Details →</Link>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
