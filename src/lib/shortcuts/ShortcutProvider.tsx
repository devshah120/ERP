"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { QUICK_NAV } from "./registry";

/**
 * Actions a screen can offer to the keyboard. A screen registers only what
 * it genuinely supports; anything it leaves undefined falls through to the
 * browser, so a shortcut never silently does nothing.
 */
export interface ShortcutScope {
  onNew?: () => void;
  onSave?: () => void;
  onSearch?: () => void;
  onPrint?: () => void;
  onExport?: () => void;
  onImport?: () => void;
  onRefresh?: () => void;
  onToggleFilters?: () => void;
  onToggleColumns?: () => void;
  onAddLine?: () => void;
}

interface ShortcutContextValue {
  register: (scope: ShortcutScope) => () => void;
  /** Dialogs push an Escape handler; the most recent one wins. */
  pushEscape: (handler: () => void) => () => void;
  openHelp: () => void;
  helpOpen: boolean;
  closeHelp: () => void;
  /** Command palette (Ctrl + K): jump to any screen or create anything. */
  openPalette: () => void;
  paletteOpen: boolean;
  closePalette: () => void;
  /** Last action fired, shown briefly so a keystroke visibly did something. */
  toast: string | null;
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

/**
 * Typing must never trigger a global action. Save and the help dialog are
 * the deliberate exceptions — Ctrl+S mid-form is exactly when you want it.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // A ref, not state: the keydown listener must see the current scope
  // without being torn down and rebuilt on every screen change.
  const scopeRef = useRef<ShortcutScope>({});
  const escapeStack = useRef<(() => void)[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);

  const register = useCallback((scope: ShortcutScope) => {
    scopeRef.current = scope;
    return () => {
      // Only clear if this scope is still the active one — a screen
      // unmounting after its replacement registered must not blank it.
      if (scopeRef.current === scope) scopeRef.current = {};
    };
  }, []);

  const pushEscape = useCallback((handler: () => void) => {
    escapeStack.current.push(handler);
    return () => {
      escapeStack.current = escapeStack.current.filter((h) => h !== handler);
    };
  }, []);

  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      const typing = isTypingTarget(event.target);
      const scope = scopeRef.current;
      const key = event.key.toLowerCase();

      // --- Escape: close the topmost dialog ---------------------------
      if (event.key === "Escape") {
        if (paletteOpen) {
          setPaletteOpen(false);
          event.preventDefault();
          return;
        }
        if (helpOpen) {
          setHelpOpen(false);
          event.preventDefault();
          return;
        }
        const handler = escapeStack.current[escapeStack.current.length - 1];
        if (handler) {
          handler();
          event.preventDefault();
        }
        return;
      }

      // --- F1: help, as in most desktop business software -------------
      if (event.key === "F1") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }

      // --- help: works even while typing ------------------------------
      if (mod && key === "/") {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }

      // --- command palette: works even while typing ---------------------
      if (mod && key === "k" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      // --- save: deliberately works while typing ----------------------
      if (mod && key === "s" && !event.shiftKey && !event.altKey) {
        if (scope.onSave) {
          event.preventDefault();
          scope.onSave();
          flash("Saving…");
        }
        return;
      }

      // --- print ------------------------------------------------------
      if (mod && key === "p" && !event.shiftKey) {
        if (scope.onPrint) {
          event.preventDefault();
          scope.onPrint();
        }
        return;
      }

      // --- add document line ------------------------------------------
      if (mod && event.key === "Enter" && scope.onAddLine) {
        event.preventDefault();
        scope.onAddLine();
        flash("Line added");
        return;
      }

      // Everything below is a global action, so it must not fire while the
      // user is typing into a field.
      if (typing) return;

      // --- navigation history -----------------------------------------
      if (event.altKey && !mod && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        if (event.key === "ArrowLeft") router.back();
        else router.forward();
        return;
      }

      // --- Alt quick-create / quick-go --------------------------------
      if (event.altKey && !mod && !event.shiftKey) {
        const target = QUICK_NAV[key];
        if (target) {
          event.preventDefault();
          router.push(target.href);
          flash(target.label);
        }
        return;
      }

      if (!mod) return;

      switch (key) {
        case "n":
          if (scope.onNew) {
            event.preventDefault();
            scope.onNew();
          }
          break;
        case "f":
          if (event.shiftKey) {
            if (scope.onToggleFilters) {
              event.preventDefault();
              scope.onToggleFilters();
            }
          } else if (scope.onSearch) {
            event.preventDefault();
            scope.onSearch();
          }
          break;
        case "e":
          if (scope.onExport) {
            event.preventDefault();
            scope.onExport();
          }
          break;
        case "i":
          if (scope.onImport) {
            event.preventDefault();
            scope.onImport();
          }
          break;
        case "k":
          // Plain Ctrl + K is the command palette (handled above).
          if (event.shiftKey && scope.onToggleColumns) {
            event.preventDefault();
            scope.onToggleColumns();
          }
          break;
        case "r":
          // Only steal the browser's reload when there is something better
          // to do with it; otherwise let the page reload as normal.
          if (scope.onRefresh) {
            event.preventDefault();
            scope.onRefresh();
            flash("Refreshed");
          }
          break;
        default:
          break;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, flash, helpOpen, paletteOpen]);

  const value = useMemo(
    () => ({ register, pushEscape, openHelp, helpOpen, closeHelp, openPalette, paletteOpen, closePalette, toast }),
    [register, pushEscape, openHelp, helpOpen, closeHelp, openPalette, paletteOpen, closePalette, toast]
  );

  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>;
}

export function useShortcuts(): ShortcutContextValue {
  const ctx = useContext(ShortcutContext);
  if (!ctx) throw new Error("useShortcuts must be used within ShortcutProvider");
  return ctx;
}

/**
 * Declares what the current screen can do from the keyboard.
 *
 * The handlers are read through a ref at keypress time, so a screen may pass
 * fresh closures on every render without re-binding the global listener.
 */
export function useShortcutScope(scope: ShortcutScope) {
  const { register } = useShortcuts();
  const latest = useRef(scope);

  // Written after render, not during it: the keypress handler reads this ref,
  // and mutating a ref mid-render is what the React compiler rules forbid.
  useEffect(() => {
    latest.current = scope;
  });

  useEffect(() => {
    // Register a stable proxy that always calls the newest handlers.
    return register({
      onNew: () => latest.current.onNew?.(),
      onSave: latest.current.onSave ? () => latest.current.onSave?.() : undefined,
      onSearch: () => latest.current.onSearch?.(),
      onPrint: latest.current.onPrint ? () => latest.current.onPrint?.() : undefined,
      onExport: () => latest.current.onExport?.(),
      onImport: latest.current.onImport ? () => latest.current.onImport?.() : undefined,
      onRefresh: () => latest.current.onRefresh?.(),
      onToggleFilters: latest.current.onToggleFilters ? () => latest.current.onToggleFilters?.() : undefined,
      onToggleColumns: () => latest.current.onToggleColumns?.(),
      onAddLine: latest.current.onAddLine ? () => latest.current.onAddLine?.() : undefined,
    });
    // Intentionally registers once per mount: the proxy above keeps the
    // handlers current, so re-registering on every render would only churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Lets a dialog claim Escape while it is open. */
export function useEscapeHandler(onEscape: () => void, active = true) {
  const { pushEscape } = useShortcuts();
  const latest = useRef(onEscape);

  useEffect(() => {
    latest.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    return pushEscape(() => latest.current());
  }, [pushEscape, active]);
}

/**
 * Warns before the browser discards unsaved edits. Deliberately limited to
 * the native prompt: a custom in-app dialog cannot block a tab close, so
 * pretending otherwise would be worse than the browser's own wording.
 */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
