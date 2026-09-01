import React from "react";
import Link from "next/link";
import { Mail, Heart } from "lucide-react";
import { Container } from "../ui/Container";
import { siteConfig } from "@/config/site";

export const Footer: React.FC = () => {
  return (
    <footer className="bg-white border-t border-[#E2E8F0] pt-12 pb-8 mt-auto text-sm text-[#475569]">
      <Container>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-12 pb-10 border-b border-[#E2E8F0]">
          {/* Brand Column */}
          <div className="lg:col-span-2 space-y-4">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-[#EA580C] flex items-center justify-center text-white shrink-0">
                <svg
                  className="h-4.5 w-4.5"
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
              <span className="text-lg font-black tracking-tight text-[#0F172A]">
                LAKSHYA<span className="text-[#EA580C]">NAUKRI</span>
              </span>
            </Link>
            <p className="text-xs sm:text-sm text-[#475569] leading-relaxed max-w-sm">
              Your trusted partner for finding career opportunities, government recruitment updates, competitive exam guides, and smart preparation tools.
            </p>
          </div>

          {/* Column 1: Explore */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-[#0F172A] uppercase tracking-wider">
              Explore
            </h3>
            <ul className="space-y-2 text-xs sm:text-sm">
              <li>
                <Link href="/jobs?category=government" className="hover:text-[#EA580C] transition-colors">
                  Government Jobs
                </Link>
              </li>
              <li>
                <Link href="/jobs?category=state-psc" className="hover:text-[#EA580C] transition-colors">
                  State PSC Jobs
                </Link>
              </li>
              <li>
                <Link href="/jobs?category=banking" className="hover:text-[#EA580C] transition-colors">
                  Banking & Finance
                </Link>
              </li>
              <li>
                <Link href="/jobs?category=railway" className="hover:text-[#EA580C] transition-colors">
                  Railway Recruitments
                </Link>
              </li>
              <li>
                <Link href="/exams" className="hover:text-[#EA580C] transition-colors">
                  Exams Directory
                </Link>
              </li>
              <li>
                <Link href="/companies" className="hover:text-[#EA580C] transition-colors">
                  Recruiting Boards
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 2: Portals & Ecosystem */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-[#0F172A] uppercase tracking-wider">
              Portals & Tools
            </h3>
            <ul className="space-y-2 text-xs sm:text-sm">
              <li>
                <Link href="/results" className="hover:text-[#EA580C] transition-colors">
                  Exam Results Portal
                </Link>
              </li>
              <li>
                <Link href="/admit-cards" className="hover:text-[#EA580C] transition-colors">
                  Admit Cards & Hall Tickets
                </Link>
              </li>
              <li>
                <Link href="/answer-keys" className="hover:text-[#EA580C] transition-colors">
                  Answer Keys & Response Sheets
                </Link>
              </li>
              <li>
                <a
                  href={siteConfig.ecosystem.careerCampus2.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#EA580C] transition-colors flex items-center gap-1"
                >
                  <span>Career Campus 2</span>
                  <span className="text-[10px] bg-[#FFF7ED] text-[#EA580C] px-1.5 py-0.5 rounded font-semibold">Prep</span>
                </a>
              </li>
              <li>
                <a
                  href={siteConfig.ecosystem.calcInfinity.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#EA580C] transition-colors flex items-center gap-1"
                >
                  <span>CalcInfinity</span>
                  <span className="text-[10px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-semibold">Tools</span>
                </a>
              </li>
              <li>
                <a
                  href={siteConfig.ecosystem.anantamarg.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#EA580C] transition-colors flex items-center gap-1"
                >
                  <span>Anantamarg</span>
                  <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-semibold">Muhurat</span>
                </a>
              </li>
            </ul>
          </div>

          {/* Column 3: Contact */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-[#0F172A] uppercase tracking-wider">
              Contact Us
            </h3>
            <ul className="space-y-2.5 text-xs sm:text-sm">
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-[#EA580C] shrink-0" />
                <a href={`mailto:${siteConfig.contact.email}`} className="hover:text-[#EA580C]">
                  {siteConfig.contact.email}
                </a>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#EA580C] shrink-0 mt-0.5">📍</span>
                <span>Patna, Bihar, India</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Copyright Bar */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#475569]">
          <p>© {new Date().getFullYear()} LakshyaNaukri. All rights reserved.</p>
          <div className="flex items-center space-x-4">
            <Link href="/privacy" className="hover:text-[#EA580C]">
              Privacy Policy
            </Link>
            <span>•</span>
            <Link href="/terms" className="hover:text-[#EA580C]">
              Terms of Service
            </Link>
            <span>•</span>
            <span className="flex items-center gap-1 font-medium text-[#0F172A]">
              Made with <Heart className="h-3.5 w-3.5 text-red-500 fill-red-500" /> in India
            </span>
          </div>
        </div>
      </Container>
    </footer>
  );
};
