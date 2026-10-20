// ═══════════════════════════════════════════════════════════
// Whether a publish posts to the Telegram channel
//
//   npx tsx --tsconfig tsconfig.json tests/cms/channel-post.test.ts
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { decideChannelPost, messageHash, newsLine } from "@/lib/cms/channel-post";

suite("Telegram channel post on publish");

test("CP01 a first publish posts unless unticked; a republish only when ticked", () => {
  assert.deepEqual(decideChannelPost({ requested: undefined, isNew: true, sameMessageRecently: false }), { post: true });
  assert.deepEqual(decideChannelPost({ requested: false, isNew: true, sameMessageRecently: false }), { post: false, reason: "not-asked" });
  assert.deepEqual(decideChannelPost({ requested: undefined, isNew: false, sameMessageRecently: false }), { post: false, reason: "not-asked" });
  assert.deepEqual(decideChannelPost({ requested: true, isNew: false, sameMessageRecently: false }), { post: true });
});

test("CP02 the same message twice within the window is not posted again, even when ticked", () => {
  assert.deepEqual(decideChannelPost({ requested: true, isNew: false, sameMessageRecently: true }), { post: false, reason: "duplicate" });
  assert.equal(messageHash("a"), messageHash("a"));
  assert.notEqual(messageHash("a"), messageHash("b"));
});

test("CP03 what's new: the newest entry of the last three days, else nothing", () => {
  const updates = [
    { date: "2026-10-01", title: "Notification out" },
    { date: "2026-10-18", title: "Tier 1 date announced" },
    { date: "2026-10-19", title: "Admit card released" },
    { date: "2026-10-19", title: "Exam city slip out" },
  ];
  assert.equal(newsLine(updates, "2026-10-20"), "Exam city slip out");
  assert.equal(newsLine(updates.slice(0, 1), "2026-10-20"), undefined);
  assert.equal(newsLine([], "2026-10-20"), undefined);
  assert.equal(newsLine([{ date: "soon", title: "x" }, { title: "no date" }], "2026-10-20"), undefined);
});
