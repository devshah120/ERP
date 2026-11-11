import mongoose from "mongoose";
import { getEnv } from "@/lib/config/env";

declare global {
  var __mongooseConn: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  } | undefined;
}

// Cached across hot-reloads/serverless invocations so we don't open a new
// connection pool on every request in dev or on every lambda cold path.
const cached = globalThis.__mongooseConn ?? { conn: null, promise: null };
globalThis.__mongooseConn = cached;

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const { MONGODB_URI } = getEnv();
    cached.promise = mongoose.connect(MONGODB_URI, {
      maxPoolSize: 20,
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }

  return cached.conn;
}
