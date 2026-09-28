import { CallHandler, ExecutionContext, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { firstValueFrom, of } from 'rxjs';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvelopeInterceptor } from './envelope.interceptor.js';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator.js';
import { PaginatedResult } from '../pagination/paginated-result.js';

// ---- Test harness -----------------------------------------------------------

const buildContext = (path = '/api/test', originalUrl = path): ExecutionContext => {
  const request = { url: path, originalUrl };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
    getHandler: () => () => undefined,
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
};

const buildInterceptor = async (): Promise<{
  interceptor: EnvelopeInterceptor;
  reflector: Reflector;
}> => {
  const module = await Test.createTestingModule({
    providers: [EnvelopeInterceptor, Reflector],
  }).compile();
  return {
    interceptor: module.get(EnvelopeInterceptor),
    reflector: module.get(Reflector),
  };
};

const runInterceptor = async (
  interceptor: EnvelopeInterceptor,
  payload: unknown,
  context: ExecutionContext = buildContext(),
): Promise<unknown> => {
  const handler: CallHandler = { handle: () => of(payload) };
  const result = interceptor.intercept(context, handler);
  return firstValueFrom(result);
};

// ---- Tests ------------------------------------------------------------------

describe('EnvelopeInterceptor', () => {
  let interceptor: EnvelopeInterceptor;
  let reflector: Reflector;

  beforeEach(async () => {
    ({ interceptor, reflector } = await buildInterceptor());
  });

  // ---------------------------------------------------------------------------
  // plain object → wrap
  // ---------------------------------------------------------------------------
  describe('GIVEN a handler returning a plain object', () => {
    it('THEN wraps the payload in { success:true, data, meta:{ timestamp, path } }', async () => {
      const payload = { id: 'u1', email: 'a@b.c' };
      const wrapped = (await runInterceptor(interceptor, payload, buildContext('/api/users/u1'))) as {
        success: boolean;
        data: unknown;
        meta: { timestamp: string; path: string };
      };

      expect(wrapped.success).toBe(true);
      expect(wrapped.data).toEqual(payload);
      expect(wrapped.meta.path).toBe('/api/users/u1');
      // timestamp must be a parseable ISO date
      expect(new Date(wrapped.meta.timestamp).toString()).not.toBe('Invalid Date');
    });
  });

  // ---------------------------------------------------------------------------
  // array → wrap
  // ---------------------------------------------------------------------------
  describe('GIVEN a handler returning an array', () => {
    it('THEN wraps the array in data and exposes the same array reference', async () => {
      const payload = [{ id: 'a' }, { id: 'b' }];
      const wrapped = (await runInterceptor(interceptor, payload)) as {
        success: boolean;
        data: unknown[];
        meta: { timestamp: string; path: string };
      };

      expect(wrapped.success).toBe(true);
      expect(Array.isArray(wrapped.data)).toBe(true);
      expect(wrapped.data).toEqual(payload);
      expect(wrapped.data).toHaveLength(2);
      expect(wrapped.meta.path).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // PaginatedResult → wrap with pagination meta
  // ---------------------------------------------------------------------------
  describe('GIVEN a handler returning a PaginatedResult', () => {
    it('THEN extracts items into data and pagination fields into meta', async () => {
      const payload = PaginatedResult.create(
        [{ id: 'u1' }, { id: 'u2' }],
        7,
        2,
        3,
      );

      const wrapped = (await runInterceptor(interceptor, payload, buildContext('/api/users'))) as {
        success: boolean;
        data: unknown[];
        meta: {
          timestamp: string;
          path: string;
          total: number;
          page: number;
          limit: number;
          totalPages: number;
          hasNextPage: boolean;
          hasPreviousPage: boolean;
        };
      };

      expect(wrapped.success).toBe(true);
      expect(wrapped.data).toEqual([{ id: 'u1' }, { id: 'u2' }]);
      expect(wrapped.meta.total).toBe(7);
      expect(wrapped.meta.page).toBe(2);
      expect(wrapped.meta.limit).toBe(3);
      // 7 items / 3 per page → totalPages=3; page=2 → hasNextPage=true, hasPreviousPage=true
      expect(wrapped.meta.totalPages).toBe(3);
      expect(wrapped.meta.hasNextPage).toBe(true);
      expect(wrapped.meta.hasPreviousPage).toBe(true);
      expect(wrapped.meta.path).toBe('/api/users');
    });
  });

  // ---------------------------------------------------------------------------
  // stream → bypass
  // ---------------------------------------------------------------------------
  describe('GIVEN a handler returning a Node Readable stream', () => {
    it('THEN returns the stream untouched (no envelope)', async () => {
      const stream = new Readable({ read() {} });
      const result = await runInterceptor(interceptor, stream);

      expect(result).toBe(stream);
    });
  });

  // ---------------------------------------------------------------------------
  // Buffer → bypass
  // ---------------------------------------------------------------------------
  describe('GIVEN a handler returning a Buffer', () => {
    it('THEN returns the Buffer untouched (no envelope)', async () => {
      const buffer = Buffer.from('hello world');
      const result = await runInterceptor(interceptor, buffer);

      expect(result).toBe(buffer);
      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // StreamableFile → bypass
  // ---------------------------------------------------------------------------
  describe('GIVEN a handler returning a NestJS StreamableFile', () => {
    it('THEN returns the StreamableFile untouched (no envelope)', async () => {
      const file = new StreamableFile(Buffer.from('x'));
      const result = await runInterceptor(interceptor, file);

      expect(result).toBe(file);
    });
  });

  // ---------------------------------------------------------------------------
  // @SkipEnvelope() → bypass
  // ---------------------------------------------------------------------------
  describe('GIVEN a handler decorated with @SkipEnvelope()', () => {
    it('THEN returns the payload untouched (no envelope)', async () => {
      const payload = { raw: true };
      vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
        if (key === SKIP_ENVELOPE_KEY) return true;
        return undefined;
      });

      const result = await runInterceptor(interceptor, payload);

      expect(result).toBe(payload);
    });
  });

  // ---------------------------------------------------------------------------
  // timestamp + path meta
  // ---------------------------------------------------------------------------
  describe('meta.timestamp + meta.path', () => {
    it('THEN timestamp is an ISO string and path matches request.originalUrl', async () => {
      const ctx = buildContext('/api/users', '/api/users?page=2&limit=5');
      const wrapped = (await runInterceptor(interceptor, { ok: true }, ctx)) as {
        meta: { timestamp: string; path: string };
      };

      // path comes from request.originalUrl when available, query string included
      expect(wrapped.meta.path).toBe('/api/users?page=2&limit=5');
      // ISO 8601 — e.g. 2026-09-28T18:21:15.123Z
      expect(wrapped.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
