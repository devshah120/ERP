import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { getEnv } from "@/lib/config/env";

export interface AccessTokenPayload {
  sub: string; // userId
  businessId: string;
  roleId: string;
  /** Snapshot of the user's permissions at issue time. Short TTL keeps staleness bounded. */
  permissions: string[];
  branchIds: string[];
  warehouseIds: string[];
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const { JWT_ACCESS_SECRET, JWT_ACCESS_TTL_SECONDS } = getEnv();
  return jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: JWT_ACCESS_TTL_SECONDS });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const { JWT_ACCESS_SECRET } = getEnv();
  return jwt.verify(token, JWT_ACCESS_SECRET) as AccessTokenPayload;
}

/**
 * Refresh tokens are opaque random strings, not JWTs — the server holds the
 * source of truth (a hash in the `sessions` collection) so an individual
 * session can be revoked instantly. Only the hash is ever persisted.
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
