"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch, ApiError, SESSION_EXPIRED_EVENT } from "@/lib/api/client";

export interface Me {
  id: string;
  name: string;
  username: string;
  email: string;
  businessId: string;
  role: { id: string; name: string } | null;
  permissions: string[];
  business: { name: string; currency: string; state?: string; gstin?: string } | null;
  financialYear: { label: string; startDate: string; endDate: string } | null;
}

interface AuthContextValue {
  me: Me | null;
  loading: boolean;
  hasPermission: (permission: string) => boolean;
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
      const data = await apiFetch<Me>("/api/auth/me");
      signedIn.current = true;
      setMe(data);
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

  const hasPermission = useCallback(
    (permission: string) => !!me && (me.permissions.includes("*") || me.permissions.includes(permission)),
    [me]
  );

  return (
    <AuthContext.Provider value={{ me, loading, hasPermission, refresh: load }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
