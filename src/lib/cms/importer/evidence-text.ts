// ═══════════════════════════════════════════════════════════
// Importer: pages and fingerprints
// ═══════════════════════════════════════════════════════════
//
// The PDF reader ends each page with a marker line, "-- 3 of 10 --". A
// quote's page is the number of markers before it, plus one. Text without
// markers (a web page, pasted text) has no pages, and none is guessed.
//
// Values are compared and hashed in a canonical form (object keys sorted),
// so the same value always has the same fingerprint.

import { createHash } from "node:crypto";

const MARKER = /^-- (\d+) of (\d+) --$/gm;

export function hasPageMarkers(text: string): boolean {
  MARKER.lastIndex = 0;
  return MARKER.test(text);
}

// Typographic quotes and dashes evened out as the quote checks do, so a quote that passed them is found on its page.
const squash = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The page a quote is on, by the reader's page markers: the number in the
 * marker that ends its page ("-- 23 of 76 --"), so a part of a document (a
 * page batch, pages uploaded in pieces) gives the document's own page
 * numbers. Null without markers or when not found.
 */
export function pageOf(text: string, quote: string | undefined): number | null {
  if (!quote || !hasPageMarkers(text)) return null;
  const parts = text.split(/^-- (\d+) of \d+ --$/m); // [page text, its number, page text, its number, …, the rest]
  const needle = squash(quote);
  for (let i = 0; i < parts.length; i += 2) {
    if (!squash(parts[i]).includes(needle)) continue;
    if (i + 1 < parts.length) return Number(parts[i + 1]);
    return parts.length >= 3 ? Number(parts[parts.length - 2]) + 1 : null; // after the last marker
  }
  return null;
}

/** JSON with object keys sorted at every level. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const valueHash = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
export const contentHash = (content: string | Buffer): string => createHash("sha256").update(content).digest("hex");
