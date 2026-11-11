/**
 * Copies a whole MongoDB database to another server — e.g. the local
 * development database to MongoDB Atlas. Every collection, document (with its
 * original _id) and index is copied, then document counts are compared.
 *
 * Usage (PowerShell):
 *   $env:SOURCE_URI = "mongodb://127.0.0.1:27017/nexora?directConnection=true"
 *   $env:TARGET_URI = "mongodb+srv://USER:PASSWORD@cluster.example.mongodb.net/nexora"
 *   node scripts/copy-db.mjs
 *
 * The database names come from the URIs. The target must be empty; pass
 * --force to copy into a database that already has collections (existing
 * documents with the same _id are left as they are).
 *
 * Credentials are read from the environment and never printed.
 */
import { MongoClient } from "mongodb";

const SOURCE_URI = process.env.SOURCE_URI;
const TARGET_URI = process.env.TARGET_URI;
const FORCE = process.argv.includes("--force");
const BATCH = 1000;

if (!SOURCE_URI || !TARGET_URI) {
  console.error("Set SOURCE_URI and TARGET_URI (see the comment at the top of this file).");
  process.exit(1);
}

/** Hides the password when a URI has to be shown. */
const redact = (uri) => uri.replace(/\/\/([^:/@]+):[^@]+@/, "//$1:****@");

function dbNameOf(uri) {
  const path = new URL(uri.replace(/^mongodb(\+srv)?:/, "http:")).pathname.replace(/^\//, "");
  if (!path) throw new Error(`No database name in ${redact(uri)} — add it after the host, e.g. .../nexora`);
  return decodeURIComponent(path);
}

const source = new MongoClient(SOURCE_URI, { serverSelectionTimeoutMS: 15000 });
const target = new MongoClient(TARGET_URI, { serverSelectionTimeoutMS: 15000 });

try {
  await Promise.all([source.connect(), target.connect()]);
  const from = source.db(dbNameOf(SOURCE_URI));
  const to = target.db(dbNameOf(TARGET_URI));
  console.log(`Copying ${from.databaseName} (${redact(SOURCE_URI)})\n     to ${to.databaseName} (${redact(TARGET_URI)})\n`);

  const existing = await to.listCollections({}, { nameOnly: true }).toArray();
  if (existing.length > 0 && !FORCE) {
    console.error(`Target database "${to.databaseName}" already has ${existing.length} collection(s). Refusing to copy; pass --force to merge into it.`);
    process.exit(1);
  }

  const collections = (await from.listCollections().toArray()).filter((c) => !c.name.startsWith("system."));
  const views = collections.filter((c) => c.type === "view");
  const plain = collections.filter((c) => c.type !== "view");
  let totalDocs = 0;
  const problems = [];

  for (const info of plain.sort((a, b) => a.name.localeCompare(b.name))) {
    const src = from.collection(info.name);
    if (!existing.some((c) => c.name === info.name)) await to.createCollection(info.name, info.options ?? {});
    const dst = to.collection(info.name);

    let copied = 0;
    let batch = [];
    const flush = async () => {
      if (batch.length === 0) return;
      try {
        await dst.insertMany(batch, { ordered: false });
      } catch (err) {
        // With --force, documents that already exist (duplicate _id) are skipped.
        if (!(FORCE && err?.code === 11000) && !(FORCE && err?.writeErrors?.every?.((w) => w.code === 11000))) throw err;
      }
      copied += batch.length;
      batch = [];
    };
    for await (const doc of src.find({}, { batchSize: BATCH })) {
      batch.push(doc);
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    const indexes = (await src.listIndexes().toArray()).filter((i) => i.name !== "_id_");
    for (const ix of indexes) {
      const { key, v: _v, ns: _ns, ...options } = ix;
      try {
        await dst.createIndex(key, options);
      } catch (err) {
        problems.push(`${info.name}: index ${ix.name} — ${err.message}`);
      }
    }

    const [a, b] = await Promise.all([src.countDocuments(), dst.countDocuments()]);
    if (a !== b) problems.push(`${info.name}: ${a} documents in source but ${b} in target`);
    totalDocs += copied;
    console.log(`  ${a === b ? "✓" : "✗"} ${info.name.padEnd(32)} ${String(b).padStart(7)} docs  ${String(indexes.length).padStart(2)} indexes`);
  }

  for (const v of views) {
    try {
      await to.createCollection(v.name, { viewOn: v.options.viewOn, pipeline: v.options.pipeline });
      console.log(`  ✓ ${v.name} (view)`);
    } catch (err) {
      problems.push(`view ${v.name}: ${err.message}`);
    }
  }

  console.log(`\nCopied ${plain.length} collections, ${totalDocs} documents${views.length ? `, ${views.length} views` : ""}.`);
  if (problems.length) {
    console.log("\nProblems:");
    for (const p of problems) console.log("  - " + p);
    process.exitCode = 1;
  } else {
    console.log("All counts match.");
  }
} finally {
  await Promise.allSettled([source.close(), target.close()]);
}
