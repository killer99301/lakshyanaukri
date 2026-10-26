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
// DNS rebinding: the host is resolved once per connection, inside the
// connection's own lookup, and the socket connects only to the addresses that
// were just checked; there is no second lookup to answer differently. The
// connected address is checked again before anything is sent. Address ranges
// come from Node's BlockList, which also matches IPv4 written inside IPv6
// (::ffff:7f00:1 is 127.0.0.1).

import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction, type Socket } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";

export const MAX_FETCH_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 25_000;

export type FetchedSource =
  | { ok: true; finalUrl: string; contentType: string; bytes: Buffer }
  | { ok: false; error: string; blocked?: boolean };

// Not the public internet: RFC 6890 special-purpose ranges, plus the IPv6
// forms that carry an IPv4 address the check could not see (NAT64, 6to4,
// Teredo, IPv4-compatible).
const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) NON_PUBLIC.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 96], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32],
  ["2001:db8::", 32], ["2001:10::", 28], ["2001:20::", 28], ["2002::", 16], ["fc00::", 7],
  ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) NON_PUBLIC.addSubnet(net, prefix, "ipv6");

/** True for addresses that are not on the public internet (and for anything that is not an address). */
export function isNonPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true;
  return NON_PUBLIC.check(ip, family === 6 ? "ipv6" : "ipv4");
}

/** How a host name becomes addresses. Replaceable in tests only. */
export type Resolver = (host: string) => Promise<string[]>;
const systemResolver: Resolver = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

export interface FetchOptions {
  resolve?: Resolver;
  /** Which addresses are refused. Tests use this to reach a local server; nothing else should. */
  isBlocked?: (ip: string) => boolean;
}

const PRIVATE_ERROR = "That address points to a private network and is not read";

/** Checks the address's form and its host's current addresses. Fetching checks again, at connection time. */
export async function checkPublicUrl(raw: string, opts: FetchOptions = {}): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  const blocked = opts.isBlocked ?? isNonPublicAddress;
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, error: "That is not a web address" }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Only http and https addresses can be read" };
  if (url.username || url.password) return { ok: false, error: "Addresses with a user name or password are not read" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await (opts.resolve ?? systemResolver)(host);
  } catch {
    return { ok: false, error: `The site ${host} could not be found` };
  }
  if (addresses.length === 0 || addresses.some(blocked)) return { ok: false, error: PRIVATE_ERROR };
  return { ok: true, url };
}

class PrivateAddressError extends Error {}

/**
 * The connection's own lookup: resolve once, refuse the host if any address
 * is non-public, and hand the socket exactly the addresses that were checked.
 */
function pinnedLookup(resolve: Resolver, blocked: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some(blocked)) {
          callback(new PrivateAddressError(PRIVATE_ERROR) as NodeJS.ErrnoException, "", 0);
          return;
        }
        const wanted = options.family === 4 || options.family === 6 ? addresses.filter((a) => isIP(a) === options.family) : addresses;
        if (wanted.length === 0) {
          callback(Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }) as NodeJS.ErrnoException, "", 0);
          return;
        }
        if (options.all) {
          (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, wanted.map((a) => ({ address: a, family: isIP(a) })));
        } else {
          callback(null, wanted[0], isIP(wanted[0]));
        }
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 0),
    );
  };
}

interface Answer { status: number; headers: http.IncomingHttpHeaders; body: Readable }

function requestOnce(url: URL, resolve: Resolver, blocked: (ip: string) => boolean, signal: AbortSignal): Promise<Answer> {
  return new Promise((done, fail) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, {
      method: "GET",
      lookup: pinnedLookup(resolve, blocked),
      agent: false,
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LakshyaNaukri-Importer/1.0)",
        Accept: "text/html,application/pdf;q=0.9,*/*;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
      },
    });
    // The address the socket actually reached, checked before the request is sent.
    req.on("socket", (socket: Socket) => {
      const verify = () => {
        const ip = socket.remoteAddress;
        if (!ip || blocked(ip)) req.destroy(new PrivateAddressError(PRIVATE_ERROR));
      };
      if (socket.remoteAddress) verify(); else socket.once("connect", verify);
    });
    req.on("response", (res) => done({ status: res.statusCode ?? 0, headers: res.headers, body: res }));
    req.on("error", fail);
    req.end();
  });
}

function decoded(answer: Answer): Readable {
  const enc = String(answer.headers["content-encoding"] ?? "").trim().toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return answer.body.pipe(createGunzip());
  if (enc === "deflate") return answer.body.pipe(createInflate());
  if (enc === "br") return answer.body.pipe(createBrotliDecompress());
  return answer.body;
}

export async function fetchSource(raw: string, opts: FetchOptions = {}): Promise<FetchedSource> {
  const resolve = opts.resolve ?? systemResolver;
  const blocked = opts.isBlocked ?? isNonPublicAddress;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = await checkPublicUrl(current, opts);
    if (!checked.ok) return { ok: false, error: checked.error };
    let res: Answer;
    try {
      res = await requestOnce(checked.url, resolve, blocked, signal);
    } catch (e) {
      if (e instanceof PrivateAddressError) return { ok: false, error: PRIVATE_ERROR };
      return { ok: false, error: e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "The site took too long to answer" : "The site could not be reached" };
    }
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      res.body.resume();
      current = new URL(location, checked.url).toString();
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      res.body.resume();
      return { ok: false, blocked: true, error: `The site refused the server (HTTP ${res.status}). Download the file yourself and upload it.` };
    }
    if (res.status < 200 || res.status >= 300) {
      res.body.resume();
      return { ok: false, error: `The site answered HTTP ${res.status}` };
    }
    const declared = Number(res.headers["content-length"] ?? 0);
    if (declared > MAX_FETCH_BYTES) { res.body.destroy(); return { ok: false, error: "The file is larger than 4 MB" }; }
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for await (const chunk of decoded(res)) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        total += buf.byteLength;
        if (total > MAX_FETCH_BYTES) { res.body.destroy(); return { ok: false, error: "The file is larger than 4 MB" }; }
        chunks.push(buf);
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "The site took too long to answer" : "The site sent a broken answer" };
    }
    const contentType = res.headers["content-type"];
    return { ok: true, finalUrl: checked.url.toString(), contentType: Array.isArray(contentType) ? contentType[0] : contentType ?? "", bytes: Buffer.concat(chunks) };
  }
  return { ok: false, error: "Too many redirects" };
}
