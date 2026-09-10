// ═══════════════════════════════════════════════════════════
// Phase 9F: PDF Extractor — DOMMatrix polyfill regression
// npm run intelligence:pdf-extractor-test
// ═══════════════════════════════════════════════════════════
//
// Regression for: ReferenceError: DOMMatrix is not defined
// Root cause: pdfjs-dist executes `const SCALE_MATRIX = new DOMMatrix()`
// at module scope (line 15620 of pdfjs-dist/legacy/build/pdf.mjs).
// On Vercel Lambda, @napi-rs/canvas is absent so DOMMatrix is never set.
// Fix: pdf-extractor.ts sets a minimal stub at module scope before any
// dynamic import of pdf-parse can trigger pdfjs-dist initialization.
//
// Tests:
//  PEX1  Polyfill sets DOMMatrix when absent at module load
//  PEX2  extractPdfFromBuffer returns ok=true for valid PDF fixture
//  PEX3  extractPdfFromBuffer returns ok=false + error for empty buffer
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suite, test, assert } from "./suite";

// Simulate Vercel Lambda: remove DOMMatrix BEFORE pdf-extractor is first
// imported. This file runs in its own npx tsx process so the module cache
// is fresh. Neither suite.ts nor node:fs imports pdf-parse/pdfjs-dist.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (globalThis as any).DOMMatrix;

suite("PDF Extractor — DOMMatrix polyfill regression (Phase 9F)");

test("PEX1: polyfill sets DOMMatrix stub when absent at module load", async () => {
  // Confirm precondition: DOMMatrix is absent in this process.
  assert.equal(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (globalThis as any).DOMMatrix,
    "undefined",
    "precondition: DOMMatrix must be absent before pdf-extractor loads"
  );

  // Dynamic import runs pdf-extractor.ts module-level code, which applies
  // the polyfill if DOMMatrix is undefined.
  await import("@/intelligence/pdf-extractor");

  // Polyfill must have set DOMMatrix to a constructable class.
  assert.notEqual(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (globalThis as any).DOMMatrix,
    "undefined",
    "polyfill must define globalThis.DOMMatrix after pdf-extractor module load"
  );

  // Verify the stub has the identity values pdfjs-dist requires on SCALE_MATRIX.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = new (globalThis as any).DOMMatrix();
  assert.equal(m.a, 1, "stub identity matrix: a=1");
  assert.equal(m.b, 0, "stub identity matrix: b=0");
  assert.equal(m.c, 0, "stub identity matrix: c=0");
  assert.equal(m.d, 1, "stub identity matrix: d=1");
  assert.equal(m.e, 0, "stub identity matrix: e=0");
  assert.equal(m.f, 0, "stub identity matrix: f=0");
});

test("PEX2: extractPdfFromBuffer returns ok=true for valid PDF fixture", async () => {
  const { extractPdfFromBuffer } = await import("@/intelligence/pdf-extractor");

  const fixturePath = join(process.cwd(), "tests", "fixtures", "minimal-test.pdf");
  const buf = readFileSync(fixturePath);

  const result = await extractPdfFromBuffer(buf);

  assert.ok(result.ok, `expected ok=true, got error: ${result.error}`);
  assert.ok(
    typeof result.text === "string" && result.text.length > 0,
    "expected non-empty extracted text"
  );
  assert.ok(
    result.text!.includes("Recruitment") || result.text!.includes("500"),
    `expected fixture text content, got: ${result.text?.slice(0, 120)}`
  );
});

test("PEX3: extractPdfFromBuffer returns ok=false for empty buffer", async () => {
  const { extractPdfFromBuffer } = await import("@/intelligence/pdf-extractor");

  const result = await extractPdfFromBuffer(Buffer.alloc(0));

  assert.ok(!result.ok, "expected ok=false for empty buffer");
  assert.ok(
    typeof result.error === "string" && result.error.length > 0,
    "expected non-empty error message"
  );
});
