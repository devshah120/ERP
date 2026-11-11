import { z } from "zod";
import { isPasswordStrongEnough } from "@/lib/auth/password";

const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine(isPasswordStrongEnough, {
    message: "Password must include an uppercase letter, lowercase letter, digit, and symbol",
  });

export const registerSchema = z
  .object({
    legalName: z.string().trim().min(2).max(200),
    tradeName: z.string().trim().min(2).max(200),
    businessType: z.string().trim().min(2).max(100),
    /** Internal workspace ID. Optional: generated from the trade name when left out. */
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{3,63}$/, "Domain may only contain lowercase letters, numbers and hyphens")
      .optional(),

    ownerName: z.string().trim().min(2).max(120),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,32}$/, "Username may only contain letters, numbers, dot, underscore, hyphen"),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().min(7).max(20),
    password: passwordField,
    confirmPassword: z.string(),

    country: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    city: z.string().trim().min(2).max(100),
    address: z.string().trim().min(2).max(300),

    currency: z.string().trim().toUpperCase().length(3).default("INR"),
    timeZone: z.string().trim().min(2).default("Asia/Kolkata"),
    gstin: z.string().trim().toUpperCase().optional(),
    registrationNumber: z.string().trim().optional(),
    financialYearStartMonth: z.number().int().min(1).max(12).default(4),
  })
  .refine((data) => data.password === data.confirmPassword, {
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
  /** Optional: needed only when the same username exists in more than one workspace. */
  domain: z.string().trim().toLowerCase().optional(),
  usernameOrEmail: z.string().trim().min(1),
  password: z.string().min(1),
  /** false = session ends when the browser closes. Defaults to staying signed in. */
  rememberMe: z.boolean().optional().default(true),
});
/** Input shape: rememberMe is optional for callers and only read by the route (cookie lifetime). */
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  domain: z.string().trim().toLowerCase().optional(),
  usernameOrEmail: z.string().trim().min(1),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    domain: z.string().trim().toLowerCase().optional(),
    usernameOrEmail: z.string().trim().min(1),
    code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
