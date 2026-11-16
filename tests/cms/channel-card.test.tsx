// The "Get job alerts" card (16 Nov 2026): the Telegram and WhatsApp links are a card in the page, above the footer,
// on every screen size; nothing floats over the page; not on the homepage (its own Stay connected section).
// Pure: reads the source and the layout, no browser.
//   npx tsx --tsconfig tsconfig.json tests/cms/channel-card.test.tsx
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { suite, test, assert } from "../intelligence/suite";

const src = readFileSync("src/components/layout/ChannelCard.tsx", "utf8");
const layout = readFileSync("src/app/(main)/layout.tsx", "utf8");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });

suite("Job alerts: an in-page card, never floating");

test("CC01 the card is in the page on all sizes: never fixed or sticky, no hiding by screen size", () => {
  // Class names only (the comments explain the old floating strip).
  const classes = [...src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g), ...src.matchAll(/const btn = "([^"]*)"/g)]
    .map((m) => m[1] ?? m[2] ?? "").join(" ");
  assert.ok(classes.length > 0);
  assert.ok(!/(^|\s)(fixed|sticky)(\s|$)/.test(classes), "never fixed or sticky");
  assert.ok(!/(^|\s)(hidden|sm:hidden|sm:block|md:hidden|lg:hidden)(\s|$)/.test(classes), "shown on every screen size");
  assert.match(src, /data-channel-card/);
});

test("CC02 placed between the page content and the footer", () => {
  const at = layout.indexOf("<ChannelCard />");
  assert.ok(at > layout.indexOf("</main>") && at < layout.indexOf("<Footer />"));
});

test("CC03 the floating strip, its spacer, Apply-button watcher and dismissal are gone everywhere", () => {
  assert.ok(!existsSync("src/components/layout/ChannelStrip.tsx"));
  const all = files("src").filter((f) => /\.(tsx?|css)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
  assert.ok(!/ChannelStrip|data-channel-strip|ln-channel-strip-closed-until|data-keep-clear/.test(all));
});

test("CC04 not on the homepage; nothing without a channel link; same destinations as before", () => {
  assert.match(src, /if \(\(!telegram && !whatsapp\) \|\| pathname === "\/"\) return null;/);
  assert.match(src, /siteConfig\.links\.telegram/);
  assert.match(src, /siteConfig\.links\.whatsapp/);
});

test("CC05 readable buttons with a visible keyboard focus ring", () => {
  assert.match(src, /bg-\[#16739F\] text-white/, "Telegram 5.3:1");
  assert.match(src, /bg-\[#25D366\] text-\[#0B3D20\]/, "WhatsApp 6.2:1");
  assert.ok(src.includes("focus-visible:ring-2 focus-visible:ring-[#0F172A] focus-visible:ring-offset-2"), "a dark ring with a white gap");
});

test("CC06 phones stacked (as tested), tablets and desktops one compact row", () => {
  assert.match(src, /sm:flex sm:items-center sm:justify-between/);
  assert.match(src, /mt-3 flex gap-2 sm:mt-0/);
});
