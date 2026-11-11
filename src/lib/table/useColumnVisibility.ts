"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "erp.columns.";

/**
 * Per-module column visibility, remembered in localStorage.
 *
 * State starts empty and is hydrated from storage in an effect rather than a
 * lazy initialiser: reading localStorage during the first render would make
 * the server and client markup disagree and trigger a hydration mismatch.
 */
export function useColumnVisibility(moduleKey: string) {
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + moduleKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setHidden(JSON.parse(raw));
    } catch {
      // Corrupt or unavailable storage (private mode, cleared site data)
      // simply means "show every column" — never a reason to break the page.
    }
  }, [moduleKey]);

  const persist = useCallback(
    (next: string[]) => {
      setHidden(next);
      try {
        window.localStorage.setItem(STORAGE_PREFIX + moduleKey, JSON.stringify(next));
      } catch {
        // Preference is lost on reload but the current session still works.
      }
    },
    [moduleKey]
  );

  const toggle = useCallback(
    (key: string) => {
      persist(hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]);
    },
    [hidden, persist]
  );

  const reset = useCallback(() => persist([]), [persist]);

  const isVisible = useCallback((key: string) => !hidden.includes(key), [hidden]);

  return { hidden, isVisible, toggle, reset };
}
