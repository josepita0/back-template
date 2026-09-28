import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaDbIndicator } from './prisma-db.indicator.js';

/**
 * `HealthController` — exposes the two probe endpoints k8s / load balancers
 * expect:
 *
 *   - `GET /health/live`  → liveness  — always 200 if the Node process is up.
 *   - `GET /health/ready` → readiness — 200 if the DB responds; 503 otherwise.
 *
 * Both endpoints are public (no auth) so an orchestrator can hit them
 * without credentials. They live on a dedicated `/health/*` prefix so
 * throttling, auth, and envelope wrappers apply only to feature routes.
 *
 * Spec §9 — Health Endpoint.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaDbIndicator,
  ) {}

  /**
   * Liveness probe — the cheapest possible signal that the process is
   * alive. We deliberately do NOT touch the database here: k8s marks
   * the pod NotReady and stops routing traffic if liveness fails, and
   * a transient DB outage should not cause a pod restart loop.
   */
  @Get('live')
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Returns 200 when the Node process is alive. Does NOT check the database.',
  })
  @ApiResponse({
    status: 200,
    description: 'Process is alive.',
    schema: {
      example: {
        status: 'ok',
        info: {},
        error: {},
        details: {},
      },
    },
  })
  live(): HealthCheckResult {
    return {
      status: 'ok',
      info: {},
      error: {},
      details: {},
    } as HealthCheckResult;
  }

  /**
   * Readiness probe — pings the database. k8s uses this to gate traffic
   * until the DB is reachable, so a 503 here means "don't send me
   * requests yet" (NOT "kill me", which is what liveness failures do).
   */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Returns 200 when the database responds to SELECT 1. Returns 503 when the DB is unreachable.',
  })
  @ApiResponse({
    status: 200,
    description: 'Database is reachable.',
    schema: {
      example: {
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Database is unreachable.',
    schema: {
      example: {
        status: 'error',
        info: {},
        error: { database: { status: 'down', message: 'connection refused' } },
        details: { database: { status: 'down', message: 'connection refused' } },
      },
    },
  })
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([() => this.db.pingCheck('database')]);
  }
}