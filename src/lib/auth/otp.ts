import crypto from "node:crypto";

export function generateOtpCode(): string {
  // 6-digit numeric code, cryptographically random, no leading-zero bias issues
  // since we format to a fixed width.
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

export function hashOtpCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}
