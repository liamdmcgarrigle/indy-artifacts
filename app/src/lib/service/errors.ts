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
  constructor(message: string) {
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
