import { Global, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';

/**
 * CommonModule — provides shared cross-cutting infrastructure providers
 * that need to be globally available.
 *
 * PR #4 introduces this module so:
 *   1. `Reflector` is available everywhere (notably to APP_GUARD
 *      ThrottlerGuard which injects it).
 *   2. ThrottlerModule's providers (THROTTLER_OPTIONS, ThrottlerStorage)
 *      are accessible from this module's injector — by re-exporting
 *      ThrottlerModule inside a @Global() module, the throttler
 *      providers become visible to APP_GUARD below.
 *
 * @Global() so importing it once in AppModule.imports exposes Reflector
 * and the throttler providers to every other module without
 * re-importing.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    // Re-export ThrottlerModule from inside a @Global() module so its
    // providers are accessible to APP_GUARD. @nestjs/throttler v6 does
    // not expose `isGlobal: true` in the forRootAsync signature, so the
    // recommended workaround is the global-wrapper pattern.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => [
        {
          name: 'default',
          ttl: configService.get<number>('throttle.ttlMs', { infer: true }),
          limit: configService.get<number>('throttle.limit', { infer: true }),
        },
      ],
    }),
  ],
  providers: [Reflector],
  exports: [Reflector, ThrottlerModule],
})
export class CommonModule {}