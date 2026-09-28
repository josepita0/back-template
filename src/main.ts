import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter.js';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor.js';
import { PinoLoggerService } from './common/logger/pino-logger.service.js';
import type { AppConfig } from './config/configuration.js';
import { AppModule } from './app.module.js';

/**
 * Bootstrap — wires cross-cutting middleware / pipes / guards / filters /
 * interceptors in the canonical order:
 *
 *   1. PinoLoggerService as the global logger (replaces default ConsoleLogger)
 *   2. pino-http middleware → per-request log line + X-Request-Id
 *   3. helmet → security headers (CSP, X-Frame-Options, etc.)
 *   4. app.enableCors() → origins from CORS_ORIGINS
 *   5. ThrottlerGuard as APP_GUARD → 100 req/min global default (configurable)
 *   6. ValidationPipe with whitelist + forbidNonWhitelisted + transform
 *   7. AllExceptionsFilter + PrismaExceptionFilter as global filters
 *   8. EnvelopeInterceptor as a global interceptor (lifted from per-controller)
 *
 * Filter registration order matters: NestJS invokes filters in REVERSE
 * registration order, so PrismaExceptionFilter must be registered LAST
 * so it sees the exception BEFORE AllExceptionsFilter would convert it
 * to a 500.
 */
async function bootstrap() {
  // NestFactory.create with `bufferLogs: true` queues Nest's own startup
  // messages until the logger is attached, so we don't lose the early logs.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const configService = app.get<ConfigService<AppConfig, true>>(ConfigService);

  // ---- Logger ---------------------------------------------------------------
  const pinoLogger = new PinoLoggerService(configService);
  app.useLogger(pinoLogger);

  // ---- Middleware ------------------------------------------------------------
  // pino-http MUST come before any other middleware so the requestId is
  // present on every downstream log line.
  app.use(pinoLogger.httpMiddleware());
  app.use(helmet());

  const corsOrigins = configService.get<string[]>('cors.origins', { infer: true });
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // ---- Guards ----------------------------------------------------------------
  // ThrottlerGuard as APP_GUARD applies to every route. Per-route overrides
  // (e.g. @Throttle({ default: { limit: 5, ttl: 60_000 } }) on POST /auth/login)
  // still work because NestJS consults metadata after the global guard runs.
  // ThrottlerModule is registered globally in AppModule (PR #4).
  app.useGlobalGuards(app.get(ThrottlerGuard));

  // ---- Pipes -----------------------------------------------------------------
  // Global ValidationPipe: class-validator decorators on DTOs are only
  // enforced when this pipe is registered. `whitelist:true` strips
  // unknown fields; `forbidNonWhitelisted:true` rejects unknown fields
  // outright. `transform:true` enables @Body() DTO instantiation.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ---- Filters ---------------------------------------------------------------
  // Order matters: NestJS calls filters in reverse registration order.
  // Register PrismaExceptionFilter LAST so it sees Prisma errors BEFORE
  // AllExceptionsFilter would convert them to a 500.
  app.useGlobalFilters(new AllExceptionsFilter(), new PrismaExceptionFilter());

  // ---- Interceptors ----------------------------------------------------------
  // Lifted from per-controller (UsersController in PR #3) to global. All
  // successful responses now go through the envelope; handlers can opt-out
  // with @SkipEnvelope() for raw streams/buffers.
  app.useGlobalInterceptors(new EnvelopeInterceptor(app.get(Reflector)));

  const port = configService.get<number>('port', { infer: true });
  await app.listen(port);
  pinoLogger.log(`bootstrap: listening on port ${port}`);
}
await bootstrap();