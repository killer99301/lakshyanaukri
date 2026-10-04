"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV = [
  { href: "/admin/cms",          label: "Jobs",         hint: "Create, edit and publish job records" },
  { href: "/admin/intake",       label: "Intake",       hint: "Turn a notification URL or PDF into a draft" },
  { href: "/admin/review",       label: "Review",       hint: "Drafts waiting for your decision" },
  { href: "/admin/history",      label: "History",      hint: "What was done and when" },
  { href: "/admin/intelligence", label: "Intelligence", hint: "Automatic discovery runs" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      color: "#e2e8f0",
      fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif",
    }}>
      <header style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: "#0d1117f2",
        backdropFilter: "blur(6px)",
        borderBottom: "1px solid #21262d",
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
            <span style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg, #f97316, #ea580c)",
              color: "#fff", fontSize: 14, fontWeight: 800,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>
              L
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>
              LakshyaNaukri <span style={{ color: "#8b949e", fontWeight: 500 }}>Admin</span>
            </span>
          </Link>
          <nav style={{ display: "flex", gap: 2, overflowX: "auto" }}>
            {NAV.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            <a href="/" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#8b949e", textDecoration: "none", whiteSpace: "nowrap" }}>
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
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        color: "#8b949e",
        background: "transparent",
        border: "1px solid #30363d",
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
        borderRadius: 6,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color: active ? "#fff" : "#8b949e",
        background: active ? "#1f2937" : "transparent",
        boxShadow: active ? "inset 0 -2px 0 #f97316" : "none",
        textDecoration: "none",
        whiteSpace: "nowrap",
        transition: "color 0.1s, background 0.1s",
      }}
    >
      {label}
    </Link>
  );
}
