"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import AuthLayout from "@/components/auth/AuthLayout";
import OtpInput from "@/components/auth/OtpInput";
import PasswordField, { passwordMeetsPolicy } from "@/components/auth/PasswordField";
import { IconAlertCircle, IconArrowLeft, IconCheckCircle } from "@/components/icons";

const COOLDOWN = 60;

export default function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const user = params.get("email") ?? "";
  const justSent = params.get("sent") === "1";

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(
    justSent ? "If the account exists, a code has been sent to its email address." : null
  );
  const [cooldown, setCooldown] = useState(justSent ? COOLDOWN : 0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const startCooldown = () => setCooldown(COOLDOWN);

  if (!user) {
    return (
      <AuthLayout>
        <span className="authIconBadge warn">
          <IconAlertCircle />
        </span>
        <h1 className="title">Start with your account details</h1>
        <p className="subtitle">We need your email before we can send a reset code.</p>
        <Link href="/forgot-password" className="button buttonPrimary buttonLg buttonBlock">
          Request a reset code
        </Link>
      </AuthLayout>
    );
  }

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = code.length === 6 && passwordMeetsPolicy(password) && confirm === password && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: user, code, password, confirmPassword: confirm }),
      });
      router.push("/login?reset=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
      setSubmitting(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: user }),
      });
      setInfo("If the account exists, a new code has been sent. Earlier codes no longer work.");
      setCode("");
      startCooldown();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
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
      <h1 className="title">Choose a new password</h1>
      <p className="subtitle">
        Enter the code sent for <strong style={{ color: "var(--text)" }}>{user}</strong>. Resetting signs you out on
        every device.
      </p>

      {error && (
        <div className="banner bannerError" style={{ marginBottom: "1.25rem" }} role="alert">
          <IconAlertCircle />
          <span>{error}</span>
        </div>
      )}
      {info && !error && (
        <div className="banner bannerInfo" style={{ marginBottom: "1.25rem" }} role="status">
          <IconCheckCircle />
          <span>{info}</span>
        </div>
      )}

      <form className="form" onSubmit={handleSubmit}>
        <div className="field">
          <label>Reset code</label>
          <OtpInput value={code} onChange={setCode} state={error && code.length === 6 ? "error" : "idle"} />
          <span className="fieldHint">
            {cooldown > 0 ? (
              `You can request another code in ${cooldown}s.`
            ) : (
              <>
                Didn&apos;t arrive?{" "}
                <button type="button" className="buttonLink" onClick={resend}>
                  Send a new code
                </button>
              </>
            )}
          </span>
        </div>

        <PasswordField
          id="new-password"
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showStrength
        />
        <PasswordField
          id="confirm-password"
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          error={mismatch ? "Passwords do not match" : undefined}
        />

        <button type="submit" className="button buttonPrimary buttonLg buttonBlock" disabled={!canSubmit}>
          {submitting && <span className="spinner" />}
          {submitting ? "Updating password…" : "Update password"}
        </button>
      </form>
    </AuthLayout>
  );
}
