export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "You do not have permission to do that") => new AppError(403, "forbidden", msg);
export const invalid = (msg: string, details?: unknown) => new AppError(400, "invalid", msg, details);
export const conflict = (msg: string, details?: unknown) => new AppError(409, "conflict", msg, details);
