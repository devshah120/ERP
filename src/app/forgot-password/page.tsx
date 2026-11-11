"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import AuthLayout from "@/components/auth/AuthLayout";
import { IconAlertCircle, IconArrowLeft } from "@/components/icons";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const u = email.trim().toLowerCase();
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: u }),
      });
      router.push(`/reset-password?email=${encodeURIComponent(u)}&sent=1`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      headline={["Locked out?", "Let's get you", "back in."]}
      lead="We'll email you a 6-digit code. Enter it with a new password and you're signed back in — every other device is signed out for safety."
      tagline="Takes less than a minute."
      topRight={
        <Link href="/login" className="button buttonGhost buttonSm">
          <IconArrowLeft /> Back to sign in
        </Link>
      }
    >
      <h1 className="title">Reset your password</h1>
      <p className="subtitle">
        Enter your email. If it has an account, we&apos;ll send a 6-digit code to it.
      </p>

      {error && (
        <div className="banner bannerError" style={{ marginBottom: "1.25rem" }} role="alert">
          <IconAlertCircle />
          <span>{error}</span>
        </div>
      )}

      <form className="form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@business.com"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
          />
        </div>
        <button type="submit" className="button buttonPrimary buttonLg buttonBlock" disabled={submitting}>
          {submitting && <span className="spinner" />}
          {submitting ? "Sending code…" : "Email me a reset code"}
        </button>
      </form>

      <p className="footerRow">
        Remembered it? <Link href="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
