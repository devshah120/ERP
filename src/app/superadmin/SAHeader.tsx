"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/superadmin/dashboard", label: "Dashboard" },
  { href: "/superadmin/companies", label: "Companies" },
  { href: "/superadmin/companies/new", label: "+ New account" },
];

/** Top bar shared by every admin-portal page. */
export default function SAHeader() {
  const router = useRouter();
  const pathname = usePathname();

  async function signOut() {
    await fetch("/api/superadmin/logout", { method: "POST" });
    router.replace("/superadmin/login");
  }

  // The longest matching link is the current one, so /companies/new doesn't also light up /companies.
  const active = LINKS.filter((l) => pathname === l.href || pathname.startsWith(`${l.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <header className="saHeader">
      <div className="saHeaderBrand">
        NEXORA <span className="saHeaderTag">Admin Portal</span>
      </div>
      <nav className="saHeaderNav">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`saNavLink ${active === l.href ? "saNavLinkActive" : ""}`}>
            {l.label}
          </Link>
        ))}
      </nav>
      <button type="button" className="saBtn saBtnGhost saBtnSm" onClick={signOut}>
        Sign out
      </button>
    </header>
  );
}

export function ProductTags({ products }: { products: string[] }) {
  return (
    <>
      {products.map((p) => (
        <span key={p} className={`saTag saTag${p}`}>
          {p}
        </span>
      ))}
    </>
  );
}

export const PLAN_OPTIONS = [
  { value: "TRIAL", label: "Trial" },
  { value: "STARTER", label: "Starter" },
  { value: "GROWTH", label: "Growth" },
  { value: "ENTERPRISE", label: "Enterprise" },
];

export function fmtDate(v: string | null | undefined) {
  return v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
}
