import type { AuthContext } from "@/lib/auth/context";
import { getSettings, updateSettings } from "@/lib/settings/service";
import { SETTINGS_SECTIONS } from "@/lib/settings/definitions";
import { holdForApproval } from "./service";
import { fieldLabel } from "./resourceApprovals";
import type { HeldResult } from "./catalog";

/** Settings screens whose changes an approval scheme can cover. */
export const SETTINGS_APPROVALS: Record<string, string> = {
  "attendance-regularization": "hr-regularization-policy",
  "hr-payroll-settings": "hr-payroll-setup",
  "hr-pf-settings": "hr-payroll-setup",
  "hr-esic-settings": "hr-payroll-setup",
};

function text(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Saves a settings section, or holds the change for approval when its
 * document has an active scheme. The new values are checked first either way.
 */
export async function saveSettingsSection(ctx: AuthContext, section: string, input: unknown, opts: { approved?: boolean } = {}): Promise<HeldResult | Record<string, unknown>> {
  const def = SETTINGS_SECTIONS[section];
  const document = SETTINGS_APPROVALS[section];
  if (def && document && !opts.approved) {
    const value = def.schema.parse(input) as Record<string, unknown>;
    const before = (await getSettings(ctx.businessId, section)) as Record<string, unknown>;
    const changed = Object.keys(value).filter((k) => JSON.stringify(value[k]) !== JSON.stringify(before[k]));
    if (changed.length > 0) {
      const held = await holdForApproval(ctx, {
        document,
        targetKey: `settings:${section}`,
        summary: `${def.title}: ${changed.map(fieldLabel).join(", ")}`,
        details: [{ label: "Settings", value: def.title }, ...changed.slice(0, 25).map((k) => ({ label: fieldLabel(k), value: `${text(before[k])} → ${text(value[k])}` }))],
        payload: { section, input: value },
      });
      if (held) return held;
    }
  }
  return (await updateSettings(ctx.businessId, ctx.userId, section, input)) as Record<string, unknown>;
}
