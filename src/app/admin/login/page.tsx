"use client";

// ═══════════════════════════════════════════════════════════
// Admin Login — 4-stage UX
// Stage 1: Username/password login
// Stage 2: OTP entry (recovery mode)
// Stage 3: New password entry
// Stage 4: Success
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────

type Stage = 1 | 2 | 3 | 4;

// ─── Styles ───────────────────────────────────────────────

const BG = "#0d1117";
const SURFACE = "#161b22";
const BORDER = "#21262d";
const TEXT = "#e2e8f0";
const MUTED = "#8b949e";
const BLUE = "#58a6ff";
const GREEN = "#238636";
const RED = "#f85149";

const s = {
  page: {
    minHeight: "100vh",
    background: BG,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "system-ui, -apple-system, sans-serif",
  } as React.CSSProperties,
  card: {
    width: "100%",
    maxWidth: 420,
    background: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: 12,
    padding: "32px 36px",
  } as React.CSSProperties,
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: TEXT,
    marginBottom: 4,
    margin: "0 0 4px 0",
  } as React.CSSProperties,
  subtitle: {
    fontSize: 13,
    color: MUTED,
    margin: "0 0 24px 0",
  } as React.CSSProperties,
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    color: MUTED,
    marginBottom: 6,
  } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "10px 12px",
    background: BG,
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    color: TEXT,
    fontSize: 14,
    boxSizing: "border-box" as const,
    marginBottom: 16,
    outline: "none",
  } as React.CSSProperties,
  btn: (disabled?: boolean, variant?: "green" | "ghost") => ({
    width: "100%",
    padding: "11px 0",
    background: disabled ? BORDER : variant === "green" ? GREEN : BLUE,
    color: disabled ? MUTED : "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? "default" : "pointer",
    marginTop: 4,
    transition: "background 0.1s",
  } as React.CSSProperties),
  error: {
    background: "#f8514922",
    border: `1px solid ${RED}44`,
    borderRadius: 6,
    padding: "10px 14px",
    color: RED,
    fontSize: 13,
    marginBottom: 16,
  } as React.CSSProperties,
  link: {
    background: "none",
    border: "none",
    color: BLUE,
    fontSize: 13,
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline",
  } as React.CSSProperties,
  otpRow: {
    display: "flex",
    gap: 8,
    marginBottom: 20,
    justifyContent: "center",
  } as React.CSSProperties,
  otpBox: (active: boolean) => ({
    width: 44,
    height: 52,
    textAlign: "center" as const,
    fontSize: 22,
    fontWeight: 700,
    background: BG,
    border: `2px solid ${active ? BLUE : BORDER}`,
    borderRadius: 8,
    color: TEXT,
    outline: "none",
  } as React.CSSProperties),
  timer: {
    fontSize: 12,
    color: MUTED,
    textAlign: "center" as const,
    marginBottom: 16,
  } as React.CSSProperties,
  divider: {
    borderTop: `1px solid ${BORDER}`,
    margin: "20px 0",
  } as React.CSSProperties,
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: `${GREEN}22`,
    border: `2px solid ${GREEN}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
    margin: "0 auto 20px",
  } as React.CSSProperties,
};

// ─── OTP digit input ──────────────────────────────────────

function OtpInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const digits = value.split("").concat(Array(6).fill("")).slice(0, 6);
  // Use a single ref to hold all 6 input elements (avoids hook-in-loop violation)
  const inputsRef = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null));

  function focusAt(i: number) {
    inputsRef.current[i]?.focus();
  }

  function handleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) focusAt(i - 1);
  }

  function handleChange(i: number, v: string) {
    const ch = v.replace(/\D/g, "").slice(-1);
    const next = digits.map((d, j) => (j === i ? ch : d)).join("");
    onChange(next.trim());
    if (ch && i < 5) focusAt(i + 1);
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(pasted);
    focusAt(Math.min(pasted.length, 5));
  }

  return (
    <div style={s.otpRow}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { inputsRef.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d}
          style={s.otpBox(i === digits.filter(Boolean).length)}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          onPaste={handlePaste}
        />
      ))}
    </div>
  );
}

// ─── Countdown timer ──────────────────────────────────────

function useCountdown(initialSeconds: number) {
  const [remaining, setRemaining] = useState(initialSeconds);
  // Track when to restart (stage 2 entry)
  const initialRef = useRef(initialSeconds);

  useEffect(() => {
    // Reset on initial render or when initialSeconds changes identity
    if (initialRef.current !== initialSeconds) {
      initialRef.current = initialSeconds;
      setRemaining(initialSeconds);
    }
    const id = setInterval(() => {
      setRemaining((r) => (r > 0 ? r - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [initialSeconds]);
  return remaining;
}

// ─── Main page ────────────────────────────────────────────

export default function AdminLoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(1);
  const [showRecovery, setShowRecovery] = useState(false);

  // Stage 1
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");

  // Stage 2 (OTP)
  const [otpDigits, setOtpDigits] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [recoveryIdentifier, setRecoveryIdentifier] = useState("");
  const [otpExpirySeconds] = useState(600); // matches OTP_EXPIRY_SECONDS

  // Stage 3 (new password)
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countdown = useCountdown(stage === 2 ? otpExpirySeconds : 0);

  // ─── Stage 1: Login ────────────────────────────────────

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity, password }),
      });
      if (res.ok) {
        router.push("/admin/history");
      } else {
        const data = await res.json().catch(() => ({ error: "Login failed" }));
        setError(data.error ?? "Login failed");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ─── Recovery: Request OTP ─────────────────────────────

  async function handleRecoveryLookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/recovery/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: recoveryIdentifier, channel: "email" }),
      });
      const data = await res.json().catch(() => ({}));
      // Always advance (anti-enumeration)
      setTransactionId(data.transactionId ?? "");
      setStage(2);
    } catch {
      // Also advance on network error (anti-enumeration)
      setTransactionId("");
      setStage(2);
    } finally {
      setLoading(false);
    }
  }

  // ─── Stage 2: Verify OTP ──────────────────────────────

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (otpDigits.length !== 6) {
      setError("Enter all 6 digits.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/recovery/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId, token: otpDigits }),
      });

      if (!res.ok) {
        // CRITICAL: stay on Stage 2 on failure
        const data = await res.json().catch(() => ({ error: "Verification failed" }));
        setError(data.error ?? "Verification failed");
        return; // do NOT advance to Stage 3
      }

      const data = await res.json();
      setResetToken(data.resetToken ?? "");
      setStage(3);
    } catch {
      // CRITICAL: network errors stay on Stage 2
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ─── Resend OTP ────────────────────────────────────────

  async function handleResend() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/recovery/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Resend failed" }));
        setError(data.error ?? "Resend failed");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ─── Stage 3: Reset password ───────────────────────────

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/recovery/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToken, password: newPassword }),
      });

      if (!res.ok) {
        // CRITICAL: stay on Stage 3 on failure
        const data = await res.json().catch(() => ({ error: "Reset failed" }));
        setError(data.error ?? "Reset failed");
        return; // do NOT advance to Stage 4
      }

      setStage(4);
    } catch {
      // CRITICAL: network errors stay on Stage 3
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ─── Render ────────────────────────────────────────────

  return (
    <div style={s.page}>
      <div style={s.card}>
        {/* Stage 1: Login */}
        {stage === 1 && !showRecovery && (
          <>
            <h1 style={s.title}>LakshyaNaukri Admin</h1>
            <p style={s.subtitle}>Sign in to access the admin panel</p>

            {error && <div style={s.error}>{error}</div>}

            <form onSubmit={handleLogin}>
              <label style={s.label}>Username or email</label>
              <input
                type="text"
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                style={s.input}
                autoComplete="username"
                required
              />
              <label style={s.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={s.input}
                autoComplete="current-password"
                required
              />
              <button
                type="submit"
                disabled={loading || !identity || !password}
                style={s.btn(loading || !identity || !password)}
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>

            <div style={s.divider} />
            <div style={{ textAlign: "center" }}>
              <button style={s.link} onClick={() => setShowRecovery(true)}>
                Forgot password?
              </button>
            </div>
          </>
        )}

        {/* Stage 1: Recovery identifier entry */}
        {stage === 1 && showRecovery && (
          <>
            <h1 style={s.title}>Account Recovery</h1>
            <p style={s.subtitle}>Enter your username or email to receive a one-time code</p>

            {error && <div style={s.error}>{error}</div>}

            <form onSubmit={handleRecoveryLookup}>
              <label style={s.label}>Username or email</label>
              <input
                type="text"
                value={recoveryIdentifier}
                onChange={(e) => setRecoveryIdentifier(e.target.value)}
                style={s.input}
                autoComplete="username"
                required
              />
              <button
                type="submit"
                disabled={loading || !recoveryIdentifier}
                style={s.btn(loading || !recoveryIdentifier)}
              >
                {loading ? "Sending…" : "Send one-time code"}
              </button>
            </form>

            <div style={s.divider} />
            <div style={{ textAlign: "center" }}>
              <button style={s.link} onClick={() => { setShowRecovery(false); setError(null); }}>
                Back to sign in
              </button>
            </div>
          </>
        )}

        {/* Stage 2: OTP entry */}
        {stage === 2 && (
          <>
            <h1 style={s.title}>Enter verification code</h1>
            <p style={s.subtitle}>
              Check your email for a 6-digit code
            </p>

            {error && <div style={s.error}>{error}</div>}

            <form onSubmit={handleVerifyOtp}>
              <OtpInput value={otpDigits} onChange={setOtpDigits} />

              <div style={s.timer}>
                {countdown > 0
                  ? `Code expires in ${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, "0")}`
                  : "Code has expired."}
              </div>

              <button
                type="submit"
                disabled={loading || otpDigits.length !== 6}
                style={s.btn(loading || otpDigits.length !== 6, "green")}
              >
                {loading ? "Verifying…" : "Verify code"}
              </button>
            </form>

            <div style={s.divider} />
            <div style={{ textAlign: "center", display: "flex", gap: 16, justifyContent: "center" }}>
              <button style={s.link} onClick={handleResend} disabled={loading}>
                Resend code
              </button>
              <button style={s.link} onClick={() => { setStage(1); setShowRecovery(false); setError(null); }}>
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Stage 3: New password */}
        {stage === 3 && (
          <>
            <h1 style={s.title}>Set new password</h1>
            <p style={s.subtitle}>Choose a strong password (min 12 characters)</p>

            {error && <div style={s.error}>{error}</div>}

            <form onSubmit={handleResetPassword}>
              <label style={s.label}>New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                style={s.input}
                autoComplete="new-password"
                minLength={12}
                required
              />
              <label style={s.label}>Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={s.input}
                autoComplete="new-password"
                minLength={12}
                required
              />
              <button
                type="submit"
                disabled={loading || !newPassword || !confirmPassword}
                style={s.btn(loading || !newPassword || !confirmPassword, "green")}
              >
                {loading ? "Resetting…" : "Set new password"}
              </button>
            </form>
          </>
        )}

        {/* Stage 4: Success */}
        {stage === 4 && (
          <>
            <div style={s.successIcon}>✓</div>
            <h1 style={{ ...s.title, textAlign: "center" }}>Password reset</h1>
            <p style={{ ...s.subtitle, textAlign: "center", marginBottom: 24 }}>
              Your password has been updated. All previous sessions have been revoked.
            </p>
            <button
              style={s.btn(false)}
              onClick={() => { setStage(1); setShowRecovery(false); setError(null); setPassword(""); }}
            >
              Sign in with new password
            </button>
          </>
        )}
      </div>
    </div>
  );
}
