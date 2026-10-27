"use client";

// A scanned page as an image on the screen, beside what the AI read from it
// (stage B2.4). Drawn here with pdf.js from the page's own one-page PDF: for
// looking only. Nothing is read from it here; the server did the reading.
// (The site forbids showing pages in frames, so a PDF viewer frame is not used.)

import { useEffect, useRef, useState } from "react";
import { C, PANEL, quietBtn } from "./ui";

export function ScanPageImage({ url, page, onClose }: { url: string; page: number; onClose?: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // pdf.js draws in a worker of its own, bundled with this page.
        if (!pdfjs.GlobalWorkerOptions.workerPort) {
          pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
        }
        const res = await fetch(url);
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
        const p = await doc.getPage(1);
        const el = canvas.current;
        if (!el || cancelled) return;
        const base = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({ scale: (Math.min(900, el.parentElement?.clientWidth ?? 600) / base.width) * zoom * (window.devicePixelRatio || 1) });
        el.width = viewport.width;
        el.height = viewport.height;
        el.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
        await p.render({ canvas: el, canvasContext: el.getContext("2d")!, viewport }).promise;
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "The page could not be shown");
      }
    })();
    return () => { cancelled = true; };
  }, [url, zoom]);

  return (
    <div data-scan-page={page} style={{ ...PANEL, padding: 8, display: "grid", gap: 6, alignContent: "start" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center", fontSize: 12, color: C.muted }}>
        <span>Page {page} as scanned — compare each figure with the table</span>
        <span style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} style={{ ...quietBtn, padding: "1px 8px" }} aria-label="Smaller">−</button>
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))} style={{ ...quietBtn, padding: "1px 8px" }} aria-label="Larger">+</button>
          {onClose && <button onClick={onClose} style={{ ...quietBtn, padding: "1px 8px" }}>Close</button>}
        </span>
      </div>
      {err ? <div role="alert" style={{ color: C.amber, fontSize: 12 }}>{err}</div> : !ready && <div style={{ color: C.muted, fontSize: 12 }}>Drawing the page…</div>}
      <div style={{ overflow: "auto", maxHeight: 640 }}><canvas ref={canvas} style={{ display: err ? "none" : "block", background: "#fff" }} /></div>
    </div>
  );
}
