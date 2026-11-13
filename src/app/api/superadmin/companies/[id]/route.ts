import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getSAContext } from "@/lib/auth/superAdminContext";
import { AppError } from "@/lib/errors/AppError";
import { Business } from "@/models/Business";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  getSAContext(req);
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Company not found");

  const b = await Business.findById(id)
    .select("legalName tradeName domain email phone status country state city address gstin registrationNumber financialYearStartMonth currency createdAt")
    .lean();
  if (!b) throw AppError.notFound("Company not found");

  return ok({
    id: b._id.toString(),
    legalName: b.legalName,
    tradeName: b.tradeName,
    domain: b.domain,
    email: b.email,
    phone: b.phone,
    status: b.status,
    country: b.country,
    state: b.state,
    city: b.city,
    address: b.address,
    gstin: b.gstin ?? null,
    registrationNumber: b.registrationNumber ?? null,
    currency: b.currency,
    financialYearStartMonth: b.financialYearStartMonth,
    createdAt: b.createdAt,
  });
});

const patchSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

export const PATCH = withApiHandler(async (req: NextRequest, { params }) => {
  getSAContext(req);
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Company not found");

  const { status } = patchSchema.parse(await req.json());
  const b = await Business.findByIdAndUpdate(id, { status }, { new: true }).select("legalName status").lean();
  if (!b) throw AppError.notFound("Company not found");

  return ok({ id: b._id.toString(), legalName: b.legalName, status: b.status });
});

