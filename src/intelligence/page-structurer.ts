// ═══════════════════════════════════════════════════════════
// Phase 13A Layer 1: DOM-Preserving Page Structurer
// ═══════════════════════════════════════════════════════════
//
// Converts raw HTML into a structured PageDocument that preserves
// section boundaries, table rows, nested list hierarchies, and
// link context. This intermediate representation feeds Layer 2
// (LLM structured extraction) with section-scoped chunks rather
// than the lossy flat text that the current stripTags() produces.
//
// Design rules:
//   - No LLM calls here — purely deterministic DOM traversal
//   - rawHtml is preserved on every section and table so Layer 2
//     can send context-bounded chunks without re-parsing the page
//   - Text normalization (collapsed whitespace) is applied to the
//     text fields; rawHtml is kept pristine for evidence anchoring
//   - Section detection is generic-first; not GovtJobGuru-specific
//   - All existing extractIntakeFields() callers are unaffected

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element as CheerioElement } from "domhandler";

// ─── Exported types ───────────────────────────────────────────

export type SectionType =
  | "overview"
  | "vacancy"
  | "dates"
  | "eligibility"
  | "financial"
  | "selection"
  | "how_to_apply"
  | "links"
  | "conditions"
  | "other";

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  caption?: string;
  // Original HTML — sent to Layer 2 verbatim; never stripped
  rawHtml: string;
  // Heading of the section this table belongs to (for evidence anchoring)
  sectionHeading: string;
}

export interface ParsedListItem {
  text: string;
  // 0 = top level, 1 = one nesting level deep, etc.
  level: number;
  children: ParsedListItem[];
}

export interface ParsedList {
  items: ParsedListItem[];
  ordered: boolean;
  rawHtml: string;
}

export interface ParsedLink {
  text: string;
  // Raw href as found in the DOM
  href: string;
  // Absolute URL (resolved against the page's base URL)
  resolvedHref: string;
  // Normalized text of the containing element for evidence context
  surroundingText: string;
  sectionHeading: string;
}

export interface PageSection {
  type: SectionType;
  heading: string;
  // Normalized plain text (whitespace collapsed, entities decoded)
  // Used for evidence verification with normalized matching
  text: string;
  // Original HTML of this section (heading + body) for Layer 2
  rawHtml: string;
  tables: ParsedTable[];
  lists: ParsedList[];
  links: ParsedLink[];
  // Paragraph-level text blocks (excludes table/list content)
  paragraphs: string[];
}

export interface PageDocument {
  title: string | undefined;
  url: string;
  sections: PageSection[];
  // Flat deduplicated list of all links across all sections
  allLinks: ParsedLink[];
}

// ─── Section type vocabulary ──────────────────────────────────
//
// Each SectionType maps to a set of keyword substrings that, when
// found in a heading, classify that section. The order of the map
// determines precedence when multiple types would match.

const SECTION_TYPE_KEYWORDS: Array<[SectionType, string[]]> = [
  ["dates",       ["important date", "key date", "schedule", "timeline", "last date", "closing date", "opening date"]],
  ["vacancy",     ["vacanc", "post detail", "no of post", "number of post", "opening", "recruitment detail", "post name"]],
  ["eligibility", ["eligib", "qualification", "age limit", "educational", "academic", "criteria"]],
  ["financial",   ["fee", "payment", "salary", "pay scale", "remuneration", "stipend", "compensation", "emolument"]],
  ["selection",   ["selection", "exam pattern", "test pattern", "marking scheme", "syllabus", "procedure", "merit"]],
  ["how_to_apply",["how to apply", "apply online", "application process", "registration process", "step to apply"]],
  ["links",       ["download", "important link", "official link", "notification link"]],
  ["conditions",  ["terms", "condition", "bond", "undertaking", "probation", "restriction", "scribe", "biometric"]],
];

function classifySectionType(heading: string): SectionType {
  const lower = heading.toLowerCase();
  for (const [type, keywords] of SECTION_TYPE_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return type;
  }
  return "other";
}

// Content-signal reclassification for "other" sections
//
// Some recruitment pages (e.g. UIIC) use post-specific headings like
// "Administrative Officer (Scale I) - Generalists" that don't contain
// eligibility keywords in the heading, but whose body contains structured
// qualification/age fields. We upgrade those from "other" → "eligibility"
// using strong content signals rather than heading text alone.
//
// Signals chosen to be high-precision on recruitment pages:
//   "qualification:"  — structured eligibility field (field: value pattern)
//   "age limit:"      — structured age-limit field
//   "years as on"     — age-date reference unique to eligibility blocks
//
// Vacancy sections also mention vacancies, but never contain these phrases.
// We intentionally keep this narrow to avoid false upgrades.

const ELIGIBILITY_CONTENT_SIGNALS = [
  "qualification:",
  "age limit:",
  "years as on",
];

function maybeReclassifyAsEligibility(section: PageSection): PageSection {
  if (section.type !== "other") return section;
  const lower = section.text.toLowerCase();
  if (ELIGIBILITY_CONTENT_SIGNALS.some((sig) => lower.includes(sig))) {
    return { ...section, type: "eligibility" };
  }
  return section;
}

// ─── Text normalization ───────────────────────────────────────
//
// Two levels of normalization:
//   displayText  — human-readable: collapses whitespace
//   matchingText — for evidence verification: lowercase + collapse + strip punctuation
//
// Layer 2 evidence anchoring uses matchingText so that whitespace
// differences (e.g. table-cell boundaries injecting newlines) do
// not cause false mismatches.

function displayText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s₹]/g, "")
    .trim();
}

// Returns true when a candidate value's text can be located inside
// the provided section text using normalized matching.
// Layer 2 MUST call this before accepting an LLM-derived value.
export function evidencePresent(value: string | number, sectionText: string): boolean {
  const normValue = normalizeForMatching(String(value));
  const normSection = normalizeForMatching(sectionText);
  // Require at least 3 chars to guard against trivial matches on "1", "of", etc.
  if (normValue.length < 3) return true;
  return normSection.includes(normValue);
}

// ─── URL resolution ───────────────────────────────────────────

function resolveUrl(href: string, base: string): string {
  if (!href) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

// ─── Table parser ─────────────────────────────────────────────

function parseTable(
  $: CheerioAPI,
  el: CheerioElement,
  sectionHeading: string,
): ParsedTable {
  const caption = $(el).find("caption").first().text().trim() || undefined;
  const headers: string[] = [];
  const dataRows: string[][] = [];

  const allRows = $(el).find("tr").toArray();
  if (allRows.length === 0) {
    return { headers: [], rows: [], caption, rawHtml: $.html(el), sectionHeading };
  }

  // First row: prefer <th> elements; fall back to first-row <td>
  const firstRow = $(allRows[0]);
  const thCells = firstRow.find("th");
  if (thCells.length > 0) {
    thCells.each((_, th) => { headers.push(displayText($(th).text())); });
    allRows.slice(1).forEach((tr) => {
      const row: string[] = [];
      $(tr).find("td, th").each((_, td) => { row.push(displayText($(td).text())); });
      if (row.some((c) => c.length > 0)) dataRows.push(row);
    });
  } else {
    // First row is data headers (all <td>)
    firstRow.find("td").each((_, td) => { headers.push(displayText($(td).text())); });
    allRows.slice(1).forEach((tr) => {
      const row: string[] = [];
      $(tr).find("td").each((_, td) => { row.push(displayText($(td).text())); });
      if (row.some((c) => c.length > 0)) dataRows.push(row);
    });
  }

  return {
    headers,
    rows: dataRows,
    caption,
    rawHtml: $.html(el),
    sectionHeading,
  };
}

// ─── List parser (recursive) ──────────────────────────────────

function parseListItems(
  $: CheerioAPI,
  listEl: CheerioElement,
  level: number,
): ParsedListItem[] {
  const items: ParsedListItem[] = [];
  $(listEl).children("li").each((_, li) => {
    // Clone so we can remove child lists without mutating the original
    const $li = $(li).clone();
    $li.find("ul, ol").remove();
    const text = displayText($li.text());

    const children: ParsedListItem[] = [];
    $(li)
      .children("ul, ol")
      .each((_, childList) => {
        children.push(...parseListItems($, childList, level + 1));
      });

    if (text || children.length > 0) {
      items.push({ text, level, children });
    }
  });
  return items;
}

function parseList(
  $: CheerioAPI,
  el: CheerioElement,
): ParsedList {
  return {
    items: parseListItems($, el, 0),
    ordered: el.tagName.toLowerCase() === "ol",
    rawHtml: $.html(el),
  };
}

// ─── Link extractor ───────────────────────────────────────────

function parseLink(
  $: CheerioAPI,
  el: CheerioElement,
  baseUrl: string,
  sectionHeading: string,
): ParsedLink | null {
  const href = $(el).attr("href") ?? "";
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return null;
  const text = displayText($(el).text());
  const parent = el.parent;
  const surroundingText = parent
    ? displayText($(parent).text()).slice(0, 200)
    : text;
  return {
    text,
    href,
    resolvedHref: resolveUrl(href, baseUrl),
    surroundingText,
    sectionHeading,
  };
}

// ─── Content area detection ───────────────────────────────────
//
// Priority cascade: specific content wrappers → main → body.
// This avoids pulling nav/header/footer/sidebar content into the
// extracted sections.

const CONTENT_SELECTORS = [
  ".entry-content",
  ".post-content",
  ".article-content",
  ".td-post-content",
  "article .content",
  "article",
  '[role="main"]',
  "main",
];

function findContentRoot($: CheerioAPI): string {
  for (const sel of CONTENT_SELECTORS) {
    if ($(sel).length > 0) return sel;
  }
  return "body";
}

// ─── Section builder ──────────────────────────────────────────
//
// Given a heading text and the DOM elements that follow it (up to
// the next heading), produces a fully-populated PageSection.

function buildSection(
  $: CheerioAPI,
  heading: string,
  elements: CheerioElement[],
  baseUrl: string,
  isOverview = false,
): PageSection {
  const type = isOverview ? "overview" : classifySectionType(heading);
  const tables: ParsedTable[] = [];
  const lists: ParsedList[] = [];
  const links: ParsedLink[] = [];
  const paragraphs: string[] = [];
  const htmlParts: string[] = [];

  for (const el of elements) {
    const tag = el.type === "tag" ? el.tagName.toLowerCase() : "";
    htmlParts.push($.html(el));

    if (tag === "table") {
      tables.push(parseTable($, el, heading));
    } else if (tag === "ul" || tag === "ol") {
      lists.push(parseList($, el));
    } else {
      // Collect paragraphs and nested tables/lists within divs etc.
      const $el = $(el);

      // Nested tables
      $el.find("table").each((_, t) => {
        // Only top-level tables within this element, not inside lists
        if ($(t).closest("ul, ol").length === 0) {
          tables.push(parseTable($, t as CheerioElement, heading));
        }
      });

      // Nested lists
      $el.find("ul, ol").each((_, l) => {
        if ($(l).parent().is("li")) return; // Skip nested lists (handled by parseListItems)
        lists.push(parseList($, l as CheerioElement));
      });

      // Paragraphs and text blocks
      if (tag === "p" || tag === "div" || tag === "blockquote") {
        const text = displayText($el.text());
        if (text.length > 10) paragraphs.push(text);
      }
    }

    // Links from anywhere in this element (tables, lists, plain text)
    $(el)
      .find("a[href]")
      .each((_, a) => {
        const link = parseLink($, a as CheerioElement, baseUrl, heading);
        if (link) links.push(link);
      });
  }

  // Normalize full text for this section.
  // Tables: extract per-cell text joined with spaces so adjacent cells
  // ("General/OBC" + "₹850") aren't merged into a single run without whitespace.
  // All other elements use .text() as before.
  const fullText = displayText(
    elements
      .map((el) => {
        const tag = el.type === "tag" ? el.tagName.toLowerCase() : "";
        if (tag === "table") {
          const cells: string[] = [];
          $(el).find("th, td").each((_, cell) => {
            const t = displayText($(cell).text());
            if (t) cells.push(t);
          });
          return cells.join(" ");
        }
        return $(el).text();
      })
      .join(" "),
  );

  return {
    type,
    heading,
    text: fullText,
    rawHtml: htmlParts.join("\n"),
    tables,
    lists,
    links,
    paragraphs,
  };
}

// ─── Main entry point ─────────────────────────────────────────

export function structureDocument(html: string, url: string): PageDocument {
  const $ = cheerio.load(html);

  // Page title
  const titleEl = $("title").first().text().trim();
  const h1Text = $("h1").first().text().trim();
  const title = titleEl || h1Text || undefined;

  // Find the best content container
  const contentSel = findContentRoot($);
  const $content = $(contentSel);

  const sections: PageSection[] = [];
  const seenLinkUrls = new Set<string>();

  // Collect top-level headings (h2/h3/h4) within the content area.
  // We use h2/h3/h4 so the page title (h1) doesn't create a section.
  const HEADING_SEL = "h2, h3, h4";
  const headings = $content.find(HEADING_SEL).toArray();

  if (headings.length === 0) {
    // No headings found — treat entire content as overview
    const allEls = $content.children().toArray() as CheerioElement[];
    sections.push(buildSection($, "", allEls, url, true));
  } else {
    // Collect overview content before the first heading
    const firstHeading = $(headings[0]);
    const overviewEls: CheerioElement[] = [];
    let cursor = firstHeading.prev();
    while (cursor.length > 0) {
      overviewEls.unshift(cursor[0] as CheerioElement);
      cursor = cursor.prev();
    }
    if (overviewEls.length > 0) {
      sections.push(buildSection($, "", overviewEls, url, true));
    }

    // Section for each heading
    headings.forEach((headingEl, i) => {
      const $heading = $(headingEl);
      const headingText = displayText($heading.text());

      // Collect sibling elements between this heading and the next heading
      // at any of h2/h3/h4 level. nextUntil() stops before the selector match.
      const nextHeading = i + 1 < headings.length ? headings[i + 1] : null;
      const bodyEls: CheerioElement[] = [];

      // Walk siblings after the heading
      let sib = $heading.next();
      while (sib.length > 0) {
        const sibEl = sib[0] as CheerioElement;
        // Stop when we hit the next heading
        if (nextHeading && sibEl === nextHeading) break;
        // Also stop at any h2/h3/h4 not in our list (shouldn't happen, but guard)
        if (sibEl.type === "tag" && /^h[234]$/.test(sibEl.tagName)) break;
        bodyEls.push(sibEl);
        sib = sib.next();
      }

      // If we found no siblings, the heading may not be a direct child of
      // $content — fall back to nextUntil from the heading itself
      if (bodyEls.length === 0) {
        $heading.nextUntil(HEADING_SEL).each((_, el) => {
          bodyEls.push(el as CheerioElement);
        });
      }

      if (headingText || bodyEls.length > 0) {
        sections.push(buildSection($, headingText, bodyEls, url));
      }
    });
  }

  // Content-signal second pass: upgrade "other" → "eligibility" where content warrants
  for (let i = 0; i < sections.length; i++) {
    sections[i] = maybeReclassifyAsEligibility(sections[i]);
  }

  // Build flat allLinks (deduplicated by resolved href)
  const allLinks: ParsedLink[] = [];
  for (const section of sections) {
    for (const link of section.links) {
      if (!seenLinkUrls.has(link.resolvedHref)) {
        seenLinkUrls.add(link.resolvedHref);
        allLinks.push(link);
      }
    }
  }

  return { title, url, sections, allLinks };
}
