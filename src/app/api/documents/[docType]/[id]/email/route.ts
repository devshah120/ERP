import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getDocumentDefinition } from "@/lib/documents/registry";
import { buildDocumentEmailHtml, sendDocumentEmail } from "@/lib/documents/email";
import { recordAudit } from "@/lib/services/auditService";
import { Business } from "@/models/Business";
import "@/models";

const emailSchema = z.object({
  /** Defaults to the party's address on the document. */
  to: z.string().trim().email("Enter a valid email address").optional(),
  subject: z.string().trim().max(200).optional(),
});

export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { docType, id } = await params;
  const def = getDocumentDefinition(docType);
  if (!def) throw AppError.notFound("Unknown document type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, def.permissions.view);

  const input = emailSchema.parse(await req.json().catch(() => ({})));

  const [doc, business] = await Promise.all([
    def.model.findOne({ _id: id, businessId: ctx.businessId }).lean(),
    Business.findById(ctx.businessId).lean(),
  ]);
  if (!doc) throw AppError.notFound(`${def.label} not found`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const party = (doc as any)[def.party.snapshotField] ?? {};
  const to = input.to ?? party.email;
  if (!to) {
    throw AppError.badRequest(
      `No email address on file for ${party.name ?? def.party.label}. Add one to the ${def.party.label.toLowerCase()} record, or enter an address to send to.`,
      "NO_RECIPIENT"
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = business as any;
  const html = buildDocumentEmailHtml({
    doc,
    documentLabel: def.label,
    businessName: b?.name ?? "Your business",
    businessGstin: b?.gstin,
    partyName: party.name ?? "Customer",
  });

  await sendDocumentEmail({
    to,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subject: input.subject ?? `${def.label} ${(doc as any).documentNumber} from ${b?.name ?? "us"}`,
    html,
  });

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: def.key,
    documentType: def.key,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    documentId: (doc as any)._id,
    newValue: { emailedTo: to },
    reason: "Document emailed",
  });

  return ok({ to }, `${def.label} emailed to ${to}`);
});
