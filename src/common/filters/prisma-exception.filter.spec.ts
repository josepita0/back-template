import { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaExceptionFilter } from './prisma-exception.filter.js';
import { ErrorCodes } from '../constants/error-codes.js';
import type { EnvelopeErrorBody } from './all-exceptions.filter.js';

// ---- Harness -----------------------------------------------------------------

interface HarnessResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

const buildHarness = (): {
  host: ArgumentsHost;
  response: HarnessResponse;
} => {
  const status = vi.fn(() => response);
  const json = vi.fn(() => response);
  const response: HarnessResponse = { status, json };

  const request = { method: 'POST', url: '/api/x', originalUrl: '/api/x' };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => () => undefined,
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
};

const parseEnvelope = (response: HarnessResponse): EnvelopeErrorBody =>
  response.json.mock.calls[0]?.[0] as EnvelopeErrorBody;

const buildPrismaError = (code: string, meta?: Record<string, unknown>): unknown =>
  new Prisma.PrismaClientKnownRequestError(`Prisma ${code}`, {
    code,
    clientVersion: '7.10.0',
    meta: meta ?? {},
  });

// ---- Tests -------------------------------------------------------------------

describe('PrismaExceptionFilter', () => {
  let filter: PrismaExceptionFilter;
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    filter = new PrismaExceptionFilter();
    harness = buildHarness();
  });

  // ---------------------------------------------------------------------------
  // P2002 → 409 EMAIL_ALREADY_EXISTS
  // ---------------------------------------------------------------------------
  describe('GIVEN a Prisma P2002 (unique constraint)', () => {
    it('THEN writes 409 EMAIL_ALREADY_EXISTS with the failing fields in details', () => {
      const err = buildPrismaError('P2002', { target: ['email'] }) as Prisma.PrismaClientKnownRequestError;

      filter.catch(err, harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(harness.response.status).toHaveBeenCalledWith(409);
      expect(envelope.success).toBe(false);
      expect(envelope.error.code).toBe(ErrorCodes.EMAIL_ALREADY_EXISTS);
      expect(envelope.error.details).toEqual({ fields: ['email'] });
      expect(envelope.meta.path).toBe('/api/x');
      expect(envelope.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('THEN works with multi-field unique targets (e.g. composite key)', () => {
      const err = buildPrismaError('P2002', { target: ['userId', 'token'] }) as Prisma.PrismaClientKnownRequestError;

      filter.catch(err, harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(envelope.error.details).toEqual({ fields: ['userId', 'token'] });
    });
  });

  // ---------------------------------------------------------------------------
  // P2025 → 404 NOT_FOUND
  // ---------------------------------------------------------------------------
  describe('GIVEN a Prisma P2025 (record not found)', () => {
    it('THEN writes 404 NOT_FOUND', () => {
      const err = buildPrismaError('P2025') as Prisma.PrismaClientKnownRequestError;

      filter.catch(err, harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(harness.response.status).toHaveBeenCalledWith(404);
      expect(envelope.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(envelope.error.message).toBe('Resource not found');
    });
  });

  // ---------------------------------------------------------------------------
  // P2003 → 400 VALIDATION_ERROR
  // ---------------------------------------------------------------------------
  describe('GIVEN a Prisma P2003 (foreign-key constraint)', () => {
    it('THEN writes 400 VALIDATION_ERROR', () => {
      const err = buildPrismaError('P2003', { field_name: 'userId' }) as Prisma.PrismaClientKnownRequestError;

      filter.catch(err, harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(harness.response.status).toHaveBeenCalledWith(400);
      expect(envelope.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(envelope.error.message).toMatch(/related record/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Unknown Prisma code → re-throw (falls through to AllExceptionsFilter)
  // ---------------------------------------------------------------------------
  describe('GIVEN an unknown Prisma code', () => {
    it('THEN re-throws as HttpException so AllExceptionsFilter can 500 it', () => {
      const err = buildPrismaError('P9999') as Prisma.PrismaClientKnownRequestError;

      // The filter throws internally; verify it does so (no response written).
      expect(() => filter.catch(err, harness.host)).toThrow();
      expect(harness.response.json).not.toHaveBeenCalled();
      expect(harness.response.status).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // meta path resolution
  // ---------------------------------------------------------------------------
  describe('meta.path resolution', () => {
    it('THEN prefers request.originalUrl when available (query string included)', () => {
      const status = vi.fn(() => response);
      const json = vi.fn(() => response);
      const response: HarnessResponse = { status, json };
      const request = { method: 'POST', url: '/api/x', originalUrl: '/api/x?page=1' };
      const host = {
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => response,
          getNext: () => () => undefined,
        }),
      } as unknown as ArgumentsHost;

      const err = buildPrismaError('P2025') as Prisma.PrismaClientKnownRequestError;
      filter.catch(err, host);

      const envelope = parseEnvelope(response);
      expect(envelope.meta.path).toBe('/api/x?page=1');
    });
  });
});