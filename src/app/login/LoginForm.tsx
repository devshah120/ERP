"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordField from "@/components/auth/PasswordField";
import { IconAlertCircle, IconCheckCircle } from "@/components/icons";
import { safeNext } from "@/lib/auth/safeNext";

const DOMAIN_KEY = "erp.lastDomain";


export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justVerified = searchParams.get("verified") === "1";
  const justReset = searchParams.get("reset") === "1";
  const next = safeNext(searchParams.get("next"));

  const [domain, setDomain] = useState("");
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);

  // Pre-fill the workspace domain from the last successful sign-in on this browser.
  useEffect(() => {
    try {
      const last = localStorage.getItem(DOMAIN_KEY);
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

    const cleanDomain = domain.trim().toLowerCase();
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          domain: cleanDomain,
          usernameOrEmail: usernameOrEmail.trim(),
          password,
          rememberMe,
        }),
      });
      try {
        localStorage.setItem(DOMAIN_KEY, cleanDomain);
      } catch {
        /* ignore */
      }
      router.push(next);
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
    <AuthLayout
      topRight={
        <>
          <span className="hideMobile">New to Garment ERP?</span>
          <Link href="/register" className="button buttonSecondary buttonSm">
            Create workspace
          </Link>
        </>
      }
    >
      <h1 className="title">Sign in to your workspace</h1>
      <p className="subtitle">Enter your business domain and credentials to continue.</p>

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
          <label htmlFor="domain">Business domain</label>
          <input
            id="domain"
            className="input"
            required
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="rangoli-textiles"
            autoComplete="organization"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus={!domain}
          />
          <span className="fieldHint">The workspace ID you chose when registering.</span>
        </div>

        <div className="field">
          <label htmlFor="user">Username or email</label>
          <input
            id="user"
            className="input"
            required
            value={usernameOrEmail}
            onChange={(e) => setUsernameOrEmail(e.target.value)}
            placeholder="asha or asha@rangoli.com"
            autoComplete="username"
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
          extraLabel={
            <Link href="/forgot-password" tabIndex={0}>
              Forgot password?
            </Link>
          }
        />

        <label className="checkboxRow">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
          Keep me signed in on this device
        </label>

        <button type="submit" className="button buttonPrimary buttonLg buttonBlock" disabled={submitting}>
          {submitting && <span className="spinner" />}
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="footerRow">
        Don&apos;t have a workspace yet? <Link href="/register">Register your business</Link>
      </p>
    </AuthLayout>
  );
}
