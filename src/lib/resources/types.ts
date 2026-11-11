import type { Model } from "mongoose";
import type { ZodType } from "zod";

/**
 * Server-side definition of a master-data resource. One of these per entity
 * gives it list/search/sort/paginate/create/read/update/soft-delete over the
 * shared handlers in handlers.ts, with tenant scoping, permission checks and
 * audit logging applied uniformly — rather than 10 near-identical route files.
 */
export interface ResourceDefinition {
  /** URL slug, e.g. "vendors". */
  key: string;
  /** Human label used in audit entries and error messages. */
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>;

  /** Auto-generated code field, e.g. { field: "vendorCode", prefix: "VEND", entityType: "VENDOR" }. */
  autoCode?: { field: string; prefix: string; entityType: string };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSchema: ZodType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateSchema: ZodType<any>;

  /** Fields included in the single free-text `query` search. */
  searchFields: string[];
  /** Query-param name → Mongo field path, for per-column filters. */
  filterFields: Record<string, string>;
  /** Field paths allowed in `sortBy`, guarding against arbitrary sort injection. */
  sortableFields: string[];
  defaultSort: string;
  defaultSortDir: "asc" | "desc";

  permissions: { view: string; create: string; edit: string; delete: string };

  /** Converts validated input into the document shape (money strings → Decimal128, id strings → ObjectId). */
  toDocument?: (input: Record<string, unknown>) => Record<string, unknown>;

  /**
   * Equality conditions that scope this resource to a slice of a shared
   * collection, e.g. `{ appliesTo: "SALES" }` when sales and purchase terms
   * live in one model. Applied to every read, and stamped onto every write so
   * a record can never be moved out of its slice through the API.
   */
  baseFilter?: Record<string, string | number | boolean>;
}
