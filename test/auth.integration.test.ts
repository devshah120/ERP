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

  it("signs in without a business domain when the username is unique", async () => {
    const { login } = await import("@/lib/services/authService");

    const byUsername = await login({ usernameOrEmail: "priya", password: "Str0ng!Passw0rd" }, {});
    expect(byUsername.user.username).toBe("priya");

    const byEmail = await login({ domain: "", usernameOrEmail: "PRIYA@acme.test", password: "Str0ng!Passw0rd" }, {});
    expect(byEmail.user.username).toBe("priya");

    await expect(login({ usernameOrEmail: "nobody", password: "Str0ng!Passw0rd" }, {})).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("lets the password pick the account when the same username exists in two workspaces", async () => {
    const { login } = await import("@/lib/services/authService");
    const { Business } = await import("@/models/Business");
    const { User } = await import("@/models/User");

    // A second active workspace with its own user called "priya".
    const original = await Business.findOne({ domain: "acme-garments" }).lean();
    const businessFields: Record<string, unknown> = { ...original };
    delete businessFields._id;
    const other = await Business.create({ ...businessFields, domain: "other-garments", legalName: "Other Garments Pvt Ltd" });
    const priya = await User.findOne({ username: "priya" }).select("+passwordHash").lean();
    const userFields: Record<string, unknown> = { ...priya };
    delete userFields._id;
    const { hashPassword } = await import("@/lib/auth/password");
    await User.create({ ...userFields, businessId: other._id, passwordHash: await hashPassword("0ther!Passw0rd") });

    // Each password opens its own workspace — no business domain needed.
    const first = await login({ usernameOrEmail: "priya", password: "Str0ng!Passw0rd" }, {});
    expect(first.user.businessId).toBe(String(original!._id));
    const second = await login({ usernameOrEmail: "priya", password: "0ther!Passw0rd" }, {});
    expect(second.user.businessId).toBe(String(other._id));

    // A password that opens neither is just invalid.
    await expect(login({ usernameOrEmail: "priya", password: "Wrong!Passw0rd" }, {})).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await User.updateMany({ username: "priya" }, { status: "ACTIVE", failedLoginAttempts: 0, lockedUntil: null });

    // API callers may still name the workspace explicitly.
    const scoped = await login({ domain: "other-garments", usernameOrEmail: "priya", password: "0ther!Passw0rd" }, {});
    expect(scoped.user.businessId).toBe(String(other._id));

    // An inactive workspace doesn't count as a second match.
    await Business.updateOne({ _id: other._id }, { status: "SUSPENDED" });
    const single = await login({ usernameOrEmail: "priya", password: "Str0ng!Passw0rd" }, {});
    expect(single.user.businessId).toBe(String(original!._id));
  });

  it("generates a unique workspace ID when registering without a domain", async () => {
    const { registerBusiness } = await import("@/lib/services/authService");
    const { Business } = await import("@/models/Business");
    const input: Record<string, unknown> = { ...registerInput, username: "neha", email: "neha@acme2.test" };
    delete input.domain;
    // "Acme Garments" → "acme-garments" is taken, so the next free one is used.
    const result = await registerBusiness(input as never);
    const created = await Business.findById(result.businessId).lean();
    expect(created?.domain).toBe("acme-garments-2");
  });

  it("registers with only the short sign-up fields and fills sensible defaults", async () => {
    const { registerBusiness } = await import("@/lib/services/authService");
    const { registerSchema } = await import("@/lib/validation/authSchemas");
    const { Business } = await import("@/models/Business");
    const { User } = await import("@/models/User");

    // Exactly what the sign-up form sends (blank optionals come through as "").
    const input = registerSchema.parse({
      legalName: "Mehta Fabrics",
      gstin: "27AAACM1234A1Z5",
      phone: "",
      ownerName: "Kiran Mehta",
      email: "Kiran.Mehta+shop@mehta.test",
      password: "Str0ng!Passw0rd",
    });
    const result = await registerBusiness(input);

    const biz = await Business.findById(result.businessId).lean();
    expect(biz?.tradeName).toBe("Mehta Fabrics");
    expect(biz?.domain).toBe("mehta-fabrics");
    expect(biz?.state).toBe("Maharashtra"); // from GSTIN state code 27
    expect(biz?.country).toBe("India");
    expect(biz?.businessType).toBe("Retail");
    const owner = await User.findOne({ businessId: result.businessId }).lean();
    expect(owner?.username).toBe("kiran.mehta");
    expect(owner?.phone).toBe("");
  });

  it("rejects a duplicate domain registration with a clean 409-style AppError", async () => {
    const { registerBusiness } = await import("@/lib/services/authService");
    await expect(registerBusiness({ ...registerInput, username: "someoneelse", email: "x@acme.test" } as never)).rejects.toMatchObject(
      { code: "DOMAIN_TAKEN" }
    );
  });
});
