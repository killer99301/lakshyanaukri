// ═══════════════════════════════════════════════════════════
// O3: the form's rule for "I downloaded or copied this myself" is the
// server's own. Through the real import, on the in-memory test database:
// for every case, the server's standing for the document (attested,
// unconfirmed) and the form's verdict (nothing missing, or what is missing)
// must agree, so the form never lets through a declaration the server would
// quietly leave unconfirmed, nor stops one it would accept. The server's rule
// is unchanged: nothing here makes a document attested. No AI, no network.
//
//   npx tsx --tsconfig tsconfig.json tests/local-stack/o3-attestation.test.ts
// ═══════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { boot, check, expectChecks, section, summary, ORIGIN } from "./boot";
import { makePdf } from "./pdf-fixture";
import { attestationProblem } from "@/app/admin/cms/import/AttestationField";

type J = Record<string, unknown>;
const URL = "https://www.ibps.in/wp-content/uploads/CRP-O3.pdf";
const NOTICE = "Institute of Banking Personnel Selection\nCommon Recruitment Process O3\nLast date to apply online: 26.10.2093";
const CASES: Array<{ name: string; attestation?: string; url: string; server: "ATTESTED" | "UNCONFIRMED" }> = [
  { name: "no declaration", url: URL, server: "UNCONFIRMED" },
  { name: "a note of spaces only", attestation: "      ", url: URL, server: "UNCONFIRMED" },
  { name: "a note of 9 characters", attestation: "from site", url: URL, server: "UNCONFIRMED" },
  { name: "a note of 10 characters (spaces around it)", attestation: "  0123456789  ", url: URL, server: "ATTESTED" },
  { name: "a full note with the address", attestation: "Downloaded from ibps.in on 3 Nov 2026", url: URL, server: "ATTESTED" },
  { name: "a full note without an address", attestation: "Downloaded from ibps.in on 3 Nov 2026", url: "", server: "UNCONFIRMED" },
];

const S = { P: "P: pasted official text", U: "U: an uploaded official PDF", R: "R: research and the preview route" };
expectChecks(S.P, CASES.map((c) => `P ${c.name}: the server says ${c.server}, and the form agrees`));
expectChecks(S.U, CASES.map((c) => `U ${c.name}: the server says ${c.server}, and the form agrees`));
expectChecks(S.R, [
  "R1 research with a note stays research (not applicable), whatever the note",
  "R2 through the preview route, as the form sends it: a short note is answered unconfirmed, a full one attested",
]);

(async () => {
  const { token, adminId } = await boot();
  const service = await import("@/lib/cms/importer/service");
  const switchRoute = await import("@/app/api/admin/cms/import/switch/route");
  const previewRoute = await import("@/app/api/admin/cms/import/preview/route");
  const req = (path: string, method: string, body?: unknown) =>
    new NextRequest(`${ORIGIN}${path}`, { method, headers: { "content-type": "application/json", origin: ORIGIN, cookie: `admin_sid=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  await switchRoute.POST(req("/api/admin/cms/import/switch", "POST", { on: true, confirm: true }));
  let year = 2100;
  const standing = async (source: J) => {
    const p = await service.previewImport({ adminId, apiKey: undefined, mode: "NEW",
      newJob: { organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year++, title: "TEST RECORD O3", govType: "PSU" },
      sources: [source], fetchSourceFn: async () => ({ ok: false as const, error: "no network" }) } as never);
    return ((p.proposal as unknown as { meta: { sources: Array<{ authenticity: string }> } }).meta.sources[0]).authenticity;
  };
  const agree = (c: (typeof CASES)[number], server: string) => {
    const formOk = attestationProblem({ attest: c.attestation !== undefined, attestation: c.attestation ?? "", url: c.url }) === null;
    // A ticked declaration the form lets through is exactly one the server attests; no declaration is not ticked.
    return c.attestation === undefined ? server === "UNCONFIRMED" : formOk === (server === "ATTESTED");
  };

  section(S.P);
  for (const c of CASES) {
    const s = await standing({ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: NOTICE, url: c.url || undefined, ...(c.attestation !== undefined ? { attestation: c.attestation } : {}) });
    check(`P ${c.name}: the server says ${c.server}, and the form agrees`, s === c.server && agree(c, s), s);
  }

  section(S.U);
  const pdf = makePdf([NOTICE]);
  for (const c of CASES) {
    const s = await standing({ declaredKind: "OFFICIAL_NOTIFICATION", method: "upload", bytes: pdf, url: c.url || undefined, ...(c.attestation !== undefined ? { attestation: c.attestation } : {}) });
    check(`U ${c.name}: the server says ${c.server}, and the form agrees`, s === c.server && agree(c, s), s);
  }

  section(S.R);
  const research = await standing({ declaredKind: "RESEARCH", method: "paste", text: NOTICE, url: URL, attestation: "Downloaded from ibps.in on 3 Nov 2026" });
  check("R1 research with a note stays research (not applicable), whatever the note", research === "NOT_APPLICABLE", research);
  const viaRoute = async (attestation: string) => {
    const f = new FormData();
    f.set("mode", "NEW");
    f.set("newJob", JSON.stringify({ organizationId: "ibps", organizationName: "Institute of Banking Personnel Selection", recruitmentYear: year++, title: "TEST RECORD O3 route", govType: "PSU" }));
    f.set("sources", JSON.stringify([{ declaredKind: "OFFICIAL_NOTIFICATION", method: "paste", text: NOTICE, url: URL, attestation }]));
    const r = await previewRoute.POST(new NextRequest(`${ORIGIN}/api/admin/cms/import/preview`, { method: "POST", headers: { origin: ORIGIN, cookie: `admin_sid=${token}` }, body: f }));
    const d = (await r.json()) as { proposal?: { meta: { sources: Array<{ authenticity: string }> } } };
    return [r.status, d.proposal?.meta.sources[0].authenticity];
  };
  const [shortR, longR] = [await viaRoute("my copy"), await viaRoute("Downloaded from ibps.in on 3 Nov 2026")];
  check("R2 through the preview route, as the form sends it: a short note is answered unconfirmed, a full one attested",
    JSON.stringify(shortR) === JSON.stringify([201, "UNCONFIRMED"]) && JSON.stringify(longR) === JSON.stringify([201, "ATTESTED"]), [shortR, longR]);

  summary();
})().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
