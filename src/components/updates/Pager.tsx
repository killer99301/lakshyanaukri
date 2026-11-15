// R3 (CMS 2.0, Nov 2026): page links for the archive. Plain links (work without JavaScript), the current page
// marked with aria-current, large tap targets.

import Link from "next/link";

function windowOf(page: number, pages: number): Array<number | "…"> {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out: Array<number | "…"> = [];
  let last = 0;
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - last > 1) out.push("…");
    out.push(n);
    last = n;
  }
  return out;
}

export function Pager({ page, pages, hrefFor, label = "Pages" }: { page: number; pages: number; hrefFor: (n: number) => string; label?: string }) {
  if (pages <= 1) return null;
  const btn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-bold";
  return (
    <nav aria-label={label} data-pager className="flex flex-wrap items-center gap-1.5">
      {page > 1 && <Link href={hrefFor(page - 1)} rel="prev" className={`${btn} border-ln-line bg-white text-ln-ink hover:bg-ln-past-soft`}>← Newer</Link>}
      {windowOf(page, pages).map((n, i) => n === "…"
        ? <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-ln-muted">…</span>
        : n === page
          ? <span key={n} aria-current="page" className={`${btn} border-[#C2410C] bg-[#FFF3EB] text-[#9A3412]`}>{n}</span>
          : <Link key={n} href={hrefFor(n)} aria-label={`Page ${n}`} className={`${btn} border-ln-line bg-white text-ln-ink hover:bg-ln-past-soft`}>{n}</Link>)}
      {page < pages && <Link href={hrefFor(page + 1)} rel="next" className={`${btn} border-ln-line bg-white text-ln-ink hover:bg-ln-past-soft`}>Older →</Link>}
    </nav>
  );
}
