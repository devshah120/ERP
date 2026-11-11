import { z } from "zod";
import { isPasswordStrongEnough } from "@/lib/auth/password";

const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine(isPasswordStrongEnough, {
    message: "Password must include an uppercase letter, lowercase letter, digit, and symbol",
  });

/** "" from an untouched optional input means "not given". */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = (min: number, max: number) => z.preprocess(blankToUndefined, z.string().trim().min(min).max(max).optional());

/**
 * Sign-up. The form asks only for store name, GSTIN, phone, owner name, email
 * and password; everything else is optional here and defaulted by
 * registerBusiness (trade name = store name, state
 * from the GSTIN, India / INR / April financial year).
 */
export const registerSchema = z
  .object({
    legalName: z.string().trim().min(2, "Store name is required").max(200),
    tradeName: optionalText(2, 200),
    businessType: optionalText(2, 100),
    /** Internal workspace ID. Optional: generated from the trade name when left out. */
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{3,63}$/, "Domain may only contain lowercase letters, numbers and hyphens")
      .optional(),

    ownerName: z.string().trim().min(2, "Your name is required").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    phone: optionalText(7, 20),
    password: passwordField,
    confirmPassword: z.string().optional(),

    country: z.preprocess(blankToUndefined, z.string().trim().min(2).max(100).default("India")),
    state: optionalText(2, 100),
    city: optionalText(2, 100),
    address: optionalText(2, 300),

    currency: z.string().trim().toUpperCase().length(3).default("INR"),
    timeZone: z.string().trim().min(2).default("Asia/Kolkata"),
    gstin: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[0-9]{2}[A-Z0-9]{13}$/, "A GST number is 15 characters, starting with the 2-digit state code")
        .optional()
    ),
    registrationNumber: z.preprocess(blankToUndefined, z.string().trim().optional()),
    financialYearStartMonth: z.number().int().min(1).max(12).default(4),
  })
  .refine((data) => data.confirmPassword === undefined || data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const verifyOtpSchema = z.object({
  businessId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const resendOtpSchema = z.object({
  businessId: z.string().min(1),
});
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;

export const loginSchema = z.object({
  /** Optional: limits the lookup to one workspace (API callers). */
  domain: z.string().trim().toLowerCase().optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1),
  /** false = session ends when the browser closes. Defaults to staying signed in. */
  rememberMe: z.boolean().optional().default(true),
});
/** Input shape: rememberMe is optional for callers and only read by the route (cookie lifetime). */
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  domain: z.string().trim().toLowerCase().optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    domain: z.string().trim().toLowerCase().optional(),
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
