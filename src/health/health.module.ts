import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { PrismaDbIndicator } from './prisma-db.indicator.js';

/**
 * `HealthModule` — wires the Terminus probe service with our custom
 * Prisma indicator. Both endpoints (`/health/live`, `/health/ready`)
 * are public and live on a dedicated `/health` prefix.
 *
 * Spec §9 — Health Endpoint.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaDbIndicator],
})
export class HealthModule {}