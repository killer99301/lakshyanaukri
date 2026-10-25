// Importer core: links, trusted hosts, pages, the preview's items, field classes and the gate
//   npx tsx --tsconfig tsconfig.json tests/cms/importer-core.test.ts
import { suite, test, assert } from "../intelligence/suite";
import { cleanUrl, linkFlags, linksInText, sourceOwnLink } from "@/lib/cms/importer/links";
import { authorityCovers, originFor } from "@/lib/cms/importer/trusted-domains";
import { pageOf } from "@/lib/cms/importer/evidence-text";
import { buildProposal, type RetrievalSummary, type SourceExtraction } from "@/lib/cms/importer/proposal";
import { classifyField, publishGate, type ClaimView, type FieldState } from "@/lib/cms/importer/classify";

suite("Links");
test("IC01 tracking removed, destination and #fragment kept", () => {
  assert.equal(cleanUrl("https://bfsissc.com/blog2/post.php?slug=lic&utm_source=chatgpt.com"), "https://bfsissc.com/blog2/post.php?slug=lic");
  assert.equal(cleanUrl("https://ibps.in/#/auth/registration?utm_medium=x"), "https://ibps.in/#/auth/registration?utm_medium=x");
  assert.equal(cleanUrl("javascript:alert(1)"), null);
});
test("IC02 blogs and portals flagged; official only for a listed host", () => {
  assert.ok(linkFlags("https://bfsissc.com/blog2/post.php?slug=x", "https://bfsissc.com/blog2/post.php?slug=x&utm_source=chatgpt.com").includes("looks like a blog or article, not an apply page"));
  const found = linksInText("Apply at https://nats.education.gov.in/ and see https://www.bankersadda.com/lic-hfl-apprentice-recruitment-2026/ or https://cdn.lichousing.com/2026/10/Notice.pdf.", "lic-hfl");
  const by = (host: string) => found.find((l) => l.url.includes(host))!;
  assert.equal(by("nats").official, true);
  assert.equal(by("bankersadda").official, false);
  assert.ok(by("bankersadda").flags.some((f) => /portal/.test(f)));
  assert.equal(by("lichousing").type, "OFFICIAL_NOTIFICATION");
  assert.equal(by("lichousing").url.endsWith(".pdf"), true);
});

test("IC02b LIC batch 10 PDF: manuals and partner PDFs are not the notice; no tracking flag without tracking", () => {
  const found = linksInText("refer to https://nats.education.gov.in/assets/manual/student_manual.pdf and https://nats.education.gov.in.in (Navigate) and https://beep.bfsissc.com will be", "lic-hfl");
  const by = (s: string) => found.find((l) => l.url.includes(s))!;
  assert.equal(by("student_manual").type, "OTHER");
  assert.ok(found.every((l) => !l.flags.includes("tracking removed")));
  assert.equal(by("gov.in.in").official, false);
  assert.equal(linksInText("https://beep.bfsissc.com/notice.pdf", "lic-hfl")[0].type, "OTHER");
  assert.equal(linksInText("https://beep.bfsissc.com", "lic-hfl")[0].type, "OTHER");
  assert.equal(by("student_manual").type, "OTHER");
  assert.equal(linksInText("https://nats.education.gov.in/student_type.php", "lic-hfl")[0].type, "APPLY_ONLINE");
  assert.ok(linkFlags("https://x.gov.in/a", "https://x.gov.in/a?utm_source=chatgpt.com").includes("tracking removed"));
});
test("IC02c the notice's own address is its notification link; research has none", () => {
  const own = sourceOwnLink("https://cdn.lichousing.com/2026/10/Batch-10.pdf", "OFFICIAL_NOTIFICATION", "lic-hfl")!;
  assert.equal(own.type, "OFFICIAL_NOTIFICATION");
  assert.equal(own.official, true);
  assert.equal(sourceOwnLink("https://ssc.gov.in/c.pdf", "OFFICIAL_CORRIGENDUM", "ssc")!.type, "CORRIGENDUM");
  assert.equal(sourceOwnLink("https://x.com/a", "RESEARCH", "ssc"), null);
  assert.equal(sourceOwnLink(null, "OFFICIAL_NOTIFICATION", "ssc"), null);
});

suite("Trusted hosts");
test("IC03 a partner speaks only for its purposes", () => {
  const bfsi = originFor("lic-hfl", "beep.bfsissc.com");
  assert.equal(bfsi.role, "PARTNER");
  assert.equal(authorityCovers(bfsi.role, bfsi.purposes, "fee_payment"), true);
  assert.equal(authorityCovers(bfsi.role, bfsi.purposes, "recruitment_rules"), false);
  assert.equal(originFor("lic-hfl", "lichousing.com").role, "AUTHORITY");
  assert.equal(originFor("lic-hfl", "bankersadda.com").role, "UNLISTED");
  assert.equal(originFor("ssc", "lichousing.com").role, "UNLISTED");
  assert.equal(originFor("lic-hfl", null).role, "NONE");
  const portal = originFor("btsc", "btsc.pariksha.nic.in");
  assert.equal(portal.role, "PARTNER");
  for (const p of ["recruitment_rules", "fee_payment", "general", "exam"] as const) assert.equal(authorityCovers(portal.role, portal.purposes, p), false, p);
  assert.equal(authorityCovers(portal.role, portal.purposes, "application"), true);
  assert.equal(originFor("btsc", "pariksha.nic.in").role, "UNLISTED");
  assert.equal(originFor("btsc", "bpsc.pariksha.nic.in").role, "UNLISTED");
});

suite("Pages");
test("IC04 page from the reader's markers; none without markers", () => {
  const text = "Notice\nAge 20 to 25 years\n-- 1 of 3 --\nFee: Rs.800/- plus GST\n-- 2 of 3 --\nDates\n-- 3 of 3 --";
  assert.equal(pageOf(text, "Rs.800/-  plus GST"), 2);
  assert.equal(pageOf(text, "Age 20 to 25"), 1);
  assert.equal(pageOf(text, "not there"), null);
  assert.equal(pageOf("plain pasted text with Rs.800", "Rs.800"), null);
});

const R = (id: string, kind: RetrievalSummary["declaredKind"], auth: RetrievalSummary["authenticity"] = "CONFIRMED", role: RetrievalSummary["originRole"] = "AUTHORITY"): RetrievalSummary =>
  ({ id, declaredKind: kind, authenticity: auth, originRole: role, originPurposes: role === "AUTHORITY" ? ["all"] : [], label: id });
const ex = (r: RetrievalSummary, values: SourceExtraction["values"], links: SourceExtraction["links"] = []): SourceExtraction => ({ retrieval: r, values, links });

suite("Preview items");
test("IC05 fill, matches, replace and replace-verified", () => {
  const p = buildProposal({
    extractions: [ex(R("pdf", "OFFICIAL_NOTIFICATION"), [
      { fieldPath: "dates.applicationCloseDate", value: "2026-11-01", quote: "01.11.2026" },
      { fieldPath: "financial.feeGeneral", value: 800 },
      { fieldPath: "financial.feeSCST", value: 200 },
      { fieldPath: "age", value: { min: 20, max: 25 } },
    ])],
    current: (f) => ({ "financial.feeGeneral": { value: 800, verified: false }, "financial.feeSCST": { value: 250, verified: false }, age: { value: { max: 26, min: 20 }, verified: true } } as Record<string, { value: unknown; verified: boolean }>)[f],
  });
  const it = (f: string) => p.items.find((i) => i.fieldPath === f)!;
  assert.equal(it("dates.applicationCloseDate").action, "FILL");
  assert.equal(it("dates.applicationCloseDate").defaultTicked, true);
  assert.equal(it("financial.feeGeneral").action, "MATCHES");
  assert.equal(it("financial.feeSCST").action, "REPLACE");
  assert.equal(it("financial.feeSCST").defaultTicked, false);
  assert.equal(it("age").action, "REPLACE_VERIFIED");
  assert.equal(it("age").defaultTicked, false);
});
test("IC06 research 7 Nov vs PDF 8 Nov → a conflict, nothing ticked", () => {
  const p = buildProposal({
    extractions: [
      ex(R("chatgpt", "RESEARCH", "NOT_APPLICABLE", "NONE"), [{ fieldPath: "dates.examDate", value: "2026-11-07" }]),
      ex(R("pdf", "OFFICIAL_NOTIFICATION"), [{ fieldPath: "dates.examDate", value: "2026-11-08" }]),
    ],
    current: () => undefined,
  });
  const exam = p.items.filter((i) => i.fieldPath === "dates.examDate");
  assert.equal(exam.length, 2);
  assert.ok(exam.every((i) => i.conflict && !i.defaultTicked));
  assert.ok(exam.find((i) => i.value === "2026-11-07")!.flags[0].startsWith("from research only"));
});
test("IC07 a corrigendum replaces only the fields it states", () => {
  const p = buildProposal({
    extractions: [
      ex(R("notice", "OFFICIAL_NOTIFICATION"), [
        { fieldPath: "dates.applicationCloseDate", value: "2026-11-01" },
        { fieldPath: "financial.feeGeneral", value: 800 },
      ]),
      ex(R("corr", "OFFICIAL_CORRIGENDUM"), [{ fieldPath: "dates.applicationCloseDate", value: "2026-11-08" }]),
    ],
    current: () => undefined,
    existingClaims: [
      { id: "old-close", fieldPath: "dates.applicationCloseDate", value: "2026-11-01", superseded: false },
      { id: "old-fee", fieldPath: "financial.feeGeneral", value: 800, superseded: false },
    ],
  });
  const close = p.items.filter((i) => i.fieldPath === "dates.applicationCloseDate");
  assert.equal(close.length, 1);
  assert.equal(close[0].value, "2026-11-08");
  assert.equal(close[0].conflict, false);
  assert.deepEqual(close[0].supersedes, ["old-close"]);
  const fee = p.items.find((i) => i.fieldPath === "financial.feeGeneral")!;
  assert.deepEqual(fee.supersedes, []);
  assert.deepEqual(p.replacedInImport.map((r) => r.value), ["2026-11-01"]);
});
test("IC07b a corrigendum's heading is never proposed as the job's title", () => {
  const p = buildProposal({
    extractions: [ex(R("corr", "OFFICIAL_CORRIGENDUM"), [
      { fieldPath: "identity.title", value: "Corrigendum 1 to LICHFL Apprenticeship Program-010" },
      { fieldPath: "dates.applicationCloseDate", value: "2026-11-08" },
    ])],
    current: () => ({ value: "LIC HFL Apprentice Recruitment 2026", verified: false }),
  });
  assert.deepEqual(p.items.map((i) => i.fieldPath), ["dates.applicationCloseDate"]);
});
test("IC08 a syllabus only research states is flagged when an official document is in the import", () => {
  const p = buildProposal({
    extractions: [
      ex(R("pdf", "OFFICIAL_NOTIFICATION"), [{ fieldPath: "financial.feeGeneral", value: 800 }]),
      ex(R("chatgpt", "RESEARCH", "NOT_APPLICABLE", "NONE"), [{ fieldPath: "syllabus", value: [{ subject: "Reasoning", topics: ["Puzzles"] }] }]),
    ],
    current: () => undefined,
  });
  const syl = p.items.find((i) => i.fieldPath === "syllabus")!;
  assert.ok(syl.flags.includes("the official document in this import does not state this"));
});
test("IC09 links: a blog link is proposed but not ticked; research links are never ticked", () => {
  const research = R("chatgpt", "RESEARCH", "NOT_APPLICABLE", "NONE");
  const p = buildProposal({
    extractions: [ex(research, [], linksInText("Official source: https://bfsissc.com/blog2/post.php?slug=lic&utm_source=chatgpt.com and https://nats.education.gov.in/", "lic-hfl"))],
    current: () => undefined,
  });
  assert.ok(p.items.every((i) => i.kind === "LINK" && !i.defaultTicked));
  assert.ok(p.items.some((i) => (i.value as { url: string }).url === "https://bfsissc.com/blog2/post.php?slug=lic"));
  const fromPdf = buildProposal({
    extractions: [ex(R("pdf", "OFFICIAL_NOTIFICATION", "CONFIRMED", "AUTHORITY"), [], linksInText("https://nats.education.gov.in/ and https://nats.education.gov.in.in", "lic-hfl"))],
    current: () => undefined,
  });
  const tick = (host: string) => fromPdf.items.find((i) => (i.value as { url: string }).url.includes(host))!.defaultTicked;
  assert.equal(tick("gov.in/"), true);
  assert.equal(tick("gov.in.in"), false);
});

// ── Field classes ──
const claim = (c: Partial<ClaimView> & Pick<ClaimView, "id" | "seq" | "kind">): ClaimView => ({ value: null, ...c });
const official = { authenticity: "CONFIRMED", originRole: "AUTHORITY" as const, originPurposes: ["all"], declaredKind: "OFFICIAL_NOTIFICATION" };
const state = (s: Partial<FieldState>): FieldState => ({ fieldPath: "dates.applicationCloseDate", hasValue: true, value: "2026-11-07", latestRevisionId: "r1", latestRevisionAt: "2026-10-22T10:00:00Z", claims: [], ...s });

suite("Field classes");
test("IC10 verified 7 Nov → edited to 10 Nov → restored to 7 Nov: not verified", () => {
  const verified = claim({ id: "v", seq: 2, kind: "ADMIN_VERIFIED", value: "2026-11-07", fieldRevisionId: "r1" });
  const extracted = claim({ id: "e", seq: 1, kind: "EXTRACTED", value: "2026-11-07", retrieval: official });
  assert.equal(classifyField(state({ claims: [extracted, verified] }), null).cls, "VERIFIED");
  // two later saves: r2 (10 Nov), r3 (back to 7 Nov)
  assert.equal(classifyField(state({ latestRevisionId: "r3", claims: [extracted, verified] }), null).cls, "SUPPORTED");
});
test("IC11 the latest unrevoked decision is in force", () => {
  const a = claim({ id: "a", seq: 5, kind: "ADMIN_NOT_STATED", fieldRevisionId: "r1" });
  const b = claim({ id: "b", seq: 6, kind: "ADMIN_VERIFIED", value: "2026-11-07", fieldRevisionId: "r1" });
  assert.equal(classifyField(state({ claims: [a, b] }), null).cls, "VERIFIED");
  const revokeB = claim({ id: "x", seq: 7, kind: "ADMIN_REVOKED", revokesClaimId: "b" });
  assert.equal(classifyField(state({ claims: [a, b, revokeB] }), null).cls, "NOT_STATED");
  const revokeA = claim({ id: "y", seq: 8, kind: "ADMIN_REVOKED", revokesClaimId: "a" });
  assert.equal(classifyField(state({ claims: [a, b, revokeB, revokeA] }), null).cls, "UNSUPPORTED");
});
test("IC12 research-only, unconfirmed, conflicting, missing, legacy", () => {
  const research = { authenticity: "NOT_APPLICABLE", originRole: "NONE" as const, originPurposes: [], declaredKind: "RESEARCH" };
  assert.equal(classifyField(state({ claims: [claim({ id: "e", seq: 1, kind: "EXTRACTED", value: "2026-11-07", retrieval: research })] }), null).cls, "RESEARCH_ONLY");
  const upload = { authenticity: "UNCONFIRMED", originRole: "AUTHORITY" as const, originPurposes: ["all"], declaredKind: "OFFICIAL_NOTIFICATION" };
  assert.equal(classifyField(state({ claims: [claim({ id: "e", seq: 1, kind: "EXTRACTED", value: "2026-11-07", retrieval: upload })] }), null).cls, "UNSUPPORTED");
  assert.equal(classifyField(state({ claims: [
    claim({ id: "e1", seq: 1, kind: "EXTRACTED", value: "2026-11-07", retrieval: official }),
    claim({ id: "e2", seq: 2, kind: "EXTRACTED", value: "2026-11-08", retrieval: official }),
  ] }), null).cls, "CONFLICTING");
  assert.equal(classifyField(state({ hasValue: false, value: null }), null).cls, "MISSING");
  assert.equal(classifyField(state({ latestRevisionAt: "2026-10-01T00:00:00Z" }), "2026-10-20T00:00:00Z").cls, "LEGACY");
  assert.equal(classifyField(state({ latestRevisionAt: "2026-10-25T00:00:00Z" }), "2026-10-20T00:00:00Z").cls, "UNSUPPORTED");
});
test("IC13 a partner's genuine document supports a fee, not an age limit", () => {
  const partner = { authenticity: "CONFIRMED", originRole: "PARTNER" as const, originPurposes: ["exam", "fee_payment"], declaredKind: "OFFICIAL_PAGE" };
  assert.equal(classifyField(state({ fieldPath: "financial.feeGeneral", value: 800, claims: [claim({ id: "e", seq: 1, kind: "EXTRACTED", value: 800, retrieval: partner })] }), null).cls, "SUPPORTED");
  assert.equal(classifyField(state({ fieldPath: "age", value: { max: 25 }, claims: [claim({ id: "e", seq: 1, kind: "EXTRACTED", value: { max: 25 }, retrieval: partner })] }), null).cls, "UNSUPPORTED");
});

suite("Publish gate");
test("IC14 Tier A never accepts not-stated; Tier B does; supported alone is not enough", () => {
  const decided = (fieldPath: string, kind: ClaimView["kind"]) => state({ fieldPath, claims: [claim({ id: `${fieldPath}-d`, seq: 1, kind, value: "x", fieldRevisionId: "r1" })] });
  const all = [
    decided("dates.applicationCloseDate", "ADMIN_VERIFIED"), decided("eligibility", "ADMIN_VERIFIED"), decided("age", "ADMIN_VERIFIED"),
    decided("links#APPLY_ONLINE", "ADMIN_VERIFIED"), decided("links#OFFICIAL_NOTIFICATION", "ADMIN_VERIFIED"),
    decided("dates.applicationOpenDate", "ADMIN_VERIFIED"), decided("dates.feePaymentCloseDate", "ADMIN_NOT_APPLICABLE"),
    decided("financial.feeGeneral", "ADMIN_VERIFIED"), decided("financial.feeSCST", "ADMIN_VERIFIED"), decided("vacancies.total", "ADMIN_NOT_STATED"),
  ];
  assert.equal(publishGate(all, "2026-10-01T00:00:00Z").ok, true);
  const tierA = all.map((s) => s.fieldPath === "age" ? decided("age", "ADMIN_NOT_STATED") : s);
  const r = publishGate(tierA, "2026-10-01T00:00:00Z");
  assert.equal(r.ok, false);
  assert.deepEqual(r.blockers.map((b) => b.fieldPath), ["age"]);
  const supportedOnly = all.map((s) => s.fieldPath === "eligibility" ? state({ fieldPath: "eligibility", value: "Graduate", claims: [claim({ id: "e", seq: 1, kind: "EXTRACTED", value: "Graduate", retrieval: official })] }) : s);
  assert.deepEqual(publishGate(supportedOnly, null).blockers.map((b) => `${b.fieldPath}:${b.cls}`), ["eligibility:SUPPORTED"]);
});
