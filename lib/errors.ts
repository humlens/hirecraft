export class ApiError extends Error {
  status: number;
  /** Optional machine-readable extras (for example an upgrade hint). */
  details?: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
