import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/http';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code ?? 'APP_ERROR', message: err.message },
    });
    return;
  }

  // Middleware errors carry their own HTTP status (e.g. body-parser's
  // malformed-JSON SyntaxError has status 400) — honor it instead of 500ing.
  const carrier = err as { status?: number; statusCode?: number };
  const httpStatus = carrier.statusCode ?? carrier.status;
  if (typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500) {
    if (httpStatus === 413) {
      // Body too large — say so plainly (QA wave-3 F2: this used to surface
      // as a generic "Malformed request body").
      const limit = (err as { limit?: number }).limit;
      res.status(413).json({
        error: {
          code: 'REQUEST_TOO_LARGE',
          message: limit
            ? `Request body exceeds the ${(limit / 1024 / 1024).toFixed(1)}MB limit`
            : 'Request body exceeds the size limit',
        },
      });
      return;
    }
    res.status(httpStatus).json({
      error: { code: 'BAD_REQUEST', message: 'Malformed request body' },
    });
    return;
  }

  // Prisma error codes we translate into friendly HTTP responses.
  const prismaCode = (err as { code?: string }).code;
  if (prismaCode === 'P2002') {
    res.status(409).json({
      error: { code: 'CONFLICT', message: 'A record with these values already exists' },
    });
    return;
  }
  if (prismaCode === 'P2025') {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong' },
  });
};
