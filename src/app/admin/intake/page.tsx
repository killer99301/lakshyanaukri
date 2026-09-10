"use client";
// ═══════════════════════════════════════════════════════════
// Phase 9D: Admin Intake — Multi-Source
// ═══════════════════════════════════════════════════════════
//
// Accepts multiple URLs + optional PDF uploads.
// Calls POST /api/admin/intake (multipart/form-data).
// Shows entity-resolved results with evidence, Trust Gate,
// extracted fields, and consolidation status.
// ═══════════════════════════════════════════════════════════

import { useState, useRef } from "react";
import type { EntityGroup } from "@/intelligence/entity-resolver";
import type { IntakeResult } from "@/intelligence/intake";

// ─── Shared styles ────────────────────────────────────────────

const S = {
  card: {
    background: "#161b22",
    border: "1px solid #21262d",
    borderRadius: 8,
    padding: "20px 24px",
    marginBottom: 16,
  } as React.CSSProperties,
  sectionHead: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "#8b949e",
    borderBottom: "1px solid #21262d",
    paddingBottom: 6,
    marginBottom: 12,
  } as React.CSSProperties,
  row: {
    display: "grid",
    gridTemplateColumns: "180px 1fr",
    gap: 8,
    padding: "3px 0",
    fontSize: 13,
  } as React.CSSProperties,
  label: { color: "#8b949e", fontWeight: 500 } as React.CSSProperties,
  code: {
    fontFamily: "monospace",
    fontSize: 12,
    background: "#21262d",
    padding: "1px 6px",
    borderRadius: 3,
    color: "#e2e8f0",
  } as React.CSSProperties,
};

// ─── Source kind badge ────────────────────────────────────────

const KIND_COLOR: Record<string, string> = {
  OFFICIAL_PDF: "#238636",
  OFFICIAL_SPECIFIC: "#1f6feb",
  OFFICIAL_GENERIC: "#388bfd66",
  THIRD_PARTY: "#bb800966",
  UNKNOWN: "#484f5866",
};

function SourceBadge({ kind }: { kind: string }) {
  const bg = KIND_COLOR[kind] ?? "#21262d";
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 7px",
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 600,
      background: bg,
      color: "#e2e8f0",
      border: "1px solid #30363d",
    }}>
      {kind}
    </span>
  );
}

// ─── Trust gate display ───────────────────────────────────────

function TrustGatePanel({ passed, errors, warnings }: {
  passed: boolean;
  errors: string[];
  warnings: string[];
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: errors.length + warnings.length > 0 ? 10 : 0 }}>
        <span style={{
          padding: "2px 10px",
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 700,
          background: passed ? "#238636" : "#da3633",
          color: "white",
        }}>
          {passed ? "PASS" : "FAIL"}
        </span>
        <span style={{ fontSize: 12, color: "#8b949e" }}>Trust Gate</span>
      </div>
      {errors.map((e, i) => (
        <div key={i} style={{ fontSize: 12, color: "#f85149", padding: "2px 0" }}>✗ {e}</div>
      ))}
      {warnings.map((w, i) => (
        <div key={i} style={{ fontSize: 12, color: "#d29922", padding: "2px 0" }}>⚠ {w}</div>
      ))}
    </div>
  );
}

// ─── Entity group card ────────────────────────────────────────

function EntityGroupCard({ group }: { group: EntityGroup }) {
  const [expanded, setExpanded] = useState(true);
  const m = group.merged;

  return (
    <div style={S.card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>
            {m.title ?? <em style={{ color: "#8b949e" }}>title not extracted</em>}
          </div>
          <div style={{ fontSize: 12, color: "#8b949e", marginTop: 3 }}>
            {m.organizationName && <span>{m.organizationName} · </span>}
            {m.notificationNumber && <code style={S.code}>{m.notificationNumber}</code>}
            {!m.notificationNumber && <em style={{ color: "#f85149" }}>no notification number</em>}
            {group.results.length > 1 && (
              <span style={{ marginLeft: 8, color: "#58a6ff", fontSize: 11 }}>
                {group.results.length} sources merged
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {group.ambiguous && (
            <span style={{ fontSize: 11, color: "#d29922", background: "#d2992222", padding: "2px 8px", borderRadius: 4 }}>
              ⚠ Ambiguous
            </span>
          )}
          <span style={{
            padding: "2px 10px",
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
            background: m.trustGatePassed ? "#238636" : "#da3633",
            color: "white",
          }}>
            {m.trustGatePassed ? "Trust Gate PASS" : "Trust Gate FAIL"}
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{ background: "none", border: "1px solid #21262d", color: "#8b949e", borderRadius: 4, padding: "2px 10px", cursor: "pointer", fontSize: 12 }}
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {group.ambiguous && (
        <div style={{ background: "#d2992222", border: "1px solid #d2992244", borderRadius: 4, padding: "8px 12px", fontSize: 12, color: "#d29922", marginBottom: 12 }}>
          <strong>Ambiguity:</strong> {group.ambiguityReason}
          <br />Review sources individually — they may belong to different recruitments.
        </div>
      )}

      {expanded && (
        <>
          {/* Fields grid */}
          <div style={S.sectionHead}>Extracted Fields</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px", marginBottom: 16 }}>
            {[
              ["Notification #", m.notificationNumber, "notificationNumber"],
              ["Organization",   m.organizationId,       "organizationId"],
              ["Vacancies",      m.totalVacancies,        "totalVacancies"],
              ["Open date",      m.applicationOpenDate,   "applicationOpenDate"],
              ["Close date",     m.applicationCloseDate,  "applicationCloseDate"],
              ["Notification date", m.postDate,           "postDate"],
              ["Notification PDF", m.notifPdfUrl,         "notifPdfUrl"],
              ["Primary source",   m.primarySourceUrl,    "primarySourceUrl"],
            ].map(([label, value, field]) => (
              <div key={label as string} style={S.row}>
                <span style={S.label}>{label}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  {value !== undefined && value !== null ? (
                    <>
                      <span style={{ wordBreak: "break-all" }}>{String(value)}</span>
                      {m.fieldSources[field as string] && (
                        <SourceBadge kind={m.fieldSources[field as string]} />
                      )}
                    </>
                  ) : (
                    <em style={{ color: "#f85149" }}>not extracted</em>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            {/* Evidence chain */}
            <div>
              <div style={S.sectionHead}>Evidence Chain</div>
              {m.evidenceChainSummary.length === 0 ? (
                <p style={{ fontSize: 12, color: "#8b949e" }}>No evidence chain</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {m.evidenceChainSummary.map((line, i) => (
                    <li key={i} style={{ fontSize: 12, color: "#8b949e", padding: "2px 0" }}>
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Trust Gate */}
            <div>
              <div style={S.sectionHead}>Trust Gate</div>
              <TrustGatePanel
                passed={m.trustGatePassed}
                errors={m.trustGateErrors}
                warnings={m.trustGateWarnings}
              />
            </div>
          </div>

          {/* Missing fields */}
          {m.missingFields.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={S.sectionHead}>Missing Fields</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {m.missingFields.map((f) => (
                  <code key={f} style={{ ...S.code, background: "#f8514922", color: "#f85149", border: "1px solid #f8514944" }}>
                    {f}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Per-source results toggle */}
          {group.results.length > 1 && (
            <SourcesBreakdown results={group.results} />
          )}

          {/* Analysis notes */}
          {m.analysisNotes.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={S.sectionHead}>Analysis Notes</div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {m.analysisNotes.map((n, i) => (
                  <li key={i} style={{ fontSize: 12, color: "#8b949e", padding: "1px 0" }}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 12, color: "#8b949e" }}>
            Confidence: <strong style={{ color: "#e2e8f0" }}>{Math.round(m.confidence * 100)}%</strong>
            {" · "}
            Official source: <strong style={{ color: m.officialSourceFound ? "#3fb950" : "#f85149" }}>
              {m.officialSourceFound ? "found" : "not found"}
            </strong>
          </div>
        </>
      )}
    </div>
  );
}

function SourcesBreakdown({ results }: { results: IntakeResult[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: "none", border: "none", color: "#58a6ff", fontSize: 12, cursor: "pointer", padding: 0 }}
      >
        {open ? "▾" : "▸"} {results.length} individual source results
      </button>
      {open && results.map((r, i) => (
        <div key={i} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, padding: "10px 14px", marginTop: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#8b949e", marginBottom: 6 }}>
            Source {i + 1}: {r.sourceUrl}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
            <SourceBadge kind={r.classification.kind} />
            {r.officialSource.found && <span style={{ color: "#3fb950" }}>✓ Official source found</span>}
            {r.isDuplicate && <span style={{ color: "#d29922" }}>⚠ Duplicate</span>}
            {r.trustGatePassed && <span style={{ color: "#3fb950" }}>✓ Trust Gate</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────

export default function AdminIntakePage() {
  const [urls, setUrls] = useState<string[]>([""]);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    groups: EntityGroup[];
    savedIds: string[];
    dryRun: boolean;
    pdfCount: number;
    pdfNames: string[];
    urlCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addUrl() { setUrls((u) => [...u, ""]); }
  function removeUrl(i: number) { setUrls((u) => u.filter((_, j) => j !== i)); }
  function setUrl(i: number, v: string) { setUrls((u) => u.map((x, j) => j === i ? v : x)); }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPdfFiles((prev) => [...prev, ...files.filter((f) => f.type === "application/pdf" || f.name.endsWith(".pdf"))]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePdf(i: number) { setPdfFiles((f) => f.filter((_, j) => j !== i)); }

  async function handleProcess(e: React.FormEvent) {
    e.preventDefault();
    const validUrls = urls.filter((u) => u.trim());
    if (validUrls.length === 0 && pdfFiles.length === 0) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("urls", JSON.stringify(validUrls));
      if (notes.trim()) fd.append("notes", notes.trim());
      if (dryRun) fd.append("dry_run", "true");
      pdfFiles.forEach((f, i) => {
        fd.append(`pdf_${i}`, f);
        fd.append(`pdf_${i}_name`, f.name);
      });

      const res = await fetch("/api/admin/intake", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setError(err.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>New Intake</h1>
        <p style={{ fontSize: 13, color: "#8b949e", marginTop: 4, marginBottom: 0 }}>
          Submit official URLs and/or upload PDFs. The engine fetches, classifies, extracts, and resolves entities.
        </p>
      </div>

      <form onSubmit={handleProcess}>
        <div style={S.card}>
          {/* URLs */}
          <div style={S.sectionHead}>Official URLs</div>
          {urls.map((url, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(i, e.target.value)}
                placeholder="https://ibps.in/... or https://ssc.gov.in/..."
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  background: "#0d1117",
                  border: "1px solid #21262d",
                  borderRadius: 6,
                  color: "#e2e8f0",
                  fontSize: 13,
                  fontFamily: "monospace",
                }}
              />
              {urls.length > 1 && (
                <button type="button" onClick={() => removeUrl(i)} style={{ background: "none", border: "1px solid #21262d", color: "#8b949e", borderRadius: 6, padding: "0 12px", cursor: "pointer", fontSize: 18 }}>×</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addUrl} style={{ background: "none", border: "none", color: "#58a6ff", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 20 }}>
            + Add another URL
          </button>

          {/* PDF uploads */}
          <div style={S.sectionHead}>Local Documents (optional)</div>
          <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 8 }}>
            PDFs are used for Stage C extraction only. Local paths are never stored as provenance. An official URL is still required.
          </div>
          {pdfFiles.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, fontSize: 13, color: "#8b949e" }}>
              <span style={{ color: "#58a6ff" }}>📄</span>
              <span>{f.name}</span>
              <span style={{ fontSize: 12 }}>({(f.size / 1024).toFixed(0)} KB)</span>
              <button type="button" onClick={() => removePdf(i)} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 14 }}>×</button>
            </div>
          ))}
          <label style={{ display: "inline-block", padding: "7px 14px", background: "#21262d", border: "1px solid #30363d", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#8b949e", marginBottom: 20 }}>
            Upload PDF
            <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" multiple onChange={handleFileChange} style={{ display: "none" }} />
          </label>

          {/* Notes */}
          <div style={S.sectionHead}>Notes (optional)</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Deadline extension announced in corrigendum dated..."
            rows={2}
            style={{
              width: "100%",
              padding: "8px 12px",
              background: "#0d1117",
              border: "1px solid #21262d",
              borderRadius: 6,
              color: "#e2e8f0",
              fontSize: 13,
              resize: "vertical",
              boxSizing: "border-box",
              marginBottom: 20,
            }}
          />

          {/* Options + Submit */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              type="submit"
              disabled={loading || (urls.every((u) => !u.trim()) && pdfFiles.length === 0)}
              style={{
                padding: "9px 24px",
                background: loading ? "#21262d" : "#238636",
                color: loading ? "#8b949e" : "white",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 700,
                cursor: loading ? "default" : "pointer",
              }}
            >
              {loading ? "Processing…" : "Process Sources"}
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#8b949e", cursor: "pointer" }}>
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
              Dry run (don&apos;t save to queue)
            </label>
          </div>
        </div>
      </form>

      {error && (
        <div style={{ background: "#f8514922", border: "1px solid #f8514944", borderRadius: 6, padding: "12px 16px", color: "#f85149", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {result && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>
              Results — {result.groups.length} {result.groups.length === 1 ? "entity" : "entities"}
            </h2>
            <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
              <span style={{ color: "#8b949e" }}>{result.urlCount} URLs · {result.pdfCount} PDFs</span>
              {result.dryRun ? (
                <span style={{ color: "#d29922" }}>dry run — nothing saved</span>
              ) : result.savedIds.length > 0 ? (
                <span style={{ color: "#3fb950" }}>✓ {result.savedIds.length} saved to review queue</span>
              ) : (
                <span style={{ color: "#8b949e" }}>no new candidates (all duplicates)</span>
              )}
            </div>
          </div>

          {result.groups.map((group) => (
            <EntityGroupCard key={group.mergeKey} group={group} />
          ))}

          {result.savedIds.length > 0 && !result.dryRun && (
            <div style={{ background: "#238636" + "22", border: "1px solid " + "#238636" + "44", borderRadius: 6, padding: "12px 16px", fontSize: 13, color: "#3fb950" }}>
              {result.savedIds.length} candidate{result.savedIds.length !== 1 ? "s" : ""} saved to review queue.{" "}
              <a href="/admin/review" style={{ color: "#58a6ff" }}>Go to Review →</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
