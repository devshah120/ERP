/**
 * Where to send someone after sign-in, given an untrusted ?next= value.
 * Only same-origin absolute app paths are honoured — never another host
 * ("//evil.com", "/\evil.com") and never back to a signed-out page.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
  if (/^\/(login|register|verify-otp|forgot-password|reset-password|session-expired)(\/|\?|$)/.test(next)) {
    return "/dashboard";
  }
  return next;
}
