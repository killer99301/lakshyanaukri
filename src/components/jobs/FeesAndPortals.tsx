// U5 (CMS 2.0, Nov 2026): what the Unified Update can save, now shown to applicants exactly as saved.
//   - FeeTableView: the notice's fees category by category, post by post, exemptions written out.
//   - ApplyPortals: every Apply Online portal, with who each is for. Live "Apply" buttons only while applications
//     are open; once closed, each portal is kept as information (its site named, not linked as an action).
// Both render only when the job has that information; every other page is unchanged.
import React from "react";
import { ExternalLink, Lock } from "lucide-react";
import { formatDate } from "@/lib/utils";

type FeeRow = { category: string; amount: number; exempt?: boolean; post?: string; note?: string };

const feeText = (r: FeeRow) => (r.exempt || r.amount === 0 ? "No fee (exempt)" : `₹${r.amount.toLocaleString("en-IN")}`);

export function FeeTableView({ rows, overlaps }: { rows: FeeRow[]; overlaps?: string[] }) {
  // Rows for every post first, then one group per post, in the order the notice gives them.
  const groups: Array<{ post: string | null; rows: FeeRow[] }> = [];
  for (const r of rows) {
    const post = r.post ?? null;
    const g = groups.find((x) => x.post === post) ?? (groups.push({ post, rows: [] }), groups[groups.length - 1]);
    g.rows.push(r);
  }
  groups.sort((a, b) => Number(a.post !== null) - Number(b.post !== null));
  const postWise = groups.some((g) => g.post);
  return (
    <div data-fee-table className="space-y-4">
      {overlaps && overlaps.length > 0 && (
        <div data-fee-overlap role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <span className="font-bold">Check the notice:</span> it gives more than one fee for the same candidates ({overlaps.join("; ")}). Which applies to you depends on the notice.
        </div>
      )}
      {groups.map((g) => (
        <div key={g.post ?? "all"} className="space-y-2">
          {postWise && (
            <h3 data-fee-post className="text-sm font-black text-[#0F172A]">{g.post ? `For ${g.post}` : "For all posts"}</h3>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-50 text-[#475569] border-b border-slate-200">
                  <th scope="col" className="py-3 px-4 font-extrabold">Category</th>
                  <th scope="col" className="py-3 px-4 font-extrabold text-right whitespace-nowrap">Fee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {g.rows.map((r, i) => (
                  <tr key={i} className="text-[#0F172A]">
                    <td className="py-3 px-4 font-bold align-top">
                      {r.category}
                      {r.note && <span className="block text-xs font-semibold text-[#475569] mt-0.5">{r.note}</span>}
                    </td>
                    <td className={`py-3 px-4 text-right align-top whitespace-nowrap font-black ${r.exempt || r.amount === 0 ? "text-[#0F7A43]" : "text-[#C2410C]"}`}>{feeText(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="text-xs font-semibold text-[#475569]">As given in the notice. A category not listed here is not covered by this table: check the notice.</p>
    </div>
  );
}

export type PortalState = "OPEN" | "UPCOMING" | "CLOSED";

export function ApplyPortals({ portals, state, opensOn }: {
  portals: Array<{ label: string; url: string; host: string | null; appliesTo?: string }>;
  state: PortalState;
  opensOn?: string;
}) {
  return (
    <div id="apply-portals" data-apply-portals={state.toLowerCase()} className="space-y-2.5 scroll-mt-24">
      <h3 className="text-sm font-black text-[#0F172A]">
        {state === "CLOSED" ? "Where applications were taken" : portals.length > 1 ? `Where to apply: ${portals.length} portals` : "Where to apply"}
      </h3>
      {state === "CLOSED" && <p className="text-xs font-semibold text-[#475569]">Applications are closed. The portals are listed for reference only.</p>}
      {state === "UPCOMING" && <p className="text-xs font-semibold text-[#475569]">Applications open{opensOn ? ` on ${formatDate(opensOn)}` : " later"}. Use the portal for your post when they open.</p>}
      <ul className="space-y-2">
        {portals.map((p) => (
          <li key={p.url} data-apply-portal className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="min-w-0">
              <div className="text-sm font-bold text-[#0F172A] break-words">{p.label}</div>
              <div data-portal-for className="text-xs font-semibold text-[#334155]">
                {p.appliesTo ? `For: ${p.appliesTo}` : "Who it is for is not stated here: check the notice"}
              </div>
              {p.host && <div className="text-xs text-[#64748B]">{p.host}</div>}
            </div>
            {state === "OPEN" ? (
              <a data-portal-action href={p.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl bg-[#EA580C] text-white font-bold text-sm w-full sm:w-auto shrink-0">
                Apply <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : (
              <span data-portal-closed className="inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl bg-slate-100 text-slate-500 border border-slate-200 font-bold text-sm w-full sm:w-auto shrink-0">
                <Lock className="h-4 w-4" aria-hidden="true" /> {state === "CLOSED" ? "Closed" : "Not open yet"}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
