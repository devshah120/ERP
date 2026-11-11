/** Reads a dot-path value, e.g. getPath(record, "billingAddress.city"). */
export function getPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

/** Immutably writes a dot-path value, creating intermediate objects as needed. */
export function setPath<T extends Record<string, unknown>>(source: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const out = { ...source } as Record<string, unknown>;
  let cursor = out;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const existing = cursor[key];
    cursor[key] = existing && typeof existing === "object" ? { ...(existing as object) } : {};
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[keys[keys.length - 1]] = value;
  return out as T;
}
