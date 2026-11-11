import Link from "next/link";
import AuthLayout from "@/components/auth/AuthLayout";
import { IconSearch } from "@/components/icons";

export default function NotFound() {
  return (
    <AuthLayout>
      <span className="authIconBadge">
        <IconSearch />
      </span>
      <div className="statusCode">404 · NOT FOUND</div>
      <h1 className="title">We couldn&apos;t find that page</h1>
      <p className="subtitle">The link may be mistyped or out of date.</p>
      <Link href="/dashboard" className="button buttonPrimary buttonLg buttonBlock">
        Go to your workspace
      </Link>
    </AuthLayout>
  );
}
