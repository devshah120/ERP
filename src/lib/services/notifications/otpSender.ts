import nodemailer from "nodemailer";
import { getEnv } from "@/lib/config/env";
import type { OtpChannel, OtpPurpose } from "@/models/OtpVerification";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const env = getEnv();
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) return null;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  return transporter;
}

const PURPOSE_SUBJECT: Record<OtpPurpose, string> = {
  REGISTRATION: "Verify your business registration",
  LOGIN_2FA: "Your login verification code",
  PASSWORD_RESET: "Reset your password",
};

/**
 * Sends an OTP code to the given target. Email is implemented via SMTP;
 * SMS is a stub interface point for a future provider (Twilio/MSG91/etc).
 * In non-production environments without SMTP configured, the code is
 * logged to the server console instead of silently discarded — this keeps
 * local development usable without ever faking success in production.
 */
export async function sendOtp(params: {
  channel: OtpChannel;
  purpose: OtpPurpose;
  target: string;
  code: string;
}): Promise<void> {
  const { channel, purpose, target, code } = params;
  const env = getEnv();

  if (channel === "SMS") {
    throw new Error("SMS OTP delivery is not yet configured. Integrate an SMS provider before using this channel.");
  }

  const mailer = getTransporter();
  if (!mailer) {
    if (env.NODE_ENV === "production") {
      throw new Error("SMTP is not configured. Cannot send OTP email in production.");
    }
    console.warn(`[DEV OTP] purpose=${purpose} target=${target} code=${code}`);
    return;
  }

  await mailer.sendMail({
    from: env.SMTP_FROM ?? env.SMTP_USER,
    to: target,
    subject: PURPOSE_SUBJECT[purpose],
    text: `Your verification code is ${code}. It expires in ${Math.floor(env.OTP_TTL_SECONDS / 60)} minutes. Do not share this code with anyone.`,
  });
}
