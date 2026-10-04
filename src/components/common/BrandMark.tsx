import React from "react";

/**
 * The LakshyaNaukri "LN" mark. Same drawing as src/app/icon.svg (the browser
 * tab icon) — change both together.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="LakshyaNaukri">
      <rect width="64" height="64" rx="14" fill="#FFF7ED" />
      <path d="M9 10h13v35h33v9H9z" fill="#0F172A" stroke="#0F172A" strokeWidth="2" strokeLinejoin="round" />
      <path
        d="M28 11h7.500l12 16.500V11H55v29h-7.500l-12-16.500V40H28z"
        fill="#EA580C"
        stroke="#EA580C"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
