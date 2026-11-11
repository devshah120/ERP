export class ApiError extends Error {
  code: string;
  errors?: unknown[];
  status?: number;

  constructor(message: string, code: string, errors?: unknown[], status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.errors = errors;
    this.status = status;
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
  errors?: unknown[];
}

/** Fired on window when the session can't be renewed; AuthProvider decides where to send the user. */
export const SESSION_EXPIRED_EVENT = "erp:session-expired";

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Renews the 15-minute access token using the long-lived refresh cookie.
 * Single-flight: a page firing six requests at once after the token expired
 * triggers one refresh, not six — which matters because refresh tokens rotate
 * and a second concurrent use of the old one would be rejected.
 */
function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        // Let callers that awaited this promise see the result before clearing it.
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      });
  }
  return refreshInFlight;
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
}

/** Thin wrapper around fetch for the app's own API routes: always sends
 * cookies, always parses the standard { success, data, message } envelope,
 * and throws ApiError (with the server's message/code) on failure. An expired
 * access token is renewed transparently and the request retried once. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res = await send(path, init);

  // Credential endpoints answer 401 for a wrong password etc. — never retry
  // those. /api/auth/me is a normal protected read and does get the retry.
  const isCredentialRoute = path.startsWith("/api/auth/") && !path.startsWith("/api/auth/me");
  if (res.status === 401 && !isCredentialRoute && typeof window !== "undefined") {
    if (await refreshSession()) {
      res = await send(path, init);
    } else {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      throw new ApiError("Your session has expired. Please sign in again.", "SESSION_EXPIRED", undefined, 401);
    }
  }

  let body: ApiEnvelope<T>;
  try {
    body = await res.json();
  } catch {
    throw new ApiError("Unexpected server response", "BAD_RESPONSE", undefined, res.status);
  }

  if (!body.success) {
    throw new ApiError(body.message ?? "Request failed", body.code ?? "UNKNOWN_ERROR", body.errors, res.status);
  }

  return body.data as T;
}
