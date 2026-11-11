"use client";

// ═══════════════════════════════════════════════════════════
// Admin: the owner's publication review (owner-controlled publication, Stage 2)
// ═══════════════════════════════════════════════════════════
//
// docs/owner-controlled-publication-design.md, revision 3, §2 and §4. Shows the
// review the server builds (GET …/publication-review): what is ready, what is
// missing, where the sources disagree, the links, the warnings, the private
// source standing and the hard rules. The publisher acknowledges each
// disagreement on its own, then accepts editorial responsibility in one final
// statement, and publishes from here. Telegram stays off unless ticked.
//
// Nothing here decides anything on the server: the publish request carries the
// review's fingerprint and freshness, and the server rebuilds the review and
// refuses if anything changed (REVIEW_CHANGED), a hard rule applies, or a
// disagreement was not acknowledged. A non-publisher sees the review read only,
// with their own admin ID to give the owner.

import { useCallback, useEffect, useState } from "react";
import type { RecruitmentRecord } from "@/types/recruitment-record";
import type { PublicationReview, ReviewLink } from "@/lib/cms/publication-review";
import { C, PANEL, badge, quietBtn } from "../import/ui";
import { sectionOf } from "./ImportChecksPanel";

/** The publisher's final statement, word for word (design rev. 3, §2.3). */
export const PUBLISHER_STATEMENT = "I have reviewed the available information and accept editorial responsibility for publishing this recruitment.";

interface ReviewResponse { review: PublicationReview; publisher: boolean; adminId: string }

export interface PublishOutcome { record: RecruitmentRecord; note: string | null; error: string | null }

const LINK_STATE: Record<ReviewLink["state"], string> = {
  NONE: "none", RESEARCH: "from research, not checked", ENTERED: "entered by hand, not checked", VERIFIED: "checked against an official document",
  LINK_LATER: "link not yet released (recorded)", NOT_APPLICABLE: "not applicable (recorded)",
};
const STANDING: Record<string, string> = {
  AUTHORITY: "the recruiting body's own site", PARTNER: "a listed partner site",
  UNLISTED: "a site not listed for this organisation", NONE: "a site not established for this organisation",
};

export function PublicationReviewPanel({ record, onJump, onPublished, onRefused }: {
  record: RecruitmentRecord;
  onJump: (section: string, fieldPath?: string) => void;
  onPublished: (o: PublishOutcome) => void;
  /** A refused publish: the editor reloads the job (an approval may have been withdrawn). */
  onRefused: () => void;
}) {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Acknowledgements and the final statement belong to one review: a new fingerprint starts them afresh.
  const [ackState, setAckState] = useState<{ hash: string; set: Set<string> }>({ hash: "", set: new Set() });
  const [acceptedFor, setAcceptedFor] = useState("");
  const [announce, setAnnounce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showStanding, setShowStanding] = useState(false);

  // A new review (another fingerprint) starts every acknowledgement afresh.
  const take = useCallback((d: ReviewResponse) => setData(d), []);
  const hash = data?.review.reviewHash ?? "";
  const acks = ackState.hash === hash ? ackState.set : new Set<string>();
  const accepted = acceptedFor !== "" && acceptedFor === hash;
  const setAccepted = (on: boolean) => setAcceptedFor(on ? hash : "");
  const fetchReview = useCallback(() => fetch(`/api/admin/cms/records/${record.id}/publication-review`, { cache: "no-store" })
    .then(async (r) => ({ ok: r.ok, status: r.status, d: await r.json().catch(() => ({})) })), [record.id]);
  const settle = useCallback(({ ok, status, d }: { ok: boolean; status: number; d: { error?: string } }) => {
    if (!ok) { setLoadErr(d.error ?? `The review could not be loaded (HTTP ${status})`); return; }
    setLoadErr(null);
    take(d as unknown as ReviewResponse);
  }, [take]);
  const load = useCallback(() => fetchReview().then(settle).catch((e) => setLoadErr(String(e))), [fetchReview, settle]);
  // Rebuilt whenever the job changes (any save, decision or import can change the review).
  useEffect(() => {
    let alive = true;
    fetchReview().then((x) => { if (alive) settle(x); }).catch((e) => { if (alive) setLoadErr(String(e)); });
    return () => { alive = false; };
  }, [fetchReview, settle, record.recordRevision, record.updatedAt]);

  if (record.draftState !== "DRAFT" && record.draftState !== "APPROVED") return null;
  if (!data) {
    return (
      <section data-publication-review aria-label="Publication review" style={{ ...PANEL, padding: "14px 18px", marginBottom: 16, fontSize: 12, color: C.muted }}>
        {loadErr ? <span role="alert" style={{ color: C.red }}>{loadErr} <button onClick={() => void load()} style={{ ...quietBtn, padding: "2px 8px" }}>Try again</button></span> : "Loading the publication review…"}
      </section>
    );
  }

  const { review: v, publisher, adminId } = data;
  const conflictsDone = v.conflicts.every((c) => acks.has(c.fieldPath));
  const canPublish = publisher && v.hardRules.length === 0 && conflictsDone && accepted && !busy;
  const toggleAck = (p: string) => { const n = new Set(acks); if (n.has(p)) n.delete(p); else n.add(p); setAckState({ hash, set: n }); };
  const jump = (fieldPath: string) => onJump(sectionOf(fieldPath), fieldPath.startsWith("links#") ? undefined : fieldPath);

  async function publish() {
    if (!canPublish) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/cms/records/${record.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          announce,
          approveFirst: record.draftState === "DRAFT",
          ownerApproval: { acknowledged: true, reviewHash: v.reviewHash, ...v.freshness, conflictsAcknowledged: v.conflicts.map((c) => c.fieldPath).filter((p) => acks.has(p)) },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr((d.error ?? `Publish failed: HTTP ${res.status}`) + (d.approvalWithdrawn ? " The job is still a draft." : ""));
        if (d.review) take({ review: d.review, publisher, adminId });
        else void load();
        onRefused();
        return;
      }
      const note = d.announced === "sent" ? "Published and posted to the Telegram channel."
        : d.announced === "duplicate" ? "Published. Not posted to Telegram: the same message went out in the last 24 hours."
          : d.announced === "failed" ? null : "Published. Nothing was posted to Telegram.";
      const error = d.announced === "failed" ? "Published. The Telegram channel post did not go through — post it by hand if you want it there."
        : d.revalidated === false ? "Published, but the public site cache could not be refreshed. The public pages will update after the next deployment." : null;
      setAnnounce(false);
      setAccepted(false);
      onPublished({ record: d.record, note, error });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const heading = (t: string, color: string = C.text) => <div style={{ fontSize: 12, fontWeight: 700, color, marginTop: 12, marginBottom: 4 }}>{t}</div>;
  const linkLine = (name: string, l: ReviewLink) => (
    <div style={{ lineHeight: 1.6 }}>
      <span style={{ color: C.muted }}>{name}:</span>{" "}
      {l.url ? <><span style={{ wordBreak: "break-all" }}>{l.host ?? l.url}</span> — {LINK_STATE[l.state]}{l.standing ? `, on ${STANDING[l.standing] ?? l.standing}` : ""}</> : LINK_STATE[l.state]}
    </div>
  );

  return (
    <section data-publication-review aria-label="Publication review" onInput={(e) => e.stopPropagation()} style={{ ...PANEL, padding: "14px 18px", marginBottom: 16, fontSize: 12, color: C.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Publication review</div>
          <div style={{ color: C.muted, marginTop: 2, lineHeight: 1.5 }}>
            You decide whether this job is published. Official confirmation is optional; only the hard rules below stop a publish.
          </div>
        </div>
        <button onClick={() => void load()} style={{ ...quietBtn, padding: "4px 10px" }}>Refresh the review</button>
      </div>

      {!publisher && (
        <div role="note" data-review-readonly style={{ marginTop: 10, padding: "8px 10px", border: `1px solid ${C.amber}55`, borderRadius: 8, color: C.amber, lineHeight: 1.5 }}>
          Read only: only the owner or an authorised publisher can publish. Your admin ID is <code style={{ userSelect: "all" }}>{adminId}</code>.
        </div>
      )}

      {v.hardRules.length > 0 && (
        <div data-review-hard-rules>
          {heading("Must be fixed before publishing", C.red)}
          {v.hardRules.map((h) => (
            <div key={h.code} style={{ color: C.red, lineHeight: 1.5 }}>
              ✕ {h.message}{" "}
              {h.fieldPaths?.[0] && <button onClick={() => jump(h.fieldPaths![0])} style={{ ...quietBtn, padding: "1px 8px" }}>Fix</button>}
            </div>
          ))}
        </div>
      )}

      {v.conflicts.length > 0 && (
        <div data-review-conflicts>
          {heading(`Values that disagree (${v.conflicts.length})`, C.amber)}
          <div style={{ color: C.muted, marginBottom: 4 }}>Correct the value, or acknowledge each disagreement to publish the value shown in the editor.</div>
          {v.conflicts.map((c) => (
            <div key={c.fieldPath} data-review-conflict={c.fieldPath} style={{ borderTop: `1px solid ${C.border}`, padding: "6px 0" }}>
              <div style={{ fontWeight: 600 }}>{c.label}{c.part ? ` — ${c.part === "both" ? "qualification and experience" : c.part}` : ""}</div>
              <div data-conflict-kind={c.kind ?? "SOURCES"} style={{ color: C.muted, fontSize: 11 }}>
                {c.kind === "OMITTED" ? "The saved value leaves out part of what the source says. Correct it, or acknowledge that you publish it as saved."
                  : c.kind === "READINGS" ? "One source, read two different ways — or it gives two different values. Check which is right." : "The sources disagree."}
              </div>
              {c.values.map((x, i) => <div key={i} style={{ color: C.muted, wordBreak: "break-word" }}>Source value {i + 1}: {x}</div>)}
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                <button onClick={() => jump(c.fieldPath)} style={{ ...quietBtn, padding: "2px 8px" }}>Edit</button>
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: publisher ? "pointer" : "default" }}>
                  <input type="checkbox" disabled={!publisher} checked={acks.has(c.fieldPath)} onChange={() => toggleAck(c.fieldPath)} />
                  I have seen this disagreement and accept the value in the editor
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {v.missing.length > 0 && (
        <div data-review-missing>
          {heading("Missing information")}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {v.missing.map((m) => (
              <button key={m.fieldPath} onClick={() => jump(m.fieldPath)} title="Empty — click to fill" style={{ ...badge(C.muted), cursor: "pointer" }}>{m.label}</button>
            ))}
          </div>
        </div>
      )}

      {v.warnings.filter((w) => w.code !== "MISSING_KEY_DETAILS").length > 0 && (
        <div data-review-warnings>
          {heading("Before you publish")}
          {v.warnings.filter((w) => w.code !== "MISSING_KEY_DETAILS").map((w, i) => (
            <div key={`${w.code}${i}`} data-warning={w.code} style={{ color: w.code === "PAST_DEADLINE" || w.code === "POSSIBLE_DUPLICATE" || w.code === "QUESTIONABLE_APPLY_URL" ? C.amber : C.muted, lineHeight: 1.5 }}>
              • {w.text}
              {w.recordId && <> — <a href={`/admin/cms/${w.recordId}`} target="_blank" rel="noreferrer" style={{ color: C.accent }}>open it</a></>}
            </div>
          ))}
        </div>
      )}

      {(v.announcements ?? []).length > 0 && (
        <div data-review-announcements>
          {heading(`Announcements this publish makes public (${v.announcements.length})`)}
          {v.announcements.map((a) => (
            <div key={a.id} data-announcement={a.id} style={{ color: C.text, lineHeight: 1.5 }}>
              • {a.title} <span style={{ color: C.muted }}>({a.type.replace(/_/g, " ").toLowerCase()}, {a.date})</span>
            </div>
          ))}
        </div>
      )}

      <div data-review-links>
        {heading("Links")}
        {linkLine("Apply Online", v.links.applyOnline)}
        {linkLine("Notification", v.links.notification)}
      </div>

      {v.ready.length > 0 && (
        <div data-review-ready>
          {heading("Ready")}
          <div style={{ color: C.muted }}>{v.ready.join(" · ")}</div>
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <button onClick={() => setShowStanding((x) => !x)} style={{ background: "none", border: "none", padding: 0, color: C.muted, cursor: "pointer", fontSize: 12 }}>
          {showStanding ? "▾" : "▸"} Where the details came from (admin only, never public)
        </button>
        {showStanding && (
          <div data-review-standing style={{ color: C.muted, lineHeight: 1.6, marginTop: 4 }}>
            Checked against an official document: {v.standing.verified} · recorded as not applicable or not stated: {v.standing.decided} ·
            in an official document, not checked: {v.standing.officialUnchecked} · from research: {v.standing.research} ·
            entered by hand: {v.standing.entered} · missing: {v.standing.missing} · official documents: {v.standing.officialDocuments}
          </div>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 12, paddingTop: 10 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.5, cursor: publisher ? "pointer" : "default" }}>
          <input type="checkbox" data-publisher-statement disabled={!publisher || v.hardRules.length > 0} checked={accepted} onChange={(e) => setAccepted(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={{ fontWeight: 600 }}>{PUBLISHER_STATEMENT}</span>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 6, color: C.muted, cursor: publisher ? "pointer" : "default" }}>
          <input type="checkbox" data-telegram disabled={!publisher} checked={announce} onChange={(e) => setAnnounce(e.target.checked)} style={{ marginTop: 2 }} />
          <span>{record.publishedAt ? "Also post “Updated” to the Telegram channel" : "Also post “New job” to the Telegram channel"} (off unless ticked)</span>
        </label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <button
            data-review-publish
            onClick={() => void publish()}
            disabled={!canPublish}
            style={{ padding: "8px 16px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13, cursor: canPublish ? "pointer" : "not-allowed",
              background: canPublish ? "linear-gradient(135deg, #22c55e, #14b8a6)" : "#1c2740", color: canPublish ? "#04130c" : C.muted }}
          >
            {busy ? "Publishing…" : record.publishedAt ? "Publish this version" : "Publish"}
          </button>
          <span style={{ color: C.muted }}>
            {!publisher ? "Publishing is for the owner or an authorised publisher."
              : v.hardRules.length ? "Fix the hard rules first."
                : !conflictsDone ? `Acknowledge each disagreement (${v.conflicts.filter((c) => !acks.has(c.fieldPath)).length} left).`
                  : !accepted ? "Tick the statement above to publish." : "Ready to publish."}
          </span>
        </div>
        {err && <div role="alert" style={{ color: C.red, marginTop: 8, lineHeight: 1.5 }}>{err}</div>}
      </div>
    </section>
  );
}
