"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import AuthLayout from "@/components/auth/AuthLayout";
import { IconAlertCircle, IconArrowLeft, IconKey } from "@/components/icons";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const last = localStorage.getItem("erp.lastDomain");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (last) setDomain(last);
    } catch {
      /* storage unavailable */
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const d = domain.trim().toLowerCase();
    const u = usernameOrEmail.trim();
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ domain: d, usernameOrEmail: u }),
      });
      router.push(`/reset-password?domain=${encodeURIComponent(d)}&user=${encodeURIComponent(u)}&sent=1`);
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
      <span className="authIconBadge">
        <IconKey />
      </span>
      <h1 className="title">Reset your password</h1>
      <p className="subtitle">
        Enter your workspace and username. If the account exists, we&apos;ll email a 6-digit code to the address on
        file.
      </p>

      {error && (
        <div className="banner bannerError" style={{ marginBottom: "1.25rem" }} role="alert">
          <IconAlertCircle />
          <span>{error}</span>
        </div>
      )}

      <form className="form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="domain">Business domain</label>
          <input
            id="domain"
            className="input"
            required
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="rangoli-textiles"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
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
