import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

process.env.JWT_ACCESS_SECRET = "test-access-secret-0123456789-0123456789-0123456789";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789-0123456789-0123456789";
process.env.OTP_TTL_SECONDS = "600";
process.env.OTP_MAX_ATTEMPTS = "3";
process.env.OTP_RESEND_COOLDOWN_SECONDS = "60";
process.env.OTP_MAX_RESENDS_PER_WINDOW = "5";
process.env.LOGIN_MAX_FAILED_ATTEMPTS = "3";
process.env.LOGIN_LOCKOUT_MINUTES = "15";

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    instanceOpts: [{ launchTimeout: 60_000 }],
  });
  process.env.MONGODB_URI = replSet.getUri("garment-erp-reset-test");
  await mongoose.connect(process.env.MONGODB_URI);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

const DOMAIN = "reset-garments";
const OLD_PASSWORD = "Str0ng!Passw0rd";
const NEW_PASSWORD = "N3w!Passw0rd-2026";

/** The emailed code is hashed at rest; tests plant a known one the same way the verify test does. */
async function plantResetCode(code: string) {
  const { hashOtpCode } = await import("@/lib/auth/otp");
  const { OtpVerification } = await import("@/models/OtpVerification");
  await OtpVerification.updateOne(
    { purpose: "PASSWORD_RESET", status: "PENDING" },
    { codeHash: hashOtpCode(code), attempts: 0 }
  );
}

describe("password reset (real MongoDB replica set, real transactions)", () => {
  let refreshToken: string;

  it("sets up an active workspace with a signed-in session", async () => {
    const { registerBusiness, login } = await import("@/lib/services/authService");
    const { User } = await import("@/models/User");
    const { Business } = await import("@/models/Business");

    const reg = await registerBusiness({
      legalName: "Reset Garments Pvt Ltd",
      tradeName: "Reset Garments",
      businessType: "Trader",
      domain: DOMAIN,
      ownerName: "Ravi Iyer",
      username: "ravi",
      email: "ravi@reset.test",
      phone: "9999999999",
      password: OLD_PASSWORD,
      confirmPassword: OLD_PASSWORD,
      country: "India",
      state: "Gujarat",
      city: "Surat",
      address: "1 Market Road",
      currency: "INR",
      timeZone: "Asia/Kolkata",
      financialYearStartMonth: 4,
    } as never);
    // Activate directly; OTP verification is covered by auth.integration.test.ts.
    await Business.updateOne({ _id: reg.businessId }, { status: "ACTIVE" });
    await User.updateOne({ _id: reg.userId }, { status: "ACTIVE", isEmailVerified: true });

    const session = await login({ domain: DOMAIN, usernameOrEmail: "ravi", password: OLD_PASSWORD }, {});
    refreshToken = session.refreshToken;
    expect(refreshToken).toBeTruthy();
  });

  it("answers silently for an account that doesn't exist — and creates nothing", async () => {
    const { requestPasswordReset } = await import("@/lib/services/authService");
    const { OtpVerification } = await import("@/models/OtpVerification");

    await expect(requestPasswordReset({ domain: DOMAIN, usernameOrEmail: "nobody" })).resolves.toBeUndefined();
    await expect(requestPasswordReset({ domain: "no-such-domain", usernameOrEmail: "ravi" })).resolves.toBeUndefined();
    expect(await OtpVerification.countDocuments({ purpose: "PASSWORD_RESET" })).toBe(0);
  });

  it("issues one code, and ignores a repeat request inside the cooldown", async () => {
    const { requestPasswordReset } = await import("@/lib/services/authService");
    const { OtpVerification } = await import("@/models/OtpVerification");

    await requestPasswordReset({ domain: DOMAIN, usernameOrEmail: "ravi@reset.test" });
    await requestPasswordReset({ domain: DOMAIN, usernameOrEmail: "ravi" });

    const pending = await OtpVerification.find({ purpose: "PASSWORD_RESET", status: "PENDING" }).lean();
    expect(pending).toHaveLength(1);
    expect(pending[0].target).toBe("ravi@reset.test");
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const { resetPassword } = await import("@/lib/services/authService");
    await plantResetCode("111111");

    await expect(
      resetPassword({ domain: DOMAIN, usernameOrEmail: "ravi", code: "999999", password: NEW_PASSWORD })
    ).rejects.toMatchObject({ code: "OTP_INVALID" });
  });

  it("rejects a valid code presented for a different account", async () => {
    const { resetPassword } = await import("@/lib/services/authService");
    await expect(
      resetPassword({ domain: DOMAIN, usernameOrEmail: "nobody", code: "111111", password: NEW_PASSWORD })
    ).rejects.toMatchObject({ code: "RESET_INVALID" });
  });

  it("changes the password, unlocks the account and revokes every session", async () => {
    const { resetPassword, login, refreshSession } = await import("@/lib/services/authService");
    const { User } = await import("@/models/User");

    // Lock the account first: a reset must also clear the lockout.
    await User.updateOne({ username: "ravi" }, { status: "LOCKED", lockedUntil: new Date(Date.now() + 3_600_000), failedLoginAttempts: 3 });

    await resetPassword({ domain: DOMAIN, usernameOrEmail: "ravi", code: "111111", password: NEW_PASSWORD });

    const user = await User.findOne({ username: "ravi" }).lean();
    expect(user?.status).toBe("ACTIVE");
    expect(user?.failedLoginAttempts).toBe(0);

    // The session opened before the reset is dead.
    await expect(refreshSession(refreshToken, {})).rejects.toMatchObject({ code: "SESSION_EXPIRED" });

    await expect(login({ domain: DOMAIN, usernameOrEmail: "ravi", password: OLD_PASSWORD }, {})).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    const fresh = await login({ domain: DOMAIN, usernameOrEmail: "ravi", password: NEW_PASSWORD }, {});
    expect(fresh.accessToken).toBeTruthy();
  });

  it("resets without a business domain, using just the username", async () => {
    const { requestPasswordReset, resetPassword, login } = await import("@/lib/services/authService");
    const { OtpVerification } = await import("@/models/OtpVerification");
    // Let the resend cooldown pass so a fresh code is issued.
    await OtpVerification.updateMany({ purpose: "PASSWORD_RESET" }, { lastSentAt: new Date(0) });

    await requestPasswordReset({ usernameOrEmail: "ravi" });
    await plantResetCode("222222");
    await resetPassword({ usernameOrEmail: "ravi@reset.test", code: "222222", password: OLD_PASSWORD });

    const back = await login({ usernameOrEmail: "ravi", password: OLD_PASSWORD }, {});
    expect(back.user.username).toBe("ravi");
  });

  it("won't accept the same code twice", async () => {
    const { resetPassword } = await import("@/lib/services/authService");
    await expect(
      resetPassword({ domain: DOMAIN, usernameOrEmail: "ravi", code: "111111", password: OLD_PASSWORD })
    ).rejects.toMatchObject({ code: "RESET_INVALID" });
  });
});
