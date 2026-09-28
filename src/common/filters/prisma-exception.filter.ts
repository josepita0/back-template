import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ErrorCodes, type ErrorCode } from '../constants/error-codes.js';
import type { EnvelopeErrorBody } from './all-exceptions.filter.js';

/**
 * Mapping of canonical Prisma error codes (https://www.prisma.io/docs/orm/
 * reference/error-reference#error-codes) to the envelope error code +
 * HTTP status the template returns.
 *
 * Spec §7 — Prisma mapping:
 *   P2002 → 409 EMAIL_ALREADY_EXISTS
 *   P2025 → 404 NOT_FOUND
 *   P2003 → 400 VALIDATION_ERROR (foreign-key constraint failure)
 *   anything else → re-thrown, falls through to AllExceptionsFilter (500)
 */
interface PrismaErrorMapping {
  status: number;
  code: ErrorCode;
  message: string;
}

const PRISMA_ERROR_MAP: Record<string, PrismaErrorMapping> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    code: ErrorCodes.EMAIL_ALREADY_EXISTS,
    message: 'A record with the same unique value already exists',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    code: ErrorCodes.NOT_FOUND,
    message: 'Resource not found',
  },
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'Invalid reference: related record does not exist',
  },
};

/**
 * `PrismaExceptionFilter` — translates Prisma's `PrismaClientKnownRequestError`
 * into the canonical envelope BEFORE `AllExceptionsFilter` would otherwise
 * log it as a generic 500.
 *
 * Registered globally in `main.ts`. The order of filter registration matters:
 * NestJS invokes filters in REVERSE order of registration, so Prisma-specific
 * errors reach THIS filter first when it's registered LAST.
 *
 * Why a separate filter:
 *   - AllExceptionsFilter is generic — it has no Prisma knowledge.
 *   - P2002/P2025 are client errors (4xx), not server errors (5xx); they
 *     must NOT be logged at error level or counted as outages.
 *   - Future Prisma versions may add codes; the central map makes
 *     updating the template trivial.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const mapping = PRISMA_ERROR_MAP[exception.code];

    if (!mapping) {
      // Unknown Prisma code — let AllExceptionsFilter handle it (500).
      // Re-throw as an HttpException so the generic filter picks it up.
      throw new HttpException(
        { code: ErrorCodes.INTERNAL_ERROR, message: 'Database error' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Surface which field caused the unique violation when Prisma tells us.
    // P2002: `meta.target` is `string[]` of column names.
    const details =
      exception.code === 'P2002' && Array.isArray(exception.meta?.target)
        ? { fields: exception.meta?.target }
        : undefined;

    this.logger.warn(
      `${request.method} ${request.originalUrl ?? request.url} → ${mapping.status} ${mapping.code} (Prisma ${exception.code})`,
    );

    const envelope: EnvelopeErrorBody = {
      success: false,
      error: {
        code: mapping.code,
        message: mapping.message,
        ...(details !== undefined ? { details } : {}),
      },
      meta: {
        timestamp: new Date().toISOString(),
        path: request.originalUrl ?? request.url ?? '',
      },
    };

    response.status(mapping.status).json(envelope);
  }
}