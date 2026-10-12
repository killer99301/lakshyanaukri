// ═══════════════════════════════════════════════════════════
// Telegram channel post on publish
// ═══════════════════════════════════════════════════════════
//
// Pure — no DB, no network.
//
//  TG01  message carries only facts on the snapshot; missing ones leave no line
//  TG02  "New job" and "Updated" headings; title text is escaped
//  TG03  nothing is sent unless both settings are present
//  TG04  a sent message goes to the channel with HTML mode and no token in the body
//  TG05  a refusal or a network error is "failed", never an exception
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import type { PublishedRecruitmentSnapshot } from "@/lib/cms/projector";
import { buildJobAnnouncement, normalizeChatId, sendToChannel, telegramConfigured } from "@/lib/telegram";

function snapshot(over: Partial<PublishedRecruitmentSnapshot> = {}): PublishedRecruitmentSnapshot {
  return {
    slug: "canara-bank-apprentice-2026",
    title: "Canara Bank Graduate Apprentice Recruitment 2026",
    shortTitle: null,
    organizationName: "Canara Bank",
    dates: { applicationOpenDate: "2026-10-01", applicationCloseDate: "2026-10-17" },
    vacancies: { total: 3500, breakdown: null },
    classification: { shortDescription: null, category: null, state: null, qualification: "Graduate" },
    ...over,
  } as unknown as PublishedRecruitmentSnapshot;
}

const ENV = { TELEGRAM_BOT_TOKEN: "123:secret-token", TELEGRAM_CHANNEL_ID: "@lakshyanaukri" };

suite("Telegram channel post");

test("TG01 message carries only facts on the snapshot; missing ones leave no line", () => {
  const full = buildJobAnnouncement(snapshot(), "NEW");
  assert.match(full, /Posts: <b>3,500<\/b>/);
  assert.match(full, /Qualification: <b>Graduate<\/b>/);
  assert.match(full, /Apply from: <b>1 Oct 2026<\/b>/);
  assert.match(full, /<b>Last date: 17 Oct 2026<\/b>/);
  assert.match(full, /\/jobs\/canara-bank-apprentice-2026$/);

  const bare = buildJobAnnouncement(
    snapshot({
      dates: {} as PublishedRecruitmentSnapshot["dates"],
      vacancies: { total: null, breakdown: null },
      classification: { shortDescription: null, category: null, state: null, qualification: null },
    }),
    "NEW",
  );
  assert.doesNotMatch(bare, /Posts:|Qualification:|Apply from:|Last date:/);
  assert.doesNotMatch(bare, /\n\n\n/);
});

test("TG02 \"New job\" and \"Updated\" headings; title text is escaped", () => {
  assert.match(buildJobAnnouncement(snapshot(), "NEW"), /^🆕 <b>NEW JOB<\/b>/);
  assert.match(buildJobAnnouncement(snapshot(), "UPDATED"), /^🔄 <b>UPDATED<\/b>/);
  const odd = buildJobAnnouncement(snapshot({ title: "Clerk <Grade A> & Typist" }), "NEW");
  assert.match(odd, /Clerk &lt;Grade A&gt; &amp; Typist/);
});

test("TG03 nothing is sent unless both settings are present", async () => {
  let calls = 0;
  const fetchFn = async () => { calls += 1; return { ok: true, status: 200 }; };
  assert.equal(telegramConfigured({}), false);
  assert.equal(telegramConfigured({ TELEGRAM_BOT_TOKEN: "x" }), false);
  assert.equal(telegramConfigured({ TELEGRAM_BOT_TOKEN: " ", TELEGRAM_CHANNEL_ID: "@c" }), false);
  assert.equal(await sendToChannel("hi", {}, fetchFn), "skipped");
  assert.equal(await sendToChannel("hi", { TELEGRAM_CHANNEL_ID: "@c" }, fetchFn), "skipped");
  assert.equal(calls, 0);
});

test("TG04 a sent message goes to the channel with HTML mode and no token in the body", async () => {
  let seenUrl = "";
  let seenBody = "";
  const fetchFn = async (url: string, init: RequestInit) => {
    seenUrl = url;
    seenBody = String(init.body);
    return { ok: true, status: 200 };
  };
  assert.equal(await sendToChannel("<b>hello</b>", ENV, fetchFn), "sent");
  assert.equal(seenUrl, "https://api.telegram.org/bot123:secret-token/sendMessage");
  const body = JSON.parse(seenBody);
  assert.equal(body.chat_id, "@lakshyanaukri");
  assert.equal(body.parse_mode, "HTML");
  assert.equal(body.text, "<b>hello</b>");
  assert.doesNotMatch(seenBody, /secret-token/);
});

test("TG05 a refusal or a network error is \"failed\", never an exception", async () => {
  const quiet = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    assert.equal(await sendToChannel("hi", ENV, async () => ({ ok: false, status: 403 })), "failed");
    assert.equal(await sendToChannel("hi", ENV, async () => { throw new Error("network down bot123:secret-token"); }), "failed");
  } finally {
    console.error = quiet;
  }
  // The token must never reach the logs, even through an error message.
  assert.equal(logged.some((line) => line.includes("secret-token")), false);
});

test("TG06 a channel entered as a link or a bare name is sent as @name; IDs are untouched", async () => {
  assert.equal(normalizeChatId("@LakshyaNaukri"), "@LakshyaNaukri");
  assert.equal(normalizeChatId(" LakshyaNaukri "), "@LakshyaNaukri");
  assert.equal(normalizeChatId("https://t.me/LakshyaNaukri"), "@LakshyaNaukri");
  assert.equal(normalizeChatId("t.me/LakshyaNaukri/"), "@LakshyaNaukri");
  assert.equal(normalizeChatId('"@LakshyaNaukri"'), "@LakshyaNaukri");
  assert.equal(normalizeChatId("-1001234567890"), "-1001234567890");
  assert.equal(normalizeChatId("267000000"), "267000000");

  let seenBody = "";
  const fetchFn = async (_url: string, init: RequestInit) => { seenBody = String(init.body); return { ok: true, status: 200 }; };
  assert.equal(await sendToChannel("hi", { ...ENV, TELEGRAM_CHANNEL_ID: "t.me/LakshyaNaukri" }, fetchFn), "sent");
  assert.equal(JSON.parse(seenBody).chat_id, "@LakshyaNaukri");
});

test("TG07 a refusal logs Telegram's reason, without the token", async () => {
  const quiet = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const refused = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, description: "Bad Request: chat not found" }) });
    assert.equal(await sendToChannel("hi", ENV, refused), "failed");
  } finally {
    console.error = quiet;
  }
  assert.equal(logged.some((line) => line.includes("HTTP 400: Bad Request: chat not found")), true);
  assert.equal(logged.some((line) => line.includes("secret-token")), false);
});
