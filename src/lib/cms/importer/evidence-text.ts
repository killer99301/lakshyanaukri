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

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The page a quote is on, by the reader's page markers; null without markers or when not found. */
export function pageOf(text: string, quote: string | undefined): number | null {
  if (!quote || !hasPageMarkers(text)) return null;
  const pages = text.split(/^-- \d+ of \d+ --$/m);
  const needle = squash(quote);
  for (let i = 0; i < pages.length; i++) if (squash(pages[i]).includes(needle)) return i + 1;
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
