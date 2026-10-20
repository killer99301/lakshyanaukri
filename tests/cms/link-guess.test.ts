// ═══════════════════════════════════════════════════════════
// What kind of link an address probably is
//
//   npx tsx --tsconfig tsconfig.json tests/cms/link-guess.test.ts
// ═══════════════════════════════════════════════════════════

import { suite, test, assert } from "../intelligence/suite";
import { guessLinkType, onGovernmentDomain } from "@/lib/cms/link-guess";

suite("Guessing a link's type from its address");

test("LG01 the usual kinds of link", () => {
  assert.equal(guessLinkType("https://jkssb.nic.in/Pdf/ADVT_09OF2026_01092026.pdf"), "OFFICIAL_NOTIFICATION");
  assert.equal(guessLinkType("https://jkssb.nic.in/Pdf/Corrigendum_advt_09OF2026_01102026.pdf"), "CORRIGENDUM");
  assert.equal(guessLinkType("https://ssc.gov.in/admit-card/cgl-tier-1"), "ADMIT_CARD");
  assert.equal(guessLinkType("https://rrbcdg.gov.in/uploads/2026/answer_key_cbt1.pdf"), "ANSWER_KEY");
  assert.equal(guessLinkType("https://ibps.in/cut-off-po-mains"), "CUT_OFF");
  assert.equal(guessLinkType("https://upsc.gov.in/results/final-result-cse-2026"), "RESULT");
  assert.equal(guessLinkType("https://ssc.gov.in/notice/exam-schedule-chsl-2026"), "EXAM_NOTICE");
  assert.equal(guessLinkType("https://kearecruitment.karnataka.gov.in/KPSR_JW_2026/Account/Login"), "APPLY_ONLINE");
  assert.equal(guessLinkType("https://www.rrbapply.gov.in/#/auth/registration"), "APPLY_ONLINE");
  assert.equal(guessLinkType("https://www.tnpsc.gov.in/"), "OFFICIAL_WEBSITE");
  assert.equal(guessLinkType("https://www.tnpsc.gov.in"), "OFFICIAL_WEBSITE");
});

test("LG02 nothing to go on, or not an address: no guess", () => {
  assert.equal(guessLinkType("https://example.org/page/12345"), null);
  assert.equal(guessLinkType("not a link"), null);
  assert.equal(guessLinkType(""), null);
});

test("LG03 a government address is recognised, other addresses are not", () => {
  assert.equal(onGovernmentDomain("https://jkssb.nic.in/x.pdf"), true);
  assert.equal(onGovernmentDomain("https://ssc.gov.in/"), true);
  assert.equal(onGovernmentDomain("https://www.canarabank.bank.in/"), false);
  assert.equal(onGovernmentDomain("https://www.adda247.com/"), false);
  assert.equal(onGovernmentDomain("https://gov.in.example.com/"), false);
  assert.equal(onGovernmentDomain("nonsense"), false);
});
