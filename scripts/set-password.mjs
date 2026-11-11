/**
 * Sets a user's password directly in the database — for admins, e.g. when
 * email (SMTP) isn't set up yet so "Forgot password" can't send a code.
 *
 * Usage:
 *   node --env-file=.env.local scripts/set-password.mjs <email> <new-password>
 *
 * Same effect as the app's own password reset: stores a bcrypt hash (cost 12),
 * clears any lockout, signs the user out of every device and records an
 * Activity Log entry. The password must meet the app's rules (8+ characters,
 * upper and lower case, a number and a symbol).
 */
import bcrypt from "bcryptjs";
import { MongoClient } from "mongodb";

const [email, password] = process.argv.slice(2);
const POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

if (!email || !password) {
  console.error("Usage: node --env-file=.env.local scripts/set-password.mjs <email> <new-password>");
  process.exit(1);
}
if (!POLICY.test(password)) {
  console.error("Password must be 8+ characters with an uppercase letter, a lowercase letter, a number and a symbol.");
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not set — run with --env-file=.env.local");
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
try {
  await client.connect();
  const db = client.db();
  const users = await db.collection("users").find({ email: email.trim().toLowerCase() }).toArray();
  if (users.length === 0) {
    console.error(`No user with email ${email} in database "${db.databaseName}".`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  for (const u of users) {
    await db.collection("users").updateOne(
      { _id: u._id },
      {
        $set: {
          passwordHash,
          passwordChangedAt: now,
          failedLoginAttempts: 0,
          lockedUntil: null,
          ...(u.status === "LOCKED" ? { status: "ACTIVE" } : {}),
          updatedAt: now,
        },
      }
    );
    const revoked = await db.collection("sessions").updateMany({ userId: u._id, revokedAt: null }, { $set: { revokedAt: now } });
    await db.collection("auditlogs").insertOne({
      businessId: u.businessId,
      userId: u._id,
      action: "PASSWORD_CHANGE",
      module: "auth",
      documentType: "User",
      documentId: u._id,
      reason: "Password set by an administrator (scripts/set-password.mjs); all sessions revoked",
      createdAt: now,
      updatedAt: now,
    });
    console.log(`✓ Password updated for ${u.email} (${u.name ?? "user"}) — ${revoked.modifiedCount} session(s) signed out`);
  }

  const ok = await bcrypt.compare(password, (await db.collection("users").findOne({ _id: users[0]._id })).passwordHash);
  console.log(ok ? "✓ Verified: the new password matches the stored hash." : "✗ Verification failed.");
} finally {
  await client.close();
}
