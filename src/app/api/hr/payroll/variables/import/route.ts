import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/AppError";
import "@/models";
import { parseImportFile } from "@/lib/import/service";
import { importVariables } from "@/lib/hr/variables";
import { monthQuery } from "@/lib/hr/common";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Upload a variable pay sheet: commit=false checks it, commit=true saves it when there are no errors. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.process");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw AppError.badRequest("Attach a file to import", "NO_FILE");
  if (file.size > MAX_UPLOAD_BYTES) throw AppError.badRequest("File is larger than 5 MB", "FILE_TOO_LARGE");
  const { year, month } = monthQuery.parse({ year: form.get("year"), month: form.get("month") });
  const commit = String(form.get("commit") ?? "") === "true";
  const result = await importVariables(ctx, await parseImportFile(file), year, month, commit);
  return ok(result, result.approvalMessage ?? (result.committed ? "Variable pay imported" : undefined));
});
