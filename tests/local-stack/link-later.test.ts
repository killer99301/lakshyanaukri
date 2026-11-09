// ═══════════════════════════════════════════════════════════
// "Link not released yet" (ADMIN_NOT_YET_OPEN) on the local test database
// ═══════════════════════════════════════════════════════════
//
// docs/apply-link-not-yet-open-design.md, revision 3, from decision to publish
// to the verified link on the republished page:
//   A. the decision's refusals: wrong page, a research (portal) document, a
//      schedule of dates only, words giving the application address, no
//      reviewer statement, the link's date given as the opening date;
//   B. a valid decision: the two dates kept apart, the gate relaxed for the
//      Apply Online link only;
//   C. published (Telegram not asked, not configured): the snapshot carries
//      what the notice announced, never a link; Updates Needed SOON → NOW;
//   D. withdrawn while live; recorded again; a link added but not verified
//      (decision lapses, republish blocked, no new decision while a link is
//      there); the link verified (awaiting republish); republished (cleared);
//   E. the database itself refuses an incomplete "link not released" row.
// Synthetic documents only. No AI, no network, nothing real published or posted.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/link-later.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";
import { makePdf } from "./pdf-fixture";

type J = Record<string, unknown>;
const URL = "https://www.ibps.in/wp-content/uploads/CRP-TEST-LINK-LATER-2099.pdf";
const LINK_LINE = "The link for online registration will be activated on www.ibps.in from 01.12.2099";
const SCHEDULE = "Online registration: 03.12.2099 to 23.12.2099";
const PDF = makePdf([
  "Institute of Banking Personnel Selection\nCommon Recruitment Process TEST LINK LATER 2099\nAge Limit: as per the detailed rules of the participating banks\nEducational Qualification: as per the detailed rules of the participating banks\nThis notice is published on the official website of IBPS",
  `Important dates\n${LINK_LINE}\n${SCHEDULE}\nLast date for payment of application fee: 23.12.2099`,
]);
const APPLY_URL = "https://ibpsonline.ibps.in/crplx99/";

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHANNEL_ID;
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const revert = await import("@/app/api/admin/cms/records/[id]/revert/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { linkLaterReminders } = await import("@/lib/cms/importer/link-later-reminders");
  const { updatesOverview } = await import("@/lib/cms/discovery/updates");
  const { snapshotToGovernmentRecruitment } = await import("@/lib/cms/adapter");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));
  const rev = async (id: string) => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [id])).rows[0].record_revision as string;
  const patch = async (id: string, fieldPath: string, value: unknown) => (await fields.PATCH(req(`/api/admin/cms/records/${id}/fields`, "PATCH",
    { fieldPath, field: { value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(id), reason: "link-later test" }), ctx(id))).status;
  const importInto = async (mode: "NEW" | "EXISTING", id: string | null, sources: unknown[]) => {
    const p = await service.previewImport({ adminId, mode, apiKey: undefined, sources, recruitmentId: id ?? undefined,
      newJob: id ? undefined : { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: 2099, title: "TEST RECORD IBPS LINK LATER 2099", govType: "PSU" } } as never);
    const ticked = (p.proposal as unknown as { items: Array<{ id: string; defaultTicked: boolean }> }).items.filter((i) => i.defaultTicked).map((i) => i.id);
    return (await service.applyImportFlow({ importId: p.importId, adminId, selected: ticked, confirmReplaceVerified: false, override: null })).recruitmentId;
  };
  const checks = async (id: string) => service.checksFor((await getRecruitmentById(id))!);
  const row = async (id: string, path: string) => (await checks(id)).rows.find((r) => r.fieldPath === path)!;
  const docOf = async (id: string, kind: string) => (await checks(id)).retrievals.find((r) => r.declaredKind === kind)!.id;
  type Kind = "ADMIN_VERIFIED" | "ADMIN_NOT_APPLICABLE" | "ADMIN_NOT_STATED" | "ADMIN_NOT_YET_OPEN";
  const decide = async (id: string, path: string, kind: Kind, o: { retrievalId?: string; page?: number | null; quote?: string | null; justification?: string | null; reviewScope?: J | null;
    linkLater?: { linkReleaseOn: string | null; applicationsOpenOn: string | null; where: string | null; reviewerConfirmed: boolean } }) => {
    const r = await row(id, path);
    try {
      await service.decide({ recruitmentId: id, adminId, fieldPath: path, kind, retrievalId: o.retrievalId ?? await docOf(id, "OFFICIAL_NOTIFICATION"), page: o.page ?? null, quote: o.quote ?? null,
        tableCell: null, reviewScope: (o.reviewScope ?? null) as never, justification: o.justification ?? null, publicNote: null, linkLater: o.linkLater ?? null,
        seen: { revisionId: r.latestRevisionId, decisionId: r.decisionId ?? null } });
      return "accepted";
    } catch (e) { return `refused: ${(e as Error).message}`; }
  };
  const LATER = { linkReleaseOn: "2099-12-01", applicationsOpenOn: "2099-12-03", where: "www.ibps.in", reviewerConfirmed: true };
  const linkLater = (id: string, o: Partial<{ page: number; quote: string; retrievalId: string; linkLater: typeof LATER }> = {}) =>
    decide(id, "links#APPLY_ONLINE", "ADMIN_NOT_YET_OPEN", { page: 2, quote: `${LINK_LINE}\n${SCHEDULE}`, justification: "The notice says the registration link will be activated later", ...o, linkLater: o.linkLater ?? LATER });
  const decisions = async () => (await pg.query("SELECT count(*)::int AS n FROM recruitment_field_claims WHERE kind = 'ADMIN_NOT_YET_OPEN'")).rows[0].n as number;
  const reminder = async (id: string, today: string) => (await linkLaterReminders(today, id))[0]?.item ?? null;
  // Owner-controlled publication (Stage 1): the same, but without the owner's approval (refused, with the review).
  const cycleUnapproved = async (id: string) => {
    const state = (await pg.query("SELECT draft_state FROM recruitments WHERE id = $1", [id])).rows[0].draft_state as string;
    if (state === "PUBLISHED") await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
    await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
    const r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST"), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  const warns = (x: { data: J }) => (((x.data.review as J | undefined)?.warnings ?? []) as Array<{ code: string }>).map((w) => w.code);
  const cycle = async (id: string) => {
    const state = (await pg.query("SELECT draft_state FROM recruitments WHERE id = $1", [id])).rows[0].draft_state as string;
    if (state === "PUBLISHED") await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
    await approve.POST(req(`/api/admin/cms/records/${id}/approve`, "POST"), ctx(id));
    const r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST", await approved(id)), ctx(id));
    return { status: r.status, data: (await r.json()) as J };
  };
  const published = async (id: string) => (await pg.query("SELECT snapshot FROM published_recruitments WHERE recruitment_id = $1 ORDER BY published_at DESC LIMIT 1", [id])).rows[0]?.snapshot as J | undefined;

  // ── A ──
  section("A. refusals");
  const id = await importInto("NEW", null, [{ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: PDF, url: URL, attestation: `Downloaded from ${URL} (link-later test)` }]);
  await importInto("EXISTING", id, [{ declaredKind: "RESEARCH", method: "paste", text: `A coaching portal's summary of IBPS CRP TEST LINK LATER 2099. ${LINK_LINE}. ${SCHEDULE}.` }]);
  const research = await docOf(id, "RESEARCH");
  const before = await decisions();
  const tries = {
    wrongPage: await linkLater(id, { page: 1 }),
    portal: await linkLater(id, { retrievalId: research, page: undefined as never }),
    datesOnly: await linkLater(id, { quote: SCHEDULE, linkLater: { ...LATER, linkReleaseOn: null, applicationsOpenOn: "2099-12-03" } }),
    noStatement: await linkLater(id, { linkLater: { ...LATER, reviewerConfirmed: false } }),
    linkDateAsOpening: await linkLater(id, { linkLater: { ...LATER, applicationsOpenOn: "2099-12-01" } }),
    openingAsLinkDate: await linkLater(id, { linkLater: { ...LATER, linkReleaseOn: "2099-12-03" } }),
  };
  check("A1 the words cited with the wrong page: refused", /on page 2 of this PDF, not page 1/.test(tries.wrongPage), tries.wrongPage);
  check("A2 a research (portal) document: refused", /confirmed or attested|recruiting body's own/.test(tries.portal), tries.portal);
  check("A3 a schedule of dates only: refused, pointing to the normal route", /do not say the application link will be released later/.test(tries.datesOnly), tries.datesOnly);
  check("A4 without the reviewer's statement: refused", /Confirm the statement/.test(tries.noStatement), tries.noStatement);
  check("A5 the link's date as the opening date, and the reverse: refused", /not for applications opening/.test(tries.linkDateAsOpening) && /not for the link/.test(tries.openingAsLinkDate), tries);
  check("A6 nothing recorded by the refusals", (await decisions()) === before);

  // ── B ──
  section("B. a valid decision");
  const valid = await linkLater(id);
  const ap = await row(id, "links#APPLY_ONLINE");
  const claim = (await pg.query("SELECT value, page, quote, public_note FROM recruitment_field_claims WHERE kind = 'ADMIN_NOT_YET_OPEN' AND recruitment_id = $1", [id])).rows[0];
  check("B1 recorded on page 2 with the two dates kept apart and the place; no public note", valid === "accepted" && ap.cls === "NOT_YET_OPEN" && claim?.page === 2
    && claim.value.linkReleaseOn === "2099-12-01" && claim.value.applicationsOpenOn === "2099-12-03" && claim.value.where === "www.ibps.in" && claim.value.reviewerConfirmed === true && claim.public_note === null, { valid, cls: ap.cls, claim });
  const gate1 = await service.publishGateFor((await getRecruitmentById(id))!);
  check("B2 the Apply Online link no longer blocks; every other missing check still does", !gate1.blockers.some((b) => b.fieldPath === "links#APPLY_ONLINE") && !gate1.ok && gate1.blockers.length > 0,
    gate1.blockers.map((b) => b.fieldPath));
  const early = await cycleUnapproved(id);
  check("B3 without the owner's approval nothing is published; the review warns the other key details are missing",
    early.status === 422 && early.data.code === "OWNER_REVIEW_REQUIRED" && warns(early).includes("MISSING_KEY_DETAILS") && !(await published(id)), early);

  // The other checks, done properly: dates verified, the rest recorded with the notice's own words.
  const page1 = "Age Limit: as per the detailed rules of the participating banks";
  const done = [
    await patch(id, "dates.applicationCloseDate", "2099-12-23"), await patch(id, "dates.applicationOpenDate", "2099-12-03"),
    await decide(id, "dates.applicationCloseDate", "ADMIN_VERIFIED", { page: 2, quote: SCHEDULE }),
    await decide(id, "dates.applicationOpenDate", "ADMIN_VERIFIED", { page: 2, quote: SCHEDULE }),
    await decide(id, "age", "ADMIN_NOT_APPLICABLE", { page: 1, quote: page1, justification: "Age limits are set by each participating bank" }),
    await decide(id, "eligibility", "ADMIN_NOT_APPLICABLE", { page: 1, quote: "Educational Qualification: as per the detailed rules of the participating banks", justification: "Qualifications are set by each participating bank" }),
    await decide(id, "links#OFFICIAL_NOTIFICATION", "ADMIN_NOT_APPLICABLE", { page: 1, quote: "This notice is published on the official website of IBPS", justification: "Test: the notice's own address is the source itself" }),
    ...await Promise.all([]),
  ];
  for (const p of ["dates.feePaymentCloseDate", "vacancies.total", "financial.feeGeneral", "financial.feeSCST"]) {
    done.push(await decide(id, p, "ADMIN_NOT_STATED", { reviewScope: { whole_document: true }, justification: "Not given in this synthetic test notice" }));
  }
  const gate2 = await service.publishGateFor((await getRecruitmentById(id))!);
  check("B4 the other checks recorded through the existing decisions (verified, not applicable, not stated)", gate2.ok, { done, blockers: gate2.blockers.map((b) => [b.fieldPath, b.cls]) });

  // ── C ──
  section("C. published: the notice's words, never a link; Updates Needed");
  const pub1 = await cycle(id);
  const snap1 = await published(id);
  check("C1 published by hand; Telegram not asked (nothing posted)", pub1.status === 200 && pub1.data.announced === "not-asked", pub1);
  check("C2 the published copy carries what the notice announced and no Apply Online link",
    (snap1?.applyLinkLater as J | undefined)?.linkReleaseOn === "2099-12-01" && (snap1?.applyLinkLater as J).applicationsOpenOn === "2099-12-03" && (snap1?.applyLinkLater as J).where === "www.ibps.in"
    && !(snap1?.links as Array<{ type: string }>).some((l) => l.type === "APPLY_ONLINE"), snap1?.applyLinkLater);
  const job = snapshotToGovernmentRecruitment(snap1 as never);
  check("C3 the public job: no Apply Online address, the announcement kept for the page", job.links.apply === "" && job.applyLinkLater?.linkReleaseOn === "2099-12-01");
  const r1 = await reminder(id, "2099-11-30"), r2 = await reminder(id, "2099-12-01");
  check("C4 Updates Needed: SOON before the link's date, NOW from it", r1?.level === "SOON" && r2?.level === "NOW" && /due by 1 Dec 2099/.test(r2.message), { r1, r2 });
  const overview = await updatesOverview();
  check("C5 the job is in the Updates Needed list", overview.attention.some((j) => j.id === id && j.items.some((i) => i.code === "APPLY_LINK_PENDING")));

  // ── D ──
  section("D. withdrawn, re-recorded, link added, verified, republished");
  await service.revoke({ recruitmentId: id, adminId, fieldPath: "links#APPLY_ONLINE", decisionId: (await row(id, "links#APPLY_ONLINE")).decisionId! });
  const rw = await reminder(id, "2099-11-30");
  check("D1 withdrawn while the live page shows the wording: NOW, saying no decision supports it", rw?.level === "NOW" && /no decision supports it now/.test(rw.message), rw);
  // Editing a live job: it is opened as a draft first (the live page stays as it is until republished).
  const reverted = await revert.POST(req(`/api/admin/cms/records/${id}/revert`, "POST"), ctx(id));
  check("D2a the live job opened for editing (reverted to draft); the public copy stays", reverted.status === 200 && !!(await published(id)), reverted.status);
  check("D2 recorded again", (await linkLater(id)) === "accepted" && (await row(id, "links#APPLY_ONLINE")).cls === "NOT_YET_OPEN");
  const links = (await getRecruitmentById(id))!.links;
  check("D3 a link added by hand (not verified)", (await patch(id, "links", [...links, { type: "APPLY_ONLINE", label: "Apply Online", url: APPLY_URL, official: true }])) === 200);
  const added = await row(id, "links#APPLY_ONLINE");
  const ra = await reminder(id, "2099-11-30");
  check("D4 the decision lapses and the reminder stays: added but not verified", added.cls !== "NOT_YET_OPEN" && added.cls !== "VERIFIED" && /added but is not verified/.test(ra?.message ?? ""), { cls: added.cls, ra });
  check("D5 no new 'link not released' decision while a link is on the job", /has an Apply Online link/.test(await linkLater(id)));
  const blocked = await cycleUnapproved(id);
  check("D6 republishing needs the owner's approval; the review warns the Apply link is not checked",
    blocked.status === 422 && blocked.data.code === "OWNER_REVIEW_REQUIRED" && warns(blocked).includes("APPLY_NOT_CHECKED"), blocked);
  check("D7 the live page keeps the earlier copy (no link shown)", !((await published(id))?.links as Array<{ type: string }>).some((l) => l.type === "APPLY_ONLINE"));
  await importInto("EXISTING", id, [{ declaredKind: "OFFICIAL_PAGE", method: "paste", url: "https://www.ibps.in/crp-link-later-2099/", attestation: "Copied from the official page (link-later test)",
    text: `Institute of Banking Personnel Selection\nCRP TEST LINK LATER 2099: online registration is now open.\nApply online: ${APPLY_URL}` }]);
  const page = await docOf(id, "OFFICIAL_PAGE");
  const verified = await decide(id, "links#APPLY_ONLINE", "ADMIN_VERIFIED", { retrievalId: page, quote: `Apply online: ${APPLY_URL}` });
  const rv = await reminder(id, "2099-12-05");
  check("D8 the link verified against the official page; the reminder: republish to show it", verified === "accepted" && (await row(id, "links#APPLY_ONLINE")).cls === "VERIFIED"
    && /verified but the public page does not show it yet/.test(rv?.message ?? ""), { verified, rv });
  // Saving the whole links list reopened the other link's check too (existing rule): recorded again.
  const reNotice = await decide(id, "links#OFFICIAL_NOTIFICATION", "ADMIN_NOT_APPLICABLE", { page: 1, quote: "This notice is published on the official website of IBPS", justification: "Test: the notice's own address is the source itself" });
  check("D8a the official notification link's check, reopened by the links save, recorded again", reNotice === "accepted", reNotice);
  const pub2 = await cycle(id);
  const snap2 = await published(id);
  check("D9 republished: the verified link on the page, the announcement gone, the reminder cleared",
    pub2.status === 200 && (snap2?.links as Array<{ type: string; url: string }>).some((l) => l.type === "APPLY_ONLINE" && l.url === APPLY_URL) && !snap2?.applyLinkLater
    && (await reminder(id, "2099-12-05")) === null, { status: pub2.status, later: snap2?.applyLinkLater });

  // ── E ──
  section("E. the database refuses an incomplete row");
  const good = (await pg.query("SELECT * FROM recruitment_field_claims WHERE kind = 'ADMIN_NOT_YET_OPEN' ORDER BY seq DESC LIMIT 1")).rows[0];
  const insert = async (over: J) => {
    const r = { ...good, ...over };
    try {
      await pg.query(`INSERT INTO recruitment_field_claims (id, recruitment_id, field_path, kind, value, retrieval_id, page, quote, field_revision_id, justification, public_note, claimed_by)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [r.recruitment_id, r.field_path, r.kind, JSON.stringify(r.value), r.retrieval_id, r.page, r.quote, r.field_revision_id, r.justification, r.public_note, r.claimed_by]);
      return "accepted";
    } catch (e) { return (e as Error).message; }
  };
  const bad = {
    noStatement: await insert({ value: { ...good.value, reviewerConfirmed: false } }),
    noDateNoPlace: await insert({ value: { ...good.value, linkReleaseOn: null, where: null } }),
    shortReason: await insert({ justification: "short" }),
    publicNote: await insert({ public_note: "Applications soon" }),
    otherField: await insert({ field_path: "financial.feeGeneral" }),
  };
  check("E1 without the statement, without a date or place, a short reason, a public note, another field: all refused by the database",
    Object.values(bad).every((m) => m !== "accepted"), bad);
  const published2 = (await pg.query("SELECT count(*)::int AS n FROM published_recruitments")).rows[0].n;
  check("E2 only the local test job was published (the seed stays as it was)", published2 >= 1);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
