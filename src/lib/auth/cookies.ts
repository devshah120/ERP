import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";

export const ACCESS_TOKEN_COOKIE = "erp_access_token";
export const REFRESH_TOKEN_COOKIE = "erp_refresh_token";
/** Present (value "0") when the user signed in without "Remember me", so a
 * refresh rotation keeps the session browser-scoped instead of silently
 * upgrading it to a 30-day one. */
export const SESSION_ONLY_COOKIE = "erp_session_only";

function baseCookieOptions() {
  const { NODE_ENV } = getEnv();
  return {
    httpOnly: true,
    secure: NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

/**
 * persistent = true (default): cookies survive a browser restart for the
 * refresh-token lifetime. false: session cookies, gone when the browser closes.
 */
export function setAuthCookies(
  res: NextResponse,
  accessToken: string,
  refreshToken: string,
  options: { persistent?: boolean } = {}
) {
  const { JWT_ACCESS_TTL_SECONDS, JWT_REFRESH_TTL_SECONDS } = getEnv();
  const persistent = options.persistent ?? true;

  res.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, {
    ...baseCookieOptions(),
    maxAge: JWT_ACCESS_TTL_SECONDS,
  });
  res.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...baseCookieOptions(),
    ...(persistent ? { maxAge: JWT_REFRESH_TTL_SECONDS } : {}),
    path: "/api/auth",
  });
  if (persistent) {
    res.cookies.set(SESSION_ONLY_COOKIE, "", { ...baseCookieOptions(), maxAge: 0, path: "/api/auth" });
  } else {
    res.cookies.set(SESSION_ONLY_COOKIE, "0", { ...baseCookieOptions(), path: "/api/auth" });
  }
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.set(ACCESS_TOKEN_COOKIE, "", { ...baseCookieOptions(), maxAge: 0 });
  res.cookies.set(REFRESH_TOKEN_COOKIE, "", { ...baseCookieOptions(), maxAge: 0, path: "/api/auth" });
  res.cookies.set(SESSION_ONLY_COOKIE, "", { ...baseCookieOptions(), maxAge: 0, path: "/api/auth" });
}
