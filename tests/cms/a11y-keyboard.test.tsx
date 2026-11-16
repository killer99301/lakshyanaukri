// Accessibility fixes O1-O3 (16 Nov 2026): named pagination buttons, a labelled sort menu with a visible keyboard
// focus ring, and sideways-scrolling tables that keyboard users can reach. Pure: renders to markup and reads the source;
// the overflow/resize/keyboard behaviour of ScrollTable is checked in a real browser (see the O1-O3 report).
//   npx tsx --tsconfig tsconfig.json tests/cms/a11y-keyboard.test.tsx
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { JobsPagination } from "@/components/jobs/JobsPagination";
import { JobsToolbar } from "@/components/jobs/JobsToolbar";
import { ScrollTable } from "@/components/ui/ScrollTable";

const noop = () => {};
const pager = (currentPage: number, totalPages: number) =>
  renderToStaticMarkup(<JobsPagination currentPage={currentPage} totalPages={totalPages} onPageChange={noop} />);
const buttons = (h: string) => [...h.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], body: m[2] }));

suite("Keyboard and screen-reader fixes (O1-O3)");

test("KA01 pagination: a named nav; Previous/Next have names; chevrons hidden; every button type=button", () => {
  const h = pager(2, 4);
  assert.match(h, /^<nav aria-label="Job list pages"/);
  const b = buttons(h);
  assert.equal(b.length, 6, "prev + 4 pages + next");
  assert.match(b[0].attrs, /aria-label="Previous page"/);
  assert.match(b[5].attrs, /aria-label="Next page"/);
  for (const x of [b[0], b[5]]) assert.match(x.body, /<svg[^>]*aria-hidden="true"/);
  assert.ok(b.every((x) => /type="button"/.test(x.attrs)));
});

test("KA02 pagination: page buttons say 'Page N'; only the current page has aria-current", () => {
  const b = buttons(pager(2, 4));
  assert.deepEqual(b.slice(1, 5).map((x) => (x.attrs.match(/aria-label="([^"]*)"/) ?? [])[1]), ["Page 1", "Page 2", "Page 3", "Page 4"]);
  assert.deepEqual(b.map((x) => /aria-current="page"/.test(x.attrs)), [false, false, true, false, false, false]);
  // Previous disabled on page 1, Next on the last page: unchanged
  assert.match(buttons(pager(1, 4))[0].attrs, /disabled=""/);
  assert.match(buttons(pager(4, 4))[5].attrs, /disabled=""/);
});

test("KA03 pagination: the page list itself is unchanged (1-5, ellipsis, last page); ellipsis hidden from screen readers", () => {
  const h = pager(8, 8);
  const b = buttons(h);
  assert.deepEqual(b.slice(1, -1).map((x) => x.body), ["1", "2", "3", "4", "5", "8"]);
  assert.match(b[6].attrs, /aria-label="Page 8"/);
  assert.match(b[6].attrs, /aria-current="page"/);
  assert.match(h, /<span aria-hidden="true"[^>]*>\.\.\.<\/span>/);
  assert.equal(pager(1, 1), "", "a single page still shows no bar");
});

test("KA04 sort menu: the visible label is tied to the select; it has the same name on phones; same options", () => {
  const h = renderToStaticMarkup(<JobsToolbar totalCount={40} sortBy="latest" setSortBy={noop} viewMode="compact-list" setViewMode={noop} />);
  const id = (h.match(/<select[^>]*\bid="([^"]+)"/) ?? [])[1];
  assert.ok(id, "select has an id");
  assert.ok(h.includes(`<label for="${id}" class="font-semibold hidden sm:inline">Sort by:</label>`));
  assert.match(h, /<select[^>]*aria-label="Sort by"/);
  assert.deepEqual([...h.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)</g)].map((m) => `${m[1]}=${m[2]}`),
    ["latest=Latest", "deadline=Closing Soon", "vacancies=Vacancies (High to Low)"]);
});

test("KA05 sort menu: the faint 20% orange focus ring is replaced by the dark keyboard ring", () => {
  const cls = (renderToStaticMarkup(<JobsToolbar totalCount={1} sortBy="latest" setSortBy={noop} viewMode="compact-list" setViewMode={noop} />)
    .match(/<select[^>]*class="([^"]+)"/) ?? [])[1] ?? "";
  assert.ok(!cls.includes("ring-[#EA580C]/20"));
  for (const c of ["focus:outline-none", "focus-visible:ring-2", "focus-visible:ring-[#0F172A]", "focus-visible:ring-offset-2"]) assert.ok(cls.split(/\s+/).includes(c), c);
});

test("KA06 ScrollTable: first render is a plain scroll box (no Tab stop, no region) so server and client agree", () => {
  const h = renderToStaticMarkup(<ScrollTable label="Post-wise vacancies" className="rounded-xl border"><table><tbody><tr><td>x</td></tr></tbody></table></ScrollTable>);
  assert.match(h, /^<div data-scroll-table="fits" class="overflow-x-auto rounded-xl border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-\[#0F172A\] focus-visible:ring-offset-2"><table>/);
  assert.ok(!/tabindex|role=|aria-label/.test(h));
});

test("KA07 ScrollTable: becomes a named, focusable region only while it overflows; watches resizes; safe without ResizeObserver", () => {
  const src = readFileSync("src/components/ui/ScrollTable.tsx", "utf8");
  assert.match(src, /el\.scrollWidth > el\.clientWidth \+ 1/);
  assert.match(src, /role=\{scrolls \? "region" : undefined\}/);
  assert.match(src, /aria-label=\{scrolls \? label : undefined\}/);
  assert.match(src, /tabIndex=\{scrolls \? 0 : undefined\}/);
  assert.match(src, /new ResizeObserver\(check\)/);
  assert.match(src, /observer\.observe\(el\.firstElementChild\)/);
  assert.match(src, /typeof ResizeObserver === "undefined"[\s\S]*addEventListener\("resize", check\)[\s\S]*removeEventListener\("resize", check\)/);
  assert.match(src, /observer\.disconnect\(\)/);
});

test("KA08 all 7 sideways-scrolling tables use ScrollTable with a meaningful name; no bare scroll wrapper left", () => {
  const uses: Record<string, string[]> = {
    "src/components/jobs/JobDetailSections.tsx": ['label="Important dates"', 'label="Post-wise vacancies"', 'label="Category-wise vacancies"', 'label="Application fee"'],
    "src/components/jobs/FeesAndPortals.tsx": ["label={g.post ? `Application fee for ${g.post}` : \"Application fee\"}"],
    "src/components/jobs/ExamPatternSyllabus.tsx": ["label={`${paper.name}: exam pattern`}"],
    "src/components/jobs/VacancyTableSection.tsx": ["label={`${g.name}: ${detailWords}-wise vacancies`}"],
  };
  let n = 0;
  for (const [file, labels] of Object.entries(uses)) {
    const src = readFileSync(file, "utf8");
    assert.match(src, /import \{ ScrollTable \} from "@\/components\/ui\/ScrollTable";/);
    for (const l of labels) { assert.ok(src.includes(`<ScrollTable ${l}`), `${file}: ${l}`); n++; }
    assert.ok(!/<div className="[^"]*overflow-x-auto/.test(src), `${file}: no plain overflow-x-auto wrapper`);
    assert.equal((src.match(/<ScrollTable /g) ?? []).length, (src.match(/<\/ScrollTable>/g) ?? []).length);
  }
  assert.equal(n, 7);
});
