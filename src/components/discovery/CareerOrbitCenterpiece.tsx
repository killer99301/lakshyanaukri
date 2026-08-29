"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Building2,
  Landmark,
  Factory,
  CreditCard,
  BookOpen,
  Shield,
  Cpu,
  Grid,
  ArrowRight,
  GraduationCap,
  Award,
  Briefcase,
  UserCheck,
  Wrench,
  Stethoscope,
  Calculator,
  Compass,
} from "lucide-react";
import { SectionHeading } from "../ui/SectionHeading";
import { Container } from "../ui/Container";
import {
  EXPLORE_CATEGORIES,
  EXPLORE_STATES,
  EXPLORE_QUALIFICATIONS,
  EXPLORE_ROLES,
} from "@/data/homepage";
import { cn } from "@/lib/utils";

type TabType = "categories" | "states" | "qualifications" | "roles";

interface LineGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Staggered idle floating and ambient breathing timing configs per card index
const IDLE_ANIMATIONS = [
  { duration: "6.2s", delay: "0s", auraDuration: "7.5s" },
  { duration: "7.1s", delay: "0.8s", auraDuration: "8.2s" },
  { duration: "5.8s", delay: "1.5s", auraDuration: "6.9s" },
  { duration: "6.7s", delay: "2.3s", auraDuration: "7.8s" },
  { duration: "7.4s", delay: "0.4s", auraDuration: "8.0s" },
  { duration: "6.4s", delay: "1.2s", auraDuration: "7.1s" },
  { duration: "5.9s", delay: "1.9s", auraDuration: "6.8s" },
  { duration: "7.8s", delay: "2.7s", auraDuration: "8.5s" },
];

export const CareerOrbitCenterpiece: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>("categories");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isHubHovered, setIsHubHovered] = useState<boolean>(false);

  // DOM Refs for dynamic geometry calculations
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const hubRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  // State holding dynamically calculated SVG line geometries
  const [geometries, setGeometries] = useState<LineGeometry[]>([]);

  // Icon renderer for categories
  const renderCategoryIcon = (iconName: string) => {
    switch (iconName) {
      case "Building2":
        return <Building2 className="h-5 w-5 text-[#EA580C]" />;
      case "Landmark":
        return <Landmark className="h-5 w-5 text-[#EA580C]" />;
      case "Factory":
        return <Factory className="h-5 w-5 text-[#EA580C]" />;
      case "CreditCard":
        return <CreditCard className="h-5 w-5 text-[#EA580C]" />;
      case "BookOpen":
        return <BookOpen className="h-5 w-5 text-[#EA580C]" />;
      case "Shield":
        return <Shield className="h-5 w-5 text-[#EA580C]" />;
      case "Cpu":
        return <Cpu className="h-5 w-5 text-[#EA580C]" />;
      case "Grid":
        return <Grid className="h-5 w-5 text-[#EA580C]" />;
      default:
        return <Grid className="h-5 w-5 text-[#EA580C]" />;
    }
  };

  // Icon renderer for qualifications
  const renderQualificationIcon = (slug: string) => {
    switch (slug) {
      case "10th-pass":
      case "12th-pass":
        return <BookOpen className="h-5 w-5 text-[#EA580C]" />;
      case "iti":
      case "diploma":
        return <Wrench className="h-5 w-5 text-[#EA580C]" />;
      case "graduate":
      case "post-graduate":
        return <GraduationCap className="h-5 w-5 text-[#EA580C]" />;
      case "be-btech":
        return <Cpu className="h-5 w-5 text-[#EA580C]" />;
      case "mba":
      case "mca":
        return <Briefcase className="h-5 w-5 text-[#EA580C]" />;
      case "bed":
        return <Award className="h-5 w-5 text-[#EA580C]" />;
      default:
        return <GraduationCap className="h-5 w-5 text-[#EA580C]" />;
    }
  };

  // Icon renderer for job roles
  const renderRoleIcon = (slug: string) => {
    switch (slug) {
      case "teacher":
      case "professor":
        return <BookOpen className="h-5 w-5 text-[#EA580C]" />;
      case "engineer":
        return <Cpu className="h-5 w-5 text-[#EA580C]" />;
      case "clerk":
      case "accountant":
      case "stenographer":
        return <Calculator className="h-5 w-5 text-[#EA580C]" />;
      case "police":
        return <Shield className="h-5 w-5 text-[#EA580C]" />;
      case "nurse":
      case "doctor":
        return <Stethoscope className="h-5 w-5 text-[#EA580C]" />;
      case "apprentice":
        return <UserCheck className="h-5 w-5 text-[#EA580C]" />;
      default:
        return <Briefcase className="h-5 w-5 text-[#EA580C]" />;
    }
  };

  // Get active 8 items slice for dynamic orbit centerpiece
  const getActiveItems = () => {
    switch (activeTab) {
      case "categories":
        return EXPLORE_CATEGORIES.slice(0, 8).map((c) => ({
          id: c.id,
          label: c.label,
          subtitle: "Explore Category",
          href: c.href,
          icon: renderCategoryIcon(c.iconName),
        }));
      case "states":
        return EXPLORE_STATES.slice(0, 8).map((s) => ({
          id: s.id,
          label: s.label,
          subtitle: s.isAction ? "View All States" : "State Recruitment",
          href: s.href,
          icon: s.isAction ? (
            <ArrowRight className="h-5 w-5 text-[#EA580C]" />
          ) : (
            <div className="h-6 w-6 rounded-md bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center font-black text-xs text-[#EA580C]">
              {s.label.slice(0, 2).toUpperCase()}
            </div>
          ),
        }));
      case "qualifications":
        return EXPLORE_QUALIFICATIONS.slice(0, 8).map((q) => ({
          id: q.id,
          label: q.label,
          subtitle: "Eligibility Criteria",
          href: q.href,
          icon: renderQualificationIcon(q.slug),
        }));
      case "roles":
        return EXPLORE_ROLES.slice(0, 8).map((r) => ({
          id: r.id,
          label: r.label,
          subtitle: "Job Role",
          href: r.href,
          icon: renderRoleIcon(r.slug),
        }));
    }
  };

  const activeItems = getActiveItems();

  // Pure DOM Geometry Calculation Engine: calculates exact intersections using real DOM bounding rects
  const calculateGeometries = useCallback(() => {
    if (!svgRef.current || !hubRef.current) return;

    const svgRect = svgRef.current.getBoundingClientRect();
    const hubRect = hubRef.current.getBoundingClientRect();

    if (svgRect.width === 0 || svgRect.height === 0 || hubRect.width === 0) return;

    // Hub center relative to SVG canvas
    const hubCenterX = hubRect.left + hubRect.width / 2 - svgRect.left;
    const hubCenterY = hubRect.top + hubRect.height / 2 - svgRect.top;
    const hubRadius = hubRect.width / 2;

    const newGeometries: LineGeometry[] = [];

    cardRefs.current.forEach((cardEl) => {
      if (!cardEl) return;

      const cardRect = cardEl.getBoundingClientRect();

      // Card bounding box relative to SVG canvas
      const cardL = cardRect.left - svgRect.left;
      const cardR = cardRect.right - svgRect.left;
      const cardT = cardRect.top - svgRect.top;
      const cardB = cardRect.bottom - svgRect.top;

      const cardCenterX = (cardL + cardR) / 2;
      const cardCenterY = (cardT + cardB) / 2;

      const vx = hubCenterX - cardCenterX;
      const vy = hubCenterY - cardCenterY;

      let x1 = cardCenterX;
      let y1 = cardCenterY;

      // Ray / Card Rectangle Edge Intersection
      if (vx > 0) {
        // Card is to the left of hub -> ray hits card's RIGHT edge (cardR)
        x1 = cardR;
        y1 = cardCenterY + vy * ((cardR - cardCenterX) / vx);
        // Clamp Y to card vertical boundary
        y1 = Math.max(cardT + 4, Math.min(cardB - 4, y1));
      } else if (vx < 0) {
        // Card is to the right of hub -> ray hits card's LEFT edge (cardL)
        x1 = cardL;
        y1 = cardCenterY + vy * ((cardL - cardCenterX) / vx);
        // Clamp Y to card vertical boundary
        y1 = Math.max(cardT + 4, Math.min(cardB - 4, y1));
      }

      // Exact angle from Hub center to the calculated Card Edge point
      const angle = Math.atan2(y1 - hubCenterY, x1 - hubCenterX);

      // Hub Circumference Intersection Point
      const x2 = hubCenterX + hubRadius * Math.cos(angle);
      const y2 = hubCenterY + hubRadius * Math.sin(angle);

      newGeometries.push({ x1, y1, x2, y2 });
    });

    setGeometries(newGeometries);
  }, []);

  // Update geometry on mount, tab changes, window resize, and layout shifts
  useEffect(() => {
    const timer = setTimeout(calculateGeometries, 50);

    const handleResize = () => calculateGeometries();
    window.addEventListener("resize", handleResize);

    let observer: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => calculateGeometries());
      observer.observe(containerRef.current);
    }

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
      if (observer) observer.disconnect();
    };
  }, [calculateGeometries, activeTab]);

  return (
    <div
      ref={containerRef}
      className="bg-gradient-to-b from-[#F7F6F3] via-white to-[#F7F6F3] border-y border-[#E2E8F0] py-12 sm:py-16 relative overflow-hidden"
    >
      {/* Background Soft Atmospheric Ambient Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[650px] bg-[radial-gradient(circle,rgba(234,88,12,0.06)_0%,transparent_70%)] pointer-events-none" />

      <Container className="relative z-10">
        <SectionHeading
          title="Explore Opportunities"
          subtitle="Find your path in seconds through the LakshyaNaukri interactive career explorer."
          align="center"
        />

        {/* Segmented Control Switcher */}
        <div className="flex items-center justify-center mt-6 mb-10">
          <div className="bg-white p-1.5 rounded-2xl border border-[#E2E8F0] shadow-sm inline-flex items-center gap-1 max-w-full overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveTab("categories")}
              className={cn(
                "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 cursor-pointer shrink-0",
                activeTab === "categories"
                  ? "bg-[#FFF7ED] text-[#EA580C] shadow-2xs border border-[#FED7AA] shimmer-hover"
                  : "text-[#475569] hover:text-[#0F172A]"
              )}
            >
              Categories
            </button>
            <button
              onClick={() => setActiveTab("states")}
              className={cn(
                "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 cursor-pointer shrink-0",
                activeTab === "states"
                  ? "bg-[#FFF7ED] text-[#EA580C] shadow-2xs border border-[#FED7AA] shimmer-hover"
                  : "text-[#475569] hover:text-[#0F172A]"
              )}
            >
              States
            </button>
            <button
              onClick={() => setActiveTab("qualifications")}
              className={cn(
                "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 cursor-pointer shrink-0",
                activeTab === "qualifications"
                  ? "bg-[#FFF7ED] text-[#EA580C] shadow-2xs border border-[#FED7AA] shimmer-hover"
                  : "text-[#475569] hover:text-[#0F172A]"
              )}
            >
              Qualifications
            </button>
            <button
              onClick={() => setActiveTab("roles")}
              className={cn(
                "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all duration-200 cursor-pointer shrink-0",
                activeTab === "roles"
                  ? "bg-[#FFF7ED] text-[#EA580C] shadow-2xs border border-[#FED7AA] shimmer-hover"
                  : "text-[#475569] hover:text-[#0F172A]"
              )}
            >
              Job Roles
            </button>
          </div>
        </div>

        {/* Circular Hub + Orbiting Nodes Layout (Desktop Real-DOM SVG Geometry & Idle Motion) */}
        <div className="max-w-5xl mx-auto relative min-h-[480px]">
          {/* Real DOM SVG Connector Layer (Absolute inset-0, sits behind Hub & Cards) */}
          <svg
            ref={svgRef}
            className="hidden lg:block absolute inset-0 w-full h-full pointer-events-none z-0 overflow-visible"
          >
            {geometries.map((geom, idx) => {
              const isHovered = hoveredIndex === idx;
              const strokeColor = isHovered
                ? "#EA580C"
                : isHubHovered
                ? "#FED7AA"
                : "#E8EDF3";
              const strokeWidth = isHovered ? 2 : 1;
              const opacity = isHovered ? 1 : isHubHovered ? 0.85 : 0.4;

              return (
                <g key={idx}>
                  {/* Real DOM Line (Connects exactly card border -> hub circumference) */}
                  <line
                    x1={geom.x1}
                    y1={geom.y1}
                    x2={geom.x2}
                    y2={geom.y2}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    opacity={opacity}
                    className="transition-all duration-300"
                  />

                  {/* Active Travelling Pulse Particle on Hover (Moves card -> hub) */}
                  {isHovered && (
                    <circle
                      cx={geom.x1 * 0.4 + geom.x2 * 0.6}
                      cy={geom.y1 * 0.4 + geom.y2 * 0.6}
                      r="3.5"
                      fill="#EA580C"
                      className="animate-ping"
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* Dedicated Positioning Outer Wrapper (Locks Hub 100% Dead Center) */}
          <div className="hidden lg:flex absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none items-center justify-center">
            {/* Inner Hub Circle Element (Handles hover scaling, breathing & pointer events cleanly) */}
            <div
              ref={hubRef}
              onMouseEnter={() => setIsHubHovered(true)}
              onMouseLeave={() => setIsHubHovered(false)}
              className={cn(
                "h-48 w-48 rounded-full bg-white border-2 border-[#FED7AA] shadow-xl shadow-orange-500/10 flex flex-col items-center justify-center text-center p-4 cursor-pointer pointer-events-auto transition-transform duration-300 animate-hub-breathe",
                hoveredIndex !== null || isHubHovered
                  ? "border-[#EA580C] shadow-orange-500/20 scale-105"
                  : "hover:scale-105"
              )}
            >
              {/* Soft Atmospheric Aura Glow Behind Hub */}
              <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(234,88,12,0.12)_0%,transparent_70%)] pointer-events-none -z-10" />

              <div className="h-10 w-10 rounded-full bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#EA580C] mb-1.5 shadow-2xs group-hover:rotate-12 transition-transform">
                <Compass className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-black text-[#EA580C] uppercase tracking-wider block">
                CAREER HUB
              </span>
              <h4 className="text-sm font-extrabold text-[#0F172A] leading-tight mt-0.5">
                Explore Your <br /> Career Circle
              </h4>
            </div>
          </div>

          {/* Symmetrically Anchored Left & Right Card Columns */}
          <div className="hidden lg:flex justify-between items-center relative z-10 w-full">
            {/* Left Column (4 Nodes, Fixed 270px Symmetrical Width) */}
            <div className="space-y-3 w-[270px] shrink-0">
              {activeItems.slice(0, 4).map((item, idx) => {
                const isHovered = hoveredIndex === idx;
                const isOtherHovered =
                  (hoveredIndex !== null && !isHovered) || isHubHovered;
                const anim = IDLE_ANIMATIONS[idx];

                return (
                  <Link
                    key={item.id}
                    ref={(el) => {
                      cardRefs.current[idx] = el;
                    }}
                    href={item.href}
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    style={
                      isHovered
                        ? { animation: "none" }
                        : {
                            animation: `floatOrganic ${anim.duration} ease-in-out infinite ${anim.delay}, auraBreathe ${anim.auraDuration} ease-in-out infinite ${anim.delay}`,
                          }
                    }
                    className="block group"
                  >
                    <div
                      className={cn(
                        "bg-white border rounded-2xl p-3.5 transition-all duration-300 flex items-center gap-3",
                        isHovered
                          ? "border-[#EA580C] shadow-md shadow-orange-500/10 -translate-y-1 scale-[1.015]"
                          : isOtherHovered
                          ? "border-[#E2E8F0] opacity-80 shadow-xs"
                          : "border-[#E2E8F0] shadow-xs hover:border-[#FED7AA]"
                      )}
                    >
                      <div className="h-10 w-10 rounded-xl bg-[#FFF7ED] border border-[#FED7AA]/60 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
                        {item.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h5 className="text-xs sm:text-sm font-extrabold text-[#0F172A] group-hover:text-[#EA580C] transition-colors truncate">
                          {item.label}
                        </h5>
                        <span className="text-[10px] font-semibold text-[#475569] block truncate">
                          {item.subtitle}
                        </span>
                      </div>
                      <div className="text-[#EA580C] opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Right Column (4 Nodes, Fixed 270px Symmetrical Width) */}
            <div className="space-y-3 w-[270px] shrink-0">
              {activeItems.slice(4, 8).map((item, idx) => {
                const actualIdx = idx + 4;
                const isHovered = hoveredIndex === actualIdx;
                const isOtherHovered =
                  (hoveredIndex !== null && !isHovered) || isHubHovered;
                const anim = IDLE_ANIMATIONS[actualIdx];

                return (
                  <Link
                    key={item.id}
                    ref={(el) => {
                      cardRefs.current[actualIdx] = el;
                    }}
                    href={item.href}
                    onMouseEnter={() => setHoveredIndex(actualIdx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    style={
                      isHovered
                        ? { animation: "none" }
                        : {
                            animation: `floatOrganic ${anim.duration} ease-in-out infinite ${anim.delay}, auraBreathe ${anim.auraDuration} ease-in-out infinite ${anim.delay}`,
                          }
                    }
                    className="block group"
                  >
                    <div
                      className={cn(
                        "bg-white border rounded-2xl p-3.5 transition-all duration-300 flex items-center gap-3",
                        isHovered
                          ? "border-[#EA580C] shadow-md shadow-orange-500/10 -translate-y-1 scale-[1.015]"
                          : isOtherHovered
                          ? "border-[#E2E8F0] opacity-80 shadow-xs"
                          : "border-[#E2E8F0] shadow-xs hover:border-[#FED7AA]"
                      )}
                    >
                      <div className="h-10 w-10 rounded-xl bg-[#FFF7ED] border border-[#FED7AA]/60 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
                        {item.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h5 className="text-xs sm:text-sm font-extrabold text-[#0F172A] group-hover:text-[#EA580C] transition-colors truncate">
                          {item.label}
                        </h5>
                        <span className="text-[10px] font-semibold text-[#475569] block truncate">
                          {item.subtitle}
                        </span>
                      </div>
                      <div className="text-[#EA580C] opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Mobile & Tablet Bento Grid Layout */}
          <div className="lg:hidden grid grid-cols-2 sm:grid-cols-4 gap-3">
            {activeItems.map((item) => (
              <Link key={item.id} href={item.href} className="group block">
                <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3 shadow-2xs hover:border-[#FED7AA] hover:bg-[#FFF7ED]/40 transition-all duration-200 flex flex-col justify-between h-full space-y-2">
                  <div className="h-9 w-9 rounded-xl bg-[#FFF7ED] border border-[#FED7AA]/60 flex items-center justify-center shrink-0">
                    {item.icon}
                  </div>
                  <div>
                    <h5 className="text-xs font-extrabold text-[#0F172A] group-hover:text-[#EA580C] transition-colors truncate">
                      {item.label}
                    </h5>
                    <span className="text-[10px] font-medium text-[#475569] block truncate">
                      {item.subtitle}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </Container>
    </div>
  );
};
