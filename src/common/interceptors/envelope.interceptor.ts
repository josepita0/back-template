import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PaginatedResult } from '../pagination/paginated-result.js';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator.js';

/**
 * Envelope interceptor — wraps every successful response in the standard
 * `{ data, meta }` shape used across the API.
 *
 * Contract (spec §4):
 *
 * - Plain objects → `{ success: true, data, meta: { timestamp, path, ... } }`
 * - PaginatedResult → `{ success: true, data: items, meta: { timestamp, path,
 *   total, page, limit, totalPages, hasNextPage, hasPreviousPage } }`
 * - Buffers / Node `Readable` / `StreamableFile` / raw `Response` objects
 *   → pass through untouched (no envelope)
 * - Handlers marked with `@SkipEnvelope()` → pass through untouched
 *
 * Errors are NOT wrapped here; the global exception filter (PR #4) owns
 * the `{ success: false, error: { code, message }, meta }` shape.
 *
 * Wired per-controller in PR #3 (Users module). PR #4 may lift this to a
 * global interceptor in `main.ts` once the global filters are also wired.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<unknown>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const path = request?.originalUrl ?? request?.url ?? '';

    return next.handle().pipe(
      map((payload) => {
        if (skip) {
          return payload;
        }
        if (this.shouldBypass(payload)) {
          return payload;
        }

        const timestamp = new Date().toISOString();

        if (payload instanceof PaginatedResult) {
          return {
            success: true,
            data: payload.items,
            meta: {
              timestamp,
              path,
              total: payload.total,
              page: payload.page,
              limit: payload.limit,
              totalPages: payload.totalPages,
              hasNextPage: payload.hasNextPage,
              hasPreviousPage: payload.hasPreviousPage,
            },
          };
        }

        return {
          success: true,
          data: payload,
          meta: { timestamp, path },
        };
      }),
    );
  }

  /**
   * Decide whether a return value should pass through unwrapped.
   *
   * Detection is intentionally narrow:
   * - Buffer → raw bytes (file content)
   * - StreamableFile (NestJS streaming response) → raw stream
   * - Node `Readable` (including ReadableStream) → raw stream
   * - plain `Response` from `@Res()` without `passthrough` → caller owns it
   *
   * Plain objects, arrays, strings, numbers, booleans, and `null` all
   * get wrapped.
   */
  private shouldBypass(payload: unknown): boolean {
    if (payload == null) return false;
    if (Buffer.isBuffer(payload)) return true;
    if (payload instanceof StreamableFile) return true;

    // Node Readable streams expose a `pipe` method and are async-iterable.
    // Keep this check duck-typed so we don't pull in node:stream types here.
    if (
      typeof payload === 'object' &&
      typeof (payload as { pipe?: unknown }).pipe === 'function' &&
      typeof (payload as { on?: unknown }).on === 'function'
    ) {
      return true;
    }

    return false;
  }
}
