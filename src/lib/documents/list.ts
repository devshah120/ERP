import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { TenantRepository } from "@/lib/repositories/TenantRepository";
import { serializeDoc } from "@/lib/resources/serialize";
import { getDocumentDefinition } from "./registry";
import type { AuthContext } from "@/lib/auth/context";

const listQuerySchema = z.object({
  /** Free-text search across document number and party name. */
  query: z.string().trim().max(200).optional(),
  documentNumber: z.string().trim().max(60).optional(),
  /** Party name — resolved against customer.name or vendor.name per doc type. */
  partyName: z.string().trim().max(200).optional(),
  status: z.string().trim().max(40).optional(),
  /** Comma-separated status list, for drill-throughs covering several states. */
  statusIn: z.string().trim().max(200).optional(),
  paymentStatus: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]).optional(),
  /** "true" → only documents with money still owed. */
  outstanding: z.enum(["true", "false"]).optional(),
  /** "true" → some ordered quantity has not been invoiced/delivered yet. */
  pendingInvoice: z.enum(["true", "false"]).optional(),
  pendingDelivery: z.enum(["true", "false"]).optional(),
  /** Aging window in days, measured from due date (or document date). */
  minAgeDays: z.coerce.number().int().min(0).max(3650).optional(),
  maxAgeDays: z.coerce.number().int().min(0).max(3650).optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  sortBy: z.string().trim().max(40).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(15),
});

const SORTABLE = ["documentNumber", "documentDate", "status", "createdAt", "totals.grandTotal"];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listDocuments(
  docTypeKey: string,
  searchParams: Record<string, string>,
  ctx: AuthContext,
  /** Export path only: raise the page size above the interactive cap so a
   *  file can hold the whole filtered set rather than one screen. */
  options?: { pageSizeOverride?: number }
) {
  const def = getDocumentDefinition(docTypeKey);
  if (!def) throw AppError.notFound("Unknown document type");

  const parsed = listQuerySchema.parse(searchParams);
  const query = options?.pageSizeOverride
    ? { ...parsed, page: 1, pageSize: options.pageSizeOverride }
    : parsed;
  const repo = new TenantRepository(def.model);

  // Party lives under customer.name on sales documents and vendor.name on
  // purchase documents — resolved from the definition rather than assumed,
  // otherwise the filter silently matches nothing on one side of the ledger.
  const partyNamePath = `${def.party.snapshotField}.name`;

  const filter: Record<string, unknown> = {};
  if (query.documentNumber) {
    filter.documentNumber = { $regex: escapeRegex(query.documentNumber), $options: "i" };
  }
  if (query.partyName) {
    filter[partyNamePath] = { $regex: escapeRegex(query.partyName), $options: "i" };
  }
  if (query.query) {
    const needle = escapeRegex(query.query);
    filter.$or = [
      { documentNumber: { $regex: needle, $options: "i" } },
      { [partyNamePath]: { $regex: needle, $options: "i" } },
    ];
  }
  if (query.status) filter.status = query.status;
  else if (query.statusIn) {
    const list = query.statusIn
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (list.length > 0) filter.status = { $in: list };
  }

  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;

  // Analytics drill-throughs. These reproduce, as a list, exactly the set of
  // documents a dashboard figure was computed from — so a headline number and
  // the rows behind it can never disagree.
  const expressions: Record<string, unknown>[] = [];

  if (query.outstanding === "true") {
    // Money is only owed on a posted document; a draft is not yet a claim.
    filter.status = filter.status ?? { $nin: ["CANCELLED", "DRAFT"] };
    filter.dueAmount = { $gt: 0 };
  }

  if (query.pendingInvoice === "true" || query.pendingDelivery === "true") {
    const field = query.pendingInvoice === "true" ? "invoicedQty" : "deliveredQty";
    if (!query.status && !query.statusIn) {
      filter.status = { $nin: ["CANCELLED", "DRAFT", "REJECTED", "EXPIRED"] };
    }
    expressions.push({
      $gt: [
        {
          $size: {
            $filter: {
              input: "$lines",
              as: "l",
              cond: { $lt: [`$$l.${field}`, "$$l.quantity"] },
            },
          },
        },
        0,
      ],
    });
  }

  if (query.minAgeDays !== undefined || query.maxAgeDays !== undefined) {
    const age = {
      $dateDiff: {
        startDate: { $ifNull: ["$dueDate", "$documentDate"] },
        endDate: new Date(),
        unit: "day",
      },
    };
    if (query.minAgeDays !== undefined) expressions.push({ $gte: [age, query.minAgeDays] });
    if (query.maxAgeDays !== undefined) expressions.push({ $lte: [age, query.maxAgeDays] });
  }

  if (expressions.length === 1) filter.$expr = expressions[0];
  else if (expressions.length > 1) filter.$expr = { $and: expressions };

  if (query.fromDate || query.toDate) {
    const range: Record<string, Date> = {};
    if (query.fromDate) range.$gte = new Date(query.fromDate);
    if (query.toDate) {
      const to = new Date(query.toDate);
      to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
    filter.documentDate = range;
  }

  const sortBy = query.sortBy && SORTABLE.includes(query.sortBy) ? query.sortBy : "documentDate";
  const sort = { [sortBy]: query.sortDir === "asc" ? 1 : -1 } as Record<string, 1 | -1>;
  const skip = (query.page - 1) * query.pageSize;

  const [docs, total] = await Promise.all([
    repo.find(ctx.businessId, filter, { sort, skip, limit: query.pageSize }),
    repo.count(ctx.businessId, filter),
  ]);

  return {
    items: docs.map((d) => serializeDoc(d)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
