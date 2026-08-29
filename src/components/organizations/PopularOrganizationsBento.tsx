import React from "react";
import Link from "next/link";
import { POPULAR_ORGANIZATIONS } from "@/data/homepage";
import { SectionHeading } from "../ui/SectionHeading";
import { Container } from "../ui/Container";

export const PopularOrganizationsBento: React.FC = () => {
  return (
    <section className="bg-white py-10 border-y border-[#E2E8F0]">
      <Container>
        <SectionHeading
          title="Popular Organizations"
          subtitle="Direct shortcuts to major commissions, banking boards & tech recruiters."
          align="center"
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4 mt-6">
          {POPULAR_ORGANIZATIONS.map((org) => (
            <Link key={org.id} href={org.href} className="group block">
              <div className="bg-[#F7F6F3] border border-[#E2E8F0] rounded-2xl p-4 text-center space-y-2.5 hover:border-[#EA580C] hover:bg-[#FFF7ED]/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:ring-4 hover:ring-[#EA580C]/15">
                <div className="h-12 w-12 mx-auto rounded-2xl bg-gradient-to-br from-[#FFF7ED] to-white border border-[#FED7AA] flex items-center justify-center font-black text-sm text-[#EA580C] shadow-2xs group-hover:scale-110 transition-transform">
                  {org.name.slice(0, 2)}
                </div>
                <div>
                  <span className="text-xs font-extrabold text-[#0F172A] block group-hover:text-[#EA580C] transition-colors truncate">
                    {org.name}
                  </span>
                  <span className="text-[10px] font-medium text-[#475569] block truncate mt-0.5">
                    {org.fullName}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </Container>
    </section>
  );
};
