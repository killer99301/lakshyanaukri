import React from "react";
import { ArrowRight, BookOpen, Calculator, Sun, CheckCircle2 } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

export interface EcosystemCardProps {
  partnerId: "cc2" | "calcinfinity" | "anantamarg";
  badgeText: string;
  title: string;
  subtitle?: string;
  description: string;
  ctaText: string;
  ctaUrl: string;
  features?: string[];
  isFeatured?: boolean;
  className?: string;
}

export const EcosystemCard: React.FC<EcosystemCardProps> = ({
  partnerId,
  badgeText,
  title,
  subtitle,
  description,
  ctaText,
  ctaUrl,
  features,
  className,
}) => {
  const getPartnerIcon = () => {
    switch (partnerId) {
      case "cc2":
        return <BookOpen className="h-4.5 w-4.5 text-[#EA580C]" />;
      case "calcinfinity":
        return <Calculator className="h-4.5 w-4.5 text-[#EA580C]" />;
      case "anantamarg":
        return <Sun className="h-4.5 w-4.5 text-[#EA580C]" />;
    }
  };

  return (
    <div className="group relative h-full">
      {/* Compact Chamfered Modern Geometric Card Silhouette */}
      <div
        className={`flex flex-col justify-between h-full bg-white border border-[#E2E8F0] group-hover:border-[#FED7AA] shadow-2xs group-hover:shadow-lg group-hover:shadow-orange-500/10 transition-all duration-300 group-hover:-translate-y-1.5 group-hover:scale-[1.01] p-4.5 sm:p-5 rounded-2xl ${className || ""}`}
        style={{
          clipPath: "polygon(14px 0%, calc(100% - 14px) 0%, 100% 14px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 14px 100%, 0% calc(100% - 14px), 0% 14px)",
        }}
      >
        <div className="space-y-3">
          {/* Header Badge + Partner Icon */}
          <div className="flex items-center justify-between">
            <div className="h-9 w-9 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center shadow-xs transition-all duration-300 group-hover:scale-110 group-hover:rotate-6 group-hover:border-[#EA580C]">
              {getPartnerIcon()}
            </div>
            <Badge variant="orange" size="sm" className="px-2 py-0.5 text-[11px] font-bold">
              {badgeText}
            </Badge>
          </div>

          {/* Title & Description */}
          <div className="space-y-1">
            <h3 className="text-base sm:text-lg font-extrabold text-[#0F172A] tracking-tight group-hover:text-[#EA580C] transition-colors leading-tight">
              {title}
            </h3>
            {subtitle && (
              <p className="text-[10px] font-bold text-[#EA580C] uppercase tracking-wider">
                {subtitle}
              </p>
            )}
            <p className="text-xs text-[#475569] leading-relaxed pt-0.5">
              {description}
            </p>
          </div>

          {/* Features Checklist */}
          {features && features.length > 0 && (
            <div className="space-y-1.5 pt-2.5 border-t border-slate-100 text-xs text-[#0F172A]">
              {features.map((feat, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#EA580C] shrink-0 mt-0.5" />
                  <span className="font-medium text-[#475569] text-xs">{feat}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CTA Button */}
        <div className="pt-3 mt-3 border-t border-slate-100">
          <a
            href={ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full"
          >
            <Button
              variant="primary"
              size="sm"
              className="w-full justify-between gap-2 shadow-xs rounded-xl font-bold py-2 text-xs group/btn"
            >
              <span>{ctaText}</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-1" />
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
};
