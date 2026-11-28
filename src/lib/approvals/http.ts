import { ok } from "@/lib/http/response";
import { isHeld, type HeldResult } from "./catalog";

/**
 * Response for a module's approve/reject action: when the approval scheme
 * only moved the request on a stage (or just sent it for approval), say
 * that instead of "approved".
 */
export function okDecision<T extends object>(result: T, fallback: string) {
  const message = (result as { approvalMessage?: string }).approvalMessage;
  return ok(result, message ?? fallback);
}

/**
 * Response for an operation an approval scheme may hold: 202 with "sent for
 * approval" when it was held (nothing was written), otherwise the usual
 * success message built from the result.
 */
export function okOrHeld<T>(result: T | HeldResult, message: string | ((r: T) => string), status = 200) {
  if (isHeld(result)) return ok(result, result.approvalMessage, 202);
  return ok(result, typeof message === "function" ? message(result as T) : message, status);
}
