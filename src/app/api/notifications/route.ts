import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { listNotifications, markNotificationsRead, notificationListSchema } from "@/lib/approvals/service";
import "@/models";

/** The signed-in user's own notices (approvals waiting for them, decisions and comments on theirs). */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  return ok(await listNotifications(ctx, notificationListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

const readSchema = z.object({ ids: z.union([z.literal("all"), z.array(z.string().trim()).max(200)]) });

/** Marks notices read: the given ids, or "all". */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  const { ids } = readSchema.parse(await req.json());
  return ok(await markNotificationsRead(ctx, ids));
});
