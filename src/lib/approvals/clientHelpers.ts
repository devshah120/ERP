import { isHeld } from "./catalog";

interface ToastLike {
  info: (title: string, description?: string) => void;
}

/**
 * After a save: when an approval scheme held the change instead of writing it,
 * says so ("Sent for approval as APR-000012 … Waiting for …") and returns true,
 * so the screen skips its "saved" message. Also covers partial holds that
 * return an approvalMessage alongside the saved result (e.g. variable pay).
 */
export function notifyHeld(toast: ToastLike, res: unknown): boolean {
  if (isHeld(res)) {
    toast.info("Sent for approval", res.approvalMessage);
    return true;
  }
  return false;
}

/** The approvalMessage of a result that was only partly held, if any. */
export function partlyHeldMessage(res: unknown): string | null {
  if (res && typeof res === "object" && !isHeld(res)) {
    const m = (res as { approvalMessage?: unknown }).approvalMessage;
    return typeof m === "string" && m ? m : null;
  }
  return null;
}
