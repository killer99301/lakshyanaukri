// O3: "I downloaded or copied this myself" says what it needs (an address and
// a note of at least 10 characters, the server's own rule) and the form is not
// sent while a ticked declaration lacks it. Pure: the rule and the field,
// rendered; no database. The server's side is tests/local-stack/o3-attestation.test.ts.
//
//   npx tsx --tsconfig tsconfig.json tests/cms/o3-attestation.test.tsx

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { suite, test, assert } from "../intelligence/suite";
import { ATTESTATION_MIN, AttestationField, attestationProblem } from "@/app/admin/cms/import/AttestationField";

const URL = "https://www.ibps.in/wp-content/uploads/notice.pdf";
const NOTE = "Downloaded from ibps.in on 3 Nov 2026";
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

suite("O3: what a ticked declaration needs");

test("A1 the server's minimum: 10 characters", () => { assert.equal(ATTESTATION_MIN, 10); });
test("A2 ticked, the note empty: the note is asked for", () => {
  assert.match(attestationProblem({ attest: true, attestation: "", url: URL }) ?? "", /a note of how you got it \(at least 10 characters\)/);
});
test("A3 ticked, the note only spaces: the same, it counts as empty", () => {
  assert.match(attestationProblem({ attest: true, attestation: "   \t  ", url: URL }) ?? "", /a note of how you got it/);
});
test("A4 ticked, the note shorter than 10 characters: a longer note, with its length", () => {
  assert.match(attestationProblem({ attest: true, attestation: "  from site  ", url: URL }) ?? "", /a longer note: at least 10 characters, now 9/);
});
test("A5 ticked, a note of exactly 10 characters and the address: nothing missing", () => {
  assert.equal(attestationProblem({ attest: true, attestation: "  0123456789  ", url: URL }), null);
  assert.equal(attestationProblem({ attest: true, attestation: NOTE, url: URL }), null);
});
test("A6 ticked, no address, or none the server can read: the address is asked for", () => {
  for (const url of ["", "   ", "ibps.in/notice.pdf", "ftp://ibps.in/notice.pdf"])
    assert.match(attestationProblem({ attest: true, attestation: NOTE, url }) ?? "", /the address it came from, in the box above/, url);
});
test("A7 both missing: both named", () => {
  const p = attestationProblem({ attest: true, attestation: "", url: "" }) ?? "";
  assert.match(p, /the address it came from.*; and a note of how you got it/);
  assert.match(p, /stays unconfirmed and nothing can be checked against it/);
});
test("A8 not ticked, with or without a note or address: nothing is needed (and the form sends no declaration)", () => {
  for (const s of [{ attestation: "", url: "" }, { attestation: "x", url: "" }, { attestation: NOTE, url: URL }])
    assert.equal(attestationProblem({ attest: false, ...s }), null);
});

suite("O3: the field, rendered");

const field = (attest: boolean, attestation: string, url = URL) =>
  renderToStaticMarkup(<AttestationField id="source-1" attest={attest} attestation={attestation} url={url} onChange={() => {}} />);

test("F1 not ticked: no note box and no message", () => {
  const html = field(false, "");
  assert.ok(!/<input(?![^>]*type="checkbox")/.test(html), "only the checkbox");
  assert.ok(!/data-attestation-needed/.test(html));
});
test("F2 ticked, the note empty: the guidance, and the message tied to the note box for screen readers", () => {
  const html = field(true, "");
  assert.match(text(html), /Say where you got it and when, in at least 10 characters, and keep the address above\. It records your word, not a check by the server\./);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="source-1-attestation-needed"/);
  const message = /<span [^>]*id="source-1-attestation-needed"[^>]*>/.exec(html)?.[0] ?? "";
  assert.ok(/data-attestation-needed/.test(message) && /aria-live="polite"/.test(message), message || html);
  assert.match(text(html), /Needed for this declaration: a note of how you got it \(at least 10 characters\)/);
});
test("F3 ticked, a short note: the message gives its length", () => {
  assert.match(text(field(true, "my copy")), /at least 10 characters, now 7/);
});
test("F4 ticked, a valid note and address: no message, nothing marked invalid", () => {
  const html = field(true, NOTE);
  assert.ok(!/data-attestation-needed|aria-invalid|aria-describedby/.test(html), html);
});
test("F5 ticked, a valid note but no address: the message names the address", () => {
  assert.match(text(field(true, NOTE, "")), /the address it came from, in the box above/);
});
