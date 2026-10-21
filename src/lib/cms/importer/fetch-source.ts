// ═══════════════════════════════════════════════════════════
// Importer: fetching a source the admin named by address
// ═══════════════════════════════════════════════════════════
//
// Server only. http(s) only; every hop of a redirect is checked; addresses
// that resolve to private, loopback, link-local or other non-public ranges
// are refused, so an admin-supplied address cannot reach the server's own
// network. The body is capped and returned as bytes, so a fetched PDF can be
// fingerprinted and later matched against an upload of the same file.
//
// Residual risk (documented): a host could resolve to a public address when
// checked and a private one when connected (DNS rebinding). The fetch runs
// with a short timeout and its answer is only ever read as text.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_FETCH_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 25_000;

export type FetchedSource =
  | { ok: true; finalUrl: string; contentType: string; bytes: Buffer }
  | { ok: false; error: string; blocked?: boolean };

/** True for addresses that are not on the public internet. */
export function isNonPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isNonPublicAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9")
    || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

export async function checkPublicUrl(raw: string): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, error: "That is not a web address" }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Only http and https addresses can be read" };
  if (url.username || url.password) return { ok: false, error: "Addresses with a user name or password are not read" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return { ok: false, error: `The site ${host} could not be found` };
  }
  if (addresses.length === 0 || addresses.some(isNonPublicAddress)) return { ok: false, error: "That address points to a private network and is not read" };
  return { ok: true, url };
}

export async function fetchSource(raw: string, fetchFn: typeof fetch = fetch): Promise<FetchedSource> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = await checkPublicUrl(current);
    if (!checked.ok) return { ok: false, error: checked.error };
    let res: Response;
    try {
      res = await fetchFn(checked.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LakshyaNaukri-Importer/1.0)", Accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" },
      });
    } catch (e) {
      return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "The site took too long to answer" : "The site could not be reached" };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, checked.url).toString();
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return { ok: false, blocked: true, error: `The site refused the server (HTTP ${res.status}). Download the file yourself and upload it.` };
    }
    if (!res.ok) return { ok: false, error: `The site answered HTTP ${res.status}` };
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_FETCH_BYTES) return { ok: false, error: "The file is larger than 4 MB" };
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, error: "The site sent nothing" };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FETCH_BYTES) { await reader.cancel(); return { ok: false, error: "The file is larger than 4 MB" }; }
      chunks.push(value);
    }
    return { ok: true, finalUrl: checked.url.toString(), contentType: res.headers.get("content-type") ?? "", bytes: Buffer.concat(chunks) };
  }
  return { ok: false, error: "Too many redirects" };
}
