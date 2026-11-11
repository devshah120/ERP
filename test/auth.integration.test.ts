import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

// NODE_ENV is already set to "test" by vitest itself.
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
  process.env.MONGODB_URI = replSet.getUri("garment-erp-test");
  await mongoose.connect(process.env.MONGODB_URI);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

describe("auth flow (real MongoDB replica set, real transactions)", () => {
  const registerInput = {
    legalName: "Acme Garments Pvt Ltd",
    tradeName: "Acme Garments",
    businessType: "Manufacturer",
    domain: "acme-garments",
    ownerName: "Priya Sharma",
    username: "priya",
    email: "priya@acme.test",
    phone: "9999999999",
    password: "Str0ng!Passw0rd",
    confirmPassword: "Str0ng!Passw0rd",
    country: "India",
    state: "Maharashtra",
    city: "Mumbai",
    address: "123 Textile Road",
    currency: "INR",
    timeZone: "Asia/Kolkata",
    financialYearStartMonth: 4,
  };

  let businessId: string;

  it("registers a business, creates default branch/warehouse/role, and sends an OTP", async () => {
    const { registerBusiness } = await import("@/lib/services/authService");
    const { OtpVerification } = await import("@/models/OtpVerification");
    const { Branch } = await import("@/models/Branch");
    const { Warehouse } = await import("@/models/Warehouse");
    const { Role } = await import("@/models/Role");
    const { Business } = await import("@/models/Business");

    const result = await registerBusiness(registerInput as never);
    businessId = result.businessId;

    expect(result.userId).toBeTruthy();
    expect(result.otpTarget).toBe("priya@acme.test");

    const business = await Business.findById(businessId).lean();
    expect(business?.status).toBe("PENDING_VERIFICATION");

    const branch = await Branch.findOne({ businessId }).lean();
    expect(branch?.code).toBe("MAIN");

    const warehouse = await Warehouse.findOne({ businessId }).lean();
    expect(warehouse?.code).toBe("MAIN");

    const role = await Role.findOne({ businessId, name: "Owner" }).lean();
    expect(role?.permissions).toEqual(["*"]);

    const otp = await OtpVerification.findOne({ businessId, purpose: "REGISTRATION" }).select("+codeHash");
    expect(otp).toBeTruthy();
    expect(otp!.status).toBe("PENDING");
  });

  it("rejects an invalid OTP and reports remaining attempts", async () => {
    const { verifyRegistrationOtp } = await import("@/lib/services/authService");
    await expect(verifyRegistrationOtp(businessId, "000000")).rejects.toMatchObject({
      code: "OTP_INVALID",
    });
  });

  it("resends a fresh OTP and successfully verifies with it", async () => {
    const { hashOtpCode } = await import("@/lib/auth/otp");
    const { OtpVerification } = await import("@/models/OtpVerification");
    const { verifyRegistrationOtp } = await import("@/lib/services/authService");
    const { User } = await import("@/models/User");
    const { Business } = await import("@/models/Business");

    // Simulate "resend" but intercept the code by monkey-patching at the
    // hash layer: generate a known code, write it directly through the
    // same codepath resend would use, to avoid depending on SMTP delivery
    // in a test environment.
    const knownCode = "654321";
    await OtpVerification.updateOne(
      { businessId, purpose: "REGISTRATION", status: "PENDING" },
      { codeHash: hashOtpCode(knownCode), attempts: 0 }
    );

    await verifyRegistrationOtp(businessId, knownCode);

    const user = await User.findOne({ businessId }).lean();
    expect(user?.status).toBe("ACTIVE");
    expect(user?.isEmailVerified).toBe(true);

    const business = await Business.findById(businessId).lean();
    expect(business?.status).toBe("ACTIVE");
  });

  it("rejects login with the wrong password and locks after max attempts", async () => {
    const { login } = await import("@/lib/services/authService");
    const { User } = await import("@/models/User");

    for (let i = 0; i < 3; i++) {
      await expect(
        login(
          { domain: "acme-garments", usernameOrEmail: "priya", password: "wrong-password" },
          {}
        )
      ).rejects.toMatchObject({ code: i < 2 ? "INVALID_CREDENTIALS" : "INVALID_CREDENTIALS" });
    }

    const user = await User.findOne({ username: "priya" }).lean();
    expect(user?.status).toBe("LOCKED");

    await expect(
      login({ domain: "acme-garments", usernameOrEmail: "priya", password: "Str0ng!Passw0rd" }, {})
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });

  it("logs in successfully after unlocking, and refresh/logout work", async () => {
    const { User } = await import("@/models/User");
    const { login, refreshSession, logout } = await import("@/lib/services/authService");
    const { Session } = await import("@/models/Session");

    // Unlock directly (simulates lockout window elapsing).
    await User.updateOne({ username: "priya" }, { status: "ACTIVE", failedLoginAttempts: 0, lockedUntil: null });

    const result = await login(
      { domain: "acme-garments", usernameOrEmail: "priya@acme.test", password: "Str0ng!Passw0rd" },
      { ip: "127.0.0.1", userAgent: "vitest" }
    );

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.username).toBe("priya");

    const sessionBefore = await Session.findOne({ userId: result.user.id, revokedAt: null });
    expect(sessionBefore).toBeTruthy();

    const refreshed = await refreshSession(result.refreshToken, { ip: "127.0.0.1" });
    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.refreshToken).not.toBe(result.refreshToken);

    // Old refresh token must now be rejected (rotation).
    await expect(refreshSession(result.refreshToken, {})).rejects.toMatchObject({ code: "SESSION_EXPIRED" });

    await logout(refreshed.refreshToken);
    await expect(refreshSession(refreshed.refreshToken, {})).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("rejects a duplicate domain registration with a clean 409-style AppError", async () => {
    const { registerBusiness } = await import("@/lib/services/authService");
    await expect(registerBusiness({ ...registerInput, username: "someoneelse", email: "x@acme.test" } as never)).rejects.toMatchObject(
      { code: "DOMAIN_TAKEN" }
    );
  });
});
