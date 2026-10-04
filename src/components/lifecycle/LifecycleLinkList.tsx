import React from "react";
import Link from "next/link";
import { ExternalLink, Trophy, FileBadge, KeyRound, ArrowRight } from "lucide-react";
import { OrganizationLogo } from "@/components/common/OrganizationLogo";
import { SectionHeading } from "../ui/SectionHeading";
import { Container } from "../ui/Container";
import { formatDate } from "@/lib/utils";
import type { LifecycleKind, LifecycleLink, LifecycleLinks } from "@/lib/cms/lifecycle-links";

const KIND_META: Record<LifecycleKind, { title: string; href: string; action: string; empty: string; icon: React.ReactNode }> = {
  result: {
    title: "Results",
    href: "/results",
    action: "View result",
    empty: "No results listed yet.",
    icon: <Trophy className="h-4 w-4" />,
  },
  admitCard: {
    title: "Admit Cards",
    href: "/admit-cards",
    action: "Get admit card",
    empty: "No admit cards listed yet.",
    icon: <FileBadge className="h-4 w-4" />,
  },
  answerKey: {
    title: "Answer Keys",
    href: "/answer-keys",
    action: "View answer key",
    empty: "No answer keys listed yet.",
    icon: <KeyRound className="h-4 w-4" />,
  },
};

/** One official link, with the job it belongs to. Used on the three listing pages. */
export function LifecycleLinkCard({ item }: { item: LifecycleLink }) {
  const meta = KIND_META[item.kind];
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-2xs space-y-4 h-full flex flex-col justify-between hover:border-[#FED7AA] transition-colors">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <OrganizationLogo organizationName={item.organization} size="md" />
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-black uppercase">
            Official link
          </span>
        </div>
        <div>
          <span className="text-[10px] font-black uppercase tracking-wider text-[#C2410C]">
            Updated {formatDate(item.updatedAtIso)}
          </span>
          <h3 className="text-sm font-bold text-[#0F172A] leading-snug mt-0.5">{item.label}</h3>
          <p className="text-xs text-[#475569] font-medium mt-1">{item.jobTitle}</p>
          <p className="text-[11px] text-slate-400 font-medium">{item.organization}</p>
        </div>
      </div>
      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs gap-2 flex-wrap">
        <Link href={`/jobs/${item.jobSlug}`} className="font-bold text-[#0F172A] hover:text-[#EA580C] hover:underline">
          Job details
        </Link>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-bold text-[#EA580C] hover:underline"
        >
          <span>{meta.action}</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

/** The list block for a listing page, with an honest empty state. */
export function LifecycleLinkGrid({ kind, items }: { kind: LifecycleKind; items: LifecycleLink[] }) {
  const meta = KIND_META[kind];
  if (items.length === 0) {
    return (
      <div className="bg-white border border-dashed border-[#FED7AA] rounded-2xl p-8 text-center space-y-2">
        <div className="h-11 w-11 mx-auto rounded-full bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#EA580C]">
          {meta.icon}
        </div>
        <h3 className="text-sm font-extrabold text-[#0F172A]">{meta.empty}</h3>
        <p className="text-xs text-[#475569] max-w-md mx-auto leading-relaxed">
          We list one only after its official link has been checked and added to the job. Until then, use the
          official portals below, or open a job to see its current stage.
        </p>
        <Link href="/jobs" className="inline-flex items-center gap-1 text-xs font-bold text-[#EA580C] hover:underline">
          <span>Browse jobs</span>
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <LifecycleLinkCard key={item.id} item={item} />
      ))}
    </div>
  );
}

/** Home page: the three lists side by side, three entries each. */
export function LifecycleHomeSection({ links }: { links: LifecycleLinks }) {
  const columns: Array<{ kind: LifecycleKind; items: LifecycleLink[] }> = [
    { kind: "result", items: links.results },
    { kind: "admitCard", items: links.admitCards },
    { kind: "answerKey", items: links.answerKeys },
  ];
  return (
    <section>
      <Container>
        <SectionHeading
          title="Results, Admit Cards & Answer Keys"
          subtitle="Official links, added to a job only after they have been checked."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mt-4">
          {columns.map(({ kind, items }) => {
            const meta = KIND_META[kind];
            return (
              <div key={kind} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-2xs flex flex-col">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#EA580C]">
                      {meta.icon}
                    </div>
                    <h3 className="text-sm font-extrabold text-[#0F172A]">{meta.title}</h3>
                  </div>
                  <Link href={meta.href} className="text-xs font-bold text-[#EA580C] hover:underline inline-flex items-center gap-1">
                    <span>View all</span>
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>

                {items.length === 0 ? (
                  <p className="text-xs text-[#475569] py-5 text-center leading-relaxed">
                    {meta.empty}
                    <br />
                    <span className="text-slate-400">They appear here as official links are added.</span>
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {items.slice(0, 3).map((item) => (
                      <li key={item.id} className="py-2.5">
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="group block">
                          <span className="text-xs font-bold text-[#0F172A] group-hover:text-[#EA580C] transition-colors flex items-start justify-between gap-2">
                            <span className="line-clamp-2">{item.label}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 mt-0.5 text-slate-400 group-hover:text-[#EA580C]" />
                          </span>
                        </a>
                        <Link href={`/jobs/${item.jobSlug}`} className="text-[11px] text-[#475569] hover:underline line-clamp-1 mt-0.5 block">
                          {item.jobTitle} · {formatDate(item.updatedAtIso)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
