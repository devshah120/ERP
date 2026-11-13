import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getSAContext } from "@/lib/auth/superAdminContext";
import { Business } from "@/models/Business";
import { User } from "@/models/User";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest) => {
  getSAContext(req);

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // "ACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION" | null = all

  const filter = status ? { status } : {};
  const businesses = await Business.find(filter)
    .sort({ createdAt: -1 })
    .select("legalName tradeName domain email phone status createdAt gstin country")
    .lean();

  // Attach user count per business
  const ids = businesses.map((b) => b._id);
  const counts = await User.aggregate([
    { $match: { businessId: { $in: ids } } },
    { $group: { _id: "$businessId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [c._id.toString(), c.count as number]));

  const items = businesses.map((b) => ({
    id: b._id.toString(),
    legalName: b.legalName,
    tradeName: b.tradeName,
    domain: b.domain,
    email: b.email,
    phone: b.phone,
    status: b.status,
    country: b.country,
    gstin: b.gstin ?? null,
    userCount: countMap.get(b._id.toString()) ?? 0,
    createdAt: b.createdAt,
  }));

  // Summary counts for dashboard cards
  const summary = {
    total: items.length,
    active: items.filter((i) => i.status === "ACTIVE").length,
    suspended: items.filter((i) => i.status === "SUSPENDED").length,
    pending: items.filter((i) => i.status === "PENDING_VERIFICATION").length,
  };

  return ok({ items, summary });
});

