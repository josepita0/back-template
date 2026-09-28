import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService wraps the Prisma 7 client with the @prisma/adapter-pg
 * driver adapter. NestJS owns the lifecycle: connect on init, $disconnect
 * on destroy (which in turn disposes the adapter's pg.Pool).
 *
 * DEVIATION from design.md: Prisma 7 no longer lets the client manage its
 * own connection via DATABASE_URL; an adapter is mandatory at runtime.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Inject(ConfigService) configService: ConfigService) {
    const connectionString = configService.get<string>('database.url');
    if (!connectionString) {
      // ConfigModule validation already enforces DATABASE_URL; defensive guard
      // for the (test-only) case where validation is disabled.
      throw new Error('DATABASE_URL is required to construct PrismaService');
    }

    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    // Eagerly verify connectivity at boot — fail fast if DB is unreachable.
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    // $disconnect disposes the adapter's pg.Pool internally
    // (PrismaPg.disconnect → PrismaPgAdapter.dispose → pg.Pool.end).
    await this.$disconnect();
  }
}