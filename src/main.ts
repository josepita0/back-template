import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
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
 *   5. ValidationPipe with whitelist + forbidNonWhitelisted + transform
 *   6. AllExceptionsFilter + PrismaExceptionFilter as global filters
 *   7. EnvelopeInterceptor as a global interceptor (lifted from per-controller)
 *   8. Swagger UI at /api/docs when SWAGGER_ENABLED=true
 *      (also on in NODE_ENV=development by default)
 *
 * ThrottlerGuard is wired as APP_GUARD in AppModule (PR #4); its
 * Reflector dep comes from CommonModule (global). Per-route @Throttle()
 * overrides still work because NestJS consults metadata after the guard.
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
  // cookie-parser populates `request.cookies` so AuthController.refresh()
  // can read the refresh token from the `rt` cookie when AUTH_COOKIE_ENABLED
  // is on. Must come before any controller that calls request.cookies.
  app.use(cookieParser());

  const corsOrigins = configService.get<string[]>('cors.origins', { infer: true });
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

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
  // with @SkipEnvelope() for raw streams/buffers. Reflector comes from
  // CommonModule (global) so we can fetch it here.
  app.useGlobalInterceptors(new EnvelopeInterceptor(app.get(Reflector)));

  // ---- Swagger ---------------------------------------------------------------
  // Spec §10 — Swagger setup:
  //   - /api/docs serves Swagger UI
  //   - addBearerAuth() for protected endpoints
  //   - Disabled in production unless SWAGGER_ENABLED=true
  //
  // Resolution order:
  //   1. NODE_ENV=development → always on (dev convenience)
  //   2. SWAGGER_ENABLED=true → on
  //   3. NODE_ENV=production AND SWAGGER_ENABLED≠true → off (404)
  //
  // We use `swagger-ui-express` because the project runs on Express
  // (`@nestjs/platform-express`). Fastify users would swap in
  // `@fastify/static` here.
  const nodeEnv = configService.get<string>('nodeEnv', { infer: true });
  const swaggerEnabled =
    nodeEnv !== 'production' ||
    configService.get<boolean>('swagger.enabled', { infer: true });

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Back-Template API')
      .setDescription(
        'Production-ready NestJS backend template. Auth, Users CRUD, Health probes, structured envelope.',
      )
      .setVersion('0.0.1')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Paste the accessToken returned by POST /auth/login as `Bearer <token>`.',
          name: 'Authorization',
          in: 'header',
        },
        'access-token',
      )
      .addTag('auth', 'Login, refresh, password reset (admin-driven)')
      .addTag('users', 'User CRUD (ADMIN-only)')
      .addTag('health', 'Liveness + readiness probes')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = configService.get<number>('port', { infer: true });
  await app.listen(port);
  pinoLogger.log(
    `bootstrap: listening on port ${port} (swagger=${swaggerEnabled ? 'on' : 'off'})`,
  );
}
await bootstrap();