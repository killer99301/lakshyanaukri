"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark } from "@/components/common/BrandMark";

const NAV = [
  { href: "/admin/cms",          label: "Jobs",         hint: "Create, edit and publish job records" },
  { href: "/admin/library",      label: "Syllabus",     hint: "Prepared syllabus files, one per recurring exam" },
  { href: "/admin/intake",       label: "Intake",       hint: "Turn a notification URL or PDF into a draft" },
  { href: "/admin/review",       label: "Review",       hint: "Drafts waiting for your decision" },
  { href: "/admin/history",      label: "History",      hint: "What was done and when" },
  { href: "/admin/intelligence", label: "Intelligence", hint: "Automatic discovery runs" },
];

// Look and feel shared by every admin page. Pages style themselves inline;
// this adds what inline styles cannot: focus rings, hover lift, scrollbars.
const ADMIN_CSS = `
.adm-root { color-scheme: dark; }
.adm-root ::selection { background: rgba(249,115,22,0.35); }
.adm-root input, .adm-root select, .adm-root textarea {
  transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease;
}
.adm-root input:focus, .adm-root select:focus, .adm-root textarea:focus {
  outline: none;
  border-color: #f97316 !important;
  box-shadow: 0 0 0 3px rgba(249,115,22,0.18), 0 0 18px rgba(249,115,22,0.10);
}
.adm-root button, .adm-root a { transition: filter .15s ease, transform .15s ease, box-shadow .15s ease, background-color .15s ease, color .15s ease; }
.adm-root button:not(:disabled):hover { filter: brightness(1.12); }
.adm-root button:not(:disabled):active { transform: translateY(1px); }
.adm-root button:focus-visible, .adm-root a:focus-visible {
  outline: 2px solid #f97316; outline-offset: 2px; border-radius: 6px;
}
.adm-root * { scrollbar-width: thin; scrollbar-color: #2b3a5c transparent; }
.adm-root *::-webkit-scrollbar { width: 8px; height: 8px; }
.adm-root *::-webkit-scrollbar-thumb { background: #2b3a5c; border-radius: 999px; }
.adm-root *::-webkit-scrollbar-track { background: transparent; }
@media (prefers-reduced-motion: reduce) {
  .adm-root *, .adm-root *::before, .adm-root *::after { transition: none !important; animation: none !important; }
}
`;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <div
      className="adm-root"
      style={{
        minHeight: "100vh",
        color: "#e2e8f0",
        fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif",
        // Deep base with two soft glows and a faint grid.
        backgroundColor: "#070b16",
        backgroundImage: [
          "radial-gradient(900px 420px at 12% -8%, rgba(249,115,22,0.10), transparent 60%)",
          "radial-gradient(900px 480px at 96% 0%, rgba(99,102,241,0.14), transparent 62%)",
          "linear-gradient(rgba(148,163,184,0.035) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(148,163,184,0.035) 1px, transparent 1px)",
        ].join(", "),
        backgroundSize: "auto, auto, 44px 44px, 44px 44px",
        backgroundAttachment: "fixed",
      }}
    >
      <style>{ADMIN_CSS}</style>
      <header style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "rgba(7,11,22,0.72)",
        backdropFilter: "blur(14px) saturate(140%)",
        WebkitBackdropFilter: "blur(14px) saturate(140%)",
        borderBottom: "1px solid rgba(148,163,184,0.14)",
        boxShadow: "0 1px 0 rgba(249,115,22,0.10), 0 12px 32px rgba(0,0,0,0.25)",
      }}>
        <div style={{
          maxWidth: 1320,
          margin: "0 auto",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          gap: 28,
          height: 56,
        }}>
          <Link href="/admin/cms" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <span style={{ width: 28, height: 28, display: "inline-flex", borderRadius: 8, boxShadow: "0 0 18px rgba(249,115,22,0.35)" }}>
              <BrandMark />
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", letterSpacing: "0.01em" }}>
              LakshyaNaukri{" "}
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
                color: "#fdba74", border: "1px solid rgba(249,115,22,0.35)", background: "rgba(249,115,22,0.10)",
                padding: "2px 7px", borderRadius: 999, marginLeft: 4, verticalAlign: "middle",
              }}>
                Admin
              </span>
            </span>
          </Link>
          <nav style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            {NAV.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            <a href="/" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#8c9bb8", textDecoration: "none", whiteSpace: "nowrap" }}>
              View site ↗
            </a>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main style={{ maxWidth: 1320, margin: "0 auto", padding: "24px" }}>{children}</main>
    </div>
  );
}

function LogoutButton() {
  const router = useRouter();
  async function handleLogout() {
    await fetch("/api/admin/auth/session", { method: "DELETE" });
    router.push("/admin/login");
  }
  return (
    <button
      onClick={handleLogout}
      style={{
        padding: "5px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        color: "#8c9bb8",
        background: "rgba(148,163,184,0.06)",
        border: "1px solid rgba(148,163,184,0.18)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      Sign out
    </button>
  );
}

function NavLink({ href, label, hint }: { href: string; label: string; hint: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      title={hint}
      style={{
        padding: "6px 14px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        color: active ? "#fff" : "#8c9bb8",
        background: active ? "linear-gradient(135deg, rgba(249,115,22,0.22), rgba(99,102,241,0.22))" : "transparent",
        border: `1px solid ${active ? "rgba(249,115,22,0.45)" : "transparent"}`,
        boxShadow: active ? "0 0 18px rgba(249,115,22,0.18)" : "none",
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Link>
  );
}
