import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  THROTTLER_OPTIONS,
} from '@nestjs/throttler/dist/throttler.constants.js';
import {
  ThrottlerStorage,
} from '@nestjs/throttler/dist/throttler-storage.interface.js';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { configuration } from './config/configuration.js';
import { validate } from './config/config.validation.js';
import { HealthModule } from './health/health.module.js';
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
    // CommonModule is @Global() — exports ThrottlerModule's providers
    // (THROTTLER_OPTIONS, ThrottlerStorage) so the APP_GUARD factory below
    // can inject them.
    CommonModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // ThrottlerGuard as APP_GUARD via useFactory (instead of useClass).
    // useFactory lets us explicitly inject THROTTLER_OPTIONS, ThrottlerStorage,
    // and Reflector — required because @nestjs/throttler v6's ThrottlerGuard
    // constructor doesn't have a no-arg form, and APP_GUARD's useClass path
    // doesn't auto-wire Reflector.
    {
      provide: APP_GUARD,
      inject: [THROTTLER_OPTIONS, ThrottlerStorage, 'Reflector'],
      useFactory: (
        options: unknown,
        storage: unknown,
        reflector: import('@nestjs/core').Reflector,
      ) =>
        new ThrottlerGuard(
          options as never,
          storage as never,
          reflector,
        ),
    },
  ],
})
export class AppModule {}