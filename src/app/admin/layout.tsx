"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV = [
  { href: "/admin/intake",  label: "Intake"  },
  { href: "/admin/review",  label: "Review"  },
  { href: "/admin/history", label: "History" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      color: "#e2e8f0",
      fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif",
    }}>
      <header style={{
        borderBottom: "1px solid #21262d",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        gap: 32,
        height: 52,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#58a6ff", letterSpacing: "0.04em" }}>
          LakshyaNaukri Admin
        </span>
        <nav style={{ display: "flex", gap: 4 }}>
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>
        <div style={{ marginLeft: "auto" }}>
          <LogoutButton />
        </div>
      </header>
      <main style={{ padding: "24px" }}>{children}</main>
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
        border: "1px solid #21262d",
        cursor: "pointer",
      }}
    >
      Sign out
    </button>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      style={{
        padding: "6px 14px",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        color: active ? "#58a6ff" : "#8b949e",
        background: active ? "#1f2937" : "transparent",
        textDecoration: "none",
        transition: "color 0.1s, background 0.1s",
      }}
    >
      {label}
    </Link>
  );
}
