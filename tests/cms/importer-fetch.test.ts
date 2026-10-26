// Fetching an address the admin named: which addresses are refused, DNS
// rebinding, redirects and limits. A local server on 127.0.0.1 stands in for
// the internet, reached only through a stub resolver and a test-only rule
// that lets 127.0.0.1 (and nothing else private) through. No outside network.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { suite, test, assert } from "../intelligence/suite";
import { checkPublicUrl, fetchSource, isNonPublicAddress, MAX_FETCH_BYTES, type Resolver } from "@/lib/cms/importer/fetch-source";

let port = 0;
const hits: string[] = [];
const server = http.createServer((req, res) => {
  hits.push(req.url ?? "");
  const u = req.url ?? "/";
  if (u === "/page") { res.writeHead(200, { "content-type": "text/html" }); res.end("<p>Advt No. 1/2026</p>"); return; }
  if (u === "/gz") { res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" }); res.end(gzipSync("Last date: 01.11.2026")); return; }
  if (u === "/big") { res.writeHead(200, { "content-type": "application/pdf" }); res.end(Buffer.alloc(MAX_FETCH_BYTES + 10)); return; }
  if (u === "/forbidden") { res.writeHead(403); res.end(); return; }
  if (u.startsWith("/to?")) { res.writeHead(302, { location: decodeURIComponent(u.slice(4)) }); res.end(); return; }
  if (u.startsWith("/loop")) { res.writeHead(302, { location: `/loop${u.length}` }); res.end(); return; }
  res.writeHead(404); res.end();
});

// The suite starts async tests together; these share one server, so they run in turn.
let chain: Promise<void> = Promise.resolve();
const serial = (fn: () => Promise<void>) => () => (chain = chain.then(fn));
const ready = new Promise<void>((r) => server.listen(0, "127.0.0.1", () => { port = (server.address() as AddressInfo).port; r(); }));

/** Only 127.0.0.1 is let through, standing in for a public address; every other private address stays refused. */
const testBlocked = (ip: string) => ip !== "127.0.0.1" && isNonPublicAddress(ip);
const fixed = (map: Record<string, string[]>): Resolver & { calls: string[] } => {
  const calls: string[] = [];
  const fn = (async (host: string) => { calls.push(host); if (!map[host]) throw new Error("ENOTFOUND"); return map[host]; }) as Resolver & { calls: string[] };
  fn.calls = calls;
  return fn;
};

suite("Which addresses are not public");
test("FS01 private, loopback, link-local and special ranges are refused, in every spelling", () => {
  for (const ip of ["127.0.0.1", "127.8.9.10", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "192.0.2.10", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fe80::1", "fd00::1", "fc00::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a00:1", "::ffff:a9fe:a9fe", "::127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001::1", "not-an-address"]) {
    assert.equal(isNonPublicAddress(ip), true, ip);
  }
});
test("FS02 public addresses are allowed", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "164.100.1.1", "172.32.0.1", "2606:4700:4700::1111", "2404:6800:4009::200e", "::ffff:808:808"]) {
    assert.equal(isNonPublicAddress(ip), false, ip);
  }
});
test("FS03 address forms that hide a private address are refused before any lookup", async () => {
  const resolve = fixed({});
  for (const raw of ["http://[::ffff:7f00:1]/", "http://[::1]/", "http://127.1/", "http://2130706433/", "http://0x7f.0.0.1/", "http://[fd00::1]/", "http://169.254.169.254/latest/meta-data/"]) {
    const r = await checkPublicUrl(raw, { resolve });
    assert.equal(r.ok, false, raw);
  }
  assert.equal(resolve.calls.length, 0);
  for (const raw of ["file:///etc/passwd", "ftp://example.com/x", "https://user:pw@example.com/"]) {
    assert.equal((await checkPublicUrl(raw, { resolve })).ok, false, raw);
  }
});
test("FS04 a name with any private address among its answers is refused", async () => {
  const r = await checkPublicUrl("https://mixed.test/", { resolve: fixed({ "mixed.test": ["93.184.216.34", "10.0.0.5"] }) });
  assert.equal(r.ok, false);
});

suite("Fetching");
test("FS05 a public page is read; the connection goes to the address that was checked", serial(async () => {
  await ready;
  hits.length = 0;
  const resolve = fixed({ "good.test": ["127.0.0.1"] });
  const out = await fetchSource(`http://good.test:${port}/page`, { resolve, isBlocked: testBlocked });
  assert.equal(out.ok, true, JSON.stringify(out));
  if (out.ok) {
    assert.equal(out.bytes.toString(), "<p>Advt No. 1/2026</p>");
    assert.equal(out.contentType, "text/html");
    assert.equal(out.finalUrl, `http://good.test:${port}/page`);
  }
  assert.deepEqual(hits, ["/page"]);
  assert.equal(resolve.calls.length, 2, "once for the check, once inside the connection — never a third, unchecked lookup");
}));
test("FS06 DNS rebinding: public when checked, private when connecting → refused, nothing sent", serial(async () => {
  hits.length = 0;
  let n = 0;
  const rebinding: Resolver = async () => (n++ === 0 ? ["93.184.216.34"] : ["10.0.0.7"]);
  const out = await fetchSource(`http://rebind.test:${port}/page`, { resolve: rebinding, isBlocked: testBlocked });
  assert.equal(out.ok, false);
  if (!out.ok) assert.match(out.error, /private network/);
  assert.deepEqual(hits, []);
  n = 0;
  const toLoopback: Resolver = async () => (n++ === 0 ? ["93.184.216.34"] : ["127.0.0.2"]);
  const out2 = await fetchSource(`http://rebind.test:${port}/page`, { resolve: toLoopback, isBlocked: testBlocked });
  assert.equal(out2.ok, false, "another loopback address is still refused at connection time");
  assert.deepEqual(hits, []);
}));
test("FS07 every redirect is checked again: to a private address, a private name, or another scheme", serial(async () => {
  const resolve = fixed({ "good.test": ["127.0.0.1"], "inside.test": ["192.168.0.10"] });
  for (const target of [`http://127.0.0.2:${port}/page`, `http://inside.test:${port}/page`, `http://[::ffff:7f00:2]:${port}/page`, "file:///etc/passwd", "http://169.254.169.254/latest/meta-data/"]) {
    hits.length = 0;
    const out = await fetchSource(`http://good.test:${port}/to?${encodeURIComponent(target)}`, { resolve, isBlocked: testBlocked });
    assert.equal(out.ok, false, target);
    assert.equal(hits.length, 1, `only the first hop reached a server (${target})`);
  }
  hits.length = 0;
  const ok = await fetchSource(`http://good.test:${port}/to?${encodeURIComponent("/page")}`, { resolve, isBlocked: testBlocked });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.finalUrl, `http://good.test:${port}/page`);
}));
test("FS08 limits and answers: gzip is unpacked, over 4 MB refused, 403 is 'blocked', redirect loops stop", serial(async () => {
  const resolve = fixed({ "good.test": ["127.0.0.1"] });
  const gz = await fetchSource(`http://good.test:${port}/gz`, { resolve, isBlocked: testBlocked });
  assert.equal(gz.ok && gz.bytes.toString(), "Last date: 01.11.2026");
  const big = await fetchSource(`http://good.test:${port}/big`, { resolve, isBlocked: testBlocked });
  assert.equal(big.ok, false);
  if (!big.ok) assert.match(big.error, /4 MB/);
  const forbidden = await fetchSource(`http://good.test:${port}/forbidden`, { resolve, isBlocked: testBlocked });
  assert.equal(!forbidden.ok && forbidden.blocked, true);
  const loop = await fetchSource(`http://good.test:${port}/loop`, { resolve, isBlocked: testBlocked });
  assert.equal(!loop.ok && loop.error, "Too many redirects");
  const missing = await fetchSource(`http://good.test:${port}/nope`, { resolve, isBlocked: testBlocked });
  assert.equal(!missing.ok && missing.error, "The site answered HTTP 404");
  const unknown = await fetchSource("http://nowhere.test/", { resolve, isBlocked: testBlocked });
  assert.equal(!unknown.ok && /could not be found/.test(unknown.error), true);
  server.close();
}));
