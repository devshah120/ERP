import { Types } from "mongoose";
import { Customer, type ICustomer } from "@/models/Customer";
import { Business } from "@/models/Business";
import { TenantRepository } from "@/lib/repositories/TenantRepository";
import { getNextMasterCode } from "@/lib/services/masterNumberingService";
import { stringToDecimal128, decimal128ToString } from "@/lib/money/decimal";
import { AppError } from "@/lib/errors/AppError";
import type { CreateCustomerInput, UpdateCustomerInput, ListCustomersQuery } from "@/lib/validation/customerSchemas";

const customerRepository = new TenantRepository(Customer);

export interface CustomerDTO {
  id: string;
  customerCode: string;
  name: string;
  companyName?: string;
  contactPerson?: string;
  email?: string;
  phone: string;
  alternatePhone?: string;
  billingAddress: ICustomer["billingAddress"];
  shippingAddress?: ICustomer["shippingAddress"];
  gstin?: string;
  creditLimit: string;
  creditDays: number;
  paymentTerms?: string;
  currency: string;
  salespersonId?: string;
  customerGroup?: string;
  openingBalance: string;
  openingBalanceType: ICustomer["openingBalanceType"];
  status: ICustomer["status"];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

function serialize(doc: ICustomer): CustomerDTO {
  return {
    id: doc._id.toString(),
    customerCode: doc.customerCode,
    name: doc.name,
    companyName: doc.companyName,
    contactPerson: doc.contactPerson,
    email: doc.email,
    phone: doc.phone,
    alternatePhone: doc.alternatePhone,
    billingAddress: doc.billingAddress,
    shippingAddress: doc.shippingAddress,
    gstin: doc.gstin,
    creditLimit: decimal128ToString(doc.creditLimit),
    creditDays: doc.creditDays,
    paymentTerms: doc.paymentTerms,
    currency: doc.currency,
    salespersonId: doc.salespersonId?.toString(),
    customerGroup: doc.customerGroup,
    openingBalance: decimal128ToString(doc.openingBalance),
    openingBalanceType: doc.openingBalanceType,
    status: doc.status,
    notes: doc.notes,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function listCustomers(
  businessId: string,
  query: ListCustomersQuery
): Promise<{ items: CustomerDTO[]; total: number; page: number; pageSize: number }> {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.query) {
    filter.$or = [
      { name: { $regex: escapeRegex(query.query), $options: "i" } },
      { companyName: { $regex: escapeRegex(query.query), $options: "i" } },
      { customerCode: { $regex: escapeRegex(query.query), $options: "i" } },
      { phone: { $regex: escapeRegex(query.query), $options: "i" } },
      { email: { $regex: escapeRegex(query.query), $options: "i" } },
    ];
  }
  if (query.customerCode) filter.customerCode = { $regex: escapeRegex(query.customerCode), $options: "i" };
  if (query.name) filter.name = { $regex: escapeRegex(query.name), $options: "i" };
  if (query.companyName) filter.companyName = { $regex: escapeRegex(query.companyName), $options: "i" };
  if (query.city) filter["billingAddress.city"] = { $regex: escapeRegex(query.city), $options: "i" };
  if (query.phone) filter.phone = { $regex: escapeRegex(query.phone), $options: "i" };
  if (query.email) filter.email = { $regex: escapeRegex(query.email), $options: "i" };

  const skip = (query.page - 1) * query.pageSize;
  const sort = { [query.sortBy]: query.sortDir === "asc" ? 1 : -1 } as Record<string, 1 | -1>;

  const [items, total] = await Promise.all([
    customerRepository.find(businessId, filter, { sort, skip, limit: query.pageSize }),
    customerRepository.count(businessId, filter),
  ]);

  return { items: items.map(serialize), total, page: query.page, pageSize: query.pageSize };
}

export async function getCustomer(businessId: string, id: string): Promise<CustomerDTO> {
  const doc = await customerRepository.findById(businessId, id);
  if (!doc) throw AppError.notFound("Customer not found");
  return serialize(doc);
}

export async function createCustomer(
  businessId: string,
  input: CreateCustomerInput,
  userId: string
): Promise<CustomerDTO> {
  const business = await Business.findById(businessId).lean();
  if (!business) throw AppError.notFound("Business not found");

  const customerCode = await getNextMasterCode({ businessId, entityType: "CUSTOMER", prefix: "CUST" });

  const doc = await customerRepository.create(businessId, {
    customerCode,
    name: input.name,
    companyName: input.companyName,
    contactPerson: input.contactPerson,
    email: input.email || undefined,
    phone: input.phone,
    alternatePhone: input.alternatePhone,
    billingAddress: input.billingAddress,
    shippingAddress: input.shippingAddress,
    gstin: input.gstin,
    creditLimit: stringToDecimal128(input.creditLimit),
    creditDays: input.creditDays,
    paymentTerms: input.paymentTerms,
    currency: input.currency ?? business.currency,
    salespersonId: input.salespersonId ? new Types.ObjectId(input.salespersonId) : undefined,
    customerGroup: input.customerGroup,
    openingBalance: stringToDecimal128(input.openingBalance),
    openingBalanceType: input.openingBalanceType,
    notes: input.notes,
    createdBy: new Types.ObjectId(userId),
    updatedBy: new Types.ObjectId(userId),
  } as Partial<ICustomer>);

  return serialize(doc);
}

export async function updateCustomer(
  businessId: string,
  id: string,
  input: UpdateCustomerInput,
  userId: string
): Promise<CustomerDTO> {
  const update: Record<string, unknown> = { updatedBy: new Types.ObjectId(userId) };

  for (const key of [
    "name",
    "companyName",
    "contactPerson",
    "phone",
    "alternatePhone",
    "billingAddress",
    "shippingAddress",
    "gstin",
    "creditDays",
    "paymentTerms",
    "currency",
    "customerGroup",
    "openingBalanceType",
    "notes",
    "status",
  ] as const) {
    if (input[key] !== undefined) update[key] = input[key];
  }

  if (input.email !== undefined) update.email = input.email || undefined;
  if (input.salespersonId !== undefined) {
    update.salespersonId = input.salespersonId ? new Types.ObjectId(input.salespersonId) : null;
  }
  if (input.creditLimit !== undefined) update.creditLimit = stringToDecimal128(input.creditLimit);
  if (input.openingBalance !== undefined) update.openingBalance = stringToDecimal128(input.openingBalance);

  const doc = await customerRepository.findByIdAndUpdate(businessId, id, update);
  if (!doc) throw AppError.notFound("Customer not found");

  return serialize(doc);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Soft-deletes a customer.
 *
 * Nothing is removed from the database: invoices snapshot the customer's
 * details onto themselves, but the id stays referenced, and a hard delete
 * would break drill-through from every historical document. The record is
 * marked INACTIVE and stamped with deletedAt so listings hide it.
 */
export async function deleteCustomer(businessId: string, id: string, userId: string): Promise<void> {
  const doc = await customerRepository.findByIdAndUpdate(businessId, id, {
    deletedAt: new Date(),
    status: "INACTIVE",
    updatedBy: new Types.ObjectId(userId),
  });
  if (!doc) throw AppError.notFound("Customer not found");
}
