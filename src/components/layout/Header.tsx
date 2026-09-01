import React from "react";
import Link from "next/link";
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
          <div className="h-9 w-9 rounded-lg bg-[#EA580C] flex items-center justify-center text-white shrink-0 transition-transform group-hover:scale-105 shadow-2xs">
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </div>
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
