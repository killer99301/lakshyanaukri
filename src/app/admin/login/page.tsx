"use client";

// ═══════════════════════════════════════════════════════════
// Admin Login — 4-stage UX
// Stage 1: Username/password login
// Stage 2: OTP entry (recovery mode)
// Stage 3: New password entry
// Stage 4: Success
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";

// ─── Types ────────────────────────────────────────────────

type Stage = 1 | 2 | 3 | 4;

// ─── CSS (keyframes + class definitions) ──────────────────
// Injected as a <style> tag so keyframes and :hover/:focus
// selectors work without an external stylesheet dependency.

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

*, *::before, *::after { box-sizing: border-box; }

.ln-page {
  min-height: 100vh;
  background: #05080f;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  position: relative;
  overflow: hidden;
  padding: 24px;
}

/* ── Animated background orbs ────────────────────────── */

.ln-orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  will-change: transform;
  filter: blur(80px);
  opacity: 0.18;
}
.ln-orb-1 {
  width: 520px; height: 520px;
  background: radial-gradient(circle, #1e40af 0%, transparent 70%);
  top: -120px; left: -100px;
  animation: orb1 22s ease-in-out infinite alternate;
}
.ln-orb-2 {
  width: 400px; height: 400px;
  background: radial-gradient(circle, #0f4c81 0%, transparent 70%);
  bottom: -80px; right: -60px;
  animation: orb2 18s ease-in-out infinite alternate;
  opacity: 0.14;
}
.ln-orb-3 {
  width: 280px; height: 280px;
  background: radial-gradient(circle, #312e81 0%, transparent 70%);
  top: 55%; left: 60%;
  animation: orb3 26s ease-in-out infinite alternate;
  opacity: 0.10;
}

@keyframes orb1 {
  from { transform: translate(0, 0) scale(1); }
  to   { transform: translate(60px, 40px) scale(1.08); }
}
@keyframes orb2 {
  from { transform: translate(0, 0) scale(1); }
  to   { transform: translate(-50px, -30px) scale(0.94); }
}
@keyframes orb3 {
  from { transform: translate(0, 0); }
  to   { transform: translate(-40px, 30px); }
}

/* Faint grid overlay */
.ln-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px);
  background-size: 48px 48px;
}

/* ── Card ─────────────────────────────────────────────── */

.ln-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 420px;
  background: rgba(10, 16, 28, 0.88);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 16px;
  padding: 36px 40px;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow:
    0 0 0 1px rgba(59, 130, 246, 0.04),
    0 8px 32px rgba(0,0,0,0.45),
    0 2px 8px rgba(0,0,0,0.3);
  animation: cardIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes cardIn {
  from { opacity: 0; transform: translateY(14px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* ── Stage wrapper (animates on each stage mount) ─────── */

.ln-stage {
  animation: stageIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes stageIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Brand / header ───────────────────────────────────── */

.ln-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 5px;
  animation: fieldIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: 0.05s;
}

.ln-shield {
  width: 28px; height: 28px;
  flex-shrink: 0;
  color: #3b82f6;
  opacity: 0.9;
}

.ln-title {
  font-size: 17px;
  font-weight: 700;
  color: #e2e8f0;
  margin: 0;
  letter-spacing: -0.01em;
}

.ln-subtitle {
  font-size: 12.5px;
  color: #4a5568;
  margin: 0 0 26px 0;
  animation: fieldIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: 0.1s;
}

/* ── Field groups (staggered entrance) ────────────────── */

.ln-field {
  margin-bottom: 14px;
  animation: fieldIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes fieldIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.ln-label {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: #475569;
  margin-bottom: 6px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.ln-input {
  width: 100%;
  padding: 10px 14px;
  background: rgba(5, 8, 15, 0.7);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px;
  color: #e2e8f0;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;
}
.ln-input:focus {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(7, 11, 20, 0.9);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.08);
}
.ln-input::placeholder { color: #1e2a3a; }
.ln-input:disabled { opacity: 0.5; cursor: default; }

/* ── Primary button ───────────────────────────────────── */

.ln-btn {
  width: 100%;
  padding: 11px 0;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition:
    transform 0.15s ease,
    box-shadow 0.2s ease,
    opacity 0.15s ease;
  animation: fieldIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.ln-btn-primary {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: #fff;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3), 0 1px 2px rgba(0,0,0,0.2);
}
.ln-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(37, 99, 235, 0.4), 0 2px 4px rgba(0,0,0,0.2);
}
.ln-btn-primary:active:not(:disabled) {
  transform: scale(0.98) translateY(0);
  box-shadow: 0 1px 4px rgba(37, 99, 235, 0.25);
}

/* Shimmer sweep on hover */
.ln-btn-primary::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%);
  transform: translateX(-100%);
  transition: transform 0s;
}
.ln-btn-primary:hover:not(:disabled)::before {
  transform: translateX(100%);
  transition: transform 0.5s ease;
}

.ln-btn-green {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #fff;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25), 0 1px 2px rgba(0,0,0,0.2);
}
.ln-btn-green:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
}
.ln-btn-green:active:not(:disabled) {
  transform: scale(0.98);
}

.ln-btn:disabled {
  background: #111827;
  color: #1f2937;
  cursor: default;
  box-shadow: none;
  transform: none;
}
.ln-btn:disabled::before { display: none; }

/* Success flash state */
.ln-btn-success {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
  color: #fff !important;
  cursor: default;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15) !important;
}

/* Loading spinner inside button */
.ln-spinner {
  display: inline-block;
  width: 13px; height: 13px;
  border: 2px solid rgba(255,255,255,0.25);
  border-top-color: rgba(255,255,255,0.85);
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 7px;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Footer link (Forgot password / Back) ─────────────── */

.ln-divider {
  border: none;
  border-top: 1px solid rgba(255,255,255,0.05);
  margin: 22px 0 18px;
  animation: fieldIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.ln-link {
  background: none;
  border: none;
  font-family: inherit;
  font-size: 12.5px;
  color: #374151;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: color 0.18s ease;
  animation: fieldIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.ln-link:hover { color: #9ca3af; }
.ln-link:hover .ln-chevron { transform: translateX(2px); }
.ln-link:focus-visible {
  outline: 2px solid rgba(59,130,246,0.5);
  outline-offset: 3px;
  border-radius: 3px;
}
.ln-link:disabled { opacity: 0.4; cursor: default; pointer-events: none; }

.ln-chevron {
  display: inline-block;
  transition: transform 0.18s ease;
  font-style: normal;
}

/* ── Error banner ─────────────────────────────────────── */

.ln-error {
  background: rgba(239, 68, 68, 0.07);
  border: 1px solid rgba(239, 68, 68, 0.18);
  border-radius: 8px;
  padding: 10px 14px;
  color: #fca5a5;
  font-size: 13px;
  margin-bottom: 16px;
  animation: stageIn 0.25s ease both;
}

/* ── OTP boxes ────────────────────────────────────────── */

.ln-otp-row {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  justify-content: center;
}

.ln-otp-box {
  width: 46px; height: 54px;
  text-align: center;
  font-size: 22px;
  font-weight: 700;
  font-family: inherit;
  background: rgba(5, 8, 15, 0.7);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px;
  color: #e2e8f0;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.ln-otp-box:focus {
  border-color: rgba(59,130,246,0.5);
  box-shadow: 0 0 0 3px rgba(59,130,246,0.08);
}
.ln-otp-box--active {
  border-color: rgba(59,130,246,0.25);
}

/* ── Timer ─────────────────────────────────────────────── */

.ln-timer {
  font-size: 12px;
  color: #374151;
  text-align: center;
  margin-bottom: 16px;
}

/* ── Stage 4 success icon ─────────────────────────────── */

.ln-success-icon {
  width: 58px; height: 58px;
  border-radius: 50%;
  background: rgba(16, 185, 129, 0.08);
  border: 1.5px solid rgba(16, 185, 129, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  margin: 0 auto 20px;
  animation: successPulse 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes successPulse {
  from { opacity: 0; transform: scale(0.7); }
  to   { opacity: 1; transform: scale(1); }
}

/* ── Responsive ───────────────────────────────────────── */

@media (max-width: 480px) {
  .ln-page { padding: 16px; align-items: flex-start; padding-top: 60px; }
  .ln-card { padding: 28px 24px; }
  .ln-orb { display: none; }
}

/* ── Reduced motion ───────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
  .ln-orb, .ln-grid { animation: none !important; }
  .ln-card  { animation: none !important; opacity: 1; transform: none; }
  .ln-stage { animation: none !important; opacity: 1; transform: none; }
  .ln-brand, .ln-subtitle, .ln-field, .ln-btn,
  .ln-divider, .ln-link { animation: none !important; opacity: 1; transform: none; }
  .ln-btn-primary::before { display: none; }
  .ln-success-icon { animation: none !important; }
}
`;

// ─── OTP digit input ──────────────────────────────────────

function OtpInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const digits = value.split("").concat(Array(6).fill("")).slice(0, 6);
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
    <div className="ln-otp-row">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { inputsRef.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d}
          className={`ln-otp-box${i === digits.filter(Boolean).length ? " ln-otp-box--active" : ""}`}
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
  const initialRef = useRef(initialSeconds);

  useEffect(() => {
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

// ─── Shield glyph ─────────────────────────────────────────

function ShieldIcon() {
  return (
    <svg
      className="ln-shield"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V7L12 2z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

// ─── Main page ────────────────────────────────────────────

export default function AdminLoginPage() {
  const [stage, setStage] = useState<Stage>(1);
  const [showRecovery, setShowRecovery] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);

  // Stage 1
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");

  // Stage 2 (OTP)
  const [otpDigits, setOtpDigits] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [recoveryIdentifier, setRecoveryIdentifier] = useState("");
  const [otpExpirySeconds] = useState(600);

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
        setLoginSuccess(true);
        setTimeout(() => { window.location.href = "/admin/history"; }, 480);
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
        return;
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
        return;
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
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="ln-page">
        {/* Ambient background */}
        <div className="ln-orb ln-orb-1" aria-hidden="true" />
        <div className="ln-orb ln-orb-2" aria-hidden="true" />
        <div className="ln-orb ln-orb-3" aria-hidden="true" />
        <div className="ln-grid" aria-hidden="true" />

        <div className="ln-card" role="main">

          {/* ── Stage 1: Login ── */}
          {stage === 1 && !showRecovery && (
            <div className="ln-stage" key="login">
              <div className="ln-brand">
                <ShieldIcon />
                <h1 className="ln-title">LakshyaNaukri Admin</h1>
              </div>
              <p className="ln-subtitle" style={{ animationDelay: "0.10s" }}>
                Secure access · Admin panel
              </p>

              {error && <div className="ln-error" role="alert">{error}</div>}

              <form onSubmit={handleLogin} noValidate>
                <div className="ln-field" style={{ animationDelay: "0.14s" }}>
                  <label className="ln-label" htmlFor="ln-identity">Username or email</label>
                  <input
                    id="ln-identity"
                    type="text"
                    value={identity}
                    onChange={(e) => setIdentity(e.target.value)}
                    className="ln-input"
                    autoComplete="username"
                    required
                    disabled={loginSuccess}
                  />
                </div>
                <div className="ln-field" style={{ animationDelay: "0.20s" }}>
                  <label className="ln-label" htmlFor="ln-password">Password</label>
                  <input
                    id="ln-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="ln-input"
                    autoComplete="current-password"
                    required
                    disabled={loginSuccess}
                  />
                </div>
                <div className="ln-field" style={{ animationDelay: "0.28s", marginBottom: 0 }}>
                  <button
                    type="submit"
                    disabled={loading || !identity || !password || loginSuccess}
                    className={`ln-btn ${loginSuccess ? "ln-btn-success" : "ln-btn-primary"}`}
                  >
                    {loginSuccess ? (
                      <>✓ Authenticated</>
                    ) : loading ? (
                      <><span className="ln-spinner" aria-hidden="true" />Signing in…</>
                    ) : (
                      "Sign in"
                    )}
                  </button>
                </div>
              </form>

              <hr className="ln-divider" style={{ animationDelay: "0.33s" }} />
              <div style={{ textAlign: "center" }}>
                <button
                  className="ln-link"
                  style={{ animationDelay: "0.36s" }}
                  onClick={() => setShowRecovery(true)}
                >
                  Forgot password?
                  <span className="ln-chevron" aria-hidden="true">›</span>
                </button>
              </div>
            </div>
          )}

          {/* ── Stage 1: Recovery identifier entry ── */}
          {stage === 1 && showRecovery && (
            <div className="ln-stage" key="recovery-lookup">
              <div className="ln-brand">
                <ShieldIcon />
                <h1 className="ln-title">Account Recovery</h1>
              </div>
              <p className="ln-subtitle" style={{ animationDelay: "0.08s" }}>
                Enter your username or email to receive a one-time code
              </p>

              {error && <div className="ln-error" role="alert">{error}</div>}

              <form onSubmit={handleRecoveryLookup} noValidate>
                <div className="ln-field" style={{ animationDelay: "0.14s" }}>
                  <label className="ln-label" htmlFor="ln-recovery-id">Username or email</label>
                  <input
                    id="ln-recovery-id"
                    type="text"
                    value={recoveryIdentifier}
                    onChange={(e) => setRecoveryIdentifier(e.target.value)}
                    className="ln-input"
                    autoComplete="username"
                    required
                  />
                </div>
                <div className="ln-field" style={{ animationDelay: "0.20s", marginBottom: 0 }}>
                  <button
                    type="submit"
                    disabled={loading || !recoveryIdentifier}
                    className="ln-btn ln-btn-primary"
                  >
                    {loading ? (
                      <><span className="ln-spinner" aria-hidden="true" />Sending…</>
                    ) : (
                      "Send one-time code"
                    )}
                  </button>
                </div>
              </form>

              <hr className="ln-divider" style={{ animationDelay: "0.26s" }} />
              <div style={{ textAlign: "center" }}>
                <button
                  className="ln-link"
                  style={{ animationDelay: "0.30s" }}
                  onClick={() => { setShowRecovery(false); setError(null); }}
                >
                  <span className="ln-chevron" aria-hidden="true" style={{ display: "inline-block", transform: "scaleX(-1)" }}>›</span>
                  Back to sign in
                </button>
              </div>
            </div>
          )}

          {/* ── Stage 2: OTP entry ── */}
          {stage === 2 && (
            <div className="ln-stage" key="otp">
              <div className="ln-brand">
                <ShieldIcon />
                <h1 className="ln-title">Verification code</h1>
              </div>
              <p className="ln-subtitle" style={{ animationDelay: "0.08s" }}>
                Check your email for a 6-digit code
              </p>

              {error && <div className="ln-error" role="alert">{error}</div>}

              <form onSubmit={handleVerifyOtp} noValidate>
                <div className="ln-field" style={{ animationDelay: "0.14s" }}>
                  <OtpInput value={otpDigits} onChange={setOtpDigits} />
                </div>
                <div className="ln-timer">
                  {countdown > 0
                    ? `Code expires in ${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, "0")}`
                    : "Code has expired."}
                </div>
                <div className="ln-field" style={{ animationDelay: "0.20s", marginBottom: 0 }}>
                  <button
                    type="submit"
                    disabled={loading || otpDigits.length !== 6}
                    className="ln-btn ln-btn-green"
                  >
                    {loading ? (
                      <><span className="ln-spinner" aria-hidden="true" />Verifying…</>
                    ) : (
                      "Verify code"
                    )}
                  </button>
                </div>
              </form>

              <hr className="ln-divider" />
              <div style={{ display: "flex", gap: 20, justifyContent: "center" }}>
                <button className="ln-link" onClick={handleResend} disabled={loading}>
                  Resend code
                </button>
                <button
                  className="ln-link"
                  onClick={() => { setStage(1); setShowRecovery(false); setError(null); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── Stage 3: New password ── */}
          {stage === 3 && (
            <div className="ln-stage" key="reset">
              <div className="ln-brand">
                <ShieldIcon />
                <h1 className="ln-title">Set new password</h1>
              </div>
              <p className="ln-subtitle" style={{ animationDelay: "0.08s" }}>
                Choose a strong password — minimum 12 characters
              </p>

              {error && <div className="ln-error" role="alert">{error}</div>}

              <form onSubmit={handleResetPassword} noValidate>
                <div className="ln-field" style={{ animationDelay: "0.12s" }}>
                  <label className="ln-label" htmlFor="ln-newpw">New password</label>
                  <input
                    id="ln-newpw"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="ln-input"
                    autoComplete="new-password"
                    minLength={12}
                    required
                  />
                </div>
                <div className="ln-field" style={{ animationDelay: "0.18s" }}>
                  <label className="ln-label" htmlFor="ln-confirmpw">Confirm password</label>
                  <input
                    id="ln-confirmpw"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="ln-input"
                    autoComplete="new-password"
                    minLength={12}
                    required
                  />
                </div>
                <div className="ln-field" style={{ animationDelay: "0.24s", marginBottom: 0 }}>
                  <button
                    type="submit"
                    disabled={loading || !newPassword || !confirmPassword}
                    className="ln-btn ln-btn-green"
                  >
                    {loading ? (
                      <><span className="ln-spinner" aria-hidden="true" />Resetting…</>
                    ) : (
                      "Set new password"
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── Stage 4: Success ── */}
          {stage === 4 && (
            <div className="ln-stage" key="success" style={{ textAlign: "center" }}>
              <div className="ln-success-icon" aria-hidden="true">✓</div>
              <h1 className="ln-title" style={{ textAlign: "center", marginBottom: 6 }}>
                Password updated
              </h1>
              <p className="ln-subtitle" style={{ textAlign: "center", marginBottom: 28, animationDelay: "0.08s" }}>
                Your password has been reset. All previous sessions have been revoked.
              </p>
              <button
                className="ln-btn ln-btn-primary"
                onClick={() => { setStage(1); setShowRecovery(false); setError(null); setPassword(""); }}
              >
                Sign in with new password
              </button>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
