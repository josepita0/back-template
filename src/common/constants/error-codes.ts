/**
 * Standard error codes returned in the envelope `error.code` field.
 *
 * Spec §7 — Error-Code Filters:
 *   "Template defines zero custom exception classes" — codes are constants
 *   thrown from HttpException (or wrapped by PrismaExceptionFilter). Every
 *   code below is paired with the HTTP status it should surface as.
 *
 * Adding a new code:
 *   1. Add the literal here.
 *   2. Update `HttpStatusByCode` if it maps to a non-default status.
 *   3. Update the spec / design to document the new case.
 *
 * Removing a code: treat as breaking — clients may branch on the string.
 */
export const ErrorCodes = {
  // Auth (401 / 403)
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',

  // Resource (404)
  NOT_FOUND: 'NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',

  // Validation / input (400)
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // Conflict (409)
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',

  // Generic (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/**
 * Union of every valid error code. Use as the type for `error.code` in
 * envelope shapes, filter response objects, etc.
 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Default HTTP status for each error code. Filters use this as the
 * fallback when an HttpException doesn't carry an explicit status — most
 * do (NotFoundException → 404, etc.), so the table is consulted only
 * for raw Error instances mapped by code.
 *
 * Numbers match the NestJS HttpStatus enum values:
 *   400 BAD_REQUEST
 *   401 UNAUTHORIZED
 *   403 FORBIDDEN
 *   404 NOT_FOUND
 *   409 CONFLICT
 *   500 INTERNAL_SERVER_ERROR
 */
export const HttpStatusByCode: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_TOKEN: 401,
  TOKEN_EXPIRED: 400,
  FORBIDDEN: 403,
  ACCOUNT_SUSPENDED: 403,
  NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  EMAIL_ALREADY_EXISTS: 409,
  INTERNAL_ERROR: 500,
};