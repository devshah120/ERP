import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { AppError } from "@/lib/errors/AppError";
import { getResource } from "@/lib/resources/registry";
import { getHandler, updateHandler, deleteHandler } from "@/lib/resources/handlers";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { resource, id } = await params;
  const def = getResource(resource);
  if (!def) throw AppError.notFound("Unknown resource");

  return getHandler(def)(req, id);
});

export const PATCH = withApiHandler(async (req: NextRequest, { params }) => {
  const { resource, id } = await params;
  const def = getResource(resource);
  if (!def) throw AppError.notFound("Unknown resource");

  return updateHandler(def)(req, id);
});

export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const { resource, id } = await params;
  const def = getResource(resource);
  if (!def) throw AppError.notFound("Unknown resource");

  return deleteHandler(def)(req, id);
});
