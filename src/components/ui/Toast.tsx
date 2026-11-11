"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { IconAlertCircle, IconCheckCircle, IconClose, IconInfo } from "@/components/icons";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DURATION: Record<ToastTone, number> = { success: 3500, info: 4000, error: 6500 };

/**
 * Transient confirmations ("Customer saved") that don't need to sit in the
 * page. Errors stay longer and are announced assertively for screen readers.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { id, tone, title, description }]);
      setTimeout(() => dismiss(id), DURATION[tone]);
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, d) => push("success", t, d),
      error: (t, d) => push("error", t, d),
      info: (t, d) => push("info", t, d),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toastStack" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
            <span className="toastIcon">
              {t.tone === "success" ? <IconCheckCircle /> : t.tone === "error" ? <IconAlertCircle /> : <IconInfo />}
            </span>
            <div className="toastBody">
              <strong>{t.title}</strong>
              {t.description && <span>{t.description}</span>}
            </div>
            <button type="button" className="toastClose" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <IconClose />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Falls back to a no-op outside the provider (e.g. auth pages) rather than throwing. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return ctx ?? NOOP;
}

const NOOP: ToastApi = { success: () => {}, error: () => {}, info: () => {} };
