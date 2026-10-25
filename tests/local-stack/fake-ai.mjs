// ═══════════════════════════════════════════════════════════
// Test only: a stand-in for the AI model inside the local test server.
//
// Loaded with `node tests/local-stack/run-next.mjs dev --fake-ai`, never in
// production. It answers the three AI Assist extraction prompts by finding,
// in the prompt's own source text, lines that state each fact, and quoting
// them word for word, so the site's real evidence checks run unchanged.
// Every other request passes through.
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";

const realFetch = globalThis.fetch;

// FAKE_AI_ANSWERS=<file>: canned answers for prompts this stand-in cannot
// work out by itself (the whole-text reading, an image). A JSON list of
// { "when": text the prompt must contain, "match": text of the source it
// must contain, "answer": the JSON to return }. Written by hand for a demo;
// every quote in it still has to be in the source to be kept.
const canned = process.env.FAKE_AI_ANSWERS ? JSON.parse(readFileSync(process.env.FAKE_AI_ANSWERS, "utf8")) : [];

function sectionsOf(prompt) {
  return prompt.split(/^## Section: /m).slice(1).map((s) => ({ heading: s.split("\n")[0].trim(), lines: s.split("\n").slice(1) }));
}

function find(sections, re) {
  for (const s of sections) for (const raw of s.lines) {
    const line = raw.trim();
    const m = line.match(re);
    if (m) return { m, evidence: line.slice(0, 200), heading: s.heading };
  }
  return null;
}

const iso = (d) => { const [dd, mm, yyyy] = d.split(/[./-]/); return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`; };

function answer(prompt) {
  const hit = canned.find((c) => prompt.includes(c.when) && prompt.includes(c.match));
  if (hit) return hit.answer;
  const sections = sectionsOf(prompt);
  const out = {};
  const put = (key, hit, value) => { if (hit) out[key] = { value, evidence: hit.evidence, sectionHeading: hit.heading }; };
  if (prompt.includes('"applicationFeeGeneral"')) {
    const gen = find(sections, /(General|UR|OBC)[^\n]*?Rs\.?\s?(\d[\d,]*)\s?\/-/i);
    put("applicationFeeGeneral", gen, gen && Number(gen.m[2].replace(/,/g, "")));
    const sc = find(sections, /\bSC\b[^\n]*?Rs\.?\s?(\d[\d,]*)\s?\/-/i);
    put("applicationFeeSCST", sc, sc && Number(sc.m[1].replace(/,/g, "")));
    const close = find(sections, /(last date[^\n]*?|to\s+)(\d{2}[./-]\d{2}[./-]\d{4})/i);
    put("applicationCloseDate", close, close && iso(close.m[2]));
    const open = find(sections, /(open[^\n]*?|^)(\d{2}[./-]\d{2}[./-]\d{4})\s+to\b/i);
    put("applicationOpenDate", open, open && iso(open.m[2]));
    return out;
  }
  if (prompt.includes('"howToApply"')) {
    const age = find(sections, /(\d{2})\s+to\s+(\d{2})\s+years/i);
    if (age) out.age = { min: Number(age.m[1]), max: Number(age.m[2]), evidence: age.evidence, relaxations: [] };
    const grad = find(sections, /graduation in any (stream|discipline)/i);
    if (grad) out.eligibility = [{ post: "Apprentice", qualification: "Graduation in any stream", evidence: grad.evidence }];
    return out;
  }
  return out;
}

globalThis.fetch = async (input, init) => {
  if (!String(input).includes("generativelanguage.googleapis.com")) return realFetch(input, init);
  const body = JSON.parse(String(init?.body ?? "{}"));
  const prompt = (body.contents?.[0]?.parts ?? []).map((p) => p.text ?? "").join("\n");
  const out = answer(prompt);
  // A scan or image reading answers with plain text, not JSON.
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof out === "string" ? out : JSON.stringify(out) }] } }] }), {
    status: 200, headers: { "content-type": "application/json" },
  });
};
console.log("[fake-ai] AI requests answered locally (test only)");
