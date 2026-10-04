import React from "react";
import Link from "next/link";
import { BrandMark } from "@/components/common/BrandMark";
import { Container } from "../ui/Container";
import { Button } from "../ui/Button";
import { MainNav } from "./MainNav";
import { MobileNav } from "./MobileNav";
import { ArrowRight } from "lucide-react";

export const Header: React.FC = () => {
  return (
    <header className="sticky top-0 z-40 w-full bg-white border-b border-[#E2E8F0] shadow-xs">
      <Container className="flex h-16 items-center justify-between">
        {/* Brand Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <BrandMark className="h-9 w-9 shrink-0 rounded-[10px] border border-[#FED7AA] transition-transform group-hover:scale-105 shadow-2xs" />
          <div className="flex flex-col">
            <span className="text-lg font-black tracking-tight text-[#0F172A] leading-tight">
              LAKSHYA<span className="text-[#EA580C]">NAUKRI</span>
            </span>
            <span className="text-[10px] font-medium text-[#475569] uppercase tracking-wider hidden sm:block">
              Opportunities & Exams
            </span>
          </div>
        </Link>

        {/* Desktop Main Navigation */}
        <MainNav />

        {/* Action Buttons & Mobile Toggle */}
        <div className="flex items-center space-x-3">
          <div className="hidden sm:flex items-center space-x-2">
            <Link href="/jobs">
              <Button variant="primary" size="sm" className="rounded-full px-4 text-xs font-bold gap-1 shadow-xs">
                <span>Explore Jobs</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>

          {/* Mobile Menu */}
          <MobileNav />
        </div>
      </Container>
    </header>
  );
};
