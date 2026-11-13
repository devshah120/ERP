import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SA_COOKIE } from "@/lib/auth/superAdminTokens";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect /superadmin routes except /superadmin/login and API routes
  if (pathname.startsWith("/superadmin") && pathname !== "/superadmin/login") {
    const saToken = request.cookies.get(SA_COOKIE)?.value;
    if (!saToken) {
      const loginUrl = new URL("/superadmin/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/superadmin/:path*"],
};

