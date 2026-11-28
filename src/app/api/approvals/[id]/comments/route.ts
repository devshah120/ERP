import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { addComment, commentSchema } from "@/lib/approvals/service";
import "@/models";

/** Adds a comment to an approval; anyone who can see it may comment, and the others on it are told. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  const { text } = commentSchema.parse(await req.json());
  return ok(await addComment(ctx, id, text), "Comment added");
});
