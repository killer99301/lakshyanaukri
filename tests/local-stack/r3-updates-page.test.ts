// ═══════════════════════════════════════════════════════════
// CMS 2.0 R3: the Latest updates archive on the in-memory test database, through the real publish and take-down
// routes and the real page modules. SYNTHETIC data only. Never touches production.
//   A. Published jobs' reviewed announcements appear; a draft job's and a links-only job's never do.
//   B. A taken-down job's announcements leave the archive with it; put back, they return.
//   C. The full page response: only public fields; superseded entries carry their correction, not their reason.
//   D. Search engines: canonical, robots on filtered views, the sitemap entry.
//   E. Category pages and the homepage: Previous sections and Important now from the same data.
//   npx tsx --tsconfig tsconfig.json tests/local-stack/r3-updates-page.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";
import { approved } from "./owner-approval";

const S = { A: "A: what the archive contains", B: "B: taken-down jobs", C: "C: privacy of the page", D: "D: search engines", E: "E: category pages and homepage" };
expectChecks(S.A, ["A1 a published job's announcements are listed, newest first", "A2 a draft job's and a links-only job's are not"]);
expectChecks(S.B, ["B1 taken down: its announcements leave the archive", "B2 put back: they return"]);
expectChecks(S.C, ["C1 no admin ID, supersede reason or internal field in the full page", "C2 the superseded entry shows its correction and links the correct notice"]);
expectChecks(S.D, ["D1 page 1 canonical to /updates, no robots rule", "D2 a page beyond the last: noindex, canonical to the last real page", "D3 a filtered view: noindex, follow", "D4 the sitemap lists /updates once, no filtered address"]);
expectChecks(S.E, ["E1 the admit card page lists the recorded admit card notices", "E2 the homepage passes Important now from published jobs only"]);

(async () => {
  const { pg, token, adminId } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN;
  const records = await import("@/app/api/admin/cms/records/route");
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  const approve = await import("@/app/api/admin/cms/records/[id]/approve/route");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const takeDown = await import("@/app/api/admin/cms/records/[id]/take-down/route");
  const putBack = await import("@/app/api/admin/cms/records/[id]/put-back/route");
  const { persistUpdatesNote, getRecruitmentById } = await import("@/lib/cms/repository");
  const updatesPage = await import("@/app/(main)/updates/page");
  const admitPage = await import("@/app/(main)/admit-cards/page");
  const sitemap = (await import("@/app/sitemap")).default;
  const SECRET = "R3-SECRET-SUPERSEDE-REASON";

  const req = (path: string, method: string, body?: unknown) => new NextRequest(`${ORIGIN}${path}`, {
    method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const manual = (value: unknown) => ({ value, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true });
  const quiet = <T,>(f: () => Promise<T>) => { const e = console.error; console.error = () => {}; return f().finally(() => { console.error = e; }); };

  async function makeJob(slugPart: string, title: string, announcements: unknown[] | null, publishIt: boolean) {
    const r = await records.POST(req("/api/admin/cms/records", "POST", { organizationId: `r3-${slugPart}`, organizationName: `Test R3 ${slugPart} Board`, govType: "Central Govt", title, recruitmentYear: 2097 }));
    const rec = (await r.json()).record;
    let rev = rec.recordRevision as string;
    for (const [fieldPath, value] of [
      ["dates.applicationCloseDate", "2097-01-31"],
      ["links", [{ type: "OFFICIAL_WEBSITE", label: "Board", url: `https://${slugPart}.example.gov.in/`, official: true }, { type: "ADMIT_CARD", label: "Admit card", url: `https://${slugPart}.example.gov.in/admit`, official: true }]],
      ["examStages", [{ name: "Tier-I", order: 1, status: "ADMIT_CARD_OUT", kind: "SELECTION", dateIso: "2099-12-10", certainty: "CONFIRMED" }]],
    ] as Array<[string, unknown]>) {
      const res = await fields.PATCH(req(`/api/admin/cms/records/${rec.id}/fields`, "PATCH", { fieldPath, field: manual(value), clientRevision: rev, reason: "r3 test" }), ctx(rec.id));
      rev = (await res.json()).record.recordRevision;
    }
    if (announcements) {
      const cur = (await getRecruitmentById(rec.id))!;
      await persistUpdatesNote(rec.id, cur.updates ?? [], announcements as never, adminId, "r3 test");
    }
    if (publishIt) {
      await approve.POST(req(`/api/admin/cms/records/${rec.id}/approve`, "POST"), ctx(rec.id));
      const p = await quiet(async () => publish.POST(req(`/api/admin/cms/records/${rec.id}/publish`, "POST", await approved(rec.id)), ctx(rec.id)));
      if (p.status !== 200) throw new Error(`setup: publish ${slugPart} → ${p.status}`);
    }
    return rec as { id: string; slug: string };
  }

  const A = await makeJob("alpha", "TEST R3 Alpha Exam 2097", [
    { id: "a-1", date: "2096-12-01", type: "RESCHEDULE", title: "Tier-I moved to 30 Dec", description: "Wrong date.", event: { kind: "EXAM_DATE", stage: "Tier-I" },
      superseded: { on: "2096-12-05", by: adminId, reason: SECRET, replacedBy: "a-2" } },
    { id: "a-2", date: "2096-12-05", type: "EXAM_NOTICE", title: "Tier-I date confirmed", description: "Tier-I is on 10 Dec 2099.", event: { kind: "EXAM_DATE", stage: "Tier-I" } },
    { id: "a-3", date: "2097-01-10", type: "EXAM_NOTICE", title: "Tier-I admit card released", description: "The admit card is out.", event: { kind: "ADMIT_CARD", stage: "Tier-I" }, action: "ADMIT_CARD" },
  ], true);
  const B = await makeJob("beta", "TEST R3 Beta Recruitment 2097", [
    { id: "b-1", date: "2097-01-08", type: "POSTPONEMENT", title: "Beta written test postponed", description: "New date awaited.", event: { kind: "POSTPONEMENT" } },
  ], true);
  await makeJob("draft", "TEST R3 Draft Only 2097", [{ id: "d-1", date: "2097-01-09", type: "EXAM_NOTICE", title: "Draft only notice", description: "Not public." }], false);
  await makeJob("links", "TEST R3 Links Only 2097", null, true);

  const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await updatesPage.default({ searchParams: Promise.resolve(params) }));
  const meta = (params: Record<string, string> = {}) => updatesPage.generateMetadata({ searchParams: Promise.resolve(params) });

  section(S.A);
  let html = await render();
  const order = ["Tier-I admit card released", "Beta written test postponed", "Tier-I date confirmed"].map((t) => html.indexOf(t));
  check("A1 a published job's announcements are listed, newest first",
    order.every((i) => i > 0) && /Current/.test(html) && html.indexOf("Beta written test postponed") < html.indexOf("Tier-I date confirmed"), order);
  check("A2 a draft job's and a links-only job's are not", !html.includes("Draft only notice") && !html.includes("TEST R3 Links Only 2097"));

  section(S.B);
  const td = await quiet(async () => takeDown.POST(req(`/api/admin/cms/records/${B.id}/take-down`, "POST", { reason: "r3 test: off the site" }), ctx(B.id)));
  html = await render();
  check("B1 taken down: its announcements leave the archive", td.status === 200 && !html.includes("Beta written test postponed"), td.status);
  const pb = await quiet(async () => putBack.POST(req(`/api/admin/cms/records/${B.id}/put-back`, "POST"), ctx(B.id)));
  html = await render();
  check("B2 put back: they return", pb.status === 200 && html.includes("Beta written test postponed"), pb.status);

  section(S.C);
  check("C1 no admin ID, supersede reason or internal field in the full page",
    !html.includes(adminId) && !html.includes(SECRET) && !/evidenceIds|manuallyEdited|"reason"/.test(html));
  check("C2 the superseded entry shows its correction and links the correct notice",
    /Tier-I moved to 30 Dec/.test(html) && /Superseded/.test(html) && /Correct notice: Tier-I date confirmed/.test(html) && !html.includes("Wrong date."));

  section(S.D);
  const m1 = await meta();
  check("D1 page 1 canonical to /updates, no robots rule", m1.alternates?.canonical === "/updates" && !m1.robots, m1.alternates);
  const m2 = await meta({ page: "2" });
  check("D2 a page beyond the last: noindex, canonical to the last real page",
    m2.alternates?.canonical === "/updates" && JSON.stringify(m2.robots) === JSON.stringify({ index: false, follow: true }), { a: m2.alternates, r: m2.robots });
  const m3 = await meta({ type: "admit-card" });
  check("D3 a filtered view: noindex, follow", JSON.stringify(m3.robots) === JSON.stringify({ index: false, follow: true }), m3.robots);
  const urls = (await sitemap()).map((u) => u.url);
  check("D4 the sitemap lists /updates once, no filtered address", urls.filter((u) => u.endsWith("/updates")).length === 1 && !urls.some((u) => u.includes("/updates?")), urls.filter((u) => u.includes("updates")));

  section(S.E);
  const admit = renderToStaticMarkup(await admitPage.default());
  check("E1 the admit card page lists the recorded admit card notices",
    /data-previous-updates="admit-card"/.test(admit) && admit.includes("Tier-I admit card released") && /href="\/updates\?type=admit-card"/.test(admit));
  const home = await import("@/app/(main)/page");
  const tree = await home.default() as { props: { importantNow: Array<{ title: string; job: { slug: string } }> } };
  const titles = tree.props.importantNow.map((e) => e.title);
  check("E2 the homepage passes Important now from published jobs only",
    titles[0] === "Beta written test postponed" && titles.includes("Tier-I admit card released") && !titles.includes("Draft only notice"), titles);

  void pg;
  summary();
})().catch((e) => { console.error(e); process.exit(1); });
