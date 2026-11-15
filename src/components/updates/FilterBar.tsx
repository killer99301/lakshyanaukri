// R3 (CMS 2.0, Nov 2026): the archive's filters. Type pills are plain links; recruitment, month and status are a
// GET form with labelled selects and a submit button, so everything works without JavaScript and with a keyboard.

import Link from "next/link";
import { FEED_TYPES, feedHref, monthLabel, type FeedQuery } from "@/lib/updates-feed";

export function FilterBar({ q, counts, jobs, months }: {
  q: FeedQuery;
  counts: Record<string, number>;
  jobs: Array<{ slug: string; title: string }>;
  months: string[];
}) {
  const pill = (active: boolean) => `inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap ${active ? "border-[#C2410C] bg-[#FFF3EB] text-[#9A3412]" : "border-ln-line bg-white text-ln-text hover:bg-ln-past-soft"}`;
  const types = FEED_TYPES.filter((t) => (counts[t.slug] ?? 0) > 0 || q.type === t.slug);
  const select = "min-h-11 w-full rounded-lg border border-[#D6D2C7] bg-white px-3 text-sm text-ln-ink";
  const filtered = !!(q.type || q.job || q.month || q.status);
  const active = [q.job, q.month, q.status].filter(Boolean).length;
  const renderForm = (className: string) => (
        <form method="get" action="/updates" className={className}>
          {q.type && <input type="hidden" name="type" value={q.type} />}
          <label className="grid gap-1 text-xs font-bold text-ln-muted">
            Recruitment
            <select name="job" defaultValue={q.job ?? ""} className={select}>
              <option value="">All recruitments</option>
              {jobs.map((j) => <option key={j.slug} value={j.slug}>{j.title}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-bold text-ln-muted">
            Month
            <select name="month" defaultValue={q.month ?? ""} className={select}>
              <option value="">Any month</option>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-bold text-ln-muted">
            Status
            <select name="status" defaultValue={q.status ?? ""} className={select}>
              <option value="">Any status</option>
              <option value="current">Current</option>
              <option value="closed">Closed</option>
              <option value="superseded">Superseded</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button type="submit" className="min-h-11 rounded-lg bg-[#C2410C] px-4 text-sm font-bold text-white hover:bg-[#9A3412]">Apply</button>
            {filtered && <Link href="/updates" className="inline-flex min-h-11 items-center rounded-lg border border-ln-line bg-white px-3 text-sm font-semibold text-ln-ink hover:bg-ln-past-soft">Clear</Link>}
          </div>
        </form>
  );
  return (
    <div data-filter-bar className="space-y-3">
      <nav aria-label="Update types" className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:overflow-visible">
        <ul className="flex gap-2 sm:flex-wrap">
          <li><Link href={feedHref({ ...q, type: undefined, page: 1 })} aria-current={!q.type ? "page" : undefined} className={pill(!q.type)}>All <span className="text-ln-muted font-bold">{counts.all ?? 0}</span></Link></li>
          {types.map((t) => (
            <li key={t.slug}><Link href={feedHref({ ...q, type: t.slug, page: 1 })} aria-current={q.type === t.slug ? "page" : undefined} className={pill(q.type === t.slug)}>
              {t.label} <span className="text-ln-muted font-bold">{counts[t.slug] ?? 0}</span>
            </Link></li>
          ))}
        </ul>
      </nav>
      {/* Phones: the form folds into one "Filter" control (a native disclosure, no JavaScript); wider screens: always shown. */}
      <details data-filter-sheet className="sm:hidden rounded-2xl border border-ln-line bg-white" {...(active > 0 ? { open: true } : {})}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-bold text-ln-ink">
          <span>Filter by recruitment, month or status{active > 0 ? ` (${active})` : ""}</span>
          <span aria-hidden="true" className="text-ln-muted">▾</span>
        </summary>
        <div className="border-t border-ln-line">{renderForm("grid gap-3 p-3")}</div>
      </details>
      <div className="hidden sm:block">{renderForm("grid gap-3 rounded-2xl border border-ln-line bg-white p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end")}</div>
    </div>
  );
}
