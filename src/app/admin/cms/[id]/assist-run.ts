// ═══════════════════════════════════════════════════════════
// AI Assist from the editor: one request, with a Stop, a time limit and plain errors
// ═══════════════════════════════════════════════════════════
//
// The editor used to wait on AI Assist with no way out: no Stop, no time limit,
// and an unreadable answer (a gateway timeout page, say) surfaced as a code
// error. This runs the request with both, and says in plain words what went
// wrong. It never retries by itself: every retry is another AI request against
// the free daily allowance, so only the admin starts one.
//
// Stopping is honest about what it can do. Stop ends the browser's wait at once
// and the server is told the browser has gone; the AI Assist route checks that
// before it saves anything. But a run that was already saving finishes, and
// whether a host passes the "browser has gone" signal on is up to the host. So
// after a Stop the editor treats the server as possibly still running until its
// time limit has passed (LATE_RESULT_WINDOW_MS), then reloads the job and says
// what, if anything, arrived late. Whatever arrives late was saved under the
// route's rule (empty fields only, as Pending), and the route refuses to save
// at all if the job changed after the run began, so a late result never
// overwrites anything newer.
//
// Pure apart from the fetch it is handed, so tests drive it with a fake fetch.

/** The AI Assist route's own limit (maxDuration in its route file). */
export const ASSIST_SERVER_LIMIT_MS = 90_000;
/** The editor gives up a little after the server must have: by then the server has finished or been stopped. */
export const ASSIST_CLIENT_TIMEOUT_MS = ASSIST_SERVER_LIMIT_MS + 10_000;
/** After a Stop: how long a run that was already under way may still save, counted from when it began. */
export const LATE_RESULT_WINDOW_MS = ASSIST_SERVER_LIMIT_MS + 5_000;

export type AssistFailureKind = "STOPPED" | "TIMEOUT" | "SOURCE" | "AI_BUSY" | "CHANGED" | "INPUT" | "NETWORK" | "FAILED";

export type AssistOutcome =
  | { ok: true; status: number; data: Record<string, unknown> }
  | { ok: false; kind: AssistFailureKind; status: number; message: string; data?: Record<string, unknown> };

const HEADLINE: Record<AssistFailureKind, string> = {
  STOPPED: "Stopped.",
  TIMEOUT: "AI Assist took too long and was stopped.",
  SOURCE: "The source could not be read.",
  AI_BUSY: "The AI is busy or its limit is reached.",
  CHANGED: "This job changed while AI Assist was working.",
  INPUT: "AI Assist could not start.",
  NETWORK: "The connection to the site was lost.",
  FAILED: "AI Assist failed.",
};

/** What a failed answer means, from its HTTP status and the route's own words. */
export function classifyAssistFailure(status: number, error: string | undefined): AssistFailureKind {
  const text = (error ?? "").toLowerCase();
  if (status === 409) return /archived|published/.test(text) ? "INPUT" : "CHANGED";
  if (status === 504 || /took too long|timed out|timeout/.test(text)) return "TIMEOUT";
  if (status === 429 || /rate limit|quota|daily|limit reached|unavailable|overloaded|busy/.test(text)) return "AI_BUSY";
  if (status === 422) return "SOURCE";
  if (status === 400 || status === 404 || status === 413) return "INPUT";
  if (status === 502 || status === 503) return "AI_BUSY";
  return "FAILED";
}

/** The sentence shown to the admin: what happened, then the route's reason when it gave one, then what to do. */
export function describeAssistFailure(kind: AssistFailureKind, reason?: string): string {
  const next: Record<AssistFailureKind, string> = {
    STOPPED: "",
    TIMEOUT: "Nothing more is running. You can retry, or upload the PDF or paste the notice text instead.",
    SOURCE: "If the official site blocks us, download the PDF and upload it, or paste the notice text.",
    AI_BUSY: "Wait a minute and retry. A daily limit resets the next day.",
    CHANGED: "The job has been reloaded with the latest saved values. Check them, then retry if you still need to.",
    INPUT: "",
    NETWORK: "The job has been reloaded. Retry when the connection is back.",
    FAILED: "You can retry once, or fill the fields by hand.",
  };
  return [HEADLINE[kind], reason?.trim(), next[kind]].filter(Boolean).join(" ");
}

/**
 * Runs one AI Assist request. `signal` is the Stop button; the time limit is
 * added here. Never throws: every way it can end comes back as an outcome.
 */
export async function runAssistRequest(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs = ASSIST_CLIENT_TIMEOUT_MS,
): Promise<AssistOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onStop = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", onStop, { once: true });
  try {
    const res = await fetchFn(url, { ...init, signal: controller.signal });
    // A gateway's own timeout or error page is not JSON.
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok && data) return { ok: true, status: res.status, data };
    const error = typeof data?.error === "string" ? data.error : undefined;
    const kind = res.ok ? "FAILED" : classifyAssistFailure(res.status, error);
    return { ok: false, kind, status: res.status, message: describeAssistFailure(kind, error), ...(data ? { data } : {}) };
  } catch {
    const kind: AssistFailureKind = timedOut ? "TIMEOUT" : signal.aborted ? "STOPPED" : "NETWORK";
    return { ok: false, kind, status: 0, message: describeAssistFailure(kind) };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onStop);
  }
}

/** A failure after which the server may still be at work: the answer never came. */
export const mayStillBeRunning = (o: AssistOutcome) => !o.ok && (o.kind === "STOPPED" || o.kind === "NETWORK");

/**
 * One line on what a stopped run saved after all, from the job's change history.
 * `knownUntilIso` is the newest change the editor already had when the run began
 * (server time, so the browser's clock does not matter).
 */
export function lateResultNote(revisions: Array<{ fieldPath: string; revisedAt: string; reason?: string | null }>, knownUntilIso: string): string {
  const late = revisions.filter((r) => r.revisedAt > knownUntilIso && r.reason?.startsWith("AI Assist (auto-filled"));
  if (late.length === 0) return "The stopped request saved nothing. You can retry.";
  const fields = [...new Set(late.map((r) => r.fieldPath))];
  return `The stopped request finished on the server and filled ${fields.length} empty field${fields.length === 1 ? "" : "s"} as Pending (${fields.join(", ")}). Nothing already filled was changed. Check them before you retry.`;
}
