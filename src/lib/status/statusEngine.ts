import { AppError } from "@/lib/errors/AppError";

export interface StatusTransitionRule<TStatus extends string, TDoc> {
  from: TStatus;
  to: TStatus;
  /** Permission key required to perform this transition, e.g. "sales.order.approve". */
  permission?: string;
  /** Optional extra guard beyond the state graph itself (e.g. "credit limit not exceeded"). */
  guard?: (doc: TDoc) => true | string; // return true, or an error message
}

export interface StatusWorkflowDefinition<TStatus extends string, TDoc> {
  documentType: string;
  initialStatus: TStatus;
  transitions: StatusTransitionRule<TStatus, TDoc>[];
}

export interface TransitionActor {
  userId: string;
  permissions: string[]; // resolved permission keys for the acting user; "*" = all
}

/**
 * Central, config-driven state machine. Every transactional module defines
 * its allowed states/transitions as data (see workflows/*.ts) and routes
 * every status change through `transition()` here instead of hand-rolling
 * `if (doc.status === ...)` checks per module (Section 18 / decision J-3).
 */
export class StatusEngine<TStatus extends string, TDoc extends { status: TStatus }> {
  constructor(private readonly definition: StatusWorkflowDefinition<TStatus, TDoc>) {}

  private hasPermission(actor: TransitionActor, permission?: string): boolean {
    if (!permission) return true;
    return actor.permissions.includes("*") || actor.permissions.includes(permission);
  }

  canTransition(currentStatus: TStatus, to: TStatus): StatusTransitionRule<TStatus, TDoc> | undefined {
    return this.definition.transitions.find((t) => t.from === currentStatus && t.to === to);
  }

  /** Throws AppError(409/403) if the transition is not allowed; otherwise returns silently. */
  assertTransition(doc: TDoc, to: TStatus, actor: TransitionActor): void {
    const rule = this.canTransition(doc.status, to);
    if (!rule) {
      throw AppError.conflict(
        `Cannot transition ${this.definition.documentType} from ${doc.status} to ${to}`,
        "INVALID_STATUS_TRANSITION"
      );
    }

    if (!this.hasPermission(actor, rule.permission)) {
      throw AppError.forbidden(
        `You do not have permission to transition ${this.definition.documentType} to ${to}`
      );
    }

    if (rule.guard) {
      const result = rule.guard(doc);
      if (result !== true) {
        throw AppError.badRequest(result, "STATUS_GUARD_FAILED");
      }
    }
  }
}
