import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind class names safely with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats ISO date string to Indian format (e.g. "17 Aug 2026")
 */
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(dateString: string): string {
  if (!dateString) return "";
  // A plain calendar date is shown exactly as written, day first, with no
  // time-zone arithmetic. Built by hand so the server and every browser print
  // the same text.
  const plain = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(dateString);
  if (plain) {
    const month = MONTHS_SHORT[Number(plain[2]) - 1];
    if (month) return `${Number(plain[3])} ${month} ${plain[1]}`;
  }
  // Anything else ("December 2026", "Nov–Dec 2026") is left as written.
  // Parsing it would invent a day that the source never gave.
  return dateString;
}

/**
 * Month and day for a calendar badge ("AUG", "21"), read from the date as written, like formatDate: no time-zone
 * arithmetic, so a date-only value is the same day on the server and in every browser (west of UTC, new Date("2026-08-21")
 * falls on 20 Aug). { month: "TBA", day: "—" } when there is no readable date.
 */
export function dateBadgeParts(dateString: string | undefined): { month: string; day: string } {
  const plain = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(dateString ?? "");
  const month = plain ? MONTHS_SHORT[Number(plain[2]) - 1] : undefined;
  if (!plain || !month || Number.isNaN(Date.parse(`${plain[1]}-${plain[2]}-${plain[3]}T00:00:00Z`))) return { month: "TBA", day: "—" };
  return { month: month.toUpperCase(), day: String(Number(plain[3])) };
}

/**
 * Formats a number with Indian commas (e.g., 12500 -> "12,500")
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-IN").format(num);
}

/**
 * Formats currency values in INR (e.g., 56100 -> "₹56,100")
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Calculates remaining days from target ISO date string
 */
export function getDaysRemaining(targetDateStr: string): number | null {
  if (!targetDateStr) return null;
  const targetDate = new Date(targetDateStr);
  if (isNaN(targetDate.getTime())) return null;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);
  
  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}
