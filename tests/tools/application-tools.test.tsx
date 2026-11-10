// Application Tools, Batch A: the photo and signature engine (reading a notice's size, units, crop and fit,
// the KB quality search), the job page's shortcuts, the /tools page and the nav item. Pure: no browser, no network.
//
//   npx tsx --tsconfig tsconfig.json tests/tools/application-tools.test.tsx

import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { readRequirement, toPx, targetPixels, requirementProblem, placement, chooseQuality, kbOf } from "@/lib/tools/photo-resize";
import { PrepareToApply } from "@/components/tools/PrepareToApply";
import { PhotoSignatureTool } from "@/components/tools/PhotoSignatureTool";
import ToolsPage from "@/app/(main)/tools/page";
import { MAIN_NAV_ITEMS } from "@/lib/constants";
import type { Opportunity } from "@/types";

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

suite("Reading a notice's size");
test("AT01 centimetres, pixels and millimetres, as notices print them", () => {
  assert.deepEqual(readRequirement("3.5 cm × 4.5 cm, 20 KB to 50 KB"), { unit: "cm", width: 3.5, height: 4.5, minKB: 20, maxKB: 50 });
  assert.deepEqual(readRequirement("200 x 230 pixels (preferred), size of file should be between 20kb–50 kb"), { unit: "px", width: 200, height: 230, minKB: 20, maxKB: 50 });
  assert.deepEqual(readRequirement("35mm x 45mm, not more than 100 KB, 300 DPI"), { unit: "mm", width: 35, height: 45, dpi: 300, maxKB: 100 });
  assert.deepEqual(readRequirement("140 x 60 pixels, 10 KB - 20 KB"), { unit: "px", width: 140, height: 60, minKB: 10, maxKB: 20 });
  assert.deepEqual(readRequirement("Signature: under 30 KB"), { maxKB: 30 });
  assert.deepEqual(readRequirement("file size minimum 10 KB"), { minKB: 10 });
  assert.deepEqual(readRequirement("max 1 MB"), { maxKB: 1024 });
  assert.deepEqual(readRequirement("Recent colour photograph"), {}, "nothing to read: nothing invented");
});
test("AT02 units to pixels: 2.54 cm an inch, 200 DPI unless the notice gives one", () => {
  assert.equal(toPx(3.5, "cm"), 276);
  assert.equal(toPx(4.5, "cm"), 354);
  assert.equal(toPx(35, "mm", 300), 413);
  assert.equal(toPx(200, "px"), 200);
  assert.deepEqual(targetPixels({ width: 3.5, height: 4.5, unit: "cm", dpi: 200 }), { width: 276, height: 354 });
  assert.equal(targetPixels({ unit: "px", dpi: 200 }), null);
});
test("AT03 what stops a resize is said plainly", () => {
  assert.match(requirementProblem({ unit: "px", dpi: 200 }) ?? "", /width and height/);
  assert.match(requirementProblem({ width: 200, height: 230, unit: "cm", dpi: 200 }) ?? "", /Check the unit/);
  assert.match(requirementProblem({ width: 200, height: 230, unit: "px", dpi: 200, minKB: 50, maxKB: 20 }) ?? "", /minimum size is larger/);
  assert.equal(requirementProblem({ width: 200, height: 230, unit: "px", dpi: 200, minKB: 20, maxKB: 50 }), null);
});

suite("Shape and size");
test("AT04 a photo is cropped from the centre to the shape, never stretched; a signature fits inside on white", () => {
  const wide = { width: 1000, height: 500 };
  const portrait = { width: 200, height: 250 };
  const crop = placement(wide, portrait, "crop");
  assert.deepEqual([crop.sw, crop.sh, crop.sx, crop.sy], [400, 500, 300, 0], "the centre 400 × 500 of the picture");
  assert.ok(Math.abs(crop.sw / crop.sh - 200 / 250) < 1e-9, "the same shape as the target");
  const pad = placement(wide, portrait, "pad");
  assert.deepEqual([pad.sw, pad.sh, pad.dw, pad.dh, pad.dx, pad.dy], [1000, 500, 200, 100, 0, 75], "the whole picture, centred, white above and below");
});
test("AT05 the KB limit: the best quality within the maximum, in a few encodings; a limit no quality meets is reported", async () => {
  // A stand-in for the browser's encoder: the bytes grow with quality.
  let calls = 0;
  const sizeAt = async (q: number) => { calls++; return Math.round(10_000 + q * 90_000); };
  const within = await chooseQuality(sizeAt, 50 * 1024);
  assert.ok(within.fits && within.bytes <= 50 * 1024, JSON.stringify(within));
  assert.ok(within.bytes > 45 * 1024, "close to the limit, not far under it");
  assert.ok(calls <= 10, `${calls} encodings`);
  const none = await chooseQuality(async () => 5_000);
  assert.equal(none.quality, 0.92, "no limit: the usual quality");
  const tooSmall = await chooseQuality(sizeAt, 5 * 1024);
  assert.equal(tooSmall.fits, false);
  assert.equal(kbOf(51_200), 50);
});

suite("The tool page");
test("AT06 no exam's sizes are built in, nothing is uploaded, no background removal", () => {
  const src = readFileSync("src/components/tools/PhotoSignatureTool.tsx", "utf8") + readFileSync("src/lib/tools/photo-resize.ts", "utf8");
  assert.ok(!/\b(UPSC|SSC|IBPS|Banking|Railway)\b/.test(src.replace(/^\s*\/\/.*$/gm, "")), "no exam presets");
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|FormData/.test(src), "no upload");
  assert.ok(!/imgly|background-removal|removeBackground/.test(src), "no licence-restricted background removal");
  const html = text(renderToStaticMarkup(<PhotoSignatureTool initialMode="signature" />));
  assert.match(html, /Enter the size from your notice/);
  assert.match(html, /never uploaded/);
  for (const m of ["Photo", "Signature", "Handwritten declaration", "Thumb impression"]) assert.ok(html.includes(m), m);
});

suite("Job pages, /tools and the menu");
const job = (closeDate: string) => ({ type: "government", application: { openDate: "2000-01-01", closeDate } } as unknown as Opportunity);
test("AT07 an open job shows the shortcuts; a closed one does not", () => {
  const open = renderToStaticMarkup(<PrepareToApply job={job("2099-12-31")} />);
  assert.match(open, /data-prepare-to-apply/);
  assert.match(open, /href="\/tools\/photo-signature\?mode=photo"/);
  assert.match(open, /href="\/tools\/photo-signature\?mode=signature"/);
  assert.match(open, /href="#eligibility"/, "the job's own age checker");
  assert.ok(!/\/tools\/pdf/.test(open), "no link to a tool not built yet");
  assert.equal(renderToStaticMarkup(<PrepareToApply job={job("2000-06-30")} />), "");
});
test("AT08 /tools lists the four areas; only built tools are links", () => {
  const html = renderToStaticMarkup(<ToolsPage />);
  for (const t of ["Photo &amp; Signature", "PDF Utilities", "Document Checker", "Age &amp; Eligibility"]) assert.ok(html.includes(t), t);
  assert.match(html, /href="\/tools\/photo-signature"/);
  assert.match(html, /href="\/eligibility"/);
  assert.equal((html.match(/Coming soon/g) ?? []).length, 2);
});
test("AT09 the menu's Application Tools item is /tools on this site", () => {
  const item = MAIN_NAV_ITEMS.find((i) => i.title === "Application Tools");
  assert.equal(item?.href, "/tools");
  assert.ok(!MAIN_NAV_ITEMS.some((i) => /calcinfinity/.test(i.href)));
});
