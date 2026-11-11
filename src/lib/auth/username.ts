import type { Types } from "mongoose";
import { User } from "@/models/User";

/**
 * People sign in with their email only. Each user record still carries a
 * `username` (it is part of a unique index and of older records), so one is
 * derived from the email automatically — nobody types or sees it.
 */

/** "asha.rao+shop@x.com" → "asha.rao"; padded/trimmed to the 3–32 character rule. */
export function usernameFromEmail(email: string): string {
  const local = email.split("@")[0].toLowerCase().split("+")[0].replace(/[^a-z0-9._-]/g, "");
  const name = local.length >= 3 ? local : `${local || "user"}${"001".slice(local.length)}`;
  return name.slice(0, 32);
}

/** A username derived from the email that is free within the business (asha, asha2, asha3…). */
export async function uniqueUsername(businessId: Types.ObjectId, email: string): Promise<string> {
  const base = usernameFromEmail(email).slice(0, 28);
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}${i}`;
    if (!(await User.exists({ businessId, username: candidate }))) return candidate;
  }
  return `${base}${Date.now().toString(36).slice(-4)}`;
}
