import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";

const BASE_ENV = {
  MONGODB_URI: "mongodb://localhost:27017/test",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
};
const SA_KEYS = ["NODE_ENV", "SUPERADMIN_EMAIL", "SUPERADMIN_PASSWORD", "SUPERADMIN_PASSWORD_HASH"] as const;

const saved = { ...process.env };

/** getEnv() caches, so each scenario loads a fresh copy of the module graph. */
async function load(env: Partial<Record<(typeof SA_KEYS)[number], string>>) {
  for (const k of SA_KEYS) delete process.env[k];
  Object.assign(process.env, BASE_ENV, env);
  vi.resetModules();
  return import("@/lib/auth/superAdminCredentials");
}

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("super-admin credentials", () => {
  it("never accepts the built-in password in production", async () => {
    const sa = await load({ NODE_ENV: "production" });
    expect(sa.getSuperAdminConfig()).toBeNull();
    expect(await sa.verifySuperAdminCredentials("superadmin@nexora.in", "Admin@12345")).toBe(false);
    expect(sa.isSuperAdminEmail("superadmin@nexora.in")).toBe(false);
  });

  it("rejects the built-in password in production even when credentials are configured", async () => {
    const hash = await bcrypt.hash("Real-Secret-1", 4);
    const sa = await load({ NODE_ENV: "production", SUPERADMIN_EMAIL: "owner@example.com", SUPERADMIN_PASSWORD_HASH: hash });
    expect(await sa.verifySuperAdminCredentials("owner@example.com", "Admin@12345")).toBe(false);
    expect(await sa.verifySuperAdminCredentials("Owner@Example.com ", "Real-Secret-1")).toBe(true);
    expect(await sa.verifySuperAdminCredentials("other@example.com", "Real-Secret-1")).toBe(false);
  });

  it("needs an email in production", async () => {
    const sa = await load({ NODE_ENV: "production", SUPERADMIN_PASSWORD: "Real-Secret-1" });
    expect(sa.getSuperAdminConfig()).toBeNull();
    expect(await sa.verifySuperAdminCredentials("superadmin@nexora.in", "Real-Secret-1")).toBe(false);
  });

  it("uses the built-in credentials only in development with nothing configured", async () => {
    const dev = await load({ NODE_ENV: "development" });
    expect(await dev.verifySuperAdminCredentials("superadmin@nexora.in", "Admin@12345")).toBe(true);
    expect(await dev.verifySuperAdminCredentials("superadmin@nexora.in", "wrong")).toBe(false);

    const configured = await load({ NODE_ENV: "development", SUPERADMIN_PASSWORD: "Local-Secret" });
    expect(await configured.verifySuperAdminCredentials("superadmin@nexora.in", "Admin@12345")).toBe(false);
    expect(await configured.verifySuperAdminCredentials("superadmin@nexora.in", "Local-Secret")).toBe(true);

    const test = await load({ NODE_ENV: "test" });
    expect(await test.verifySuperAdminCredentials("superadmin@nexora.in", "Admin@12345")).toBe(false);
  });
});
