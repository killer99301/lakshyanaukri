// ═══════════════════════════════════════════════════════════
// Smart intake corrections after the first live test, through the real preview, save, checks, review and
// publish on the in-memory test database. The AI's reply is a stand-in (no request leaves the machine).
//
//   - the notice number typed in the new-job form: saved, ticked or not; absent; an import into a job;
//   - the SBI Fire text read by code and by the (stand-in) AI: forms of one value are one value, a real
//     difference inside one source is kept as such, experience is read whole and shown publicly;
//   - publishing still needs no official document (owner-controlled), and Telegram is not asked.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/intake-corrections.test.ts
// ═══════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";

type J = Record<string, unknown>;
type Item = { id: string; fieldPath: string; kind: string; value: unknown; action: string; defaultTicked: boolean; conflict: boolean; conflictKind?: string; claims: Array<{ retrievalId: string }>; flags: string[] };

const SBI = readFileSync("tests/fixtures/paste/sbi-fire-2026-part-a.txt", "utf8");
const NUMBER = "CRPD/SCO/2026-27/29";
const POST = "Assistant Manager - Engineer (Fire)";
const EXPERIENCE = SBI.split("\n").find((l) => l.startsWith("Work Experience: "))!.slice("Work Experience: ".length).replace(/[.;]+$/, "").trim();
const line = (start: string) => SBI.split("\n").find((l) => l.startsWith(start))!;

// What the AI gave for this text in production, in the reply's own shape (formatting differs from the code's).
const AI_REPLY = {
  age: { min: 21, max: 40, asOf: "2026-10-31", quote: line("Age Limit:") },
  eligibility: [{ post: POST, qualifications: ["B.E. (Fire) from NFSC Nagpur", "B.E./B.Tech (Safety & Fire Engineering)", "B.E./B.Tech (Fire Technology & Safety Engineering)"],
    experience: [EXPERIENCE], quote: line("Qualification:") }],
  examPattern: [{ name: "Online Written Test", durationMinutes: 120, totalQuestions: 125, totalMarks: 125,
    sections: [{ subject: "English Language", questions: 50, marks: 50 }, { subject: "Professional Knowledge", questions: 75, marks: 75 }],
    note: "No penalty for wrong answers (no negative marking)", quote: line("Total: 125 Questions") }],
  howToApply: SBI.split("\n").filter((l) => /^\d\. /.test(l)).map((l) => ({ step: l.replace(/^\d\. /, ""), quote: l })),
};

const S = {
  N: "N: the notice number typed in the new-job form",
  P: "P: the SBI Fire text, read by code and by the AI (stand-in)",
  R: "R: saved, reviewed, public preview, published",
  O: "O: experience removed in the editor after saving",
};
expectChecks(S.N, [
  "N1 typed and its item ticked: saved, the job has the number",
  "N2 typed, its item left unticked: saved, the job still has the number typed",
  "N3 not typed: the read number is offered as a fill and saved",
  "N4 an import into a job that has the number: the matching item saves",
]);
expectChecks(S.P, [
  "P1 age, exam pattern and how to apply: one item each (forms of one value), claims of both readings kept",
  "P2 eligibility: the qualification split two ways is a real difference inside one source (READINGS), neither ticked",
  "P3 the code's eligibility keeps the experience whole, both pathways",
  "P4 the AI was asked once and no request left the machine",
]);
expectChecks(S.R, [
  "R1 saved with the number ticked",
  "R2 experience saved under the post",
  "R3 checks: no field reads as a disagreement between sources; eligibility reads as READINGS",
  "R4 the publication review lists only eligibility, as one source read two ways",
  "R5 the public preview shows the experience, whole, in “Qualification & Experience”",
  "R6 published without an official document after one acknowledgement; Telegram not asked; the audit records the acknowledgement",
]);

expectChecks(S.O, [
  "O1 the saved value without the experience reads as leaving out part of what the source says",
  "O2 the publication review lists it, with the saved value and what the source says",
  "O3 publishing without acknowledging it is refused",
  "O4 acknowledged: published, and the audit records the acknowledgement with its kind",
]);

(async () => {
  const { token, adminId, pg } = await boot();
  delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHANNEL_ID;
  const service = await import("@/lib/cms/importer/service");
  const { setImporterEnabled } = await import("@/lib/cms/importer/switch");
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { projectForPreview } = await import("@/lib/cms/projector");
  const { snapshotToGovernmentRecruitment } = await import("@/lib/cms/adapter");
  const publish = await import("@/app/api/admin/cms/records/[id]/publish/route");
  const reviewRoute = await import("@/app/api/admin/cms/records/[id]/publication-review/route");
  const checksRoute = await import("@/app/api/admin/cms/records/[id]/checks/route");
  await setImporterEnabled(true);
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  let aiCalls = 0;
  const standIn = (async (_u: unknown, init?: RequestInit) => {
    aiCalls++;
    const prompt = String(JSON.parse(String(init?.body ?? "{}")).contents?.[0]?.parts?.[0]?.text ?? "");
    const answer = prompt.includes('"vacancyRows"') ? AI_REPLY : {};
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const noAi = (async () => { throw new Error("no AI here"); }) as unknown as typeof fetch;
  let year = 2700;
  const preview = async (opts: { number?: string; ai?: boolean; recruitmentId?: string; text?: string }) => {
    const p = await service.previewImport({
      adminId, apiKey: opts.ai ? "stand-in-not-a-key" : undefined, fetchFn: opts.ai ? standIn : noAi, fetchSourceFn: async () => ({ ok: false as const, error: "no network" }),
      ...(opts.recruitmentId ? { mode: "EXISTING", recruitmentId: opts.recruitmentId }
        : { mode: "NEW", newJob: { organizationId: "sbi", organizationName: "State Bank of India", recruitmentYear: year++, title: "SBI Assistant Manager Engineer (Fire) Recruitment", govType: "PSU", ...(opts.number ? { notificationNumber: opts.number } : {}) } }),
      sources: [{ declaredKind: "RESEARCH", method: "paste", text: opts.text ?? SBI, prepared: true }],
    } as never);
    return { importId: p.importId, items: (p.proposal as unknown as { items: Item[] }).items };
  };
  const apply = (importId: string, selected: string[]) => service.applyImportFlow({ importId, adminId, selected, confirmReplaceVerified: false, override: { reason: "local intake-corrections test" } });
  const numberOf = async (id: string) => (await getRecruitmentById(id))?.identity.notificationNumber?.value ?? null;
  const ticked = (items: Item[], drop?: (i: Item) => boolean) => items.filter((i) => i.defaultTicked && !(drop?.(i))).map((i) => i.id);

  section(S.N);
  let p = await preview({ number: NUMBER });
  const n1 = p.items.find((i) => i.fieldPath === "identity.notificationNumber");
  const r1 = await apply(p.importId, [...ticked(p.items), ...(n1 && !n1.defaultTicked ? [n1.id] : [])]).then((r) => r, (e) => e as Error);
  check("N1 typed and its item ticked: saved, the job has the number", n1?.action === "MATCHES" && "recruitmentId" in r1 && await numberOf((r1 as { recruitmentId: string }).recruitmentId) === NUMBER,
    [n1?.action, (r1 as { code?: string }).code]);
  p = await preview({ number: NUMBER });
  const r2 = await apply(p.importId, ticked(p.items, (i) => i.fieldPath === "identity.notificationNumber"));
  check("N2 typed, its item left unticked: saved, the job still has the number typed", await numberOf(r2.recruitmentId) === NUMBER);
  p = await preview({});
  const n3 = p.items.find((i) => i.fieldPath === "identity.notificationNumber");
  const r3 = await apply(p.importId, ticked(p.items));
  check("N3 not typed: the read number is offered as a fill and saved", n3?.action === "FILL" && n3.defaultTicked && await numberOf(r3.recruitmentId) === NUMBER, n3?.action);
  p = await preview({ recruitmentId: r3.recruitmentId });
  const n4 = p.items.find((i) => i.fieldPath === "identity.notificationNumber");
  const r4 = await apply(p.importId, ticked(p.items)).then((r) => r, (e) => e as Error);
  check("N4 an import into a job that has the number: the matching item saves", n4?.action === "MATCHES" && "recruitmentId" in r4 && await numberOf(r3.recruitmentId) === NUMBER, [n4?.action, (r4 as Error).message]);

  section(S.P);
  aiCalls = 0;
  p = await preview({ number: NUMBER, ai: true });
  const one = (f: string) => p.items.filter((i) => i.fieldPath === f);
  check("P1 age, exam pattern and how to apply: one item each (forms of one value), claims of both readings kept",
    ["age", "examPattern", "howToApply"].every((f) => one(f).length === 1 && !one(f)[0].conflict && one(f)[0].claims.length >= 2),
    ["age", "examPattern", "howToApply"].map((f) => [f, one(f).length, one(f)[0]?.conflict, one(f)[0]?.claims.length]));
  const elig = one("eligibility");
  check("P2 eligibility: the qualification split two ways is a real difference inside one source (READINGS), neither ticked",
    elig.length === 2 && elig.every((i) => i.conflict && i.conflictKind === "READINGS" && !i.defaultTicked), elig.map((i) => [i.conflict, i.conflictKind, i.defaultTicked]));
  const codeElig = elig.find((i) => i.flags.some((f) => /read by code/.test(f)))!;
  const exp = (codeElig?.value as Array<{ experience?: string[] }>)?.[0]?.experience;
  check("P3 the code's eligibility keeps the experience whole, both pathways", exp?.length === 1 && exp[0] === EXPERIENCE && exp[0].includes("OR minimum 3 years"), exp);
  check("P4 the AI was asked once and no request left the machine", aiCalls >= 1, aiCalls);

  section(S.R);
  const nItem = p.items.find((i) => i.fieldPath === "identity.notificationNumber")!;
  const sel = [...ticked(p.items, (i) => i.fieldPath === "financial.feeSCST"), codeElig.id, ...(nItem.defaultTicked ? [] : [nItem.id])];
  const saved = await apply(p.importId, sel).then((r) => r, (e) => e as Error);
  const id = (saved as { recruitmentId: string }).recruitmentId;
  check("R1 saved with the number ticked", !!id && await numberOf(id) === NUMBER, (saved as Error).message);
  const job = (await getRecruitmentById(id))!;
  const posts = job.eligibility?.value as Array<{ post: string; experience?: string[] }>;
  check("R2 experience saved under the post", posts?.[0]?.post === POST && posts[0].experience?.[0] === EXPERIENCE, posts);
  const rows = (await (await checksRoute.GET(req(`/api/admin/cms/records/${id}/checks`, "GET"), ctx(id))).json()).rows as Array<{ fieldPath: string; cls: string }>;
  const conflicting = rows.filter((r) => r.cls === "CONFLICTING").map((r) => r.fieldPath);
  const v = (await (await reviewRoute.GET(req(`/api/admin/cms/records/${id}/publication-review`, "GET"), ctx(id))).json()).review as
    { reviewHash: string; freshness: J; conflicts: Array<{ fieldPath: string; kind: string }> };
  check("R3 checks: no field reads as a disagreement between sources; eligibility reads as READINGS",
    JSON.stringify(conflicting) === JSON.stringify(["eligibility"]) && v.conflicts.every((c) => c.kind === "READINGS"), [conflicting, v.conflicts]);
  check("R4 the publication review lists only eligibility, as one source read two ways",
    v.conflicts.length === 1 && v.conflicts[0].fieldPath === "eligibility" && v.conflicts[0].kind === "READINGS", v.conflicts);
  const pub = snapshotToGovernmentRecruitment(projectForPreview(job)) as unknown as { eligibility?: string[] };
  check("R5 the public preview shows the experience, whole, in “Qualification & Experience”",
    !!pub.eligibility?.includes(`Experience: ${EXPERIENCE}`), pub.eligibility);
  const r = await publish.POST(req(`/api/admin/cms/records/${id}/publish`, "POST",
    { approveFirst: true, ownerApproval: { acknowledged: true, reviewHash: v.reviewHash, ...v.freshness, conflictsAcknowledged: ["eligibility"] } }), ctx(id));
  const d = (await r.json()) as J;
  const audit = (await pg.query("SELECT metadata FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = 'OWNER_PUBLICATION_APPROVAL'", [id])).rows[0]?.metadata as J | undefined;
  check("R6 published without an official document after one acknowledgement; Telegram not asked; the audit records the acknowledgement",
    r.status === 200 && d.announced !== "sent" && audit?.telegram === false
    && JSON.stringify((audit?.conflicts as Array<{ fieldPath: string; action: string }>)?.map((c) => [c.fieldPath, c.action])) === JSON.stringify([["eligibility", "ACKNOWLEDGED"]]),
    [r.status, d.error, audit?.conflicts]);

  section(S.O);
  const fields = await import("@/app/api/admin/cms/records/[id]/fields/route");
  p = await preview({ number: NUMBER });
  const o = await apply(p.importId, ticked(p.items));
  const oid = o.recruitmentId;
  const rev = async () => (await pg.query("SELECT record_revision FROM recruitments WHERE id = $1", [oid])).rows[0].record_revision as string;
  const qualOnly = ((await getRecruitmentById(oid))!.eligibility!.value as Array<{ post: string; qualification?: string[] }>).map((x) => ({ post: x.post, qualification: x.qualification }));
  const patched = await fields.PATCH(req(`/api/admin/cms/records/${oid}/fields`, "PATCH", { fieldPath: "eligibility",
    field: { value: qualOnly, status: "PENDING", evidenceIds: [], conflict: false, manuallyEdited: true }, clientRevision: await rev(), reason: "editor removed the experience (test)" }), ctx(oid));
  const orows = (await (await checksRoute.GET(req(`/api/admin/cms/records/${oid}/checks`, "GET"), ctx(oid))).json()).rows as Array<{ fieldPath: string; cls: string; reason: string }>;
  const oel = orows.find((x) => x.fieldPath === "eligibility");
  check("O1 the saved value without the experience reads as leaving out part of what the source says",
    patched.status === 200 && oel?.cls === "CONFLICTING" && /leaves out part of what the source says/.test(oel.reason), [patched.status, oel]);
  const ov = (await (await reviewRoute.GET(req(`/api/admin/cms/records/${oid}/publication-review`, "GET"), ctx(oid))).json()).review as
    { reviewHash: string; freshness: J; conflicts: Array<{ fieldPath: string; kind: string; values: string[] }> };
  const oc = ov.conflicts.find((c) => c.fieldPath === "eligibility");
  check("O2 the publication review lists it, with the saved value and what the source says",
    oc?.kind === "OMITTED" && oc.values[0].startsWith("Saved: ") && !oc.values[0].includes("Station Officer") && oc.values.some((x) => x.startsWith("Source says: ") && x.includes("Station Officer")), oc);
  const body = (acks: string[]) => ({ approveFirst: true, ownerApproval: { acknowledged: true, reviewHash: ov.reviewHash, ...ov.freshness, conflictsAcknowledged: acks } });
  const others = ov.conflicts.map((c) => c.fieldPath).filter((f) => f !== "eligibility");
  const refused = await publish.POST(req(`/api/admin/cms/records/${oid}/publish`, "POST", body(others)), ctx(oid));
  const rd = (await refused.json()) as J;
  check("O3 publishing without acknowledging it is refused", refused.status === 422 && rd.code === "CONFLICT_NOT_ACKNOWLEDGED" && JSON.stringify(rd.fieldPaths) === JSON.stringify(["eligibility"]), [refused.status, rd.code, rd.fieldPaths]);
  const ok = await publish.POST(req(`/api/admin/cms/records/${oid}/publish`, "POST", body(ov.conflicts.map((c) => c.fieldPath))), ctx(oid));
  const oaudit = (await pg.query("SELECT metadata FROM recruitment_audit_events WHERE recruitment_id = $1 AND event_type = 'OWNER_PUBLICATION_APPROVAL'", [oid])).rows[0]?.metadata as J | undefined;
  const ack = (oaudit?.conflicts as Array<{ fieldPath: string; kind: string; action: string; values: string[] }> | undefined)?.find((c) => c.fieldPath === "eligibility");
  check("O4 acknowledged: published, and the audit records the acknowledgement with its kind",
    ok.status === 200 && ack?.kind === "OMITTED" && ack.action === "ACKNOWLEDGED" && ack.values.length >= 2, [ok.status, ack]);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
