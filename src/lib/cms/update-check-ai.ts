// ═══════════════════════════════════════════════════════════
// "Check for updates": the one request sent to the AI model
// ═══════════════════════════════════════════════════════════
//
// Server-only. One request per check, counted against the site's daily cap.
// Never throws, never retries (retrying a rate limit only deepens it), and
// never surfaces provider error text: it can carry the request URL, which
// holds the API key.

import { DEFAULT_GEMINI_MODEL } from "@/intelligence/gemini-extraction-provider";
import { capReachedMessage, recordAiFailure, reserveAiRequest } from "@/lib/ai-usage";
import { hostOf, jsonFromAnswer } from "@/lib/cms/update-check";

const TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 4096;

export type UpdateAnswer =
  | { ok: true; data: unknown; groundedHosts: string[] }
  | { ok: false; reason: string };

function failure(status: number, search: boolean): string {
  if (status === 429) return "AI rate limit reached. Wait a minute and try again.";
  if (status === 404) return "The configured AI model is not available.";
  if (status === 401 || status === 403) return "The AI key was rejected.";
  if (status === 400 && search) return "Web search is not available with the site’s AI model or plan. Paste the official page address instead.";
  if (status >= 200 && status < 300) return "The AI answer could not be read. Try again, or paste the official page address.";
  return "The AI service is unavailable right now.";
}

interface GeminiBody {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
  }>;
}

export async function askForUpdates(opts: {
  prompt: string;
  apiKey: string | undefined;
  /** True: let the model search the web. False: it answers from the page text in the prompt. */
  search: boolean;
  fetchFn?: typeof fetch;
}): Promise<UpdateAnswer> {
  if (!opts.apiKey) return { ok: false, reason: "AI is not configured on this site." };

  const reserved = await reserveAiRequest("update-check");
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
        contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
        // A JSON-only response type cannot be combined with the search tool,
        // so with search the JSON is asked for in the prompt and dug out below.
        ...(opts.search
          ? { tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS } }
          : { generationConfig: { responseMimeType: "application/json", maxOutputTokens: MAX_OUTPUT_TOKENS } }),
      }),
      signal: controller.signal,
    });
    status = response.status;
    if (!response.ok) {
      await recordAiFailure("update-check");
      return { ok: false, reason: failure(status, opts.search) };
    }

    const body = (await response.json()) as GeminiBody;
    const candidate = body.candidates?.[0];
    const answer = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const data = jsonFromAnswer(answer);
    if (data === null) {
      await recordAiFailure("update-check");
      return { ok: false, reason: failure(status, opts.search) };
    }
    // The search tool reports each page it opened; its title is the site's domain.
    const groundedHosts = [...new Set(
      (candidate?.groundingMetadata?.groundingChunks ?? [])
        .map((chunk) => hostOf(chunk.web?.title) ?? hostOf(chunk.web?.uri))
        .filter((h): h is string => Boolean(h) && !/vertexaisearch|googleusercontent/.test(h!)),
    )];
    return { ok: true, data, groundedHosts };
  } catch {
    await recordAiFailure("update-check");
    return { ok: false, reason: failure(status, opts.search) };
  } finally {
    clearTimeout(timer);
  }
}
