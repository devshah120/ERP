import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AppError } from "@/lib/errors/AppError";
import { verifySAToken, SA_COOKIE } from "@/lib/auth/superAdminTokens";

/**
 * Reads the SA cookie from a NextRequest (API route).
 * Throws 401 AppError if the cookie is missing or the token is invalid/expired.
 */
export function getSAContext(req: NextRequest): void {
  const token = req.cookies.get(SA_COOKIE)?.value;
  if (!token) throw AppError.unauthorized("Super Admin session required", "SA_UNAUTHORIZED");
  try {
    verifySAToken(token);
  } catch {
    throw AppError.unauthorized("Super Admin session expired, please sign in again", "SA_SESSION_EXPIRED");
  }
}

/**
 * Server-Component variant — reads from the Next.js cookies store.
 * Returns true if a valid SA session exists, false otherwise.
 */
export async function getServerSAContext(): Promise<boolean> {
  try {
    const store = await cookies();
    const token = store.get(SA_COOKIE)?.value;
    if (!token) return false;
    verifySAToken(token);
    return true;
  } catch {
    return false;
  }
}

/** Sets the SA httpOnly cookie on a NextResponse. */
export function setSACookie(res: NextResponse, token: string): void {
  res.cookies.set(SA_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60, // 8 h — matches token TTL
  });
}

/** Clears the SA cookie. */
export function clearSACookie(res: NextResponse): void {
  res.cookies.set(SA_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

