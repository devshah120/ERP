import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getSAContext } from "@/lib/auth/superAdminContext";
import { AppError } from "@/lib/errors/AppError";
import { User } from "@/models/User";
import { Role } from "@/models/Role";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  getSAContext(req);
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Company not found");

  const businessId = new Types.ObjectId(id);

  const [users, roles] = await Promise.all([
    User.find({ businessId })
      .select("name email status roleId lastLoginAt createdAt")
      .sort({ createdAt: 1 })
      .lean(),
    Role.find({ businessId }).select("_id name").lean(),
  ]);

  const roleMap = new Map(roles.map((r) => [r._id.toString(), r.name]));

  const items = users.map((u) => ({
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    status: u.status,
    group: u.roleId ? (roleMap.get(u.roleId.toString()) ?? null) : null,
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: u.createdAt,
  }));

  return ok({ items, total: items.length });
});

