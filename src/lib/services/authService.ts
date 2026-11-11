import mongoose, { Types } from "mongoose";
import { Business } from "@/models/Business";
import { Branch } from "@/models/Branch";
import { Warehouse } from "@/models/Warehouse";
import { FinancialYear } from "@/models/FinancialYear";
import { Role, OWNER_ROLE_NAME, OWNER_ALL_PERMISSIONS } from "@/models/Role";
import { User, type IUser } from "@/models/User";
import { OtpVerification } from "@/models/OtpVerification";
import { Session } from "@/models/Session";
import { LoginHistory } from "@/models/LoginHistory";
import { AppError } from "@/lib/errors/AppError";
import { getEnv } from "@/lib/config/env";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateOtpCode, hashOtpCode } from "@/lib/auth/otp";
import { signAccessToken, generateRefreshToken, hashToken } from "@/lib/auth/tokens";
import { sendOtp } from "@/lib/services/notifications/otpSender";
import { recordAudit } from "@/lib/services/auditService";
import { computeCurrentFinancialYear } from "@/lib/services/financialYearService";
import { resolveGstState } from "@/lib/gst/states";
import type { RegisterInput, LoginInput } from "@/lib/validation/authSchemas";

export interface RegisterResult {
  businessId: string;
  userId: string;
  otpTarget: string;
  otpExpiresAt: Date;
}

/** "Rangoli Textiles" → "rangoli-textiles", padded so it always meets the 3-character minimum. */
function slugifyDomain(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length >= 3 ? base : `${base || "workspace"}-ws`;
}

/** First free ID among base, base-2, base-3… then a random suffix as a last resort. */
async function uniqueDomain(base: string): Promise<string> {
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!(await Business.exists({ domain: candidate }))) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

/** "asha.rao+shop@x.com" → "asha.rao"; padded/trimmed to the 3–32 character username rule. */
function usernameFromEmail(email: string): string {
  const local = email.split("@")[0].toLowerCase().split("+")[0].replace(/[^a-z0-9._-]/g, "");
  const name = local.length >= 3 ? local : `${local || "owner"}${"001".slice(local.length)}`;
  return name.slice(0, 32);
}

export async function registerBusiness(input: RegisterInput, ip?: string): Promise<RegisterResult> {
  const env = getEnv();

  // The short sign-up form leaves these out; fill them with sensible defaults.
  const tradeName = input.tradeName ?? input.legalName;
  const businessType = input.businessType ?? "Retail";
  const username = input.username ?? usernameFromEmail(input.email);
  const phone = input.phone ?? "";
  const state = input.state ?? resolveGstState({ gstin: input.gstin })?.name ?? "";

  // The domain is an internal tenant ID. People no longer type it, so it is
  // derived from the trade name; an explicit one (API callers) must be free.
  let domain: string;
  if (input.domain) {
    if (await Business.findOne({ domain: input.domain }).lean()) {
      throw AppError.conflict("This domain is already taken", "DOMAIN_TAKEN");
    }
    domain = input.domain;
  } else {
    domain = await uniqueDomain(slugifyDomain(tradeName));
  }

  const passwordHash = await hashPassword(input.password);
  const session = await mongoose.startSession();

  let businessId: Types.ObjectId;
  let userId: Types.ObjectId;
  let otpCode: string;
  let otpExpiresAt: Date;

  try {
    await session.withTransaction(async () => {
      const [business] = await Business.create(
        [
          {
            legalName: input.legalName,
            tradeName,
            businessType,
            domain,
            email: input.email,
            phone,
            country: input.country,
            state,
            city: input.city ?? "",
            address: input.address ?? "",
            currency: input.currency,
            timeZone: input.timeZone,
            gstin: input.gstin,
            registrationNumber: input.registrationNumber,
            financialYearStartMonth: input.financialYearStartMonth,
            status: "PENDING_VERIFICATION",
          },
        ],
        { session }
      );
      businessId = business._id;

      const { startDate, endDate, label } = computeCurrentFinancialYear(input.financialYearStartMonth);
      await FinancialYear.create(
        [{ businessId, startDate, endDate, label, status: "OPEN", isCurrent: true }],
        { session }
      );

      const [branch] = await Branch.create(
        [{ businessId, code: "MAIN", name: "Head Office", isDefault: true, isActive: true }],
        { session }
      );

      const [warehouse] = await Warehouse.create(
        [
          {
            businessId,
            branchId: branch._id,
            code: "MAIN",
            name: "Main Warehouse",
            isDefault: true,
            isActive: true,
          },
        ],
        { session }
      );

      business.defaultBranchId = branch._id;
      business.defaultWarehouseId = warehouse._id;
      await business.save({ session });

      const [ownerRole] = await Role.create(
        [
          {
            businessId,
            name: OWNER_ROLE_NAME,
            description: "Full access to all modules. Automatically assigned to the business owner.",
            permissions: [OWNER_ALL_PERMISSIONS],
            isSystemRole: true,
            isActive: true,
          },
        ],
        { session }
      );

      const [user] = await User.create(
        [
          {
            businessId,
            name: input.ownerName,
            username,
            email: input.email,
            phone,
            passwordHash,
            roleId: ownerRole._id,
            branchIds: [],
            warehouseIds: [],
            status: "PENDING_VERIFICATION",
          },
        ],
        { session }
      );
      userId = user._id;

      otpCode = generateOtpCode();
      otpExpiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);

      await OtpVerification.create(
        [
          {
            businessId,
            userId,
            purpose: "REGISTRATION",
            channel: "EMAIL",
            target: input.email,
            codeHash: hashOtpCode(otpCode),
            expiresAt: otpExpiresAt,
            maxAttempts: env.OTP_MAX_ATTEMPTS,
            resendCount: 0,
            lastSentAt: new Date(),
            status: "PENDING",
          },
        ],
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  // External I/O (email dispatch) deliberately happens after the transaction
  // has committed — never send/notify from inside a DB transaction.
  try {
    await sendOtp({ channel: "EMAIL", purpose: "REGISTRATION", target: input.email, code: otpCode! });
  } catch (err) {
    console.error("[OTP_SEND_FAILED]", err);
    // Registration itself already succeeded and the OTP row exists — the
    // user can retry delivery via /auth/resend-otp, so we don't fail the
    // whole registration just because the first email attempt failed.
  }

  await recordAudit({
    businessId: businessId!,
    userId: userId!,
    action: "CREATE",
    module: "auth",
    documentType: "Business",
    documentId: businessId!,
    ip,
  });

  return {
    businessId: businessId!.toString(),
    userId: userId!.toString(),
    otpTarget: input.email,
    otpExpiresAt: otpExpiresAt!,
  };
}

export async function verifyRegistrationOtp(businessId: string, code: string, ip?: string): Promise<void> {
  // Attempt-counting on an invalid/expired code is a single-document write
  // and happens outside any transaction. Only the "success" path — which
  // touches OtpVerification + User + Business together — needs one, since
  // a crash mid-write there must not leave the account half-activated with
  // no way to retry (Section 24 / decision J-8).
  const otp = await OtpVerification.findOne({
    businessId,
    purpose: "REGISTRATION",
    status: "PENDING",
  })
    .sort({ createdAt: -1 })
    .select("+codeHash");

  if (!otp) {
    throw AppError.badRequest("No pending verification found. Please register or request a new code.", "OTP_NOT_FOUND");
  }

  if (otp.expiresAt < new Date()) {
    otp.status = "EXPIRED";
    await otp.save();
    throw AppError.badRequest("Verification code has expired. Please request a new one.", "OTP_EXPIRED");
  }

  if (otp.attempts >= otp.maxAttempts) {
    throw AppError.tooManyRequests("Maximum verification attempts exceeded. Please request a new code.");
  }

  otp.attempts += 1;

  if (hashOtpCode(code) !== otp.codeHash) {
    await otp.save();
    const remaining = otp.maxAttempts - otp.attempts;
    throw AppError.badRequest(`Invalid verification code. ${remaining} attempt(s) remaining.`, "OTP_INVALID");
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await OtpVerification.updateOne(
        { _id: otp._id },
        { status: "VERIFIED", consumedAt: new Date() },
        { session }
      );

      const user = await User.findOneAndUpdate(
        { _id: otp.userId, businessId },
        { status: "ACTIVE", isEmailVerified: true },
        { session }
      );
      if (!user) throw AppError.notFound("User not found");

      await Business.updateOne({ _id: businessId }, { status: "ACTIVE" }, { session });
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId,
    userId: otp.userId,
    action: "UPDATE",
    module: "auth",
    documentType: "Business",
    documentId: businessId,
    reason: "Business activated via OTP verification",
    ip,
  });
}

export async function resendRegistrationOtp(businessId: string): Promise<{ otpTarget: string; otpExpiresAt: Date }> {
  const env = getEnv();

  const otp = await OtpVerification.findOne({
    businessId,
    purpose: "REGISTRATION",
    status: "PENDING",
  }).sort({ createdAt: -1 });

  if (!otp) {
    throw AppError.badRequest("No pending verification found for this business.", "OTP_NOT_FOUND");
  }

  const secondsSinceLastSend = (Date.now() - otp.lastSentAt.getTime()) / 1000;
  if (secondsSinceLastSend < env.OTP_RESEND_COOLDOWN_SECONDS) {
    throw AppError.tooManyRequests(
      `Please wait ${Math.ceil(env.OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLastSend)}s before requesting another code.`
    );
  }

  if (otp.resendCount >= env.OTP_MAX_RESENDS_PER_WINDOW) {
    throw AppError.tooManyRequests("Maximum resend attempts reached. Please contact support.");
  }

  const code = generateOtpCode();
  otp.codeHash = hashOtpCode(code);
  otp.expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);
  otp.attempts = 0;
  otp.resendCount += 1;
  otp.lastSentAt = new Date();
  await otp.save();

  try {
    await sendOtp({ channel: otp.channel, purpose: "REGISTRATION", target: otp.target, code });
  } catch (err) {
    console.error("[OTP_RESEND_SEND_FAILED]", err);
    throw AppError.badRequest(
      "Could not send the verification code right now. Please try again shortly.",
      "OTP_SEND_FAILED"
    );
  }

  return { otpTarget: otp.target, otpExpiresAt: otp.expiresAt };
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    username: string;
    email: string;
    businessId: string;
    roleId: string;
  };
}

async function issueSession(
  user: IUser,
  permissions: string[],
  meta: { userAgent?: string; ip?: string }
): Promise<{ accessToken: string; refreshToken: string }> {
  const env = getEnv();

  const accessToken = signAccessToken({
    sub: user._id.toString(),
    businessId: user.businessId.toString(),
    roleId: user.roleId.toString(),
    permissions,
    branchIds: user.branchIds.map((id) => id.toString()),
    warehouseIds: user.warehouseIds.map((id) => id.toString()),
  });

  const refreshToken = generateRefreshToken();
  await Session.create({
    businessId: user.businessId,
    userId: user._id,
    refreshTokenHash: hashToken(refreshToken),
    userAgent: meta.userAgent,
    ip: meta.ip,
    expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000),
  });

  return { accessToken, refreshToken };
}

/**
 * Every account matching a username/email in active workspaces. With a domain
 * (still accepted from API callers) the search is limited to that workspace.
 * Usernames are only unique per workspace, so this can return several users.
 */
async function findAccounts(usernameOrEmail: string, domain?: string, withPassword = false) {
  const target = usernameOrEmail.toLowerCase();
  const scope = domain?.trim().toLowerCase();
  const filter: Record<string, unknown> = { $or: [{ username: target }, { email: target }] };
  if (scope) {
    const business = await Business.findOne({ domain: scope }, { _id: 1 }).lean();
    if (!business) return [];
    filter.businessId = business._id;
  }
  const query = User.find(filter).limit(10);
  const candidates = await (withPassword ? query.select("+passwordHash") : query);
  if (candidates.length === 0) return [];
  const active = await Business.find({ _id: { $in: candidates.map((c) => c.businessId) }, status: "ACTIVE" }, { _id: 1 }).lean();
  const activeIds = new Set(active.map((b) => String(b._id)));
  return candidates.filter((c) => activeIds.has(String(c.businessId)));
}

/**
 * Finds the account a sign-in attempt is for. One match is the usual case.
 * When the same username exists in several workspaces, the password decides:
 * the account it unlocks wins (the most recently used one if it unlocks more
 * than one). If it unlocks none, the first match goes through the normal
 * failure path so lockout still applies.
 */
async function findLoginUser(input: LoginInput) {
  const live = await findAccounts(input.usernameOrEmail, input.domain, true);
  if (live.length <= 1) return live[0] ?? null;

  const usable = live.filter((u) => u.status !== "DISABLED" && u.status !== "PENDING_VERIFICATION").slice(0, 5);
  const matches = [];
  for (const u of usable) {
    if (await verifyPassword(input.password, u.passwordHash)) matches.push(u);
  }
  if (matches.length === 0) return live[0];
  matches.sort((a, b) => (b.lastLoginAt?.getTime() ?? 0) - (a.lastLoginAt?.getTime() ?? 0));
  return matches[0];
}

export async function login(input: LoginInput, meta: { userAgent?: string; ip?: string }): Promise<LoginResult> {
  const env = getEnv();

  const user = await findLoginUser(input);
  if (!user) {
    throw AppError.unauthorized("Invalid credentials", "INVALID_CREDENTIALS");
  }

  if (user.status === "LOCKED") {
    if (user.lockedUntil && user.lockedUntil <= new Date()) {
      user.status = "ACTIVE";
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
    } else {
      throw AppError.forbidden("Account is locked due to too many failed attempts. Try again later.", "ACCOUNT_LOCKED");
    }
  }

  if (user.status === "PENDING_VERIFICATION") {
    throw AppError.forbidden("Please verify your account before logging in.", "ACCOUNT_NOT_VERIFIED");
  }

  if (user.status === "DISABLED") {
    throw AppError.forbidden("This account has been disabled.", "ACCOUNT_DISABLED");
  }

  const validPassword = await verifyPassword(input.password, user.passwordHash);
  if (!validPassword) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= env.LOGIN_MAX_FAILED_ATTEMPTS) {
      user.status = "LOCKED";
      user.lockedUntil = new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60 * 1000);
      await LoginHistory.create({
        businessId: user.businessId,
        userId: user._id,
        event: "ACCOUNT_LOCKED",
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    await user.save();

    await LoginHistory.create({
      businessId: user.businessId,
      userId: user._id,
      event: "LOGIN_FAILED",
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    throw AppError.unauthorized("Invalid credentials", "INVALID_CREDENTIALS");
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  const role = await Role.findOne({ _id: user.roleId, businessId: user.businessId }).lean();
  const permissions = role?.permissions ?? [];

  const { accessToken, refreshToken } = await issueSession(user, permissions, meta);

  await LoginHistory.create({
    businessId: user.businessId,
    userId: user._id,
    event: "LOGIN_SUCCESS",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  await recordAudit({
    businessId: user.businessId,
    userId: user._id,
    action: "LOGIN",
    module: "auth",
    ip: meta.ip,
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id.toString(),
      name: user.name,
      username: user.username,
      email: user.email,
      businessId: user.businessId.toString(),
      roleId: user.roleId.toString(),
    },
  };
}

export async function refreshSession(
  refreshToken: string,
  meta: { userAgent?: string; ip?: string }
): Promise<{ accessToken: string; refreshToken: string }> {
  const tokenHash = hashToken(refreshToken);
  const existing = await Session.findOne({
    refreshTokenHash: tokenHash,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });

  if (!existing) {
    throw AppError.unauthorized("Invalid or expired session", "SESSION_EXPIRED");
  }

  const user = await User.findOne({ _id: existing.userId, businessId: existing.businessId });
  if (!user || user.status !== "ACTIVE") {
    throw AppError.unauthorized("Account is no longer active", "ACCOUNT_INACTIVE");
  }

  const role = await Role.findOne({ _id: user.roleId, businessId: user.businessId }).lean();
  const permissions = role?.permissions ?? [];

  // Rotate: revoke the presented token and issue a fresh pair — limits the
  // blast radius of a leaked refresh token to a single use.
  existing.revokedAt = new Date();
  await existing.save();

  return issueSession(user, permissions, meta);
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  const tokenHash = hashToken(refreshToken);
  const session = await Session.findOneAndUpdate(
    { refreshTokenHash: tokenHash, revokedAt: null },
    { revokedAt: new Date() }
  );

  if (session) {
    await LoginHistory.create({
      businessId: session.businessId,
      userId: session.userId,
      event: "LOGOUT",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Password reset                                                      */
/* ------------------------------------------------------------------ */

/** Same answer whether or not the account exists, so the endpoint can't be
 * used to discover which usernames or emails are registered. */
const RESET_INVALID = "Invalid or expired reset code. Request a new code and try again.";

/**
 * Accounts a reset can apply to. Usually one; if the same username exists in
 * several workspaces each gets its own code, and the code entered later
 * identifies which account is being reset.
 */
async function findResettableUsers(domain: string | undefined, usernameOrEmail: string) {
  const users = await findAccounts(usernameOrEmail, domain);
  // Unverified registrations finish through OTP verification instead, and a
  // disabled account must not be re-opened by resetting its password.
  return users.filter((u) => u.status !== "PENDING_VERIFICATION" && u.status !== "DISABLED");
}

/**
 * Emails a one-time reset code. Always resolves without revealing whether the
 * account exists; a request inside the resend cooldown is ignored silently.
 */
export async function requestPasswordReset(
  input: { domain?: string; usernameOrEmail: string },
  ip?: string
): Promise<void> {
  for (const user of await findResettableUsers(input.domain, input.usernameOrEmail)) {
    await sendResetCode(user, ip);
  }
}

async function sendResetCode(user: Awaited<ReturnType<typeof findResettableUsers>>[number], ip?: string): Promise<void> {
  const env = getEnv();

  const pending = await OtpVerification.findOne({
    businessId: user.businessId,
    userId: user._id,
    purpose: "PASSWORD_RESET",
    status: "PENDING",
  }).sort({ createdAt: -1 });

  if (pending && (Date.now() - pending.lastSentAt.getTime()) / 1000 < env.OTP_RESEND_COOLDOWN_SECONDS) {
    return;
  }

  // Only the newest code is ever valid.
  await OtpVerification.updateMany(
    { businessId: user.businessId, userId: user._id, purpose: "PASSWORD_RESET", status: "PENDING" },
    { status: "CANCELLED" }
  );

  const code = generateOtpCode();
  await OtpVerification.create({
    businessId: user.businessId,
    userId: user._id,
    purpose: "PASSWORD_RESET",
    channel: "EMAIL",
    target: user.email,
    codeHash: hashOtpCode(code),
    expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000),
    maxAttempts: env.OTP_MAX_ATTEMPTS,
    resendCount: 0,
    lastSentAt: new Date(),
    status: "PENDING",
  });

  try {
    await sendOtp({ channel: "EMAIL", purpose: "PASSWORD_RESET", target: user.email, code });
  } catch (err) {
    // Not surfaced to the caller (that would confirm the account exists);
    // the user can simply request another code.
    console.error("[PASSWORD_RESET_SEND_FAILED]", err);
  }

  await recordAudit({
    businessId: user.businessId,
    userId: user._id,
    action: "UPDATE",
    module: "auth",
    documentType: "User",
    documentId: user._id,
    reason: "Password reset code requested",
    ip,
  });
}

/**
 * Verifies the reset code and sets the new password. On success every open
 * session for the user is revoked — anyone using the old password is signed
 * out everywhere — and any lockout is cleared.
 */
export async function resetPassword(
  input: { domain?: string; usernameOrEmail: string; code: string; password: string },
  ip?: string
): Promise<void> {
  const users = await findResettableUsers(input.domain, input.usernameOrEmail);
  if (users.length === 0) throw AppError.badRequest(RESET_INVALID, "RESET_INVALID");

  // Each account's newest pending code; with several accounts, the one whose
  // code was entered is the one being reset.
  const pendings = await Promise.all(
    users.map((u) =>
      OtpVerification.findOne({ businessId: u.businessId, userId: u._id, purpose: "PASSWORD_RESET", status: "PENDING" })
        .sort({ createdAt: -1 })
        .select("+codeHash")
    )
  );
  const codeHash = hashOtpCode(input.code);
  let idx = pendings.findIndex((o) => o && o.codeHash === codeHash);
  if (idx < 0) idx = pendings.findIndex((o) => o);
  if (idx < 0) throw AppError.badRequest(RESET_INVALID, "RESET_INVALID");
  const user = users[idx];
  const otp = pendings[idx];

  if (!otp) throw AppError.badRequest(RESET_INVALID, "RESET_INVALID");

  if (otp.expiresAt < new Date()) {
    otp.status = "EXPIRED";
    await otp.save();
    throw AppError.badRequest("This reset code has expired. Request a new one.", "OTP_EXPIRED");
  }

  if (otp.attempts >= otp.maxAttempts) {
    throw AppError.tooManyRequests("Too many incorrect attempts. Request a new reset code.");
  }

  otp.attempts += 1;
  if (hashOtpCode(input.code) !== otp.codeHash) {
    await otp.save();
    const remaining = otp.maxAttempts - otp.attempts;
    throw AppError.badRequest(`Incorrect code. ${remaining} attempt(s) remaining.`, "OTP_INVALID");
  }

  const passwordHash = await hashPassword(input.password);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await OtpVerification.updateOne(
        { _id: otp._id },
        { status: "VERIFIED", consumedAt: new Date(), attempts: otp.attempts },
        { session }
      );
      await User.updateOne(
        { _id: user._id, businessId: user.businessId },
        {
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
          ...(user.status === "LOCKED" ? { status: "ACTIVE" } : {}),
        },
        { session }
      );
      await Session.updateMany(
        { userId: user._id, businessId: user.businessId, revokedAt: null },
        { revokedAt: new Date() },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: user.businessId,
    userId: user._id,
    action: "PASSWORD_CHANGE",
    module: "auth",
    documentType: "User",
    documentId: user._id,
    reason: "Password reset via emailed code; all sessions revoked",
    ip,
  });
}
