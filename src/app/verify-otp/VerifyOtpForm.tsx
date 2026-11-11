"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api/client";
import AuthLayout from "@/components/auth/AuthLayout";
import OtpInput from "@/components/auth/OtpInput";
import { IconAlertCircle, IconCheckCircle, IconMailCheck } from "@/components/icons";

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const businessId = searchParams.get("businessId") ?? "";
  const target = searchParams.get("target") ?? "";

  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "verifying" | "error" | "success">("idle");
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // The first code was just sent by registration, so start on cooldown.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  // Counts down one second at a time while there's time left.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const startCooldown = () => setCooldown(RESEND_COOLDOWN_SECONDS);

  async function verify(value: string) {
    if (value.length !== 6 || state === "verifying" || state === "success") return;
    setError(null);
    setInfo(null);
    setState("verifying");
    try {
      await apiFetch("/api/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ businessId, code: value }),
      });
      setState("success");
      setTimeout(() => router.push("/login?verified=1"), 900);
    } catch (err) {
      setState("error");
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    }
  }

  async function handleResend() {
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      await apiFetch("/api/auth/resend-otp", {
        method: "POST",
        body: JSON.stringify({ businessId }),
      });
      setInfo("A new code is on its way. The previous one no longer works.");
      setCode("");
      setState("idle");
      startCooldown();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setResending(false);
    }
  }

  if (!businessId) {
    return (
      <AuthLayout>
        <span className="authIconBadge danger">
          <IconAlertCircle />
        </span>
        <h1 className="title">This verification link is incomplete</h1>
        <p className="subtitle">
          We couldn&apos;t tell which registration to verify. Start the registration again — it only takes a minute.
        </p>
        <Link href="/register" className="button buttonPrimary buttonLg buttonBlock">
          Back to registration
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <span className={`authIconBadge ${state === "success" ? "success" : ""}`}>
        {state === "success" ? <IconCheckCircle /> : <IconMailCheck />}
      </span>
      <h1 className="title">{state === "success" ? "Business verified" : "Check your email"}</h1>
      <p className="subtitle">
        {state === "success" ? (
          "Taking you to sign in…"
        ) : target ? (
          <>
            We sent a 6-digit code to <strong style={{ color: "var(--text)" }}>{target}</strong>. Enter it to
            activate your workspace. It expires in 10 minutes.
          </>
        ) : (
          "Enter the 6-digit code we emailed you."
        )}
      </p>

      {error && (
        <div className="banner bannerError" style={{ marginBottom: "1.25rem" }} role="alert">
          <IconAlertCircle />
          <span>{error}</span>
        </div>
      )}
      {info && (
        <div className="banner bannerSuccess" style={{ marginBottom: "1.25rem" }} role="status">
          <IconCheckCircle />
          <span>{info}</span>
        </div>
      )}

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          verify(code);
        }}
      >
        <OtpInput
          value={code}
          onChange={(c) => {
            setCode(c);
            if (state === "error") setState("idle");
          }}
          onComplete={verify}
          state={state === "error" ? "error" : state === "success" ? "success" : "idle"}
          disabled={state === "verifying" || state === "success"}
        />

        <button
          type="submit"
          className="button buttonPrimary buttonLg buttonBlock"
          disabled={code.length !== 6 || state === "verifying" || state === "success"}
        >
          {state === "verifying" && <span className="spinner" />}
          {state === "verifying" ? "Verifying…" : state === "success" ? "Verified" : "Verify & activate"}
        </button>
      </form>

      <p className="footerRow">
        Didn&apos;t get it? Check spam, or{" "}
        <button type="button" className="buttonLink" onClick={handleResend} disabled={resending || cooldown > 0}>
          {cooldown > 0 ? `resend in ${cooldown}s` : resending ? "sending…" : "send a new code"}
        </button>
        .
      </p>
      <p className="legalNote" style={{ marginTop: "0.75rem" }}>
        Wrong email address? <Link href="/register" className="textLink">Register again</Link> with the right one.
      </p>
    </AuthLayout>
  );
}
