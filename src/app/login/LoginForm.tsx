"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordField from "@/components/auth/PasswordField";
import { IconAlertCircle, IconArrowRight, IconCheckCircle } from "@/components/icons";
import { safeNext } from "@/lib/auth/safeNext";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justVerified = searchParams.get("verified") === "1";
  const justReset = searchParams.get("reset") === "1";
  const next = safeNext(searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await apiFetch<{ superAdmin?: boolean; redirectTo?: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          rememberMe,
        }),
      });
      if (res?.superAdmin && res.redirectTo) {
        router.push(res.redirectTo);
      } else {
        router.push(next);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? { message: err.message, code: err.code }
          : { message: "Could not reach the server. Check your connection and try again.", code: "NETWORK" }
      );
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="title">Welcome back!</h1>
      <p className="subtitle">Sign in with your email to manage sales, stock and accounts.</p>

      {justVerified && (
        <div className="banner bannerSuccess" style={{ marginBottom: "1.25rem" }} role="status">
          <IconCheckCircle />
          <span>Your business is verified. Sign in to get started.</span>
        </div>
      )}
      {justReset && (
        <div className="banner bannerSuccess" style={{ marginBottom: "1.25rem" }} role="status">
          <IconCheckCircle />
          <span>Password updated and all other sessions signed out. Sign in with your new password.</span>
        </div>
      )}
      {error && (
        <div className="banner bannerError" style={{ marginBottom: "1.25rem" }} role="alert">
          <IconAlertCircle />
          <span>
            {error.message}
            {error.code === "ACCOUNT_LOCKED" && (
              <>
                {" "}
                <Link href="/forgot-password" className="textLink">
                  Reset your password
                </Link>{" "}
                to unlock it now.
              </>
            )}
          </span>
        </div>
      )}

      <form className="form" onSubmit={handleSubmit} noValidate={false}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="input"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@business.com"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        <div className="authRowBetween">
          <label className="checkboxRow">
            <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
            Keep me signed in
          </label>
          <Link href="/forgot-password">Forgot password?</Link>
        </div>

        <button type="submit" className="button buttonPrimary buttonLg buttonBlock" disabled={submitting}>
          {submitting && <span className="spinner" />}
          {submitting ? "Signing in…" : (
            <>
              Sign in <IconArrowRight />
            </>
          )}
        </button>
      </form>

      <p className="footerRow" style={{ textAlign: "center" }}>
        Don&apos;t have a workspace yet? <Link href="/register">Register your business</Link>
      </p>
    </AuthLayout>
  );
}
