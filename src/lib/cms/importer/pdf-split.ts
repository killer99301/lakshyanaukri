// ═══════════════════════════════════════════════════════════
// Splitting a PDF into pieces of whole pages, in the admin's browser
// ═══════════════════════════════════════════════════════════
//
// Runs in the browser (and in tests). One PDF of any size becomes pieces of
// whole pages, each under the upload limit, numbered as in the original.
// Only splitting happens here: the server reads every piece's text itself.
// A page that alone is over the limit is not shrunk or changed: it is
// reported, and its pages are recorded as not uploaded. An encrypted or
// damaged PDF is refused with that reason, before anything is sent.

import { PDFDocument } from "pdf-lib";

export interface Piece { first: number; last: number; bytes: Uint8Array }
export interface Oversized { first: number; last: number; reason: string }

export class PdfSplitError extends Error {
  constructor(message: string) { super(message); this.name = "PdfSplitError"; }
}

/** SHA-256 of the whole file, in hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Opens the PDF; an encrypted or damaged file is refused with the reason. */
export async function openPdf(bytes: Uint8Array): Promise<{ doc: PDFDocument; pages: number }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/encrypt/i.test(msg)) throw new PdfSplitError("The PDF is encrypted (password-protected). Save an unprotected copy and select that.");
    throw new PdfSplitError("The PDF could not be opened: it may be damaged. Download it again and select the new copy.");
  }
  return { doc, pages: doc.getPageCount() };
}

/**
 * The pieces, one after another (so only one is in memory at a time): as
 * many pages as fit under `maxBytes`, at most `maxPages`. A piece over the
 * limit is cut in half until it fits; a single page over the limit is
 * yielded as oversized, never changed.
 */
export async function* splitPdf(doc: PDFDocument, opts: { maxBytes: number; maxPages: number; fromPage?: number }): AsyncGenerator<Piece | (Oversized & { oversized: true })> {
  const total = doc.getPageCount();
  let first = opts.fromPage ?? 1;
  let size = opts.maxPages;
  while (first <= total) {
    const last = Math.min(total, first + size - 1);
    const piece = await PDFDocument.create();
    const copied = await piece.copyPages(doc, Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i));
    for (const p of copied) piece.addPage(p);
    const bytes = await piece.save({ useObjectStreams: true });
    if (bytes.byteLength <= opts.maxBytes) {
      yield { first, last, bytes };
      first = last + 1;
      size = opts.maxPages;
    } else if (last > first) {
      size = Math.max(1, Math.floor((last - first + 1) / 2));
    } else {
      yield { oversized: true, first, last, reason: `page ${first} alone is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB, over the ${(opts.maxBytes / 1024 / 1024).toFixed(0)} MB a piece may be` };
      first += 1;
      size = opts.maxPages;
    }
  }
}
