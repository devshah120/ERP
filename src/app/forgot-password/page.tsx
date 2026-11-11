"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import AuthLayout from "@/components/auth/AuthLayout";
import { IconAlertCircle, IconArrowLeft } from "@/components/icons";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const u = usernameOrEmail.trim();
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ usernameOrEmail: u }),
      });
      router.push(`/reset-password?user=${encodeURIComponent(u)}&sent=1`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      topRight={
        <Link href="/login" className="button buttonGhost buttonSm">
          <IconArrowLeft /> Back to sign in
        </Link>
      }
    >
      <h1 className="title">Reset your password</h1>
      <p className="subtitle">
        Enter your username or email. If the account exists, we&apos;ll email a 6-digit code to the address on file.
      </p>

      {error && (
        <div className="banner bannerError" style={{ marginBottom: "1.25rem" }} role="alert">
          <IconAlertCircle />
          <span>{error}</span>
        </div>
      )}

      <form className="form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="user">Username or email</label>
          <input
            id="user"
            className="input"
            required
            value={usernameOrEmail}
            onChange={(e) => setUsernameOrEmail(e.target.value)}
            placeholder="asha"
            autoComplete="username"
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
