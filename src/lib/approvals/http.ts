import { ok } from "@/lib/http/response";

/**
 * Response for a module's approve/reject action: when the approval scheme
 * only moved the request on a stage (or just sent it for approval), say
 * that instead of "approved".
 */
export function okDecision<T extends object>(result: T, fallback: string) {
  const message = (result as { approvalMessage?: string }).approvalMessage;
  return ok(result, message ?? fallback);
}
