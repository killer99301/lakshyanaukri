// R3 (CMS 2.0, Nov 2026): Latest updates, the archive of every reviewed announcement of published recruitments.
// Built per request from the same public query as the job pages (so a publish or a take-down shows at once), with
// only public fields (src/lib/updates-feed.ts). Search engines: page 1 and each ?page=N canonical to themselves;
// filtered views are noindex, follow. No client JavaScript.

import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { getPublishedCmsOpportunities } from "@/lib/repository";
import { buildFeed, byMonth, feedHref, feedPage, filterFeed, isFiltered, readFeedQuery, typeCounts, FEED_TYPES } from "@/lib/updates-feed";
import { UpdateList } from "@/components/updates/UpdateRow";
import { Pager } from "@/components/updates/Pager";
import { FilterBar } from "@/components/updates/FilterBar";
import { StatusChip } from "@/components/updates/StatusChip";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TITLE = "Latest Updates: Admit Cards, Results, Exam Dates";
const DESCRIPTION = "Every recruitment notice recorded on LakshyaNaukri, newest first: admit cards, results, answer keys, exam dates, postponements and extensions, each with its status.";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const jobs = await getPublishedCmsOpportunities();
  const all = buildFeed(jobs, new Date());
  const q = readFeedQuery(params, all);
  const filtered = isFiltered(q);
  // A page number beyond the last page shows the last page: it is not a page of its own.
  const { page, outOfRange } = feedPage(filterFeed(all, q), q.page);
  return {
    title: page > 1 && !filtered ? `${TITLE} (page ${page})` : TITLE,
    description: DESCRIPTION,
    // Page 1 and each ?page=N are their own pages; a filtered view is a view of this one, not for search results.
    alternates: { canonical: filtered ? "/updates" : feedHref({ page }) },
    // Any other address (a filter, an empty form field, an unknown parameter, a page past the end) is not indexed.
    ...(filtered || outOfRange || Object.keys(params).some((k) => k !== "page") ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function UpdatesPage({ searchParams }: Props) {
  const params = await searchParams;
  const now = new Date();
  const jobs = await getPublishedCmsOpportunities();
  const all = buildFeed(jobs, now);
  const q = readFeedQuery(params, all);
  const entries = filterFeed(all, q);
  const page = feedPage(entries, q.page);
  const counts = typeCounts(all, { job: q.job, month: q.month, status: q.status });
  const jobOptions = [...new Map(all.map((e) => [e.job.slug, e.job.title])).entries()].map(([slug, title]) => ({ slug, title })).sort((a, b) => a.title.localeCompare(b.title));
  const months = [...new Set(all.map((e) => e.month))];
  const filtered = isFiltered(q);
  const typeLabel = q.type ? FEED_TYPES.find((t) => t.slug === q.type)?.label : undefined;
  const jobTitle = q.job ? jobOptions.find((j) => j.slug === q.job)?.title : undefined;

  return (
    <div className="min-h-screen bg-[#F7F6F2] pb-16">
      <div className="container mx-auto max-w-6xl px-4">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Latest updates" }]} />
        <header className="space-y-2 pb-5">
          <h1 className="text-[28px] sm:text-[34px] font-black tracking-tight text-ln-ink">Latest updates</h1>
          <p className="max-w-3xl text-[15px] leading-relaxed text-ln-text">
            Every notice we have recorded for the recruitments on this site, newest first: admit cards, results, answer keys, new dates, postponements and extensions. Older notices stay here with their status.
          </p>
        </header>

        <FilterBar q={q} counts={counts} jobs={jobOptions} months={months} />

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div id="updates-main" className="min-w-0 space-y-6">
            <p data-result-count className="text-sm text-ln-muted">
              {entries.length === 0 ? "No notices" : `${entries.length} notice${entries.length === 1 ? "" : "s"}`}
              {typeLabel ? ` · ${typeLabel}` : ""}{jobTitle ? ` · ${jobTitle}` : ""}
              {filtered && <> · <Link href="/updates" className="font-semibold text-[#C2410C] hover:underline">show all</Link></>}
            </p>

            {all.length === 0 ? (
              <EmptyArchive />
            ) : entries.length === 0 ? (
              <section className="rounded-2xl border border-ln-line bg-white p-6 text-center">
                <h2 className="text-lg font-bold text-ln-ink">Nothing matches these filters</h2>
                <p className="mt-1 text-sm text-ln-muted">Try another type or month, or see every notice.</p>
                <Link href="/updates" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[#C2410C] px-4 text-sm font-bold text-white hover:bg-[#9A3412]">Show all updates</Link>
              </section>
            ) : (
              <>
                {page.page === 1 && (
                  <section aria-labelledby="current-heading" data-section="current" className="rounded-2xl border border-ln-line bg-white px-4 sm:px-5 shadow-[0_1px_2px_rgba(17,24,39,.05)]">
                    <div className="flex items-center justify-between gap-2 border-b border-ln-line py-3.5">
                      <h2 id="current-heading" className="text-lg font-black text-ln-ink">Current</h2>
                      <span className="text-xs font-semibold text-ln-muted">{page.currentCount} still relevant</span>
                    </div>
                    {page.current.length > 0
                      ? <UpdateList entries={page.current} label="Current notices" />
                      : <p className="py-5 text-sm text-ln-muted">No current notices{filtered ? " for these filters" : " right now"}. Earlier notices are below.</p>}
                  </section>
                )}

                <section aria-labelledby="previous-heading" data-section="previous" className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="previous-heading" className="text-lg font-black text-ln-ink">Previous</h2>
                    <span className="text-xs font-semibold text-ln-muted">{page.previousCount} closed or corrected{page.pages > 1 ? ` · page ${page.page} of ${page.pages}` : ""}</span>
                  </div>
                  {page.previous.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-ln-line bg-white/60 p-5 text-sm text-ln-muted">No earlier notices yet{filtered ? " for these filters" : ""}. Notices move here once their exam or window has passed, or when they are corrected.</p>
                  ) : byMonth(page.previous).map((g) => (
                    <div key={g.month} className="rounded-2xl border border-ln-line bg-white px-4 sm:px-5">
                      <h3 className="border-b border-ln-line py-3 text-sm font-black uppercase tracking-wider text-ln-muted">{g.label}</h3>
                      <UpdateList entries={g.entries} label={`Notices from ${g.label}`} compact />
                    </div>
                  ))}
                  <Pager page={page.page} pages={page.pages} hrefFor={(n) => feedHref({ ...q, page: n })} label="Pages of earlier notices" />
                </section>
              </>
            )}
          </div>

          <aside className="space-y-4" aria-label="About this page">
            <section className="rounded-2xl border border-ln-line bg-white p-5">
              <h2 className="text-sm font-black text-ln-ink">What the labels mean</h2>
              <ul className="mt-3 space-y-2.5 text-[13px] text-ln-text">
                <li><StatusChip tone="open">Current</StatusChip> still relevant now</li>
                <li><StatusChip tone="past">Closed</StatusChip> its exam or window has passed, or a newer notice replaced it; kept for reference</li>
                <li><StatusChip tone="void">Superseded</StatusChip> corrected by later information; the correct notice is linked</li>
                <li><StatusChip tone="soon">Tentative</StatusChip> the notice gives the date as tentative</li>
              </ul>
            </section>
            <section className="rounded-2xl border border-ln-line bg-white p-5">
              <h2 className="text-sm font-black text-ln-ink">Browse by type</h2>
              <ul className="mt-3 space-y-2 text-[13px] font-semibold">
                <li><Link href="/admit-cards" className="text-[#C2410C] hover:underline">Admit cards: current and previous</Link></li>
                <li><Link href="/results" className="text-[#C2410C] hover:underline">Results: current and previous</Link></li>
                <li><Link href="/answer-keys" className="text-[#C2410C] hover:underline">Answer keys: current and previous</Link></li>
                <li><Link href="/jobs" className="text-[#C2410C] hover:underline">All recruitments</Link></li>
              </ul>
            </section>
            <p className="px-1 text-xs leading-relaxed text-ln-muted">Always check the recruiting body&apos;s official notice before acting on any update.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

function EmptyArchive() {
  return (
    <section className="rounded-2xl border border-ln-line bg-white p-6 text-center">
      <h2 className="text-lg font-bold text-ln-ink">No notices recorded yet</h2>
      <p className="mt-1 text-sm text-ln-muted">Admit cards, results and other notices appear here as they are published. Meanwhile, see the recruitments themselves.</p>
      <Link href="/jobs" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-[#C2410C] px-4 text-sm font-bold text-white hover:bg-[#9A3412]">Browse recruitments</Link>
    </section>
  );
}
