"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEscapeHandler } from "@/lib/shortcuts/ShortcutProvider";

/**
 * Open/close state for any anchored popover: closes on an outside click and
 * on Escape (through the shared Escape stack, so a popover inside a modal
 * closes before the modal does).
 */
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEscapeHandler(close, open);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  return { open, setOpen, close, toggle, ref };
}
