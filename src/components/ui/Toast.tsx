"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";

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
 * Modernized Toast system built on Material UI Snackbar & Alert.
 * Provides accessible, stacked notifications with exact API compatibility.
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
      setItems((list) => [...list.slice(-2), { id, tone, title, description }]);
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
      <Snackbar
        open={items.length > 0}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        sx={{ mb: 2, mr: 2, zIndex: 9999 }}
      >
        <Stack spacing={1.5} sx={{ width: "100%", maxWidth: 360 }}>
          {items.map((t) => (
            <Alert
              key={t.id}
              severity={t.tone}
              variant="filled"
              onClose={() => dismiss(t.id)}
              sx={{
                boxShadow: "0 10px 15px -3px rgba(15, 23, 42, 0.18), 0 4px 6px -4px rgba(15, 23, 42, 0.1)",
                borderRadius: 2,
                fontSize: "0.8125rem",
                width: "100%",
              }}
            >
              <AlertTitle sx={{ fontWeight: 700, fontSize: "0.875rem", mb: t.description ? 0.25 : 0 }}>
                {t.title}
              </AlertTitle>
              {t.description && (
                <Typography variant="body2" sx={{ fontSize: "0.75rem", opacity: 0.9 }}>
                  {t.description}
                </Typography>
              )}
            </Alert>
          ))}
        </Stack>
      </Snackbar>
    </ToastContext.Provider>
  );
}

/** Falls back to a no-op outside the provider (e.g. auth pages) rather than throwing. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return ctx ?? NOOP;
}

const NOOP: ToastApi = { success: () => {}, error: () => {}, info: () => {} };
