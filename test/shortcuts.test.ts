import { describe, it, expect } from "vitest";
import { SHORTCUTS, QUICK_NAV, displayKeys } from "@/lib/shortcuts/registry";

describe("keyboard shortcut registry", () => {
  it("assigns each key combination to exactly one action", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];

    for (const s of SHORTCUTS) {
      const existing = seen.get(s.keys);
      if (existing) clashes.push(`${s.keys} is used by both "${existing}" and "${s.description}"`);
      else seen.set(s.keys, s.description);
    }

    expect(clashes).toEqual([]);
  });

  it("gives every shortcut a unique id, a scope and a real description", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const s of SHORTCUTS) {
      expect(s.description.length).toBeGreaterThan(5);
      expect(s.keys).toMatch(/^(Ctrl|Alt|Esc|F\d{1,2}$)/);
    }
  });

  it("documents every Alt quick-navigation target", () => {
    // A quick-nav entry that is not in the help table is a hidden feature;
    // a documented one with no target is a dead key. Neither is acceptable.
    // Only Alt + <letter>; Alt + ← / → are history navigation, handled
    // separately and deliberately absent from QUICK_NAV.
    const documented = new Set(
      SHORTCUTS.filter((s) => /^Alt \+ [A-Za-z]$/.test(s.keys)).map((s) => s.keys.slice(-1).toLowerCase())
    );
    const implemented = new Set(Object.keys(QUICK_NAV));

    expect([...implemented].filter((k) => !documented.has(k))).toEqual([]);
    expect([...documented].filter((k) => !implemented.has(k))).toEqual([]);
  });

  it("points every quick-navigation target at an absolute app path", () => {
    for (const [key, target] of Object.entries(QUICK_NAV)) {
      expect(target.href.startsWith("/"), `${key} → ${target.href}`).toBe(true);
      expect(target.label.length).toBeGreaterThan(3);
    }
  });

  it("substitutes Mac modifiers only on a Mac", () => {
    expect(displayKeys("Ctrl + N", false)).toBe("Ctrl + N");
    expect(displayKeys("Ctrl + N", true)).toBe("⌘ + N");
    expect(displayKeys("Alt + ←", true)).toBe("⌥ + ←");
  });
});
