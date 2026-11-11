import { z } from "zod";
import { moneyStringSchema } from "@/lib/validation/money";
import { gstinSchema } from "@/lib/validation/gstin";
import { CUSTOMER_STATUSES, BALANCE_TYPES } from "@/models/Customer";

const addressInputSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  country: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().max(20).optional(),
});

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(200),
  companyName: z.string().trim().max(200).optional(),
  contactPerson: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  phone: z.string().trim().min(7).max(20),
  alternatePhone: z.string().trim().max(20).optional(),
  billingAddress: addressInputSchema,
  shippingAddress: addressInputSchema.optional(),
  gstin: gstinSchema,
  creditLimit: moneyStringSchema.default("0"),
  creditDays: z.number().int().min(0).max(3650).default(0),
  paymentTerms: z.string().trim().max(100).optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  salespersonId: z.string().trim().optional(),
  customerGroup: z.string().trim().max(100).optional(),
  openingBalance: moneyStringSchema.default("0"),
  openingBalanceType: z.enum(BALANCE_TYPES).default("DEBIT"),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  status: z.enum(CUSTOMER_STATUSES).optional(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

const SORTABLE_FIELDS = ["customerCode", "name", "companyName", "phone", "email", "createdAt"] as const;

export const listCustomersQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  customerCode: z.string().trim().max(100).optional(),
  name: z.string().trim().max(100).optional(),
  companyName: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(100).optional(),
  email: z.string().trim().max(100).optional(),
  sortBy: z.enum(SORTABLE_FIELDS).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  // Kept in step with the generic masters framework's limit
  // (src/lib/resources/handlers.ts). They diverged once, and picker
  // dropdowns that request 200 rows silently 400'd as a result.
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
