import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { configuration } from './config/configuration.js';
import { validate } from './config/config.validation.js';
import type { AppConfig } from './config/configuration.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    // ConfigModule must come first so any module below can inject ConfigService.
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
      envFilePath: ['.env.local', `.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
      cache: true,
    }),
    // ThrottlerModule is registered GLOBALLY here in PR #4 (was local in
    // AuthModule in PR #2). Spec §8 — 100 req/min default per IP; the
    // stricter 5 req/min on POST /auth/login is enforced via @Throttle()
    // metadata on the controller method.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => [
        {
          name: 'default',
          ttl: configService.get<number>('throttle.ttlMs', { infer: true }),
          limit: configService.get<number>('throttle.limit', { infer: true }),
        },
      ],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // ThrottlerGuard as APP_GUARD applies to every route. Per-route
    // overrides (e.g. @Throttle({ default: { limit: 5, ttl: 60_000 } })
    // on POST /auth/login) still work because NestJS consults metadata
    // after the global guard runs. ThrottlerModule is registered above
    // (forRootAsync); ThrottlerStorage is provided by that module.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}