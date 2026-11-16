// The responsive header (16 Nov 2026): the full link row only from xl (1280 px), where it fits on one line; the menu
// below that (it used to switch at md, 768 px, and the row was squeezed and cut off up to about 1150 px). Dropdowns and
// the menu work by keyboard. Pure: reads the source, no browser.
//   npx tsx --tsconfig tsconfig.json tests/cms/header-responsive.test.tsx
import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { MAIN_NAV_ITEMS } from "@/lib/constants";

const main = readFileSync("src/components/layout/MainNav.tsx", "utf8");
const mobile = readFileSync("src/components/layout/MobileNav.tsx", "utf8");

suite("Header: one breakpoint, no squeezed link row");

test("HR01 the link row shows from xl and the menu below xl: the same breakpoint, so one of them is always there", () => {
  assert.match(main, /className="hidden xl:flex items-center/);
  assert.match(mobile, /<div className="xl:hidden">/);
  assert.ok(!/\bmd:flex\b|\bmd:hidden\b/.test(main + mobile), "the old md switch is gone");
});

test("HR02 link labels never wrap onto two lines", () => {
  assert.equal((main.match(/whitespace-nowrap/g) ?? []).length, 2, "dropdown buttons and plain links");
});

test("HR03 desktop dropdowns open by click or keyboard too, report their state, close on Escape or when focus leaves", () => {
  assert.match(main, /aria-expanded=\{activeDropdown === item\.title\}/);
  assert.match(main, /onClick=\{\(\) => setActiveDropdown/);
  assert.match(main, /e\.key === "Escape"/);
  assert.match(main, /onBlur=/);
  assert.match(main, /onMouseEnter=\{\(\) => setActiveDropdown\(item\.title\)\}/, "hover still works");
});

test("HR04 the menu button reports open/closed, names its panel, and Escape closes it and returns focus", () => {
  assert.match(mobile, /aria-expanded=\{isOpen\}/);
  assert.match(mobile, /aria-controls="mobile-nav-panel"/);
  assert.match(mobile, /id="mobile-nav-panel"/);
  assert.match(mobile, /e\.key === "Escape"\) \{ setIsOpen\(false\); toggle\.current\?\.focus\(\); return; \}/);
});

test("HR06 the open menu locks the page behind it and restores it exactly; the panel's own scroll never chains to the page", () => {
  assert.match(mobile, /const before = root\.style\.overflow;\s*root\.style\.overflow = "hidden";\s*return \(\) => \{ root\.style\.overflow = before; \};/);
  assert.match(mobile, /\}, \[isOpen\]\);/, "re-run on every open/close; the cleanup also runs on unmount");
  assert.match(mobile, /overflow-y-auto overscroll-contain/);
});

test("HR07 keyboard focus cycles within the open menu (button + visible panel controls), Tab and Shift+Tab wrap", () => {
  assert.match(mobile, /\.\.\.\(toggle\.current \? \[toggle\.current\] : \[\]\)/, "the menu button is in the cycle");
  assert.match(mobile, /panel\.current\?\.querySelectorAll<HTMLElement>\('a\[href\], button:not\(\[disabled\]\), \[tabindex\]:not\(\[tabindex="-1"\]\)'\)/);
  assert.match(mobile, /\.filter\(\(el\) => el\.getClientRects\(\)\.length > 0\)/, "only visible controls");
  assert.match(mobile, /\(at \+ \(e\.shiftKey \? -1 : 1\) \+ list\.length\) % list\.length/, "wraps both ways");
  assert.match(mobile, /e\.preventDefault\(\);\s*list\[next\]\.focus\(\);/);
});

test("HR08 a new page closes the menu (and so unlocks the page)", () => {
  assert.match(mobile, /if \(pathname !== openedOn\) \{ setOpenedOn\(pathname\); if \(isOpen\) setIsOpen\(false\); \}/);
});

test("HR05 every destination is still in both: same items, sub-items from the same list", () => {
  assert.ok(MAIN_NAV_ITEMS.length >= 7);
  for (const src of [main, mobile]) {
    assert.match(src, /MAIN_NAV_ITEMS\.map/);
    assert.match(src, /item\.items\?\.map/);
  }
});
