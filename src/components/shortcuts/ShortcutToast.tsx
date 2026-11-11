"use client";

import { useShortcuts } from "@/lib/shortcuts/ShortcutProvider";

/**
 * Brief confirmation that a keystroke did something. Without it, a shortcut
 * that quietly refreshes a list is indistinguishable from one that is broken.
 */
export default function ShortcutToast() {
  const { toast } = useShortcuts();
  if (!toast) return null;
  return (
    <div className="shortcutToast" role="status" aria-live="polite">
      {toast}
    </div>
  );
}
