import Decimal from "decimal.js";
import { AppError } from "@/lib/errors/AppError";
import type { AuthContext } from "@/lib/auth/context";
import { EmployeeLoan } from "@/models/hr";
import { approveLeave, rejectLeave } from "@/lib/hr/leave";
import { decideClaim, decideAdvance } from "@/lib/hr/money";
import { approveCorrection, rejectCorrection } from "@/lib/hr/corrections";
import { approveRun, rejectRunApproval } from "@/lib/hr/payroll";
import { approveFnf, rejectFnfApproval } from "@/lib/hr/fnf";
import { dayKey, toDay } from "@/lib/hr/calendar";
import { getDocumentDefinition } from "@/lib/documents/registry";
import { approvalTransition, allowedTransitions } from "@/lib/documents/workflows";
import { transitionDocument, rejectDocumentApproval } from "@/lib/documents/transitions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

/**
 * An approver acting from the queue may not hold the module's own approve
 * permission (a "Specific User" or group member often won't). The queue route
 * has already checked they are the current stage's approver, so the module
 * call runs with just the permission that step needs added. The module's
 * approvalGate() checks the stage again with the real user id.
 */
function withPermissions(ctx: AuthContext, extra: (string | undefined)[]): AuthContext {
  return { ...ctx, permissions: [...new Set([...ctx.permissions, ...(extra.filter(Boolean) as string[])])] };
}

export async function actOnApproval(ctx: AuthContext, req: AnyDoc, action: "approve" | "reject", note: string): Promise<{ approvalMessage?: string; [k: string]: unknown }> {
  const id = String(req.recordId);
  switch (req.document) {
    case "hr-leave": {
      const c = withPermissions(ctx, ["hr-leaves.approve", "hr-leaves.approve-all"]);
      return action === "approve" ? approveLeave(c, id, note) : rejectLeave(c, id, note);
    }
    case "hr-claim":
      return decideClaim(withPermissions(ctx, ["hr-claims.approve"]), id, action === "approve" ? "APPROVED" : "REJECTED", note);
    case "hr-advance": {
      const c = withPermissions(ctx, ["hr-loans.edit"]);
      if (action === "reject") return decideAdvance(c, id, { action: "reject", note: note || "Rejected in approval queue" });
      // Approved as asked; HR can still change terms on the Advance Requests screen before the last stage.
      const loan = await EmployeeLoan.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
      if (!loan) throw AppError.notFound("Request not found");
      return decideAdvance(c, id, {
        action: "approve",
        amount: new Decimal(String(loan.amount)).toFixed(2),
        emiAmount: new Decimal(String(loan.emiAmount)).toFixed(2),
        issueDate: dayKey(toDay(new Date())),
        startMonth: loan.startMonth,
        startYear: loan.startYear,
        note,
      });
    }
    case "hr-attendance-correction": {
      const c = withPermissions(ctx, ["hr-attendance.edit"]);
      if (action === "reject") return rejectCorrection(c, id, note || "Rejected in approval queue");
      return approveCorrection(c, id, note);
    }
    case "hr-payroll": {
      const c = withPermissions(ctx, ["hr-payroll.approve"]);
      // Unmarked attendance can only be paid as present from the Payroll screen, where the approver sees the days.
      if (action === "reject") return rejectRunApproval(c, id, note);
      try {
        return await approveRun(c, id, { payUnmarkedAsPresent: false });
      } catch (err) {
        if (err instanceof AppError && err.code === "UNMARKED_ATTENDANCE") {
          throw AppError.badRequest(`${err.message} Approve it from the Payroll screen, where you can choose to pay those days as present.`, "UNMARKED_ATTENDANCE");
        }
        throw err;
      }
    }
    case "hr-fnf": {
      const c = withPermissions(ctx, ["hr-payroll.approve"]);
      return action === "approve" ? approveFnf(c, id) : rejectFnfApproval(c, id, note);
    }
    default: {
      const def = getDocumentDefinition(req.document);
      if (!def) throw AppError.notFound("Unknown document");
      if (action === "reject") return rejectDocumentApproval(def.key, id, note, ctx) as Promise<{ approvalMessage?: string }>;
      const step = approvalTransition(def.workflow);
      if (!step) throw AppError.badRequest(`${def.label} has no approval step`, "NO_APPROVAL_STEP");
      const doc = await def.model.findOne({ _id: id, businessId: ctx.businessId }, { status: 1 }).lean<AnyDoc>();
      if (!doc) throw AppError.notFound(`${def.label} not found`);
      if (doc.status !== step.from) throw AppError.conflict(`This ${def.label.toLowerCase()} is ${String(doc.status).toLowerCase().replace(/_/g, " ")} now, so it can't be approved here`, "APPROVAL_STALE");
      const rule = allowedTransitions(def.workflow, step.from).find((t) => t.to === step.to);
      return transitionDocument(def.key, id, step.to, undefined, withPermissions(ctx, [rule?.permission])) as Promise<{ approvalMessage?: string }>;
    }
  }
}
