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
import { approvalDocument } from "./catalog";
import { decideHeldAction, resubmitHeldAction, sendBackRecordApproval, type ActionRunner } from "./service";
import { ACTION_EXECUTORS, withPermissions } from "./executors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;
export type ApprovalAction = "approve" | "reject" | "send-back";

/**
 * The operation an approved held action runs, with the document's
 * permission added: an approver acting from the approval screens may not
 * hold the module's own permission (a "Specific User" or group member often
 * won't). The approval screens have already checked they are the current
 * stage's approver.
 */
function runnerFor(document: string): ActionRunner {
  const run = ACTION_EXECUTORS[document];
  if (!run) throw AppError.notFound("This kind of change can no longer be applied");
  const permission = approvalDocument(document)?.permission;
  return (ctx, payload, req) => run(withPermissions(ctx, [permission]), payload, req);
}

/** The requester sends a sent-back action again. */
export function resubmit(ctx: AuthContext, id: string, document: string, note: string) {
  return resubmitHeldAction(ctx, id, note, ACTION_EXECUTORS[document] ?? runnerFor(document), approvalDocument(document)?.permission);
}

/**
 * The current stage's approver decides from the approval screens. Held
 * actions go through the engine (the operation runs on the last approval);
 * records go through their module's own approve / reject, whose
 * approvalGate() checks the stage again with the real user id.
 */
export async function actOnApproval(ctx: AuthContext, req: AnyDoc, action: ApprovalAction, note: string): Promise<{ approvalMessage?: string; [k: string]: unknown }> {
  const def = approvalDocument(req.document);
  if (!def) throw AppError.notFound("Unknown document");
  if (def.kind === "action" || req.kind === "action") {
    if (action === "send-back" && !def.sendBack) throw AppError.badRequest(`${def.label} can't be sent back. Reject it instead.`, "NO_SEND_BACK");
    return decideHeldAction(ctx, req, action, note, runnerFor(req.document));
  }

  const id = String(req.recordId);
  if (action === "send-back") {
    const doc = getDocumentDefinition(req.document);
    if (!doc || !def.sendBack) throw AppError.badRequest(`${def.label} can't be sent back from here. Reject it with a reason, and the requester can raise it again.`, "NO_SEND_BACK");
    // The request is marked sent back first, so returning the document to draft doesn't count as a cancellation.
    await sendBackRecordApproval(ctx, req, note);
    const current = await doc.model.findOne({ _id: id, businessId: ctx.businessId }, { status: 1 }).lean<AnyDoc>();
    if (current?.status === "PENDING_APPROVAL" && allowedTransitions(doc.workflow, current.status).some((t) => t.to === "DRAFT")) {
      await transitionDocument(doc.key, id, "DRAFT", note, ctx);
    }
    return { approvalMessage: `${def.label} ${req.recordNumber} sent back to ${req.requestedByName || "the author"} for correction.` };
  }

  switch (req.document) {
    case "hr-leave": {
      const c = withPermissions(ctx, ["hr-leaves.approve", "hr-leaves.approve-all"]);
      return action === "approve" ? approveLeave(c, id, note) : rejectLeave(c, id, note);
    }
    case "hr-claim":
    case "hr-claim-travel":
    case "hr-claim-medical":
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
      const doc = getDocumentDefinition(req.document);
      if (!doc) throw AppError.notFound("Unknown document");
      if (action === "reject") return rejectDocumentApproval(doc.key, id, note, ctx) as Promise<{ approvalMessage?: string }>;
      const step = approvalTransition(doc.workflow);
      if (!step) throw AppError.badRequest(`${doc.label} has no approval step`, "NO_APPROVAL_STEP");
      const current = await doc.model.findOne({ _id: id, businessId: ctx.businessId }, { status: 1 }).lean<AnyDoc>();
      if (!current) throw AppError.notFound(`${doc.label} not found`);
      if (current.status !== step.from) throw AppError.conflict(`This ${doc.label.toLowerCase()} is ${String(current.status).toLowerCase().replace(/_/g, " ")} now, so it can't be approved here`, "APPROVAL_STALE");
      const rule = allowedTransitions(doc.workflow, step.from).find((t) => t.to === step.to);
      return transitionDocument(doc.key, id, step.to, undefined, withPermissions(ctx, [rule?.permission])) as Promise<{ approvalMessage?: string }>;
    }
  }
}
