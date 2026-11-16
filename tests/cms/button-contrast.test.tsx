// Contrast fix C1 (16 Nov 2026): the shared primary button meets WCAG AA (4.5:1) for its white label in the normal,
// hover and pressed states; every other part of the button (size, type, focus ring, disabled, other variants) unchanged.
// Pure: renders the component to markup, no browser.
//   npx tsx --tsconfig tsconfig.json tests/cms/button-contrast.test.tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { Button } from "@/components/ui/Button";

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const cls = (el: React.ReactElement) => (renderToStaticMarkup(el).match(/class="([^"]*)"/) ?? [])[1] ?? "";
const colour = (c: string, prefix: string) => (c.match(new RegExp(`(?:^|\\s)${prefix}\\[(#[0-9A-Fa-f]{6})\\]`)) ?? [])[1];

suite("Primary button contrast (C1)");

const primary = cls(<Button>Search</Button>);

test("BC01 primary fill, hover and pressed backgrounds each give white text at least 4.5:1", () => {
  assert.match(primary, /(^|\s)text-white(\s|$)/);
  for (const prefix of ["bg-", "hover:bg-", "active:bg-"]) {
    const bg = colour(primary, prefix);
    assert.ok(bg, `${prefix} colour present`);
    assert.ok(ratio("#FFFFFF", bg!) >= 4.5, `${prefix}${bg} = ${ratio("#FFFFFF", bg!).toFixed(2)}`);
  }
  assert.equal(colour(primary, "bg-")!.toUpperCase(), "#C2410C");
  assert.equal(colour(primary, "hover:bg-")!.toUpperCase(), "#9A3412");
});

test("BC02 the old failing orange (#EA580C, 3.55:1) is no longer a primary fill", () => {
  assert.ok(!/(^|\s)bg-\[#EA580C\]/i.test(primary));
});

test("BC03 focus ring, disabled behaviour, sizes and shimmer unchanged", () => {
  for (const c of ["focus-visible:ring-2", "focus-visible:ring-offset-2", "focus-visible:ring-[#EA580C]", "disabled:opacity-50",
    "disabled:pointer-events-none", "shadow-sm", "shimmer-hover", "h-10", "px-4", "text-sm", "font-semibold", "rounded-lg"])
    assert.ok(primary.split(/\s+/).includes(c), c);
  assert.ok(cls(<Button size="sm">x</Button>).includes("h-8 px-3 text-xs"));
  assert.ok(cls(<Button size="lg">x</Button>).includes("h-12 px-6 text-base"));
  assert.match(renderToStaticMarkup(<Button disabled>x</Button>), /disabled=""/);
  assert.match(renderToStaticMarkup(<Button isLoading>x</Button>), /disabled=""/);
});

test("BC04 the focus ring keeps at least 3:1 against a white page", () => {
  assert.ok(ratio("#EA580C", "#FFFFFF") >= 3);
});

test("BC05 the other variants are untouched", () => {
  assert.ok(cls(<Button variant="secondary">x</Button>).includes("bg-[#F95738] text-white hover:bg-[#e04527] active:bg-[#c73418]"));
  assert.ok(cls(<Button variant="outline">x</Button>).includes("border border-[#E2E8F0] bg-white text-[#0F172A] hover:bg-[#FFF7ED] hover:border-[#FED7AA] hover:text-[#EA580C]"));
  assert.ok(cls(<Button variant="ghost">x</Button>).includes("text-[#475569] hover:bg-slate-100 hover:text-[#0F172A]"));
  assert.ok(cls(<Button variant="link">x</Button>).includes("text-[#EA580C] underline-offset-4"));
});
