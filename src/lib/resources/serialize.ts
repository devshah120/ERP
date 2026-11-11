import { Types } from "mongoose";

/**
 * Converts a Mongoose document into a JSON-safe plain object:
 * `_id` → `id` (string), ObjectId → string, Decimal128 → decimal string
 * (never a JS number — see decision J-2), Date → ISO string.
 * Applied recursively so embedded subdocuments (item variants, addresses)
 * come out clean too.
 */
export function serializeDoc(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (value instanceof Types.ObjectId) return value.toString();
  if (value instanceof Types.Decimal128) return value.toString();
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.map(serializeDoc);

  if (typeof value === "object") {
    const source = value as { toObject?: () => Record<string, unknown> };
    const plain = typeof source.toObject === "function" ? source.toObject() : (value as Record<string, unknown>);

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(plain)) {
      if (key === "__v") continue;
      if (key === "_id") {
        out.id = serializeDoc(val);
        continue;
      }
      out[key] = serializeDoc(val);
    }
    return out;
  }

  return value;
}
