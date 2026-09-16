// ═══════════════════════════════════════════════════════════
// Phase 12: Extractor Pattern Tests — Track B
// npx tsx --tsconfig tsconfig.json tests/intelligence/extractor-patterns.test.ts
// ═══════════════════════════════════════════════════════════
//
// Tests:
//  EP01  Colon-separated notification number (Advt No. prefix)
//  EP02  Standalone colon-separated notification number
//  EP03  Existing slash/dash notification number still works
//  EP04  "Total Number of Vacancies 225" extracted correctly
//  EP13  Notification number beyond 2 000 chars (JSON-LD offset regression)
//  EP05  Total 225 beats subordinate 200 (order priority)
//  EP06  "Total Vacancies: 259" still works
//  EP07  Close date from table-cell (no colon): "Last Date of Online Registration 28/09/2026"
//  EP08  Close date from intro sentence: "last date to apply ... is 28/09/2026"
//  EP09  Open date from "Online Registration Commences 08/09/2026"
//  EP10  Open date from "Registration Opens 01/09/2026"
//  EP11  Existing colon-based close date still works
//  EP12  extractIntakeFields end-to-end on GovtJobGuru-style HTML
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import { extractNotificationNumber } from "@/intelligence/discovery";
import { extractIntakeFields } from "@/intelligence/intake";

suite("Phase 12 — Extractor Pattern Fixes (Track B)");

// ─── EP01-03: Notification number ────────────────────────────

test("EP01: colon-separated notification number with Advt No. prefix", () => {
  const text = "published the recruitment notification (Advt No. HO:HRM:REC:AO:1:2026) on its official website";
  const result = extractNotificationNumber(text);
  assert.ok(result, "should extract a notification number");
  assert.ok(
    result!.includes("HO") && result!.includes("2026"),
    `expected UIIC-style colon code, got: "${result}"`,
  );
});

test("EP02: standalone colon-separated notification number (no Advt No. prefix)", () => {
  const text = "Notification: HO:HRM:REC:AO:1:2026 is now available";
  const result = extractNotificationNumber(text);
  assert.ok(result, "should extract standalone colon code");
  assert.ok(
    result!.includes("HO") && result!.includes("2026"),
    `expected colon code, got: "${result}"`,
  );
});

test("EP03: existing slash-separated notification number still works (regression)", () => {
  const text = "SSC/CHSL/2026/01 recruitment notification";
  const result = extractNotificationNumber(text);
  assert.ok(result, "should extract slash-separated code");
  assert.ok(result!.includes("2026"), `expected year in result, got: "${result}"`);
});

// ─── EP04-06: Vacancy extraction ─────────────────────────────

test("EP04: 'Total Number of Vacancies' label extracts correct total", () => {
  const html = `<html><body>
    <p>Total Number of Vacancies 225 (200 Generalists + 25 Hindi Officers)</p>
  </body></html>`;
  const result = extractIntakeFields(html, "https://example.com/", undefined, undefined, "THIRD_PARTY");
  assert.equal(result.totalVacancies, 225, `expected 225, got ${result.totalVacancies}`);
});

test("EP05: total 225 beats subordinate 200 when both appear in HTML", () => {
  // "Total Number of Vacancies" appears before "No. of Vacancies: 200" for a sub-category
  const html = `<html><body>
    <p>Total Number of Vacancies 225 (200 Generalists + 25 Hindi Officers)</p>
    <h3>Generalist Posts</h3>
    <p>No. of Vacancies: 200</p>
  </body></html>`;
  const result = extractIntakeFields(html, "https://example.com/", undefined, undefined, "THIRD_PARTY");
  assert.equal(result.totalVacancies, 225, `should pick total 225, not sub-category 200; got ${result.totalVacancies}`);
});

test("EP06: 'Total Vacancies: 259' still works (existing format, regression)", () => {
  const html = `<html><body><p>Total Vacancies: 259</p></body></html>`;
  const result = extractIntakeFields(html, "https://example.com/", undefined, undefined, "THIRD_PARTY");
  assert.equal(result.totalVacancies, 259, `expected 259, got ${result.totalVacancies}`);
});

// ─── EP07-11: Date extraction ────────────────────────────────

test("EP07: close date from table-cell without colon: 'Last Date of Online Registration 28/09/2026'", () => {
  const html = `<html><body>
    <table>
      <tr><td>Event</td><td>Date</td></tr>
      <tr><td>Last Date of Online Registration</td><td>28/09/2026</td></tr>
    </table>
  </body></html>`;
  const result = extractIntakeFields(html, "https://example.com/", undefined, undefined, "THIRD_PARTY");
  assert.ok(result.applicationCloseDate, "close date should be extracted");
  assert.equal(result.applicationCloseDate, "2026-09-28", `expected 2026-09-28, got ${result.applicationCloseDate}`);
});

test("EP08: close date from intro sentence 'last date to apply ... is 28/09/2026'", () => {
  const html = `<html><body>
    <p>The last date to apply for these vacancies is 28/09/2026.</p>
  </body></html>`;
  const result = extractIntakeFields(html, "https://example.com/", undefined, undefined, "THIRD_PARTY");
  assert.ok(result.applicationCloseDate, "close date should be extracted");
  assert.equal(result.applicationCloseDate, "2026-09-28", `expected 2026-09-28, got ${result.applicationCloseDate}`);
});

test("EP09: open date from 'Online Registration Commences 08/09/2026'", () => {
  const html = `<html><body>
    <table>
      <tr><td>Online Registration Commences</td><td>08/09/2026</td></tr>
      <tr><td>Last Date of Online Registration</td><td>28/09/2026</td></tr>
    </table>
  </body></html>`;
  const result = extractIntakeFields(html, "https://example.com/", undefined, undefined, "THIRD_PARTY");
  assert.ok(result.applicationOpenDate, "open date should be extracted");
  assert.equal(result.applicationOpenDate, "2026-09-08", `expected 2026-09-08, got ${result.applicationOpenDate}`);
});

test("EP10: open date from 'Registration Opens 01/09/2026'", () => {
  const html = `<html><body>
    <table>
      <tr><td>Registration Opens</td><td>01/09/2026</td></tr>
    </table>
  </body></html>`;
  const result = extractIntakeFields(html, "https://example.com/", undefined, undefined, "THIRD_PARTY");
  assert.ok(result.applicationOpenDate, "open date should be extracted");
  assert.equal(result.applicationOpenDate, "2026-09-01", `expected 2026-09-01, got ${result.applicationOpenDate}`);
});

test("EP11: existing colon-separated close date still works (regression)", () => {
  const html = `<html><body>
    <p>Last Date to Apply: 30/09/2026</p>
  </body></html>`;
  const result = extractIntakeFields(html, "https://example.com/", undefined, undefined, "THIRD_PARTY");
  assert.ok(result.applicationCloseDate, "close date should be extracted");
  assert.equal(result.applicationCloseDate, "2026-09-30", `expected 2026-09-30, got ${result.applicationCloseDate}`);
});

// ─── EP12: End-to-end on GovtJobGuru-style HTML ──────────────

test("EP12: end-to-end extraction on GovtJobGuru UIIC-style HTML", () => {
  // Mirrors the structure of the actual govtjobguru UIIC AO 2026 page
  const GOVTJOBGURU_HTML = `<!DOCTYPE html>
<html>
<head><title>UIIC AO Recruitment 2026 - Apply Online for 225 Administrative Officer Posts</title></head>
<body>
<h1>UIIC AO Online Form 2026</h1>
<p>The United India Insurance Company Limited has published the recruitment notification
(Advt No. HO:HRM:REC:AO:1:2026) on its official website. The notification is for the
recruitment of 225 (200 Generalists + 25 Hindi Officers) Administrative Officer posts.
The last date to apply for these vacancies is 28/09/2026.</p>

<table>
  <tr><th>Organisation</th><td>United India Insurance Company Limited</td></tr>
  <tr><th>Total Number of Vacancies</th><td>225 (200 Generalists + 25 Hindi Officers)</td></tr>
</table>

<h2>Vacancies Detail</h2>
<p>Administrative Officer (Scale I) - Generalists<br>No. of Vacancies: 200</p>
<p>Administrative Officer (Scale I) - Hindi Officers<br>No. of Vacancies: 25</p>

<h2>Important Dates</h2>
<table>
  <tr><th>Event</th><th>Date</th></tr>
  <tr><td>Online Registration Commences</td><td>08/09/2026</td></tr>
  <tr><td>Last Date of Online Registration</td><td>28/09/2026</td></tr>
</table>
</body>
</html>`;

  const result = extractIntakeFields(
    GOVTJOBGURU_HTML,
    "https://govtjobguru.in/jobs/uiic-ao-recruitment-2026/",
    undefined,
    undefined,
    "THIRD_PARTY",
  );

  // Title normalized
  assert.ok(result.title, "should have title");
  assert.ok(result.title!.includes("UIIC"), `title should include UIIC: "${result.title}"`);

  // Notification number
  assert.ok(result.notificationNumber, "should extract notification number");
  assert.ok(
    result.notificationNumber!.includes("HO") && result.notificationNumber!.includes("2026"),
    `expected UIIC notification number, got: "${result.notificationNumber}"`,
  );

  // Total vacancies (225, not sub-category 200)
  assert.equal(result.totalVacancies, 225, `should extract 225 total, not 200; got ${result.totalVacancies}`);

  // Close date
  assert.ok(result.applicationCloseDate, "should extract application close date");
  assert.equal(result.applicationCloseDate, "2026-09-28");

  // Open date
  assert.ok(result.applicationOpenDate, "should extract application open date");
  assert.equal(result.applicationOpenDate, "2026-09-08");
});

// ─── EP13: search-window regression ──────────────────────────

test("EP13: notification number beyond 2 000 chars is found (JSON-LD offset regression)", () => {
  // Mirrors the real GovtJobGuru production failure:
  // WordPress pages inject 3-4 kB of JSON-LD/schema.org before article content.
  // The old 2 000-char window never reached the advt paragraph (offset ~4 200).
  // The new 8 000-char window must find it.
  //
  // This HTML is synthetic but the structure is real: 2 200 chars of JSON-LD
  // filler, then the article paragraph containing the advt number.
  const jsonLdFiller = `{"@context":"https://schema.org","@graph":[{"@type":"WebPage","url":"https://govtjobguru.in/jobs/uiic-ao-recruitment-2026/","name":"UIIC AO Recruitment 2026 - Apply Online for 225 Administrative Officer Posts"}]}`.padEnd(2200, " ");
  const HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">${jsonLdFiller}</script>
</head><body>
<p>The United India Insurance Company Limited has published the recruitment notification
(Advt No. HO:HRM:REC:AO:1:2026) on its official website.</p>
<p>Total Number of Vacancies 225</p>
<p>Online Registration Commences 08/09/2026</p>
<p>Last Date of Online Registration 28/09/2026</p>
</body></html>`;

  const result = extractIntakeFields(HTML, "https://govtjobguru.in/jobs/uiic-ao-recruitment-2026/", undefined, undefined, "THIRD_PARTY");

  assert.ok(result.notificationNumber, "notification number must be found even when past the 2 000-char mark");
  assert.ok(
    result.notificationNumber!.includes("HO") && result.notificationNumber!.includes("2026"),
    `expected HO:HRM:REC:AO:1:2026, got: "${result.notificationNumber}"`,
  );
});
