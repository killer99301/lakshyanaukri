import React from "react";
import Link from "next/link";
import { ChevronRight, Share2, Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  showActions?: boolean;
  onShare?: () => void;
  onSave?: () => void;
  className?: string;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  items,
  showActions = false,
  onShare,
  onSave,
  className,
}) => {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 py-3 text-xs text-[#475569]",
        className
      )}
    >
      <nav aria-label="Breadcrumb" className="flex items-center space-x-1 sm:space-x-2 flex-wrap">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <React.Fragment key={index}>
              {index > 0 && (
                <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0 mx-0.5" />
              )}
              {isLast || !item.href ? (
                <span className="font-semibold text-[#0F172A] truncate max-w-[220px] sm:max-w-xs">
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="hover:text-[#EA580C] transition-colors truncate max-w-[150px] sm:max-w-none"
                >
                  {item.label}
                </Link>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      {showActions && (
        <div className="flex items-center space-x-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onShare}
            className="h-7 px-2.5 text-xs text-[#475569] gap-1.5"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span>Share</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSave}
            className="h-7 px-2.5 text-xs text-[#475569] gap-1.5"
          >
            <Bookmark className="h-3.5 w-3.5" />
            <span>Save Job</span>
          </Button>
        </div>
      )}
    </div>
  );
};
