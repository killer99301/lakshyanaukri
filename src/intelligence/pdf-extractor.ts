// ═══════════════════════════════════════════════════════════
// Phase 8C: Official PDF Text Extractor
// ═══════════════════════════════════════════════════════════
//
// Fetches an official recruitment PDF and extracts its raw
// text content so the intake pipeline can treat the PDF as
// the highest-authority evidence tier.
//
// Design choices:
//   - Uses pdf-parse (wraps pdfjs-dist). Pure JavaScript,
//     no native bindings, no WASM. Works in Node.js CLI and
//     API routes with runtime = "nodejs". Installed size ~10MB
//     (mostly pdfjs-dist). Alternatives considered:
//       • pdfjs-dist directly — ~20MB, more setup required
//       • pdf2json — lighter but less accurate text ordering
//       • unpdf — similar to pdf-parse, newer, ESM-first
//     Government recruitment PDFs are digitally generated
//     (not scanned), so pure text extraction is sufficient.
//
//   - Injectable FetchPdfFn for testing. Tests NEVER call
//     the real pdf-parse — they return text fixtures directly.
//     This avoids pdf-parse's known test-env require() side-
//     effect (loading a built-in test PDF on import).
//
//   - Fails gracefully: if fetch or parse fails, returns
//     { ok: false, text: null, error } so the caller falls
//     back to Stage A + B (HTML) data unchanged.
//
//   - Never invoked in the Edge runtime. The intake API route
//     already declares runtime = "nodejs"; the dynamic import
//     keeps pdf-parse out of any Edge bundle.
//
// INVARIANTS:
//   - This module never writes to government.ts or any
//     production dataset. It only extracts text.
//   - Trust Gate is not affected — the caller decides how to
//     use the extracted text.
// ═══════════════════════════════════════════════════════════

// Injectable PDF fetch function — used by tests to avoid live network calls.
// Tests return a pre-built text fixture; production uses defaultExtractPdf.
export type FetchPdfFn = (url: string) => Promise<{
  ok: boolean;
  text: string | null;
  error?: string;
}>;

export interface PdfExtractionResult {
  ok: boolean;
  text: string | null;
  numPages?: number;
  error?: string;
}

/**
 * Extract text from an official PDF URL.
 *
 * If fetchPdfFn is provided (test path), delegates to it directly.
 * Otherwise fetches the PDF via HTTP and parses with pdf-parse.
 *
 * Never throws — returns { ok: false, error } on any failure.
 */
export async function extractPdfText(
  url: string,
  fetchPdfFn?: FetchPdfFn
): Promise<PdfExtractionResult> {
  if (fetchPdfFn) {
    const result = await fetchPdfFn(url);
    return { ok: result.ok, text: result.text, error: result.error };
  }
  return defaultExtractPdf(url);
}

/**
 * Extract text from a PDF buffer (local file path — operator-supplied).
 *
 * Same extraction logic as defaultExtractPdf minus the HTTP fetch.
 * Never throws — returns { ok: false, error } on any failure.
 */
export async function extractPdfFromBuffer(buf: Buffer): Promise<PdfExtractionResult> {
  try {
    if (buf.byteLength === 0) {
      return { ok: false, text: null, error: "Empty PDF buffer" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PDFParse, VerbosityLevel } = await import("pdf-parse") as any;
    const parser = new PDFParse({ data: buf, verbosity: VerbosityLevel.ERRORS });
    let result: { text: string; total: number };
    try {
      result = await parser.getText({ max: 50 });
    } finally {
      await parser.destroy().catch(() => {});
    }

    const trimmed = result.text?.trim() ?? "";
    if (!trimmed) {
      return { ok: false, text: null, error: "PDF parsed but extracted text is empty (possibly a scanned image PDF)" };
    }

    return { ok: true, text: trimmed, numPages: result.total };
  } catch (e) {
    return { ok: false, text: null, error: String(e) };
  }
}

async function defaultExtractPdf(url: string): Promise<PdfExtractionResult> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "LakshyaNaukri-Intelligence/1.0 (recruitment-intake)" },
    });
    if (!response.ok) {
      return { ok: false, text: null, error: `HTTP ${response.status} from ${url}` };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const isPdfContent = contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf");
    if (!isPdfContent) {
      return { ok: false, text: null, error: "Response content-type is not application/pdf" };
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return { ok: false, text: null, error: "Empty PDF response body" };
    }

    const buffer = Buffer.from(arrayBuffer);

    // Dynamic import keeps pdf-parse out of Edge runtime bundles.
    // pdf-parse v2 uses a class-based API: new PDFParse({ data, verbosity }) → getText()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PDFParse, VerbosityLevel } = await import("pdf-parse") as any;

    const parser = new PDFParse({ data: buffer, verbosity: VerbosityLevel.ERRORS });
    let result: { text: string; total: number };
    try {
      result = await parser.getText({ max: 50 }); // cap at 50 pages
    } finally {
      await parser.destroy().catch(() => {});
    }

    const trimmed = result.text?.trim() ?? "";

    if (!trimmed) {
      return { ok: false, text: null, error: "PDF parsed but extracted text is empty (possibly a scanned image PDF)" };
    }

    return { ok: true, text: trimmed, numPages: result.total };
  } catch (e) {
    return { ok: false, text: null, error: String(e) };
  }
}
