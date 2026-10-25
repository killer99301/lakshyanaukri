"use client";

// A link to the importer, shown only while the importer is switched on.
// Hiding it is only a convenience; the importer's routes refuse when off.

import { useEffect, useState } from "react";
import Link from "next/link";
import type React from "react";

export function ImporterLink({ href, children, style }: { href: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/cms/import/switch").then((r) => (r.ok ? r.json() : { on: false })).then((d) => { if (alive) setOn(d.on === true); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!on) return null;
  return <Link href={href} style={style}>{children}</Link>;
}
