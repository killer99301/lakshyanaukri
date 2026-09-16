// ═══════════════════════════════════════════════════════════
// Phase 13A Layer 1: Page Structurer Tests
// npx tsx --tsconfig tsconfig.json tests/intelligence/page-structurer.test.ts
// ═══════════════════════════════════════════════════════════
//
// PS01  Section detection: vacancy heading classified correctly
// PS02  Section detection: dates heading classified correctly
// PS03  Section detection: eligibility heading classified correctly
// PS04  Section detection: financial heading classified correctly
// PS05  Section detection: selection heading classified correctly
// PS06  Section detection: how_to_apply heading classified correctly
// PS07  Section detection: unrecognized heading → "other"
// PS08  Table parsing: <th> headers + data rows
// PS09  Table parsing: all-<td> first row treated as headers
// PS10  Table parsing: caption extracted when present
// PS11  Nested list: hierarchy preserved across two levels
// PS12  Link extraction: href resolved to absolute URL
// PS13  Link extraction: anchors (#) and javascript: hrefs excluded
// PS14  Section fallback: no headings → single overview section
// PS15  UIIC-like fixture: section count, table detection, notification number in text
// PS16  normalizeForMatching: whitespace/case/punctuation stripped
// PS17  evidencePresent: finds value when normalized substring present
// PS18  evidencePresent: rejects value absent from section text
// PS19  rawHtml preserved on section and table
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "./suite";
import {
  structureDocument,
  normalizeForMatching,
  evidencePresent,
} from "@/intelligence/page-structurer";

suite("Phase 13A — Page Structurer (Layer 1)");

// ─── PS01-07: Section type classification ────────────────────

test("PS01: 'Vacancies Detail' heading → vacancy", () => {
  const html = `<html><body>
    <h1>Test</h1>
    <h2>Vacancies Detail</h2>
    <p>Administrative Officer 225 posts</p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading === "Vacancies Detail");
  assert.ok(sec, "should find Vacancies Detail section");
  assert.equal(sec!.type, "vacancy");
});

test("PS02: 'Important Dates' heading → dates", () => {
  const html = `<html><body>
    <h2>Important Dates</h2>
    <p>Last date: 28 Sep 2026</p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading === "Important Dates");
  assert.ok(sec, "should find Important Dates section");
  assert.equal(sec!.type, "dates");
});

test("PS03: 'Eligibility Criteria' heading → eligibility", () => {
  const html = `<html><body>
    <h2>Eligibility Criteria</h2>
    <p>Graduate with minimum 60%</p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading === "Eligibility Criteria");
  assert.ok(sec, "should find Eligibility Criteria section");
  assert.equal(sec!.type, "eligibility");
});

test("PS04: 'Application Fee' heading → financial", () => {
  const html = `<html><body>
    <h2>Application Fee</h2>
    <p>General: ₹850, SC/ST: ₹100</p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading === "Application Fee");
  assert.ok(sec, "should find Application Fee section");
  assert.equal(sec!.type, "financial");
});

test("PS05: 'Selection Process' heading → selection", () => {
  const html = `<html><body>
    <h2>Selection Process</h2>
    <p>Online exam followed by interview</p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading === "Selection Process");
  assert.ok(sec, "should find Selection Process section");
  assert.equal(sec!.type, "selection");
});

test("PS06: 'How to Apply Online' heading → how_to_apply", () => {
  const html = `<html><body>
    <h2>How to Apply Online</h2>
    <p>Visit the official website</p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading === "How to Apply Online");
  assert.ok(sec, "should find How to Apply section");
  assert.equal(sec!.type, "how_to_apply");
});

test("PS07: unrecognized heading → 'other'", () => {
  const html = `<html><body>
    <h2>About the Company</h2>
    <p>United India Insurance is a PSU</p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading === "About the Company");
  assert.ok(sec, "should find About the Company section");
  assert.equal(sec!.type, "other");
});

// ─── PS08-10: Table parsing ───────────────────────────────────

test("PS08: table with <th> headers extracts headers and data rows", () => {
  const html = `<html><body>
    <h2>Important Dates</h2>
    <table>
      <tr><th>Event</th><th>Date</th></tr>
      <tr><td>Registration Opens</td><td>08/09/2026</td></tr>
      <tr><td>Last Date</td><td>28/09/2026</td></tr>
    </table>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading === "Important Dates");
  assert.ok(sec, "should find Important Dates section");
  assert.equal(sec!.tables.length, 1, "should have one table");
  const tbl = sec!.tables[0];
  assert.deepEqual(tbl.headers, ["Event", "Date"]);
  assert.equal(tbl.rows.length, 2);
  assert.deepEqual(tbl.rows[0], ["Registration Opens", "08/09/2026"]);
  assert.deepEqual(tbl.rows[1], ["Last Date", "28/09/2026"]);
});

test("PS09: table with all-<td> first row treats first row as headers", () => {
  const html = `<html><body>
    <h2>Vacancies</h2>
    <table>
      <tr><td>Post Name</td><td>Category</td><td>Count</td></tr>
      <tr><td>AO Generalist</td><td>General</td><td>130</td></tr>
      <tr><td>AO Hindi Officer</td><td>General</td><td>20</td></tr>
    </table>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.type === "vacancy");
  assert.ok(sec, "should find vacancy section");
  const tbl = sec!.tables[0];
  assert.deepEqual(tbl.headers, ["Post Name", "Category", "Count"]);
  assert.equal(tbl.rows.length, 2);
});

test("PS10: table <caption> element is captured", () => {
  const html = `<html><body>
    <h2>Selection</h2>
    <table>
      <caption>Phase-wise marks</caption>
      <tr><th>Phase</th><th>Marks</th></tr>
      <tr><td>Online Test</td><td>100</td></tr>
    </table>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.type === "selection");
  assert.ok(sec, "should find selection section");
  const tbl = sec!.tables[0];
  assert.equal(tbl.caption, "Phase-wise marks");
});

// ─── PS11: Nested list ────────────────────────────────────────

test("PS11: two-level nested list preserves hierarchy", () => {
  const html = `<html><body>
    <h2>Eligibility Criteria</h2>
    <ul>
      <li>Age Limit
        <ul>
          <li>General: 21-30 years</li>
          <li>OBC: 21-33 years</li>
        </ul>
      </li>
      <li>Educational Qualification</li>
    </ul>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.type === "eligibility");
  assert.ok(sec, "should find eligibility section");
  assert.ok(sec!.lists.length > 0, "should have lists");
  const list = sec!.lists[0];
  // Top-level items
  assert.ok(list.items.length >= 2, "should have at least 2 top-level items");
  // First item should have children
  const ageItem = list.items.find((item) => item.text.includes("Age Limit"));
  assert.ok(ageItem, "should find Age Limit item");
  assert.ok(ageItem!.children.length >= 2, "Age Limit should have 2 child items");
  assert.equal(ageItem!.children[0].level, 1, "child level should be 1");
  assert.ok(ageItem!.children[0].text.includes("21-30"), "child should contain age range");
});

// ─── PS12-13: Link extraction ─────────────────────────────────

test("PS12: relative link resolved to absolute URL", () => {
  const html = `<html><body>
    <h2>Important Links</h2>
    <p><a href="/recruitment/notification.pdf">Download Notification</a></p>
  </body></html>`;
  const doc = structureDocument(html, "https://uiic.co.in/");
  const sec = doc.sections.find((s) => s.heading === "Important Links");
  assert.ok(sec, "should find Important Links section");
  assert.ok(sec!.links.length > 0, "should have links");
  const link = sec!.links[0];
  assert.equal(link.href, "/recruitment/notification.pdf");
  assert.equal(link.resolvedHref, "https://uiic.co.in/recruitment/notification.pdf");
  assert.equal(link.text, "Download Notification");
});

test("PS13: anchor and javascript: hrefs are excluded", () => {
  const html = `<html><body>
    <h2>Links</h2>
    <p>
      <a href="#section-top">Jump to top</a>
      <a href="javascript:void(0)">Click here</a>
      <a href="https://example.com/apply">Apply Now</a>
    </p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading === "Links");
  assert.ok(sec, "should find Links section");
  // Only the real link should be included
  assert.equal(sec!.links.length, 1, "should exclude # and javascript: hrefs");
  assert.equal(sec!.links[0].resolvedHref, "https://example.com/apply");
});

// ─── PS14: Fallback section ───────────────────────────────────

test("PS14: page with no headings produces single overview section", () => {
  const html = `<html><body>
    <p>UIIC has published a recruitment notification for 225 AO posts.</p>
    <p>Last date: 28/09/2026</p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  assert.equal(doc.sections.length, 1, "should have exactly one section");
  assert.equal(doc.sections[0].type, "overview");
  assert.ok(doc.sections[0].text.includes("225"), "overview text should include vacancy count");
});

// ─── PS15: UIIC-like fixture ──────────────────────────────────

test("PS15: UIIC-like HTML — section count, tables, notification in text", () => {
  const UIIC_HTML = `<!DOCTYPE html>
<html>
<head><title>UIIC AO Recruitment 2026 - 225 Posts</title></head>
<body>
<article class="entry-content">
<h1>UIIC AO Online Form 2026</h1>
<p>United India Insurance Company Limited (UIIC) has published recruitment notification
(Advt No. HO:HRM:REC:AO:1:2026) for 225 Administrative Officer posts.</p>

<h2>Vacancies Detail</h2>
<table>
  <tr><th>Post</th><th>Category</th><th>Vacancies</th></tr>
  <tr><td>AO (Generalist)</td><td>General</td><td>130</td></tr>
  <tr><td>AO (Hindi)</td><td>General</td><td>20</td></tr>
</table>

<h2>Important Dates</h2>
<table>
  <tr><th>Event</th><th>Date</th></tr>
  <tr><td>Registration Opens</td><td>08/09/2026</td></tr>
  <tr><td>Last Date</td><td>28/09/2026</td></tr>
</table>

<h2>Application Fee</h2>
<table>
  <tr><th>Category</th><th>Fee</th></tr>
  <tr><td>General/OBC</td><td>₹850</td></tr>
  <tr><td>SC/ST/PwD</td><td>₹100</td></tr>
</table>

<h2>Eligibility Criteria</h2>
<p>Graduation with minimum 60% marks from a recognized university.</p>
<p>Age: 21-30 years as on 01/09/2026.</p>

<h2>Selection Process</h2>
<ul>
  <li>Phase I: Online Examination (Objective)</li>
  <li>Phase II: Online Examination (Descriptive)</li>
  <li>Phase III: Interview</li>
</ul>

<h2>How to Apply Online</h2>
<p>Visit the official website <a href="https://uiic.co.in/recruitment">uiic.co.in</a>.</p>
<p><a href="https://uiic.co.in/notification.pdf">Download Official Notification</a></p>
</article>
</body>
</html>`;

  const doc = structureDocument(UIIC_HTML, "https://govtjobguru.in/uiic/");

  // Title
  assert.ok(doc.title, "should extract page title");
  assert.ok(doc.title!.includes("UIIC"), "title should include UIIC");

  // Sections
  assert.ok(doc.sections.length >= 5, `should have at least 5 sections, got ${doc.sections.length}`);

  // Notification number in overview text
  const overviewSec = doc.sections.find((s) => s.type === "overview");
  assert.ok(overviewSec, "should have overview section");
  assert.ok(
    overviewSec!.text.includes("HO:HRM:REC:AO:1:2026"),
    `overview text should contain notification number: "${overviewSec!.text.slice(0, 200)}"`,
  );

  // Vacancy section with table
  const vacancySec = doc.sections.find((s) => s.type === "vacancy");
  assert.ok(vacancySec, "should have vacancy section");
  assert.ok(vacancySec!.tables.length >= 1, "vacancy section should have table");
  assert.deepEqual(vacancySec!.tables[0].headers, ["Post", "Category", "Vacancies"]);

  // Dates section with table
  const datesSec = doc.sections.find((s) => s.type === "dates");
  assert.ok(datesSec, "should have dates section");
  assert.ok(datesSec!.tables.length >= 1, "dates section should have table");

  // Financial section
  const financeSec = doc.sections.find((s) => s.type === "financial");
  assert.ok(financeSec, "should have financial section");

  // Selection section with list
  const selectionSec = doc.sections.find((s) => s.type === "selection");
  assert.ok(selectionSec, "should have selection section");
  assert.ok(selectionSec!.lists.length >= 1, "selection section should have list");
  assert.ok(selectionSec!.lists[0].items.length >= 3, "selection list should have 3+ items");

  // How to apply with links
  const howSec = doc.sections.find((s) => s.type === "how_to_apply");
  assert.ok(howSec, "should have how_to_apply section");
  assert.ok(howSec!.links.length >= 2, "how_to_apply section should have 2+ links");

  // allLinks deduplicated
  assert.ok(doc.allLinks.length >= 2, "allLinks should have at least 2 entries");
  // Every resolved href should be absolute
  for (const link of doc.allLinks) {
    assert.ok(
      link.resolvedHref.startsWith("http"),
      `resolved href should be absolute: ${link.resolvedHref}`,
    );
  }
});

// ─── PS16-18: normalizeForMatching / evidencePresent ─────────

test("PS16: normalizeForMatching collapses whitespace, lowercases, strips punctuation", () => {
  const raw = "  HO:HRM:REC:AO:1:2026  ";
  const normalized = normalizeForMatching(raw);
  // Colons stripped, lowercase, whitespace trimmed
  assert.equal(normalized, "hohrmrecao12026");
});

test("PS17: evidencePresent returns true when value appears in section text", () => {
  const sectionText = "Total vacancies: 225 posts (200 Generalists + 25 Hindi Officers)";
  assert.ok(evidencePresent(225, sectionText), "225 should be found in section text");
  assert.ok(evidencePresent("Generalists", sectionText), "Generalists should be found");
});

test("PS18: evidencePresent returns false when value is absent from section text", () => {
  const sectionText = "Total vacancies: 225 posts";
  assert.ok(!evidencePresent(300, sectionText), "300 should not be found in section text");
  assert.ok(!evidencePresent("SSC", sectionText), "SSC should not be found");
});

// ─── PS19: rawHtml preservation ───────────────────────────────

test("PS19: rawHtml preserved on section and table", () => {
  const html = `<html><body>
    <h2>Vacancies</h2>
    <table>
      <tr><th>Post</th><th>Count</th></tr>
      <tr><td>AO</td><td>225</td></tr>
    </table>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading === "Vacancies");
  assert.ok(sec, "should find Vacancies section");
  assert.ok(sec!.rawHtml.includes("<table"), "section rawHtml should include table tag");
  assert.ok(sec!.rawHtml.includes("225"), "section rawHtml should include content");
  assert.ok(sec!.tables.length > 0, "should have table");
  assert.ok(sec!.tables[0].rawHtml.includes("<table"), "table rawHtml should include <table tag");
});

// ─── PS20-22: Content-signal reclassification ─────────────────
//
// Post-specific headings like "Administrative Officer (Scale I) - Generalists"
// don't contain eligibility keywords but their content does.
// Regression tests derived from actual UIIC AO 2026 page structure.

test("PS20: post-specific heading with 'Qualification:' content → eligibility", () => {
  // Mirrors UIIC's "Administrative Officer (Scale I) - Generalists" section
  const html = `<html><body>
    <h2>Administrative Officer (Scale I) - Generalists</h2>
    <p>No. of Vacancies: 200 (SC-30, OBC-62, EWS-22, UR-86)</p>
    <p>Qualification: Graduate Degree/Post Graduate in any discipline with minimum 60%.</p>
    <p>Age: 21-30 years as on 01/09/2026</p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading.includes("Generalists"));
  assert.ok(sec, "should find the Generalists section");
  assert.equal(
    sec!.type,
    "eligibility",
    `section with 'Qualification:' content should be eligibility, got: ${sec!.type}`,
  );
});

test("PS21: post-specific heading with 'years as on' content → eligibility", () => {
  // Mirrors UIIC's "Administrative Officer (Scale I) - Hindi Officers"
  const html = `<html><body>
    <h2>Hindi Officers</h2>
    <p>No. of Vacancies: 25</p>
    <p>Qualification: Master's Degree in Hindi from a recognized University.</p>
    <p>Age: 21-30 years as on 01/09/2026.</p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading === "Hindi Officers");
  assert.ok(sec, "should find Hindi Officers section");
  assert.equal(
    sec!.type,
    "eligibility",
    `'years as on' is a strong eligibility signal; got: ${sec!.type}`,
  );
});

test("PS22: post heading without qualification/age content stays 'other'", () => {
  // A section whose heading looks post-specific but has no eligibility signals
  const html = `<html><body>
    <h2>Admit Card Details</h2>
    <p>The admit card will be released two weeks before the exam date.</p>
    <p>Candidates must download it from the official website.</p>
  </body></html>`;
  const doc = structureDocument(html, "https://example.com/");
  const sec = doc.sections.find((s) => s.heading === "Admit Card Details");
  assert.ok(sec, "should find Admit Card Details section");
  assert.equal(
    sec!.type,
    "other",
    `section without qualification/age signals must stay 'other'; got: ${sec!.type}`,
  );
});
