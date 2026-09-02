import type { RequestHandler, Request, Response, NextFunction } from 'express';

/** An error with an HTTP status code; caught by the global error handler. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Wraps an async route handler so rejected promises reach the error
 * middleware (Express 4 does not await handlers itself).
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
