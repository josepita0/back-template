import { Injectable } from '@nestjs/common';
import {
  HealthCheckAttempt,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Custom Prisma health indicator — pings the database with a cheap
 * `SELECT 1` query and reports UP/DOWN.
 *
 * Built on Terminus v12's `HealthIndicatorService` builder pattern:
 *
 *   healthIndicatorService.check(key).attempt(async () => {
 *     await this.prisma.$queryRawUnsafe('SELECT 1');
 *   });
 *
 * The `.attempt(fn)` returns a `HealthCheckAttempt` that the
 * `HealthCheckService.check([...])` array accepts; if the function
 * throws, the indicator is marked DOWN and the overall probe returns
 * 503.
 *
 * Why not `TerminusModule`'s built-in `PrismaHealthIndicator`?
 * The built-in indicator calls `$runCommandRaw` (Mongo-style) or
 * `$queryRawUnsafe` (SQL). Both work with our Prisma 7 client, but
 * going through a hand-written indicator lets us inject
 * `PrismaService` directly (the DI token) without aliasing the
 * client and keeps the dependency surface tiny.
 *
 * Spec §9 — Health Endpoint:
 *   - GET /health/ready → 200 if DB connected; 503 if not.
 *   - GIVEN DB connected → returns { database: { status: "up" } }
 *   - GIVEN DB unreachable → returns 503 { database: { status: "down" } }
 */
@Injectable()
export class PrismaDbIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Probe the database with a `SELECT 1` query. The returned object is
   * a `HealthCheckAttempt` builder that `HealthCheckService.check()`
   * can await; success → `{ database: { status: "up" } }`, failure →
   * `{ database: { status: "down", message } }` and the controller's
   * HTTP response becomes 503.
   */
  pingCheck(key = 'database'): HealthCheckAttempt {
    return this.healthIndicatorService
      .check(key)
      .attempt(async () => {
        // Prisma 7 still exposes $queryRawUnsafe on the generated client
        // — the @prisma/adapter-pg driver forwards to pg underneath.
        await this.prisma.$queryRawUnsafe('SELECT 1');
      });
  }
}