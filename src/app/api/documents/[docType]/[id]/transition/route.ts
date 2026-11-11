import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getDocumentDefinition } from "@/lib/documents/registry";
import { transitionDocument } from "@/lib/documents/transitions";
import "@/models";

const transitionSchema = z.object({
  toStatus: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
});

/** Every status change goes through here — the workflow decides what's legal,
 * and the side effects (stock movement, fulfilment roll-up) run atomically. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { docType, id } = await params;
  const def = getDocumentDefinition(docType);
  if (!def) throw AppError.notFound("Unknown document type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, def.permissions.edit);

  const { toStatus, reason } = transitionSchema.parse(await req.json());
  const doc = await transitionDocument(docType, id, toStatus, reason, ctx);

  return ok(doc, `${def.label} moved to ${toStatus}`);
});
