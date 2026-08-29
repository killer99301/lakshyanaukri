import React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "link";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#EA580C] disabled:opacity-50 disabled:pointer-events-none cursor-pointer";

    const variants = {
      primary:
        "bg-[#EA580C] text-white hover:bg-[#c2410c] active:bg-[#9a3412] shadow-sm shimmer-hover",
      secondary:
        "bg-[#F95738] text-white hover:bg-[#e04527] active:bg-[#c73418] shadow-sm shimmer-hover",
      outline:
        "border border-[#E2E8F0] bg-white text-[#0F172A] hover:bg-[#FFF7ED] hover:border-[#FED7AA] hover:text-[#EA580C]",
      ghost:
        "text-[#475569] hover:bg-slate-100 hover:text-[#0F172A]",
      link:
        "text-[#EA580C] underline-offset-4 hover:underline p-0 h-auto font-semibold",
    };

    const sizes = {
      sm: "h-8 px-3 text-xs font-medium rounded-md",
      md: "h-10 px-4 text-sm font-semibold rounded-lg",
      lg: "h-12 px-6 text-base font-semibold rounded-xl",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
