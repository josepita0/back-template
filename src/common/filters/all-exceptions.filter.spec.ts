import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter, type EnvelopeErrorBody } from './all-exceptions.filter.js';
import { ErrorCodes } from '../constants/error-codes.js';

// ---- Harness -----------------------------------------------------------------

interface HarnessResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

const buildHarness = (): {
  host: ArgumentsHost;
  response: HarnessResponse;
  request: { method: string; url: string; originalUrl?: string };
} => {
  const request = { method: 'GET', url: '/api/test', originalUrl: '/api/test' };
  const status = vi.fn(() => response);
  const json = vi.fn(() => response);
  const response: HarnessResponse = { status, json };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => () => undefined,
    }),
  } as unknown as ArgumentsHost;

  return { host, response, request };
};

const parseEnvelope = (response: HarnessResponse): EnvelopeErrorBody =>
  response.json.mock.calls[0]?.[0] as EnvelopeErrorBody;

const buildFilter = () =>
  new AllExceptionsFilter();

// ---- Tests -------------------------------------------------------------------

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    filter = buildFilter();
    harness = buildHarness();
  });

  // ---------------------------------------------------------------------------
  // HttpException → canonical envelope
  // ---------------------------------------------------------------------------
  describe('GIVEN a NestJS HttpException with a structured { code, message } body', () => {
    it('THEN writes a canonical envelope at the exception status', () => {
      const exception = new HttpException(
        { code: ErrorCodes.NOT_FOUND, message: 'User missing' },
        HttpStatus.NOT_FOUND,
      );

      filter.catch(exception, harness.host);

      expect(harness.response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      const envelope = parseEnvelope(harness.response);
      expect(envelope.success).toBe(false);
      expect(envelope.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(envelope.error.message).toBe('User missing');
      expect(envelope.meta.path).toBe('/api/test');
      expect(envelope.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('GIVEN a NotFoundException thrown with a bare string', () => {
    it('THEN falls back to status-derived code NOT_FOUND', () => {
      const exception = new HttpException('plain message', HttpStatus.NOT_FOUND);

      filter.catch(exception, harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(envelope.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(harness.response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    });
  });

  describe('GIVEN a ForbiddenException (no structured body)', () => {
    it('THEN falls back to status-derived code FORBIDDEN', () => {
      const exception = new HttpException('nope', HttpStatus.FORBIDDEN);

      filter.catch(exception, harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(envelope.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(harness.response.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    });
  });

  describe('GIVEN a ValidationPipe-style HttpException with arrayed message', () => {
    it('THEN treats the message as Validation failed but keeps the structured code if present', () => {
      const exception = new HttpException(
        {
          code: ErrorCodes.VALIDATION_ERROR,
          message: ['email must be an email', 'password is too short'],
          details: [{ field: 'email' }, { field: 'password' }],
        },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(envelope.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(envelope.error.message).toBe('Validation failed');
      expect(envelope.error.details).toEqual([{ field: 'email' }, { field: 'password' }]);
      expect(harness.response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    });
  });

  // ---------------------------------------------------------------------------
  // generic Error → 500 INTERNAL_ERROR
  // ---------------------------------------------------------------------------
  describe('GIVEN a generic Error (not an HttpException)', () => {
    it('THEN writes 500 INTERNAL_ERROR with a generic message', () => {
      const exception = new Error('Database connection lost');

      filter.catch(exception, harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(envelope.success).toBe(false);
      expect(envelope.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(envelope.error.message).toBe('Internal server error');
      expect(harness.response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('GIVEN an unknown thrown value (not an Error)', () => {
    it('THEN still writes 500 INTERNAL_ERROR', () => {
      const exception = 'string thrown';

      filter.catch(exception, harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(envelope.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(harness.response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  // ---------------------------------------------------------------------------
  // Hide stack in production
  // ---------------------------------------------------------------------------
  describe('GIVEN NODE_ENV=production and a generic Error', () => {
    it('THEN the response body does NOT include a stack trace', () => {
      const snapshot = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const filterProd = buildFilter();
        const exception = new Error('boom');
        filterProd.catch(exception, harness.host);

        const envelope = parseEnvelope(harness.response);
        expect(envelope.error.details).toBeUndefined();
      } finally {
        process.env.NODE_ENV = snapshot;
      }
    });
  });

  describe('GIVEN NODE_ENV=development and a generic Error (500 INTERNAL_ERROR)', () => {
    it('THEN the response body includes a stack trace for debugging', () => {
      const snapshot = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'development';
        const filterDev = buildFilter();
        const exception = new Error('boom');
        filterDev.catch(exception, harness.host);

        const envelope = parseEnvelope(harness.response);
        expect(envelope.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
        expect(envelope.error.details).toBeDefined();
        expect((envelope.error.details as { stack?: unknown }).stack).toBeDefined();
      } finally {
        process.env.NODE_ENV = snapshot;
      }
    });
  });

  describe('GIVEN NODE_ENV=development and a 4xx HttpException with its own details', () => {
    it('THEN the existing details are preserved (no stack injected)', () => {
      const snapshot = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'development';
        const filterDev = buildFilter();
        const exception = new HttpException(
          { code: ErrorCodes.VALIDATION_ERROR, message: 'invalid', details: { field: 'email' } },
          HttpStatus.BAD_REQUEST,
        );
        filterDev.catch(exception, harness.host);

        const envelope = parseEnvelope(harness.response);
        expect(envelope.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(envelope.error.details).toEqual({ field: 'email' });
        // No stack injected for 4xx.
        expect((envelope.error.details as { stack?: unknown }).stack).toBeUndefined();
      } finally {
        process.env.NODE_ENV = snapshot;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // meta fields
  // ---------------------------------------------------------------------------
  describe('meta.timestamp + meta.path', () => {
    it('THEN meta.timestamp is ISO and meta.path comes from request.originalUrl', () => {
      const request = harness.request;
      request.method = 'POST';
      request.url = '/api/x';
      request.originalUrl = '/api/x?query=1';

      filter.catch(new HttpException('x', HttpStatus.BAD_REQUEST), harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(envelope.meta.path).toBe('/api/x?query=1');
      expect(new Date(envelope.meta.timestamp).toString()).not.toBe('Invalid Date');
    });

    it('THEN meta.path falls back to request.url when originalUrl is absent', () => {
      const request = harness.request;
      request.originalUrl = undefined;
      request.url = '/api/no-original';

      filter.catch(new HttpException('x', HttpStatus.BAD_REQUEST), harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(envelope.meta.path).toBe('/api/no-original');
    });
  });

  // ---------------------------------------------------------------------------
  // structured body details
  // ---------------------------------------------------------------------------
  describe('GIVEN an HttpException body with explicit details', () => {
    it('THEN forwards the details field into the envelope', () => {
      const exception = new HttpException(
        { code: ErrorCodes.VALIDATION_ERROR, message: 'invalid', details: { field: 'email' } },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(envelope.error.details).toEqual({ field: 'email' });
    });
  });

  // ---------------------------------------------------------------------------
  // unknown code falls back to INTERNAL_ERROR
  // ---------------------------------------------------------------------------
  describe('GIVEN an HttpException body with an unknown code string', () => {
    it('THEN falls back to status-derived code (NOT_FOUND for 404)', () => {
      const exception = new HttpException(
        { code: 'NOT_A_REAL_CODE', message: 'x' },
        HttpStatus.NOT_FOUND,
      );

      filter.catch(exception, harness.host);

      const envelope = parseEnvelope(harness.response);
      expect(envelope.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });
});