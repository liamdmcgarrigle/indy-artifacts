export class ServiceError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
  }
}

export class NotFoundError extends ServiceError {
  constructor(message: string) {
    super("not_found", message, 404);
  }
}

export class ValidationError extends ServiceError {
  constructor(
    message: string,
    /** Per-field problems, for a form to show beside each question. */
    public details?: Record<string, unknown>,
  ) {
    super("invalid", message, 400);
  }
}

export class ConflictError extends ServiceError {
  currentVersion: number;
  constructor(message: string, currentVersion: number) {
    super("conflict", message, 409);
    this.currentVersion = currentVersion;
  }
}

export class UnauthorizedError extends ServiceError {
  constructor(message = "sign in first") {
    super("unauthorized", message, 401);
  }
}

export class ForbiddenError extends ServiceError {
  constructor(message = "not allowed") {
    super("forbidden", message, 403);
  }
}
