// Reading a date the way people type it
//   npx tsx --tsconfig tsconfig.json tests/cms/date-input.test.ts
import { suite, test, assert } from "../intelligence/suite";
import { readDate, showDate } from "@/lib/date-input";

const iso = (s: string) => { const r = readDate(s); return r.ok === true ? r.iso : r.ok === false ? `ERR ${r.error}` : "EMPTY"; };

suite("Typed dates");

test("DI01 the usual ways of writing a date", () => {
  for (const s of ["2026-10-28", "2026/10/28", "28-10-2026", "28/10/2026", "28.10.2026", "28 Oct 2026", "28 October 2026", "28th October, 2026", "28-Oct-2026", "Oct 28, 2026", "October 28 2026", "  28   oct   2026 "]) {
    assert.equal(iso(s), "2026-10-28", s);
  }
  assert.equal(iso("1 Sept 2026"), "2026-09-01");
  assert.equal(iso("5-6-2026"), "2026-06-05");
});

test("DI02 a numeric date that could be read either way says how it was read", () => {
  const r = readDate("05-06-2026");
  assert.equal(r.ok, true);
  assert.equal(r.ok === true && r.iso, "2026-06-05");
  assert.match(r.ok === true ? r.note ?? "" : "", /day first.*If you meant 6 May/);
  assert.equal(readDate("28-10-2026").ok === true && (readDate("28-10-2026") as { note?: string }).note, undefined);
  assert.equal((readDate("06-06-2026") as { note?: string }).note, undefined);
});

test("DI03 refused, never guessed", () => {
  assert.match(iso("28-10-26"), /^ERR Type the full year/);
  assert.match(iso("31-02-2026"), /^ERR February 2026 has no day 31/);
  assert.match(iso("10-28-2026"), /^ERR Dates are read day first/);
  assert.match(iso("28 Foo 2026"), /^ERR “Foo” is not a month/);
  assert.match(iso("next Tuesday"), /^ERR Not a date/);
  assert.match(iso("2026-13-01"), /^ERR There is no such month/);
  assert.equal(iso("   "), "EMPTY");
});

test("DI04 a stored date is shown the way people read it", () => {
  assert.equal(showDate("2026-10-28"), "28 Oct 2026");
  assert.equal(showDate("2026-09-01"), "1 Sep 2026");
  assert.equal(showDate("not a date"), "not a date");
});
