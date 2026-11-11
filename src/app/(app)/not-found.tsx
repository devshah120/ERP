import Link from "next/link";
import { IconSearch } from "@/components/icons";

export default function AppNotFound() {
  return (
    <div className="statusPage">
      <div className="statusPageInner">
        <span className="authIconBadge">
          <IconSearch />
        </span>
        <div className="statusCode">404 · NOT FOUND</div>
        <h1 className="title">This page doesn&apos;t exist</h1>
        <p className="subtitle">
          The link may be mistyped, or the module isn&apos;t part of this workspace. Use search (Ctrl + K) to jump to
          any screen or record.
        </p>
        <div className="statusPageActions">
          <Link href="/dashboard" className="button buttonPrimary">
            Go to dashboard
          </Link>
          <Link href="/reports" className="button buttonSecondary">
            Browse reports
          </Link>
        </div>
      </div>
    </div>
  );
}
