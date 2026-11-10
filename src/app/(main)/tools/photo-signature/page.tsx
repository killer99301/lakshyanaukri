import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PhotoSignatureTool, type ToolMode } from "@/components/tools/PhotoSignatureTool";

export const metadata: Metadata = {
  title: "Photo & Signature Resizer for Government Job Forms",
  description:
    "Resize your photo, signature, handwritten declaration or thumb impression to the exact size and KB limit your recruitment notice gives. Works in your browser; nothing is uploaded.",
  alternates: { canonical: "/tools/photo-signature" },
};

const MODES = new Set<ToolMode>(["photo", "signature", "declaration", "thumb"]);

export default async function PhotoSignaturePage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const asked = (await searchParams).mode;
  const mode = typeof asked === "string" && MODES.has(asked as ToolMode) ? (asked as ToolMode) : "photo";
  return (
    <div className="bg-[#F8FAFC] min-h-screen pb-16 pt-6">
      <div className="container mx-auto max-w-5xl px-4 space-y-6">
        <Link href="/tools" className="inline-flex items-center gap-1 text-xs font-bold text-[#475569] hover:text-[#EA580C]">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Application Tools
        </Link>
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#0F172A]">Photo &amp; Signature Resizer</h1>
          <p className="text-sm text-[#475569] max-w-2xl">
            Get your photo, signature, handwritten declaration or thumb impression to the size and file limit your notice asks for.
            Enter the values from the official notification of the recruitment you are applying for.
          </p>
        </header>
        <PhotoSignatureTool initialMode={mode} />
      </div>
    </div>
  );
}
