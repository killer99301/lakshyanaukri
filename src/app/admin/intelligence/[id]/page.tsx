"use client";
// ═══════════════════════════════════════════════════════════
// Phase 14: Intelligence Draft Review
// ═══════════════════════════════════════════════════════════
//
// Loads a saved RecruitmentIntelligenceDraft from intelligence_drafts.
// Shows all extracted fields with evidence indicators, Gemini-filled
// fees/breakdown, and conflicts. Provides a "Promote to CMS Record"
// action that calls POST /api/admin/cms/records/from-draft.
//
// Lifecycle:
//   /admin/intelligence/[id]   ← this page
//         ↓ "Promote to CMS Record"
//   POST /api/admin/cms/records/from-draft
//         ↓ { recordId }
//   /admin/cms/[recordId]
// ═══════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { RecruitmentIntelligenceDraft, FieldValue, FeeEntry } from "@/intelligence/draft-types";

// ─── Styles ───────────────────────────────────────────────────

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
  label: { color: "#8b949e", fontWeight: 500, fontSize: 12 } as React.CSSProperties,
  value: { color: "#e2e8f0", fontSize: 13 } as React.CSSProperties,
  row: {
    display: "grid",
    gridTemplateColumns: "200px 1fr",
    gap: 8,
    padding: "4px 0",
  } as React.CSSProperties,
  code: {
    fontFamily: "monospace",
    fontSize: 12,
    background: "#21262d",
    padding: "1px 6px",
    borderRadius: 3,
    color: "#e2e8f0",
  } as React.CSSProperties,
  missing: { color: "#f85149", fontSize: 12, fontStyle: "italic" } as React.CSSProperties,
};

// ─── Field value display ──────────────────────────────────────

function FieldRow({
  label,
  fv,
}: {
  label: string;
  fv: FieldValue<unknown> | undefined;
}) {
  const val = fv?.value;
  return (
    <div style={S.row}>
      <span style={S.label}>{label}</span>
      <span style={S.value}>
        {val !== undefined && val !== null ? (
          <>
            <span>{String(val)}</span>
            {fv?.conflict && (
              <span style={{ marginLeft: 8, fontSize: 11, color: "#d29922", background: "#d2992222", padding: "1px 6px", borderRadius: 3 }}>
                ⚠ conflict
              </span>
            )}
            {fv?.evidence && fv.evidence.length > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, color: "#58a6ff" }}>
                [{fv.evidence.length} source{fv.evidence.length !== 1 ? "s" : ""}]
              </span>
            )}
          </>
        ) : (
          <span style={S.missing}>not extracted</span>
        )}
      </span>
    </div>
  );
}

function DateRow({ label, date }: { label: string; date?: { date?: string; conflict?: boolean } }) {
  return (
    <div style={S.row}>
      <span style={S.label}>{label}</span>
      <span style={S.value}>
        {date?.date ? (
          <>
            <span>{date.date}</span>
            {date.conflict && (
              <span style={{ marginLeft: 8, fontSize: 11, color: "#d29922", background: "#d2992222", padding: "1px 6px", borderRadius: 3 }}>
                ⚠ conflict
              </span>
            )}
          </>
        ) : (
          <span style={S.missing}>not extracted</span>
        )}
      </span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────

export default function IntelligenceDraftPage() {
  const { id: draftId } = useParams<{ id: string }>();
  const router = useRouter();

  const [draftData, setDraftData] = useState<{
    draftId: string;
    status: string;
    currentRevision: number;
    draft: RecruitmentIntelligenceDraft;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState<{ recordId: string; slug: string; alreadyExisted: boolean } | null>(null);

  useEffect(() => {
    if (!draftId) return;
    setLoading(true);
    fetch(`/api/admin/intelligence/drafts/${draftId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setDraftData(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [draftId]);

  async function handlePromote() {
    if (!draftId) return;
    setPromoting(true);
    try {
      const res = await fetch("/api/admin/cms/records/from-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setPromoted(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setPromoting(false);
    }
  }

  if (loading) {
    return <div style={{ color: "#8b949e", fontSize: 13 }}>Loading draft…</div>;
  }
  if (error && !draftData) {
    return (
      <div style={{ background: "#f8514922", border: "1px solid #f8514944", borderRadius: 6, padding: "12px 16px", color: "#f85149", fontSize: 13 }}>
        {error}
      </div>
    );
  }
  if (!draftData) return null;

  const { draft, status, currentRevision } = draftData;
  const d = draft;

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <Link href="/admin/intelligence" style={{ color: "#8b949e", fontSize: 12, textDecoration: "none" }}>
              ← Intelligence Drafts
            </Link>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", margin: "6px 0 0" }}>
              {d.identity.title.value ?? <em style={{ color: "#8b949e" }}>Untitled Draft</em>}
            </h1>
            <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4 }}>
              {d.identity.organizationName.value && <span>{d.identity.organizationName.value} · </span>}
              {d.identity.notificationNumber.value && (
                <code style={S.code}>{d.identity.notificationNumber.value}</code>
              )}
              <span style={{ marginLeft: 8 }}>v{currentRevision} · {status}</span>
            </div>
          </div>

          {/* Promote action */}
          {!promoted ? (
            <button
              onClick={handlePromote}
              disabled={promoting}
              style={{
                padding: "9px 20px",
                background: promoting ? "#21262d" : "#1f6feb",
                color: promoting ? "#8b949e" : "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: promoting ? "default" : "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {promoting ? "Promoting…" : "Promote to CMS Record →"}
            </button>
          ) : (
            <div style={{ background: "#23863622", border: "1px solid #23863644", borderRadius: 6, padding: "10px 16px", fontSize: 13, color: "#3fb950" }}>
              {promoted.alreadyExisted ? "Already promoted." : "Promoted!"}{" "}
              <Link href={`/admin/cms/${promoted.recordId}`} style={{ color: "#58a6ff" }}>
                Review in CMS →
              </Link>
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: "#f8514922", border: "1px solid #f8514944", borderRadius: 6, padding: "10px 14px", color: "#f85149", fontSize: 12, marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>

      {/* Readiness banner */}
      {!d.readiness.readyForReview && d.readiness.blockingIssues.length > 0 && (
        <div style={{ background: "#da363322", border: "1px solid #da363344", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#f85149", marginBottom: 16 }}>
          <strong>Not ready for review:</strong>
          <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
            {d.readiness.blockingIssues.map((issue, i) => <li key={i}>{issue}</li>)}
          </ul>
        </div>
      )}
      {d.readiness.warnings.length > 0 && (
        <div style={{ background: "#d2992222", border: "1px solid #d2992244", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#d29922", marginBottom: 16 }}>
          <strong>Warnings:</strong>
          <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
            {d.readiness.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Identity */}
      <div style={S.card}>
        <div style={S.sectionHead}>Identity</div>
        <FieldRow label="Title" fv={d.identity.title} />
        <FieldRow label="Short title" fv={d.identity.shortTitle} />
        <FieldRow label="Organisation ID" fv={d.identity.organizationId} />
        <FieldRow label="Organisation name" fv={d.identity.organizationName} />
        <FieldRow label="Notification #" fv={d.identity.notificationNumber} />
        <FieldRow label="Recruitment year" fv={d.identity.recruitmentYear} />
      </div>

      {/* Dates */}
      <div style={S.card}>
        <div style={S.sectionHead}>Key Dates</div>
        <DateRow label="Notification date" date={d.dates.notificationDate} />
        <DateRow label="Application opens" date={d.dates.applicationOpenDate} />
        <DateRow label="Application closes" date={d.dates.applicationCloseDate} />
        <DateRow label="Fee payment closes" date={d.dates.feePaymentCloseDate} />
        <DateRow label="Exam date" date={d.dates.examDate} />
      </div>

      {/* Vacancies */}
      <div style={S.card}>
        <div style={S.sectionHead}>Vacancies</div>
        <FieldRow label="Total" fv={d.vacancies.total} />
        {d.vacancies.derivedTotal !== undefined && (
          <div style={S.row}>
            <span style={S.label}>Derived total</span>
            <span style={S.value}>
              {d.vacancies.derivedTotal}
              <span style={{ marginLeft: 8, fontSize: 11, color: "#8b949e" }}>
                {d.vacancies.derivedTotalExplanation}
              </span>
            </span>
          </div>
        )}
        {d.vacancies.rows.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6, fontWeight: 600 }}>BREAKDOWN ({d.vacancies.rows.length} posts)</div>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", color: "#8b949e", padding: "2px 8px 6px", fontWeight: 500 }}>Post</th>
                  <th style={{ textAlign: "right", color: "#8b949e", padding: "2px 8px 6px", fontWeight: 500 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {d.vacancies.rows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ padding: "3px 8px", color: "#e2e8f0" }}>{row.postName}</td>
                    <td style={{ padding: "3px 8px", textAlign: "right", color: "#e2e8f0" }}>{row.total ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Application fees (Gemini-filled) */}
      {d.pay?.applicationFee && d.pay.applicationFee.length > 0 && (
        <div style={S.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, ...S.sectionHead }}>
            Application Fees
            <span style={{ fontSize: 10, background: "#1f6feb22", color: "#58a6ff", border: "1px solid #1f6feb44", borderRadius: 3, padding: "1px 6px", fontWeight: 700 }}>
              Gemini
            </span>
          </div>
          {(d.pay.applicationFee as FeeEntry[]).map((fee, i) => (
            <div key={i} style={S.row}>
              <span style={S.label}>{fee.category}</span>
              <span style={S.value}>
                ₹{fee.amount}
                {fee.description && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: "#8b949e", fontStyle: "italic" }}>
                    — {fee.description.slice(0, 80)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Links */}
      {d.links.length > 0 && (
        <div style={S.card}>
          <div style={S.sectionHead}>Links</div>
          {d.links.map((l, i) => (
            <div key={i} style={{ ...S.row, marginBottom: 4 }}>
              <span style={S.label}>{l.type}</span>
              <a href={l.url} target="_blank" rel="noreferrer" style={{ color: "#58a6ff", fontSize: 12, wordBreak: "break-all" }}>
                {l.url}
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Conflicts */}
      {d.conflicts.length > 0 && (
        <div style={S.card}>
          <div style={S.sectionHead}>Conflicts ({d.conflicts.length})</div>
          {d.conflicts.map((c, i) => (
            <div key={i} style={{ background: "#d2992211", border: "1px solid #d2992233", borderRadius: 4, padding: "8px 12px", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#d29922", marginBottom: 4 }}>
                {c.field} — {c.severity}
              </div>
              {c.values.map((v, j) => (
                <div key={j} style={{ fontSize: 12, color: "#8b949e", padding: "1px 0" }}>
                  <code style={S.code}>{v.sourceKind}</code>
                  <span style={{ marginLeft: 6 }}>{String(v.value)}</span>
                </div>
              ))}
              {c.resolution && (
                <div style={{ fontSize: 11, color: "#3fb950", marginTop: 4 }}>
                  ✓ Auto-resolved: {String(c.resolution.selectedValue)} ({c.resolution.reason})
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Missing fields */}
      {d.missingFields.length > 0 && (
        <div style={S.card}>
          <div style={S.sectionHead}>Missing Fields ({d.missingFields.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {d.missingFields.map((f) => (
              <code key={f} style={{ ...S.code, background: "#f8514922", color: "#f85149", border: "1px solid #f8514944" }}>
                {f}
              </code>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "#8b949e", marginTop: 8 }}>
            These fields can be filled manually in the CMS editor after promoting.
          </p>
        </div>
      )}

      {/* Sources */}
      <div style={S.card}>
        <div style={S.sectionHead}>Sources ({d.sources.length})</div>
        {d.sources.map((src) => (
          <div key={src.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, padding: "3px 0" }}>
            <span style={{
              padding: "1px 6px",
              borderRadius: 3,
              fontSize: 10,
              fontWeight: 600,
              background: src.kind === "OFFICIAL" ? "#238636" : "#21262d",
              color: src.kind === "OFFICIAL" ? "#fff" : "#8b949e",
            }}>
              {src.kind}
            </span>
            <a href={src.url} target="_blank" rel="noreferrer" style={{ color: "#58a6ff", wordBreak: "break-all" }}>
              {src.url}
            </a>
            {!src.success && <span style={{ color: "#f85149" }}>✗ failed</span>}
          </div>
        ))}
      </div>

      {/* Confidence + overall */}
      <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 24 }}>
        Overall confidence:{" "}
        <strong style={{ color: "#e2e8f0" }}>{Math.round(d.overallConfidence * 100)}%</strong>
        {" · "}
        {d.sources.length} source{d.sources.length !== 1 ? "s" : ""}
        {" · "}
        Created {new Date(d.createdAt).toLocaleString("en-IN")}
      </div>
    </div>
  );
}
