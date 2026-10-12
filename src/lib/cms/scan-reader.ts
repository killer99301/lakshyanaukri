// ═══════════════════════════════════════════════════════════
// Reading a scanned notice
// ═══════════════════════════════════════════════════════════
//
// Server-only. Many state notices are scanned pages with no text in them, so
// AI Assist has nothing to read. Here the PDF itself goes to the AI model,
// which writes out the parts of the notice AI Assist needs, in English. That
// text then goes through AI Assist exactly as a normal PDF's text would.
//
// One request, counted against the daily cap. Never throws, never retries,
// and never surfaces provider error text: it can carry the request URL, which
// holds the API key.
//
// What comes back is the AI's own reading of a picture. Nothing checks it
// against the scan, so every value AI Assist takes from it must be compared
// with the PDF by the admin. They stay Pending until then.

import { DEFAULT_GEMINI_MODEL } from "@/intelligence/gemini-extraction-provider";
import { capReachedMessage, recordAiFailure, reserveAiRequest } from "@/lib/ai-usage";

const TIMEOUT_MS = 55_000;
const MAX_OUTPUT_TOKENS = 12_000;
/** Fewer characters than this is not a notice; the scan could not be read. */
export const MIN_SCAN_TEXT_CHARS = 300;

export type ScanReading = { ok: true; text: string } | { ok: false; reason: string };

export function buildScanPrompt(subject: string): string {
  return [
    "The attached PDF is a scanned recruitment notice from an Indian government body. It may be in Hindi or another Indian language.",
    ...(subject ? [`It should be about: ${subject}. If it covers several recruitments, use only this one.`] : []),
    "",
    "Write out, in plain English text, the parts of the notice that state the following. Translate faithfully. Copy every number, date, amount, post name, advertisement number and web address exactly as printed. Do not summarise, do not add anything that is not printed, and do not guess a word you cannot read: write [unclear] in its place.",
    "",
    "1. The title of the recruitment, the recruiting body, and the advertisement or notification number and its date.",
    "2. Important dates: start and last date of application, fee payment, correction window, admit card, examination.",
    "3. Vacancies: the total, and the table of posts and categories, one row per line.",
    "4. Educational qualification and other essential requirements, post by post.",
    "5. Age limit, the date it is counted on, and every age relaxation.",
    "6. Application fee for each category.",
    "7. Pay scale or salary.",
    "8. Selection process, stage by stage.",
    "9. Examination pattern: papers, subjects, number of questions, marks, duration, negative marking.",
    "10. Syllabus, if printed.",
    "11. How to apply, and the official website.",
    "",
    "Put a heading line before each part (for example \"IMPORTANT DATES\", \"APPLICATION FEE\", \"AGE LIMIT\"). Write dates as DD-MM-YYYY. Leave out a part the notice does not contain. Output the text only.",
  ].join("\n");
}

function failure(status: number): string {
  if (status === 429) return "AI rate limit reached. Wait a minute and try again.";
  if (status === 404) return "The configured AI model is not available.";
  if (status === 401 || status === 403) return "The AI key was rejected.";
  if (status === 400) return "The AI could not read this scanned PDF. If it is long, upload only the pages with the dates, vacancies, eligibility and fee.";
  if (status >= 200 && status < 300) return "The AI could not read enough of this scanned PDF. Enter the details by hand, or try a clearer copy.";
  return "The AI service is unavailable right now, or the scan took too long to read. Try again, or upload only the main pages.";
}

export async function readScannedNotice(opts: {
  /** The PDF, base64. */
  data: string;
  subject: string;
  apiKey: string | undefined;
  fetchFn?: typeof fetch;
}): Promise<ScanReading> {
  if (!opts.apiKey) return { ok: false, reason: "AI is not configured on this site." };

  const reserved = await reserveAiRequest("assist");
  if (!reserved.allowed) return { ok: false, reason: capReachedMessage(reserved.cap) };

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let status = 0;

  try {
    const response = await (opts.fetchFn ?? globalThis.fetch)(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: buildScanPrompt(opts.subject) }, { inline_data: { mime_type: "application/pdf", data: opts.data } }],
        }],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      }),
      signal: controller.signal,
    });
    status = response.status;
    if (!response.ok) {
      await recordAiFailure("assist");
      return { ok: false, reason: failure(status) };
    }
    const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = (body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "").trim();
    if (text.length < MIN_SCAN_TEXT_CHARS) {
      await recordAiFailure("assist");
      return { ok: false, reason: failure(status) };
    }
    return { ok: true, text };
  } catch {
    await recordAiFailure("assist");
    return { ok: false, reason: failure(status) };
  } finally {
    clearTimeout(timer);
  }
}
