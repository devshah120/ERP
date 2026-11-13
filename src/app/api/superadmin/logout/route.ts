import { NextRequest, NextResponse } from "next/server";
import { clearSACookie } from "@/lib/auth/superAdminContext";

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ success: true, data: null }, { status: 200 });
  clearSACookie(res);
  return res;
}

