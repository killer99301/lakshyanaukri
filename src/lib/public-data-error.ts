// A public page could not read the published jobs (database unreachable, query failed, DATABASE_URL missing).
//
// Public pages are statically cached. If a loader turned this failure into an empty list or "not found", the page
// would render successfully with no jobs (or as a 404) and be cached that way until the next refresh or publish.
// Throwing instead makes the render fail, so it is not cached as a good page. A genuinely empty result (no published
// job) or a slug that really does not exist is NOT an error and never raises this.

export class PublicDataUnavailableError extends Error {
  constructor(what: string, cause: unknown) {
    super(`Public data unavailable (${what}): ${cause instanceof Error ? cause.message.slice(0, 200) : String(cause).slice(0, 200)}`, { cause });
    this.name = "PublicDataUnavailableError";
  }
}

/** Runs a public data read; any failure is logged once and re-thrown as PublicDataUnavailableError. */
export async function readPublicData<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    const e = err instanceof PublicDataUnavailableError ? err : new PublicDataUnavailableError(what, err);
    console.error(`[Public data] ${e.message}`);
    throw e;
  }
}
