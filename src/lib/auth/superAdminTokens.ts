import jwt from "jsonwebtoken";
import { getEnv } from "@/lib/config/env";

export interface SATokenPayload {
  sub: "superadmin";
  role: "SUPERADMIN";
}

function getSASecret(): string {
  const { SA_JWT_SECRET, JWT_ACCESS_SECRET } = getEnv();
  // Fall back to the app JWT secret if SA_JWT_SECRET not configured yet.
  return SA_JWT_SECRET ?? JWT_ACCESS_SECRET;
}

/** Issues a Super Admin session JWT (no businessId — global token). */
export function signSAToken(): string {
  const payload: SATokenPayload = { sub: "superadmin", role: "SUPERADMIN" };
  return jwt.sign(payload, getSASecret(), { expiresIn: 8 * 60 * 60 }); // 8 h
}

/** Verifies and decodes a Super Admin JWT. Throws if invalid or expired. */
export function verifySAToken(token: string): SATokenPayload {
  return jwt.verify(token, getSASecret()) as SATokenPayload;
}

export const SA_COOKIE = "erp_sa_token";

