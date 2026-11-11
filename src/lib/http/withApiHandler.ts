import { NextRequest } from "next/server";
import { ZodError } from "zod";
import { connectToDatabase } from "@/lib/db/connect";
import { AppError } from "@/lib/errors/AppError";
import { fail } from "@/lib/http/response";

type RouteContext = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: RouteContext) => Promise<Response>;

function isDuplicateKeyError(err: unknown): err is { code: number; keyPattern?: Record<string, unknown> } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === 11000
  );
}

/**
 * Wraps every API route handler: ensures the DB connection is established,
 * and converts thrown errors into the standardized { success, message, code }
 * response shape. Unexpected (non-AppError) errors are logged server-side
 * with full detail and returned to the client as a generic 500 — internals
 * are never leaked (Section 29/30).
 */
export function withApiHandler(handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      await connectToDatabase();
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof AppError) {
        return fail(err.message, err.statusCode, err.code, err.errors);
      }

      if (err instanceof ZodError) {
        return fail("Validation failed", 400, "VALIDATION_ERROR", err.issues);
      }

      // MongoDB duplicate-key error (E11000) from a race on a unique index —
      // e.g. two concurrent registrations claiming the same domain. Without
      // this, every future module that relies on a unique index for
      // correctness (customer code, item SKU, username, ...) would leak a
      // raw 500 on the losing request instead of a clean 409.
      if (isDuplicateKeyError(err)) {
        const field = Object.keys(err.keyPattern ?? {})[0] ?? "value";
        return fail(`This ${field} is already in use`, 409, "DUPLICATE_KEY");
      }

      console.error("[UNHANDLED_API_ERROR]", req.method, req.nextUrl.pathname, err);
      return fail("An unexpected error occurred", 500, "INTERNAL_ERROR");
    }
  };
}
