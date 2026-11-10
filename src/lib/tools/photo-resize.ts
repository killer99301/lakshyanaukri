// ═══════════════════════════════════════════════════════════
// Application Tools: photo, signature, declaration and thumb impression
// ═══════════════════════════════════════════════════════════
//
// Adapted from CalcInfinity's government-form photo tool (D:\calculator-engine,
// government-form-photo.tsx): the requirement reader, centimetres at a DPI to
// pixels, and the JPEG quality loop that brings a file under a KB limit. Two
// changes for application forms: the picture is cropped (or padded) to the
// required shape instead of stretched, and a minimum size is honoured
// ("20 KB to 50 KB").
//
// No exam presets: every value comes from the applicant's own notice. The file
// never leaves the browser; nothing here sends it anywhere.

export type Unit = "px" | "cm" | "mm";
/** Crop to fill the shape (photos), or fit inside it on white (signatures, declarations, thumb impressions). */
export type FitMode = "crop" | "pad";

export interface Requirement {
  width?: number;
  height?: number;
  unit: Unit;
  /** Dots per inch, for centimetres or millimetres (portals usually mean 200 when they give none). */
  dpi: number;
  minKB?: number;
  maxKB?: number;
}

export const DEFAULT_DPI = 200;

/** A length in the given unit, in pixels. */
export function toPx(value: number, unit: Unit, dpi = DEFAULT_DPI): number {
  if (unit === "px") return Math.round(value);
  const inches = unit === "cm" ? value / 2.54 : value / 25.4;
  return Math.round(inches * dpi);
}

/** The target in pixels, when both sides are given. */
export function targetPixels(req: Requirement): { width: number; height: number } | null {
  if (!req.width || !req.height || req.width <= 0 || req.height <= 0) return null;
  const width = toPx(req.width, req.unit, req.dpi);
  const height = toPx(req.height, req.unit, req.dpi);
  return width > 0 && height > 0 ? { width, height } : null;
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

/**
 * Reads a requirement as a notice prints it, to fill the form's fields: "3.5 cm × 4.5 cm", "200 x 230 pixels",
 * "35 mm x 45 mm", "20 KB to 50 KB", "between 10 and 20 KB", "not more than 50 KB", "at 300 DPI". Whatever it
 * cannot read is left for the applicant to type.
 */
export function readRequirement(text: string): Partial<Requirement> {
  const t = text.replace(/\s+/g, " ").trim();
  const out: Partial<Requirement> = {};
  const dims = new RegExp(`${NUM}\\s*(cm|mm|px|pixels?)?\\s*[×x*]\\s*${NUM}\\s*(cm|mm|px|pixels?)?`, "i").exec(t);
  if (dims) {
    const unitWord = (dims[2] ?? dims[4] ?? "px").toLowerCase();
    out.unit = unitWord.startsWith("cm") ? "cm" : unitWord.startsWith("mm") ? "mm" : "px";
    out.width = parseFloat(dims[1]);
    out.height = parseFloat(dims[3]);
  }
  const dpi = /(\d{2,4})\s*dpi\b/i.exec(t);
  if (dpi) out.dpi = parseInt(dpi[1], 10);
  const kb = (v: string, unit: string) => (/^m/i.test(unit) ? parseFloat(v) * 1024 : parseFloat(v));
  const range = new RegExp(`(?:between\\s*)?${NUM}\\s*(kb|mb)?\\s*(?:-|–|to|and)\\s*${NUM}\\s*(kb|mb)\\b`, "i").exec(t);
  if (range) {
    out.minKB = kb(range[1], range[2] ?? range[4]);
    out.maxKB = kb(range[3], range[4]);
  } else {
    const max = new RegExp(`(?:max(?:imum)?|under|below|up ?to|less than|not (?:more|exceeding|exceed)(?: than)?|within)?\\s*${NUM}\\s*(kb|mb)\\b`, "i").exec(t);
    if (max) out.maxKB = kb(max[1], max[2]);
    const min = new RegExp(`(?:min(?:imum)?|at least|not less than)\\s*${NUM}\\s*(kb|mb)\\b`, "i").exec(t);
    if (min) {
      out.minKB = kb(min[1], min[2]);
      if (out.maxKB === out.minKB) delete out.maxKB;
    }
  }
  return out;
}

/** Why a requirement cannot be used yet, or null when it can. */
export function requirementProblem(req: Requirement): string | null {
  if (!targetPixels(req)) return "Enter the width and height given in the notice.";
  const px = targetPixels(req)!;
  if (px.width > 6000 || px.height > 6000) return "That size is larger than any form asks for. Check the unit (pixels, cm or mm).";
  if (req.minKB != null && req.maxKB != null && req.minKB > req.maxKB) return "The minimum size is larger than the maximum.";
  if (req.maxKB != null && req.maxKB <= 0) return "The maximum size must be more than 0 KB.";
  return null;
}

/** The part of the source to draw, and where, so the picture keeps its proportions in the target shape. */
export function placement(src: { width: number; height: number }, dst: { width: number; height: number }, fit: FitMode) {
  const srcRatio = src.width / src.height;
  const dstRatio = dst.width / dst.height;
  if (fit === "crop") {
    // The largest centred part of the source with the target's shape.
    const sw = srcRatio > dstRatio ? src.height * dstRatio : src.width;
    const sh = srcRatio > dstRatio ? src.height : src.width / dstRatio;
    return { sx: (src.width - sw) / 2, sy: (src.height - sh) / 2, sw, sh, dx: 0, dy: 0, dw: dst.width, dh: dst.height };
  }
  // The whole source, as large as fits, centred on white.
  const scale = Math.min(dst.width / src.width, dst.height / src.height);
  const dw = src.width * scale;
  const dh = src.height * scale;
  return { sx: 0, sy: 0, sw: src.width, sh: src.height, dx: (dst.width - dw) / 2, dy: (dst.height - dh) / 2, dw, dh };
}

/**
 * The JPEG quality to use: the highest whose file is within the maximum, found by halving the range (a few
 * encodings, not dozens). `sizeAt` encodes at a quality and returns the bytes.
 */
export async function chooseQuality(sizeAt: (q: number) => Promise<number>, maxBytes?: number): Promise<{ quality: number; bytes: number; fits: boolean }> {
  const top = 0.92;
  const topBytes = await sizeAt(top);
  if (maxBytes == null || topBytes <= maxBytes) return { quality: top, bytes: topBytes, fits: true };
  let lo = 0.05;
  const loBytes = await sizeAt(lo);
  if (loBytes > maxBytes) return { quality: lo, bytes: loBytes, fits: false };
  let best = { quality: lo, bytes: loBytes };
  let hi = top;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    const bytes = await sizeAt(mid);
    if (bytes <= maxBytes) { best = { quality: mid, bytes }; lo = mid; } else hi = mid;
  }
  return { ...best, fits: true };
}

export interface ResizeResult {
  blob: Blob;
  width: number;
  height: number;
  sizeKB: number;
  /** null when the notice gives no such limit. */
  withinMax: boolean | null;
  withinMin: boolean | null;
}

export const kbOf = (bytes: number) => Math.round(bytes / 102.4) / 10;

// ── Browser only ──

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture could not be saved"))), "image/jpeg", quality));
}

/** Loads a picture file the applicant chose (the browser applies its orientation). */
export function loadPicture(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file could not be opened as a picture")); };
    img.src = url;
  });
}

/** Draws the picture at the required size on white and saves it as a JPEG within the KB limits, where it can be. */
export async function resizePicture(img: HTMLImageElement, req: Requirement, fit: FitMode): Promise<ResizeResult> {
  const dst = targetPixels(req);
  if (!dst) throw new Error("No size given");
  const canvas = document.createElement("canvas");
  canvas.width = dst.width;
  canvas.height = dst.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw pictures");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, dst.width, dst.height);
  ctx.imageSmoothingQuality = "high";
  const p = placement({ width: img.naturalWidth, height: img.naturalHeight }, dst, fit);
  ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);

  const blobs = new Map<number, Blob>();
  const sizeAt = async (q: number) => { const b = await canvasBlob(canvas, q); blobs.set(q, b); return b.size; };
  const chosen = await chooseQuality(sizeAt, req.maxKB != null ? req.maxKB * 1024 : undefined);
  let blob = blobs.get(chosen.quality)!;
  // Under the minimum at the usual quality: the best quality is the largest this picture can honestly be.
  if (req.minKB != null && blob.size < req.minKB * 1024 && chosen.quality < 1) {
    const best = await canvasBlob(canvas, 1);
    if (req.maxKB == null || best.size <= req.maxKB * 1024) blob = best;
  }
  const sizeKB = kbOf(blob.size);
  return {
    blob, width: dst.width, height: dst.height, sizeKB,
    withinMax: req.maxKB != null ? blob.size <= req.maxKB * 1024 : null,
    withinMin: req.minKB != null ? blob.size >= req.minKB * 1024 : null,
  };
}
