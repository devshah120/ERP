import { findStateByCode, type GstState } from "./states";

/**
 * A GSTIN is 15 characters:
 *   [0-1]   state code
 *   [2-11]  PAN of the registrant
 *   [12]    entity number for that PAN within the state
 *   [13]    'Z' by default
 *   [14]    checksum character
 */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Official GSTIN check-digit algorithm: each of the first 14 characters is
 * weighted alternately by 1 and 2; for each product the quotient and
 * remainder of division by 36 are summed; the check character makes the
 * total a multiple of 36.
 */
export function isValidGstinChecksum(gstin: string): boolean {
  if (gstin.length !== 15) return false;

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(gstin[i]);
    if (value < 0) return false;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }

  const expected = CHARSET[(36 - (sum % 36)) % 36];
  return expected === gstin[14];
}

export interface GstinCheck {
  valid: boolean;
  /** Human-readable reason when invalid. */
  reason?: string;
  state?: GstState;
}

export function validateGstin(raw?: string | null): GstinCheck {
  if (!raw || raw.trim() === "") return { valid: true }; // GSTIN is optional (unregistered parties)

  const gstin = raw.trim().toUpperCase();

  if (gstin.length !== 15) {
    return { valid: false, reason: "A GSTIN must be exactly 15 characters" };
  }
  if (!GSTIN_PATTERN.test(gstin)) {
    return { valid: false, reason: "GSTIN format is invalid (expected 22AAAAA0000A1Z5)" };
  }

  const state = findStateByCode(gstin.slice(0, 2));
  if (!state) {
    return { valid: false, reason: `"${gstin.slice(0, 2)}" is not a valid GST state code` };
  }
  if (!isValidGstinChecksum(gstin)) {
    return { valid: false, reason: "GSTIN check digit is incorrect — please re-enter" };
  }

  return { valid: true, state };
}
