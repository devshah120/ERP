"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import AuthLayout from "@/components/auth/AuthLayout";
import PasswordField, { passwordMeetsPolicy } from "@/components/auth/PasswordField";
import { IconAlertCircle, IconArrowLeft } from "@/components/icons";
import { safeNext } from "@/lib/auth/safeNext";

interface MeLite {
  email: string;
  mustChangePassword?: boolean;
}

/**
 * Signed-in password change. Users holding a temporary password land here
 * after sign-in and cannot leave until they replace it (or sign out); anyone
 * else reaches it from the account menu.
 */
export default function ChangePasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  const [me, setMe] = useState<MeLite | null>(null);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<MeLite>("/api/auth/me")
      .then(setMe)
      .catch(() => router.replace(`/login?next=${encodeURIComponent("/change-password")}`));
  }, [router]);

  const forced = Boolean(me?.mustChangePassword);
  const mismatch = confirm.length > 0 && confirm !== password;
  const sameAsCurrent = password.length > 0 && password === current;
  const canSubmit = current.length > 0 && passwordMeetsPolicy(password) && confirm === password && !sameAsCurrent && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, password, confirmPassword: confirm }),
      });
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
      setSubmitting(false);
    }
  }

  async function signOut() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  if (!me) return null;

  return (
    <AuthLayout
      headline={forced ? ["Welcome!", "First, set your", "own password."] : ["Keep your", "account", "secure."]}
      lead={
        forced
          ? "You signed in with a temporary password. Choose one only you know before you continue — every other device is signed out."
          : "Changing your password signs you out on every other device."
      }
      tagline="Takes less than a minute."
      topRight={
        forced ? (
          <button type="button" className="button buttonGhost buttonSm" onClick={signOut}>
            Sign out
          </button>
        ) : (
          <Link href={next} className="button buttonGhost buttonSm">
            <IconArrowLeft /> Back
          </Link>
        )
      }
    >
      <h1 className="title">{forced ? "Set a new password" : "Change password"}</h1>
      <p className="subtitle">
        For <strong style={{ color: "var(--text)" }}>{me.email}</strong>.
        {forced && " Use the temporary password you were given as your current password."}
      </p>

      {error && (
        <div className="banner bannerError" style={{ marginBottom: "1.25rem" }} role="alert">
          <IconAlertCircle />
          <span>{error}</span>
        </div>
      )}

      <form className="form" onSubmit={handleSubmit}>
        <PasswordField
          id="current-password"
          label={forced ? "Temporary password" : "Current password"}
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <PasswordField
          id="new-password"
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showStrength
          error={sameAsCurrent ? "Choose a password different from your current one" : undefined}
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
          {submitting ? "Updating password…" : forced ? "Set password and continue" : "Change password"}
        </button>
      </form>
    </AuthLayout>
  );
}
