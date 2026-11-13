"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { IconAlertCircle, IconEye, IconEyeOff } from "@/components/icons";

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/superadmin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.message ?? "Invalid credentials.");
        return;
      }
      router.push("/superadmin/dashboard");
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="saPage saPageCenter">
      <div className="saLoginCard">
        <div className="saLoginBrand">NEXORA</div>
        <div className="saLoginBadge">Admin Portal</div>

        <h1 className="saLoginTitle">Super Admin Sign In</h1>
        <p className="saLoginSub">Access is restricted to the product owner.</p>

        {error && (
          <div className="saBanner saBannerError" role="alert">
            <IconAlertCircle />
            <span>{error}</span>
          </div>
        )}

        <form className="saForm" onSubmit={handleSubmit} noValidate>
          <div className="saField">
            <label htmlFor="sa-email">Email</label>
            <input
              id="sa-email"
              className="saInput"
              type="email"
              required
              autoFocus
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@nexora.in"
            />
          </div>

          <div className="saField">
            <label htmlFor="sa-password">Password</label>
            <div className="saPasswordWrap">
              <input
                id="sa-password"
                className="saInput"
                type={showPw ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="saPasswordToggle"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </div>

          <button type="submit" className="saBtn saBtnPrimary saBtnBlock" disabled={submitting}>
            {submitting && <span className="spinner" />}
            {submitting ? "Signing in…" : "Sign in →"}
          </button>
        </form>
      </div>
    </div>
  );
}

