import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCodes, type ErrorCode } from '../constants/error-codes.js';

/**
 * Shape returned to the client for every error response. Mirrors the
 * success envelope so the client never needs to branch on
 * "is this an error or not" beyond checking the top-level fields.
 *
 * Spec §4 / §7 — error wrap:
 *   { success: false, error: { code, message, details? }, meta: { timestamp, path } }
 */
export interface EnvelopeErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
  meta: {
    timestamp: string;
    path: string;
  };
}

/**
 * Type guard for the structured `{ code, message, details? }` payload that
 * NestJS HttpException accepts in its constructor. Used to pull the
 * canonical code/message out of an HttpException before falling back to
 * the status-code-derived defaults.
 */
interface HttpExceptionBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

const isHttpExceptionBody = (value: unknown): value is HttpExceptionBody =>
  typeof value === 'object' && value !== null;

/**
 * Extract `{ code, message }` from an HttpException's `getResponse()`
 * payload when the controller/service threw with the canonical shape
 * (e.g. `throw new NotFoundException({ code: 'USER_NOT_FOUND', message: '...' })`).
 *
 * Falls back to deriving from the HTTP status when the payload doesn't
 * follow the shape (e.g. `throw new BadRequestException('string message')`).
 */
const extractFromHttpException = (
  exception: HttpException,
): { code: ErrorCode; message: string; details?: unknown } => {
  const status = exception.getStatus();
  const response = exception.getResponse();

  if (isHttpExceptionBody(response)) {
    const code = typeof response.code === 'string' ? (response.code as ErrorCode) : null;
    const message =
      typeof response.message === 'string'
        ? response.message
        : Array.isArray(response.message)
          ? 'Validation failed'
          : exception.message;

    if (code && code in ErrorCodes) {
      return { code, message, details: response.details };
    }
  }

  // Map common HTTP statuses to canonical codes when the controller
  // didn't supply one.
  const fallback: Record<number, { code: ErrorCode; message: string }> = {
    [HttpStatus.BAD_REQUEST]: { code: ErrorCodes.VALIDATION_ERROR, message: 'Bad request' },
    [HttpStatus.UNAUTHORIZED]: { code: ErrorCodes.UNAUTHORIZED, message: 'Unauthorized' },
    [HttpStatus.FORBIDDEN]: { code: ErrorCodes.FORBIDDEN, message: 'Forbidden' },
    [HttpStatus.NOT_FOUND]: { code: ErrorCodes.NOT_FOUND, message: 'Resource not found' },
    [HttpStatus.CONFLICT]: { code: ErrorCodes.EMAIL_ALREADY_EXISTS, message: 'Conflict' },
    [HttpStatus.TOO_MANY_REQUESTS]: {
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'Too many requests',
    },
  };

  return fallback[status] ?? {
    code: ErrorCodes.INTERNAL_ERROR,
    message: exception.message,
  };
};

/**
 * `AllExceptionsFilter` — catches every exception NestJS would otherwise
 * surface as an HTML error page or bare `{ statusCode, message }` JSON,
 * and converts it into the canonical error envelope.
 *
 * Spec §7 — Error-Code Filters:
 *   - HttpException subclasses → envelope with status-derived code
 *   - Generic Error → 500 INTERNAL_ERROR
 *   - Production → NO stack trace in the response body
 *   - Development → stack attached to `details.stack` for debugging
 *
 * Registered globally in `main.ts` (PR #4). Per Prisma errors, see
 * `PrismaExceptionFilter` which maps P2002/P2025/P2003 to canonical
 * envelopes BEFORE this filter sees them.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isProd = process.env.NODE_ENV === 'production';

    let status: number;
    let body: EnvelopeErrorBody['error'];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const extracted = extractFromHttpException(exception);
      body = {
        code: extracted.code,
        message: extracted.message,
        ...(extracted.details !== undefined ? { details: extracted.details } : {}),
      };
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      body = {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Internal server error',
      };
    }

    // Stack trace handling: never leak to the client in production.
// We only attach the stack when the error is unhandled (5xx) AND no
// structured details were already supplied — preserving the canonical
// shape for validation/HTTP exceptions and adding debugging context
// for genuine server errors.
    if (
      !isProd &&
      status >= 500 &&
      exception instanceof Error &&
      exception.stack &&
      body.details === undefined
    ) {
      body = { ...body, details: { stack: exception.stack } };
    }

    // Log unhandled errors (5xx) at error; 4xx at warn.
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl ?? request.url} → ${status} ${body.code}: ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.originalUrl ?? request.url} → ${status} ${body.code}: ${body.message}`,
      );
    }

    const envelope: EnvelopeErrorBody = {
      success: false,
      error: body,
      meta: {
        timestamp: new Date().toISOString(),
        path: request.originalUrl ?? request.url ?? '',
      },
    };

    response.status(status).json(envelope);
  }
}