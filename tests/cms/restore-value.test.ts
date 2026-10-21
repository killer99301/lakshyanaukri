// Putting back the value a field had before a change
//   npx tsx --tsconfig tsconfig.json tests/cms/restore-value.test.ts
import { suite, test, assert } from "../intelligence/suite";
import { currentValue, restorable, sameAsNow } from "@/lib/cms/restore-value";

const pf = (value: unknown, status = "VERIFIED") => ({ value, status, evidenceIds: ["e1"], conflict: false, manuallyEdited: false });

suite("Restoring an earlier value");

test("RV01 a value comes back Pending, without evidence ids, even if it was Verified", () => {
  const r = restorable(pf("2026-10-20"));
  assert.deepEqual(r, { ok: true, field: { value: "2026-10-20", status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } });
});

test("RV02 Not specified comes back as it was; an empty field cannot be restored", () => {
  assert.deepEqual(restorable({ value: null, status: "NOT_SPECIFIED", evidenceIds: [], conflict: false, manuallyEdited: true }), { ok: true, field: { value: null, status: "NOT_SPECIFIED", evidenceIds: [], conflict: false, manuallyEdited: true } });
  assert.equal(restorable(null).ok, false);
  assert.equal(restorable(undefined).ok, false);
});

test("RV03 lists kept without a status are wrapped for saving", () => {
  const links = [{ type: "OFFICIAL_WEBSITE", label: "Site", url: "https://x.gov.in/", official: true }];
  assert.deepEqual(restorable(links), { ok: true, field: { value: links, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true } });
});

test("RV04 nothing to restore when the earlier value is what the field holds now", () => {
  assert.equal(sameAsNow(pf("2026-10-20"), pf("2026-10-20", "PENDING")), true);
  assert.equal(sameAsNow(pf("2026-10-20"), pf("2026-10-26")), false);
  assert.equal(sameAsNow([1, 2], [1, 2]), true);
});

test("RV05 the current value is read by the revision's path", () => {
  const record = { dates: { applicationCloseDate: pf("2026-10-26") }, links: [{ url: "u" }], eligibility: pf([]) };
  assert.deepEqual(currentValue(record, "dates.applicationCloseDate"), pf("2026-10-26"));
  assert.deepEqual(currentValue(record, "links"), [{ url: "u" }]);
  assert.equal(currentValue(record, "dates.examDate"), undefined);
  assert.equal(currentValue(record, "nothing.here"), undefined);
});
