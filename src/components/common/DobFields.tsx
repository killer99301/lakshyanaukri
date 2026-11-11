"use client";

// Date of birth as Day and Month lists and a typed four-digit Year: no calendar
// to page back through the decades. Used by a job's age check and by the
// eligibility finder. The value stays in the page; nothing here stores or sends it.

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { isoFromParts } from "@/lib/eligibility";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function DobFields({ id, legendClassName, fieldClassName, className, onChange }: {
  /** Prefix for the three fields' ids. */
  id: string;
  legendClassName: string;
  fieldClassName: string;
  /** Extra classes for the group, e.g. the columns it takes in its form's grid. */
  className?: string;
  /** "YYYY-MM-DD" once day, month and a four-digit year are given; "" before. */
  onChange: (iso: string) => void;
}) {
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const update = (d: string, m: string, y: string) => { setDay(d); setMonth(m); setYear(y); onChange(isoFromParts(d, m, y)); };

  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className={legendClassName}>Date of birth</legend>
      <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_5.75rem] gap-2">
        <div>
          <label htmlFor={`${id}-day`} className="sr-only">Day</label>
          <select id={`${id}-day`} value={day} autoComplete="bday-day" onChange={(e) => update(e.target.value, month, year)} className={cn(fieldClassName, "px-2")}>
            <option value="">Day</option>
            {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-month`} className="sr-only">Month</label>
          <select id={`${id}-month`} value={month} autoComplete="bday-month" onChange={(e) => update(day, e.target.value, year)} className={cn(fieldClassName, "px-2")}>
            <option value="">Month</option>
            {/* Short names fit a narrow card without being cut ("Sept…"); each option keeps its full name for screen readers. */}
            {MONTHS.map((name, i) => <option key={name} value={String(i + 1).padStart(2, "0")} aria-label={name}>{name.slice(0, 3)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-year`} className="sr-only">Year (four digits)</label>
          <input
            id={`${id}-year`}
            value={year}
            onChange={(e) => update(day, month, e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            autoComplete="bday-year"
            placeholder="Year"
            className={cn(fieldClassName, "px-2")}
          />
        </div>
      </div>
    </fieldset>
  );
}
