/**
 * Base class for all expected, user-facing application errors.
 * Anything not thrown as an AppError is treated as an unexpected internal
 * error by the route wrapper: logged in full server-side, never leaked to the client.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly errors: unknown[] | undefined;

  constructor(message: string, statusCode: number, code: string, errors?: unknown[]) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
  }

  static badRequest(message: string, code = "BAD_REQUEST", errors?: unknown[]) {
    return new AppError(message, 400, code, errors);
  }

  static unauthorized(message = "Authentication required", code = "UNAUTHORIZED") {
    return new AppError(message, 401, code);
  }

  static forbidden(message = "You do not have permission to perform this action", code = "FORBIDDEN") {
    return new AppError(message, 403, code);
  }

  static notFound(message = "Resource not found", code = "NOT_FOUND") {
    return new AppError(message, 404, code);
  }

  static conflict(message: string, code = "CONFLICT") {
    return new AppError(message, 409, code);
  }

  static tooManyRequests(message = "Too many requests, please try again later", code = "RATE_LIMITED") {
    return new AppError(message, 429, code);
  }
}
