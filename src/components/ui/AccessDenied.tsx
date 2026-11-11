import Link from "next/link";
import { IconLock } from "@/components/icons";

/**
 * Shown in place of a screen the signed-in user's role can't open. States the
 * missing permission so an owner knows exactly what to grant.
 */
export default function AccessDenied({ detail }: { detail?: string }) {
  return (
    <div className="statusPage">
      <div className="statusPageInner">
        <span className="authIconBadge warn">
          <IconLock />
        </span>
        <div className="statusCode">403 · NO ACCESS</div>
        <h1 className="title">You don&apos;t have access to this</h1>
        <p className="subtitle">
          Your role doesn&apos;t include permission for this screen. Ask the workspace owner to update your role if you
          need it.
          {detail && (
            <>
              <br />
              <span className="cellMono" style={{ color: "var(--text-tertiary)" }}>
                {detail}
              </span>
            </>
          )}
        </p>
        <div className="statusPageActions">
          <Link href="/dashboard" className="button buttonPrimary">
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

/** True when an API error means "forbidden" rather than "broken". */
export function isForbidden(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    ((err as { status?: number }).status === 403 || (err as { code?: string }).code === "FORBIDDEN")
  );
}
