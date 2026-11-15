// R3 (CMS 2.0, Nov 2026): one row shape for an announcement, used by the archive, the category pages and the
// homepage. Server component, no JavaScript. It shows only public fields (FeedEntry).
//   - Current: the notice, its stage, and the official button when the job has a still-valid link of that kind.
//   - Closed: kept for reference, never with an active button.
//   - Superseded: the title and its correction note only (no old text), with a link to what replaced it.

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { FeedEntry } from "@/lib/updates-feed";
import { KindChip, StateChip, StatusChip } from "./StatusChip";

const day = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return { mon: d.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }), day: d.getUTCDate(), full: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) };
};

export function UpdateRow({ entry, showJob = true, compact = false }: { entry: FeedEntry; showJob?: boolean; compact?: boolean }) {
  const d = day(entry.date);
  const past = entry.state !== "CURRENT";
  const jobHref = `/jobs/${entry.job.slug}#updates-history`;
  const replacement = entry.correction?.replacementKey ? `/jobs/${entry.correction.replacementKey.split("#")[0]}#updates-history` : undefined;
  return (
    <li data-update-row data-state={entry.state.toLowerCase()} data-type={entry.type}
      className={`grid grid-cols-[3.25rem_minmax(0,1fr)] sm:grid-cols-[3.75rem_minmax(0,1fr)_auto] gap-x-3 gap-y-2 items-start py-3.5`}>
      <time dateTime={entry.date} aria-label={d.full}
        className={`row-span-2 sm:row-span-1 flex flex-col items-center justify-center rounded-xl border text-[11px] font-bold uppercase leading-tight py-1.5 ${past ? "border-ln-past-line bg-ln-past-soft text-ln-past" : "border-ln-line bg-white text-ln-muted"}`}>
        {d.mon}<b className={`text-lg leading-none ${past ? "text-ln-past" : "text-ln-ink"}`}>{d.day}</b>
      </time>
      <div className="min-w-0 space-y-1">
        <h3 className={`text-[15px] font-bold leading-snug ${entry.state === "SUPERSEDED" ? "text-ln-muted line-through decoration-ln-void/40" : "text-ln-ink"}`}>
          {entry.state === "SUPERSEDED" ? entry.title : <Link href={jobHref} className="hover:underline underline-offset-2">{entry.title}</Link>}
        </h3>
        <p className="text-[13px] text-ln-muted leading-snug">
          {showJob && <Link href={`/jobs/${entry.job.slug}`} className="font-semibold text-ln-text hover:underline underline-offset-2">{entry.job.title}</Link>}
          {entry.stage && <>{showJob && " · "}{entry.stage.name}{entry.stage.when ? ` · ${entry.stage.when}` : ""}</>}
          {entry.state === "SUPERSEDED" && entry.correction && <>{(showJob || entry.stage) && " · "}corrected on {day(entry.correction.on).full}</>}
        </p>
        {!compact && entry.summary && entry.state === "CURRENT" && <p className="text-[13px] text-ln-text leading-relaxed">{entry.summary}</p>}
        {entry.state === "SUPERSEDED" && (replacement || entry.correction?.sourceUrl) && (
          <p className="text-[12.5px] text-ln-void">
            {replacement
              ? <Link href={replacement} className="font-semibold hover:underline underline-offset-2">Correct notice: {entry.correction?.replacementTitle}</Link>
              : <a href={entry.correction!.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline underline-offset-2">Official correction notice</a>}
          </p>
        )}
      </div>
      <div className="col-start-2 sm:col-start-3 flex flex-wrap sm:flex-col items-center sm:items-end gap-1.5">
        <div className="flex flex-wrap gap-1.5 sm:justify-end">
          <KindChip kind={entry.kind} label={entry.kindLabel} past={past} />
          <StateChip state={entry.state} />
          {entry.stage?.tentative && !past && <StatusChip tone="soon" title="The date is tentative in the notice">Tentative</StatusChip>}
        </div>
        {entry.action && entry.state === "CURRENT" && (
          <a href={entry.action.url} target="_blank" rel="noopener noreferrer" data-update-action
            className="inline-flex items-center gap-1.5 min-h-9 rounded-lg bg-ln-action px-3 text-[13px] font-bold text-white hover:opacity-90">
            {entry.action.label}<ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /><span className="sr-only"> (official site, opens in a new tab)</span>
          </a>
        )}
      </div>
    </li>
  );
}

/** A list of rows. */
export function UpdateList({ entries, showJob = true, compact = false, label }: { entries: FeedEntry[]; showJob?: boolean; compact?: boolean; label?: string }) {
  return (
    <ol aria-label={label} className="divide-y divide-ln-line">
      {entries.map((e) => <UpdateRow key={e.key} entry={e} showJob={showJob} compact={compact} />)}
    </ol>
  );
}
