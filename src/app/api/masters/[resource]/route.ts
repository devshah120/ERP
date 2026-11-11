import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { AppError } from "@/lib/errors/AppError";
import { getResource } from "@/lib/resources/registry";
import { listHandler, createHandler } from "@/lib/resources/handlers";
import "@/models";

/**
 * Single collection endpoint serving every master-data resource, dispatched
 * by the `resource` slug against the registry. Keeps list/create behaviour
 * (tenant scoping, permissions, search, sort, paging, audit) identical
 * across all masters instead of duplicating it per entity.
 */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { resource } = await params;
  const def = getResource(resource);
  if (!def) throw AppError.notFound("Unknown resource");

  return listHandler(def)(req);
});

export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { resource } = await params;
  const def = getResource(resource);
  if (!def) throw AppError.notFound("Unknown resource");

  return createHandler(def)(req);
});
