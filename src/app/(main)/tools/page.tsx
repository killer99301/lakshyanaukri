import type { Metadata } from "next";
import Link from "next/link";
import { Calculator, ChevronRight, FileCheck2, FileStack, ImageUp, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Application Tools for Government Job Forms",
  description:
    "Free tools to get your documents ready for government job and exam application forms: photo and signature resizer, and your age against each job's limit. Your files stay on your device.",
  alternates: { canonical: "/tools" },
};

type Tool = { title: string; description: string; href?: string; icon: React.ElementType; note?: string };

const TOOLS: Tool[] = [
  {
    title: "Photo & Signature",
    description: "Resize a photo, signature, handwritten declaration or thumb impression to the size and KB limit in your notice.",
    href: "/tools/photo-signature",
    icon: ImageUp,
  },
  {
    title: "Age & Eligibility",
    description: "Each job page checks your age against that job's own limits and relaxations. Or find every open job you can apply for.",
    href: "/eligibility",
    icon: Calculator,
  },
  {
    title: "PDF Utilities",
    description: "Merge, split and reduce the size of certificates and mark sheets.",
    icon: FileStack,
    note: "Coming soon",
  },
  {
    title: "Document Checker",
    description: "Check a file's dimensions, format and size against a form's upload rules.",
    icon: FileCheck2,
    note: "Coming soon",
  },
];

export default function ToolsPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen pb-16 pt-6">
      <div className="container mx-auto max-w-5xl px-4 space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#0F172A]">Application Tools</h1>
          <p className="text-sm text-[#475569] max-w-2xl">
            Free tools to get your documents ready for government job and examination forms.
          </p>
          <p className="flex items-center gap-1.5 text-xs text-[#475569]">
            <ShieldCheck className="h-3.5 w-3.5 text-green-600" aria-hidden /> Your files are processed in your browser and never uploaded.
          </p>
        </header>

        <ul className="grid gap-4 sm:grid-cols-2">
          {TOOLS.map((t) => {
            const body = (
              <>
                <div className="flex items-center gap-3">
                  <span className={t.href ? "p-2.5 rounded-xl bg-[#FFF7ED] text-[#EA580C]" : "p-2.5 rounded-xl bg-slate-100 text-slate-400"}><t.icon className="h-5 w-5" aria-hidden /></span>
                  <h2 className={t.href ? "text-base font-black text-[#0F172A]" : "text-base font-black text-[#475569]"}>{t.title}</h2>
                  {t.note && <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-[#475569] bg-slate-200/70 rounded-full px-2 py-0.5">{t.note}</span>}
                </div>
                <p className="mt-3 text-sm text-[#475569] leading-relaxed">{t.description}</p>
                {t.href
                  ? <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-[#EA580C]">Open <ChevronRight className="h-3.5 w-3.5" aria-hidden /></span>
                  : <span className="mt-4 block text-xs font-semibold text-[#64748B]">Not available yet. It will open here when it is ready.</span>}
              </>
            );
            return (
              <li key={t.title}>
                {t.href ? (
                  <Link href={t.href} className="block h-full bg-white border border-[#E2E8F0] rounded-3xl p-5 hover:border-[#FED7AA] hover:bg-[#FFF7ED]/40 transition-colors focus:outline-none focus:ring-2 focus:ring-[#FED7AA]">
                    {body}
                  </Link>
                ) : (
                  <div className="h-full bg-slate-50 border border-dashed border-slate-300 rounded-3xl p-5" aria-disabled="true" data-tool-coming-soon>{body}</div>
                )}
              </li>
            );
          })}
        </ul>

        <p className="text-xs text-[#64748B]">
          Sizes and limits differ from one recruitment to the next. Always use the values in the official notification of the job you are applying for.
        </p>
      </div>
    </div>
  );
}
