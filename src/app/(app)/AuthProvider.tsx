"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch, ApiError, PASSWORD_CHANGE_REQUIRED_EVENT, refreshSession, SESSION_EXPIRED_EVENT } from "@/lib/api/client";
import { grants, homePathFor, normalizeProducts, productForHref, type Product } from "@/lib/products";

export interface Me {
  id: string;
  name: string;
  email: string;
  businessId: string;
  role: { id: string; name: string } | null;
  permissions: string[];
  /** Products the workspace has bought (ERP, HRMS). */
  products: Product[];
  /** Employee record linked to this login (self-service), if any. */
  employeeId: string | null;
  /** How many employees report to this login's employee record (they can decide those people's leave). */
  directReports?: number;
  /** Signed in with a temporary password; the app is blocked until it is changed. */
  mustChangePassword?: boolean;
  business: {
    name: string;
    currency: string;
    state?: string;
    gstin?: string;
    phone?: string;
    email?: string;
    city?: string;
    address?: string;
    plan?: string | null;
    maxEmployees?: number | null;
    subscriptionEndsAt?: string | null;
  } | null;
  financialYear: { label: string; startDate: string; endDate: string } | null;
}

interface AuthContextValue {
  me: Me | null;
  loading: boolean;
  /** Role grants the permission and the workspace's products include its module. */
  hasPermission: (permission: string) => boolean;
  hasProduct: (product: Product) => boolean;
  /** Whether a screen's product is part of this workspace (core screens always are). */
  canReach: (href: string) => boolean;
  /** Where this person's home screen is (ERP dashboard, HR dashboard or their own workspace). */
  homePath: string;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const signedIn = useRef(false);
  const pathRef = useRef(pathname);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const load = useCallback(async () => {
    try {
      let data = await apiFetch<Me & { stale?: boolean }>("/api/auth/me");
      // HR changed this login's role, permissions or access since the token was issued:
      // renew the token so the server enforces the new rights too, without signing out.
      if (data.stale && (await refreshSession())) {
        data = await apiFetch<Me & { stale?: boolean }>("/api/auth/me");
      }
      signedIn.current = true;
      const next: Me = { ...data, products: normalizeProducts(data.products) };
      delete (next as Me & { stale?: boolean }).stale;
      setMe((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      if (data.mustChangePassword) {
        router.replace(`/change-password?next=${encodeURIComponent(pathRef.current)}`);
      }
    } catch (err) {
      // First load with no session → sign-in, remembering where they were going.
      if (err instanceof ApiError && !signedIn.current) {
        router.replace(`/login?next=${encodeURIComponent(pathRef.current)}`);
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // Fetch-on-mount: setState happens inside load()'s async body after an
    // await, not synchronously in the effect — standard pattern, safe here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Pick up changes HR makes while this person is signed in: on returning to the tab and every minute.
  useEffect(() => {
    function recheck() {
      if (signedIn.current && document.visibilityState === "visible") load();
    }
    const timer = window.setInterval(recheck, 60_000);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [load]);

  // A session that dies mid-use (refresh token revoked or expired) gets an
  // explanation rather than a silent bounce to the login form.
  useEffect(() => {
    function onExpired() {
      if (!signedIn.current) return;
      signedIn.current = false;
      router.replace(`/session-expired?next=${encodeURIComponent(pathRef.current)}`);
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [router]);

  // A temporary password set by an admin (or a reset) blocks every screen until it is replaced.
  useEffect(() => {
    function onPasswordChangeRequired() {
      router.replace(`/change-password?next=${encodeURIComponent(pathRef.current)}`);
    }
    window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, onPasswordChangeRequired);
    return () => window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, onPasswordChangeRequired);
  }, [router]);

  const hasPermission = useCallback(
    (permission: string) => !!me && grants(me.permissions, me.products, permission),
    [me]
  );
  const hasProduct = useCallback((product: Product) => !!me && me.products.includes(product), [me]);
  const canReach = useCallback(
    (href: string) => {
      if (!me) return false;
      // Self-service shows the signed-in person's own employee record; without one there is nothing to show.
      if ((href === "/hr/me" || href.startsWith("/hr/me/")) && !me.employeeId) return false;
      if (href === "/hr/me/team" && !me.directReports) return false;
      const product = productForHref(href);
      return product === null || me.products.includes(product);
    },
    [me]
  );
  const homePath = me ? homePathFor(me.permissions, me.products, Boolean(me.employeeId)) : "/dashboard";

  return (
    <AuthContext.Provider value={{ me, loading, hasPermission, hasProduct, canReach, homePath, refresh: load }}>
      {/* Nothing behind the shell is usable until a temporary password is replaced; the redirect is under way. */}
      {me?.mustChangePassword ? null : children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
