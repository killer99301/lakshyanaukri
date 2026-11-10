"use client";

// Application Tools: resize a photo, signature, declaration or thumb impression
// to the size an application form asks for. Everything happens in this browser:
// the file is never uploaded. The sizes come from the applicant's own notice;
// no exam's sizes are built in.

import React, { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Download, ImageUp, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  DEFAULT_DPI, loadPicture, readRequirement, requirementProblem, resizePicture, targetPixels,
  type FitMode, type Requirement, type ResizeResult, type Unit,
} from "@/lib/tools/photo-resize";

export type ToolMode = "photo" | "signature" | "declaration" | "thumb";

export const MODES: Record<ToolMode, { label: string; noun: string; fit: FitMode; hint: string }> = {
  photo: { label: "Photo", noun: "photo", fit: "crop", hint: "A recent passport-style photo. It is cropped from the centre to the shape the form asks for." },
  signature: { label: "Signature", noun: "signature", fit: "pad", hint: "Sign in black or blue ink on white paper and photograph or scan it in good light." },
  declaration: { label: "Handwritten declaration", noun: "declaration", fit: "pad", hint: "Write the declaration text exactly as the notice gives it, then scan or photograph the page." },
  thumb: { label: "Thumb impression", noun: "thumb impression", fit: "pad", hint: "Press your left thumb (or as the notice says) on white paper with blue or black ink." },
};

const field = "w-full rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#FED7AA] focus:border-[#EA580C]";
const label = "block text-xs font-bold text-[#334155] mb-1";

const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

export function PhotoSignatureTool({ initialMode = "photo" }: { initialMode?: ToolMode }) {
  const id = useId();
  const [mode, setMode] = useState<ToolMode>(initialMode);
  const [fit, setFit] = useState<FitMode>(MODES[initialMode].fit);
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [unit, setUnit] = useState<Unit>("px");
  const [dpi, setDpi] = useState(String(DEFAULT_DPI));
  const [minKB, setMinKB] = useState("");
  const [maxKB, setMaxKB] = useState("");
  const [noticeText, setNoticeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(ResizeResult & { url: string }) | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Object URLs are released when they are replaced and when the page closes.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const req: Requirement = { width: num(width), height: num(height), unit, dpi: num(dpi) || DEFAULT_DPI, minKB: num(minKB), maxKB: num(maxKB) };
  const problem = requirementProblem(req);
  const px = targetPixels(req);

  const chooseMode = (m: ToolMode) => { setMode(m); setFit(MODES[m].fit); setResult(null); setError(null); };

  const take = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setResult(null);
    if (!f.type.startsWith("image/")) { setError("Choose a picture file (JPG, PNG or WebP). For a PDF, use the PDF tools."); return; }
    try {
      const picture = await loadPicture(f);
      setFile(f);
      setImg(picture);
      setPreviewUrl(URL.createObjectURL(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file could not be opened");
    }
  };

  const fillFromNotice = () => {
    const r = readRequirement(noticeText);
    if (r.width != null) setWidth(String(r.width));
    if (r.height != null) setHeight(String(r.height));
    if (r.unit) setUnit(r.unit);
    if (r.dpi) setDpi(String(r.dpi));
    setMinKB(r.minKB != null ? String(r.minKB) : "");
    setMaxKB(r.maxKB != null ? String(r.maxKB) : "");
    if (r.width == null && r.minKB == null && r.maxKB == null) setError("No size or KB limit could be read from that text. Type the values into the boxes below.");
    else setError(null);
  };

  const run = async () => {
    if (!img || problem) return;
    setBusy(true);
    setError(null);
    try {
      const r = await resizePicture(img, req, fit);
      setResult({ ...r, url: URL.createObjectURL(r.blob) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The picture could not be resized");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setFile(null); setImg(null); setPreviewUrl(null); setResult(null); setError(null); if (input.current) input.current.value = ""; };

  const download = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `lakshyanaukri-${mode}-${result.width}x${result.height}.jpg`;
    a.click();
  };

  const ok = result && result.withinMax !== false && result.withinMin !== false;

  return (
    <div className="space-y-6" data-photo-tool>
      {/* What is being prepared */}
      <div role="radiogroup" aria-label="What are you preparing?" className="flex flex-wrap gap-2">
        {(Object.keys(MODES) as ToolMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => chooseMode(m)}
            className={cn(
              "px-3.5 py-2 rounded-full text-xs font-bold border transition-colors",
              mode === m ? "bg-[#EA580C] border-[#EA580C] text-white" : "bg-white border-[#E2E8F0] text-[#0F172A] hover:border-[#FED7AA] hover:bg-[#FFF7ED]"
            )}
          >
            {MODES[m].label}
          </button>
        ))}
      </div>
      <p className="text-xs text-[#475569]">{MODES[mode].hint}</p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 1. The file */}
        <section className="bg-white border border-[#E2E8F0] rounded-3xl p-5 space-y-3">
          <h2 className="text-sm font-black text-[#0F172A]">1. Choose your {MODES[mode].noun}</h2>
          {!file ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); void take(e.dataTransfer.files[0]); }}
              className={cn("rounded-2xl border-2 border-dashed p-8 text-center transition-colors", dragging ? "border-[#EA580C] bg-[#FFF7ED]" : "border-[#E2E8F0] bg-slate-50")}
            >
              <ImageUp className="mx-auto h-8 w-8 text-[#EA580C]" aria-hidden />
              <p className="mt-2 text-sm font-semibold text-[#0F172A]">Drop a picture here, or</p>
              <label htmlFor={`${id}-file`} className="mt-2 inline-block cursor-pointer rounded-xl bg-[#EA580C] px-4 py-2 text-xs font-bold text-white hover:bg-[#C2410C] focus-within:ring-2">
                Choose a file
              </label>
              <input id={`${id}-file`} ref={input} type="file" accept="image/*" className="sr-only" onChange={(e) => void take(e.target.files?.[0])} />
              <p className="mt-2 text-[11px] text-[#64748B]">JPG, PNG or WebP. A phone photo is fine.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, never a remote picture */}
              {previewUrl && <img src={previewUrl} alt={`Your ${MODES[mode].noun}, as chosen`} className="max-h-56 mx-auto rounded-xl border border-[#E2E8F0] object-contain" />}
              <p className="text-xs text-[#475569] text-center">
                {file.name} · {img?.naturalWidth} × {img?.naturalHeight} px · {Math.round(file.size / 1024)} KB
              </p>
              <div className="text-center">
                <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-xs font-bold text-[#EA580C] hover:underline">
                  <RotateCcw className="h-3 w-3" aria-hidden /> Choose another file
                </button>
              </div>
            </div>
          )}
          <p className="flex items-start gap-1.5 text-[11px] text-[#475569]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green-600 mt-0.5" aria-hidden />
            Your file stays on this device. It is resized in your browser and never uploaded.
          </p>
        </section>

        {/* 2. The size from the notice */}
        <section className="bg-white border border-[#E2E8F0] rounded-3xl p-5 space-y-4">
          <h2 className="text-sm font-black text-[#0F172A]">2. Enter the size from your notice</h2>
          <p className="text-xs text-[#475569]">
            Each recruitment sets its own size. Copy the values from the official notification for this {MODES[mode].noun}.
          </p>
          <div>
            <label htmlFor={`${id}-notice`} className={label}>Paste the line from the notice (optional)</label>
            <div className="flex gap-2">
              <input id={`${id}-notice`} value={noticeText} onChange={(e) => setNoticeText(e.target.value)} placeholder="e.g. 3.5 cm × 4.5 cm, 20 KB to 50 KB" className={field} />
              <Button type="button" variant="outline" size="sm" onClick={fillFromNotice} disabled={!noticeText.trim()}>Fill</Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor={`${id}-w`} className={label}>Width</label>
              <input id={`${id}-w`} inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor={`${id}-h`} className={label}>Height</label>
              <input id={`${id}-h`} inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor={`${id}-u`} className={label}>Unit</label>
              <select id={`${id}-u`} value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className={field}>
                <option value="px">pixels</option>
                <option value="cm">cm</option>
                <option value="mm">mm</option>
              </select>
            </div>
          </div>
          {unit !== "px" && (
            <div className="max-w-[10rem]">
              <label htmlFor={`${id}-dpi`} className={label}>DPI</label>
              <input id={`${id}-dpi`} inputMode="numeric" value={dpi} onChange={(e) => setDpi(e.target.value)} className={field} />
              <p className="mt-1 text-[11px] text-[#64748B]">Use the DPI the notice gives; 200 if it gives none.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${id}-min`} className={label}>Minimum size (KB)</label>
              <input id={`${id}-min`} inputMode="decimal" value={minKB} onChange={(e) => setMinKB(e.target.value)} placeholder="if given" className={field} />
            </div>
            <div>
              <label htmlFor={`${id}-max`} className={label}>Maximum size (KB)</label>
              <input id={`${id}-max`} inputMode="decimal" value={maxKB} onChange={(e) => setMaxKB(e.target.value)} placeholder="if given" className={field} />
            </div>
          </div>
          <fieldset>
            <legend className={label}>Shape</legend>
            <div className="flex flex-wrap gap-4 text-xs text-[#0F172A]">
              <label className="inline-flex items-center gap-1.5"><input type="radio" name={`${id}-fit`} checked={fit === "crop"} onChange={() => setFit("crop")} /> Crop to fill the size</label>
              <label className="inline-flex items-center gap-1.5"><input type="radio" name={`${id}-fit`} checked={fit === "pad"} onChange={() => setFit("pad")} /> Fit inside, on white</label>
            </div>
          </fieldset>
          {px && <p className="text-[11px] text-[#475569]">Output: {px.width} × {px.height} pixels, JPG{req.maxKB ? `, up to ${req.maxKB} KB` : ""}{req.minKB ? `, at least ${req.minKB} KB` : ""}.</p>}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void run()} disabled={!img || !!problem || busy}>
          {busy ? "Resizing…" : `Resize ${MODES[mode].noun}`}
        </Button>
        {file && problem && <span className="text-xs text-[#475569]">{problem}</span>}
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-red-600">{error}</p>}

      {/* 3. The result */}
      {result && (
        <section aria-live="polite" className={cn("rounded-3xl border p-5 space-y-3", ok ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200")} data-photo-result>
          <h2 className="text-sm font-black text-[#0F172A]">3. Your resized {MODES[mode].noun}</h2>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
            <img src={result.url} alt={`Your resized ${MODES[mode].noun}`} className="max-h-48 rounded-xl border border-[#E2E8F0] bg-white object-contain" />
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden /> {result.width} × {result.height} pixels, JPG</li>
              <li className="flex items-center gap-1.5">
                {result.withinMax === false || result.withinMin === false
                  ? <XCircle className="h-4 w-4 text-amber-600" aria-hidden />
                  : <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />}
                {result.sizeKB} KB
                {result.withinMax === false && " — still over the maximum. Try a smaller width and height if the notice allows, or a plainer background."}
                {result.withinMin === false && " — under the minimum even at the best quality. Use a clearer, larger photo or scan."}
              </li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={download}><Download className="h-4 w-4 mr-1.5" aria-hidden /> Download JPG</Button>
          </div>
          <p className="text-[11px] text-[#475569]">Check it once more against the notice before uploading: some forms also ask for a white background, a date on the photo or a particular ink colour.</p>
        </section>
      )}
    </div>
  );
}
