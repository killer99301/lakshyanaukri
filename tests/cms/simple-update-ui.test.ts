// Simple Update (CMS usability batch 2): how the editor offers it and gets out of its way. Source checks;
// the behaviour is covered by tests/local-stack/simple-update.test.ts and the browser test.
//   npx tsx --tsconfig tsconfig.json tests/cms/simple-update-ui.test.ts
import { readFileSync } from "node:fs";
import { suite, test, assert } from "../intelligence/suite";
import { SIMPLE_KINDS } from "@/lib/cms/simple-update";

const page = readFileSync("src/app/admin/cms/[id]/page.tsx", "utf8");
const panel = readFileSync("src/app/admin/cms/[id]/SimpleUpdatePanel.tsx", "utf8");
const helper = readFileSync("src/lib/cms/simple-update.ts", "utf8");

suite("Simple Update in the editor");

test("SU-01 the seven routine updates are offered", () => {
  assert.deepEqual(SIMPLE_KINDS.map((k) => k.kind), ["EXAM_DATE", "ADMIT_CARD", "RESULT", "ANSWER_KEY", "CUT_OFF", "DEADLINE", "NOTICE"]);
});

test("SU-02 offered only for jobs that have been published (live or being edited), never archived", () => {
  assert.match(page, /\{Boolean\(record\.publishedAt\) && record\.draftState !== "ARCHIVED" && !simpleOpen && \(\s*<button\s+type="button"\s+data-open-simple-update/);
});

test("SU-03 the full editor is folded away, not removed, and any section or field link brings it back", () => {
  assert.match(page, /<div data-advanced-editor style=\{simpleOpen \? \{ display: "none" \} : undefined\}>/);
  assert.equal((page.match(/unsaved\.current = false;\r?\n\s+setSimpleOpen\(false\);/g) ?? []).length, 2, "openSection and jumpTo leave Simple Update");
  assert.match(panel, /data-su-advanced onClick=\{leave\}/);
});

test("SU-04 typing in Simple Update does not trip the editor's unsaved-field guard; leaving it asks only when something was typed", () => {
  assert.match(panel, /onInput=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(panel, /if \(dirty && !done && !window\.confirm\(/);
});

test("SU-05 no AI, no approve, no publish, no Telegram from Simple Update", () => {
  for (const src of [panel, helper]) {
    assert.ok(!/ai-assist|check-updates`|\/approve|\/publish|telegram|announce\s*:/i.test(src.replace(/Check for updates/g, "")), "no such call");
  }
  assert.match(panel, /applySaves\(record, \(opened\) => planSimpleUpdate\(opened, i, today\)\.saves, plan\.announcement\)/);
});

test("SU-06 the AI path only hands the address over; Check for updates opens afresh with it and waits for its button", () => {
  assert.match(page, /router\.replace\(`\/admin\/cms\/\$\{id\}\?source=\$\{encodeURIComponent\(src\)\}#check-updates`/);
  assert.match(page, /<UpdateCheckPanel key=\{leadSource\}/);
});

test("SU-07 the saves are Check for updates' own: no second field-saving path", () => {
  assert.match(helper, /const saves = problems\.length === 0 \? savesFor\(record, proposals\) : \[\];/);
  assert.ok(!/fetch\(/.test(helper), "the plan is pure");
});

test("SU-08 choosing an update type clears the previous type's dates, stage and link (only the source is kept)", () => {
  const choose = panel.slice(panel.indexOf("function choose("), panel.indexOf("async function save("));
  for (const reset of ['setDateIso("")', 'setFeeDateIso("")', 'setStageChoice("")', 'setNewStage("")', 'setLinkUrl("")', "setLinkOfficialChoice(null)", 'setNoteDate("")', "setReplaceVerified(false)", 'setCertainty("")', 'setExamChange("")']) {
    assert.ok(choose.includes(reset), reset);
  }
  assert.ok(!choose.includes('setSource('), "the source address is kept");
});
