import { createHash, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { getEnv } from "@/lib/config/env";

/**
 * Built-in credentials for local development only. They apply when
 * NODE_ENV is "development" and no super-admin password is configured.
 * They never apply in production or test.
 */
const DEV_EMAIL = "superadmin@nexora.in";
const DEV_PASSWORD = "Admin@12345";

interface SuperAdminConfig {
  email: string;
  hash?: string;
  plain?: string;
}

let warned = false;

/**
 * The super-admin sign-in settings, or null when super-admin sign-in is
 * disabled. In production that happens when SUPERADMIN_EMAIL or a password
 * (SUPERADMIN_PASSWORD_HASH, or SUPERADMIN_PASSWORD) is missing.
 */
export function getSuperAdminConfig(): SuperAdminConfig | null {
  const env = getEnv();
  const hash = env.SUPERADMIN_PASSWORD_HASH;
  const plain = env.SUPERADMIN_PASSWORD;

  if (hash || plain) {
    const email = env.SUPERADMIN_EMAIL ?? (env.NODE_ENV === "development" ? DEV_EMAIL : undefined);
    if (email) return { email, hash, plain };
  } else if (env.NODE_ENV === "development") {
    return { email: env.SUPERADMIN_EMAIL ?? DEV_EMAIL, plain: DEV_PASSWORD };
  }

  if (!warned) {
    warned = true;
    console.warn("[superadmin] Sign-in disabled: set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD_HASH (bcrypt).");
  }
  return null;
}

/** True when `email` is the configured super-admin address (case-insensitive). */
export function isSuperAdminEmail(email: string): boolean {
  const cfg = getSuperAdminConfig();
  return !!cfg && email.trim().toLowerCase() === cfg.email.toLowerCase();
}

function sameSecret(a: string, b: string): boolean {
  // Hash both sides so the comparison is constant-time regardless of length.
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

/** Checks a super-admin sign-in. A configured bcrypt hash takes precedence over a plain password. */
export async function verifySuperAdminCredentials(email: string, password: string): Promise<boolean> {
  const cfg = getSuperAdminConfig();
  if (!cfg || email.trim().toLowerCase() !== cfg.email.toLowerCase()) return false;

  if (cfg.hash) {
    try {
      return await bcrypt.compare(password, cfg.hash);
    } catch {
      return false;
    }
  }
  return cfg.plain ? sameSecret(password, cfg.plain) : false;
}
