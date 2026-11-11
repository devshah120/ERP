import Link from "next/link";
import AuthLayout from "@/components/auth/AuthLayout";
import { IconClock } from "@/components/icons";
import { safeNext } from "@/lib/auth/safeNext";

/**
 * Where a signed-in user lands when their session can no longer be renewed
 * (signed out elsewhere, password reset, or 30 days of inactivity). Explains
 * what happened instead of silently dropping them on the login form, and
 * returns them to the page they were on after signing in again.
 */
export default async function SessionExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safe = safeNext(next);

  return (
    <AuthLayout>
      <span className="authIconBadge warn">
        <IconClock />
      </span>
      <h1 className="title">Your session has ended</h1>
      <p className="subtitle">
        For your security you&apos;ve been signed out. This happens after a long period of inactivity, when you sign
        out on another device, or after a password reset. Anything you hadn&apos;t saved on the last screen was not
        stored.
      </p>
      <Link href={`/login?next=${encodeURIComponent(safe)}`} className="button buttonPrimary buttonLg buttonBlock">
        Sign in again
      </Link>
      <p className="footerRow">
        You&apos;ll be returned to where you left off.
      </p>
    </AuthLayout>
  );
}
