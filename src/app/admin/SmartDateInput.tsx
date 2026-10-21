"use client";

// ═══════════════════════════════════════════════════════════
// Admin: a date box that takes dates the way people type them
// ═══════════════════════════════════════════════════════════
//
// Replaces the browser's split day/month/year box, which fights pasting.
// Takes "28 Oct 2026", "28-10-2026" or "2026-10-28" (see lib/date-input.ts),
// and always shows how it read the date before anything is saved. A text it
// cannot read is never passed on: the date already there stays, and the box
// says so. A calendar button is still there for picking.

import { useRef, useState } from "react";
import { readDate, showDate } from "@/lib/date-input";

const C = { bg: "#070b16", text: "#e2e8f0", muted: "#8c9bb8", amber: "#d29922", red: "#f85149", green: "#3fb950", accent: "#62b5ff" };

export function SmartDateInput({
  id,
  value,
  onChange,
  style,
  ariaLabel,
}: {
  id?: string;
  /** The stored date: ISO (2026-10-28), or "" for none. */
  value: string;
  /** Called with an ISO date, or "" when the box is emptied. Never with text it could not read. */
  onChange: (iso: string) => void;
  style?: React.CSSProperties;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(() => (value ? showDate(value) : ""));
  // The value this box last passed on; a different one came from outside (a reset, a load).
  const [emitted, setEmitted] = useState(value);
  const picker = useRef<HTMLInputElement>(null);

  let shown = text;
  if (value !== emitted) {
    shown = value ? showDate(value) : "";
    setText(shown);
    setEmitted(value);
  }

  const reading = readDate(shown);

  function type(next: string) {
    setText(next);
    const r = readDate(next);
    if (r.ok === true) { setEmitted(r.iso); onChange(r.iso); }
    else if (r.ok === null) { setEmitted(""); onChange(""); }
  }

  return (
    <span style={{ display: "block" }}>
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          id={id}
          type="text"
          inputMode="text"
          autoComplete="off"
          aria-label={ariaLabel}
          value={shown}
          onChange={(e) => type(e.target.value)}
          placeholder="28 Oct 2026"
          style={{ ...style, flex: 1, minWidth: 0 }}
        />
        <button
          type="button"
          title="Pick from a calendar"
          aria-label="Pick from a calendar"
          onClick={() => { try { picker.current?.showPicker(); } catch { picker.current?.focus(); } }}
          style={{ background: "none", border: "1px solid #2b3a5c", borderRadius: 5, color: C.muted, cursor: "pointer", padding: "5px 8px", fontSize: 12 }}
        >
          📅
        </button>
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={reading.ok === true ? reading.iso : ""}
          onChange={(e) => type(e.target.value)}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
      </span>
      {reading.ok === true && (
        <span style={{ display: "block", fontSize: 11, color: reading.note ? C.amber : C.green, marginTop: 3, lineHeight: 1.4 }}>
          Saves as {new Date(`${reading.iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
          {reading.note ? `. ${reading.note}` : ""}
        </span>
      )}
      {reading.ok === false && (
        <span role="alert" style={{ display: "block", fontSize: 11, color: C.red, marginTop: 3, lineHeight: 1.4 }}>
          {reading.error} {value ? `Until it reads as a date, ${showDate(value)} is kept.` : "Nothing is saved from this box until it reads as a date."}
        </span>
      )}
    </span>
  );
}
