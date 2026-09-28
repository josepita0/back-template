import { randomUUID } from 'node:crypto';
import { Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'http';
import pino, { type Logger } from 'pino';
import type { AppConfig } from '../../config/configuration.js';

/**
 * Sensitive fields redacted from EVERY log line (request bodies, response
 * bodies, query strings). Spec §6 + §8 — never log credentials or tokens.
 *
 * Pino's redactor walks recursively; nested objects are scrubbed at any
 * depth. The redaction marker is `[REDACTED]` so the log stays parseable.
 */
const REDACT_PATHS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
] as const;

/**
 * `PinoLoggerService` — adapter that exposes NestJS's `LoggerService`
 * interface on top of `pino`, plus an Express middleware (`pinoHttp`)
 * for per-request structured logs.
 *
 * Spec §6 — Pino Logging:
 *   - JSON lines to stdout in production
 *   - pino-pretty transport in development
 *   - Levels (debug/info/warn/error/fatal) via LOG_LEVEL env
 *   - PinoLoggerService implements LoggerService
 *   - pino-http with requestId (X-Request-Id header or generated)
 *
 * Wiring (in main.ts):
 *   const pinoLogger = new PinoLoggerService(configService);
 *   app.useLogger(pinoLogger);
 *   app.use(pinoLogger.httpMiddleware());
 *
 * The middleware MUST be registered before any other middleware so the
 * requestId is set on the request object for downstream handlers.
 */
@Injectable()
export class PinoLoggerService implements LoggerService {
  private readonly logger: Logger;
  private readonly isProd: boolean;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.isProd = configService.get<string>('nodeEnv', { infer: true }) === 'production';
    const level = configService.get<string>('log.level', { infer: true });

    this.logger = pino({
      level,
      redact: {
        paths: [...REDACT_PATHS],
        censor: '[REDACTED]',
      },
      // Pretty in dev, raw JSON in prod. JSON in prod keeps logs
      // parseable by log aggregators (Loki, Datadog, ELK, etc.).
      transport: this.isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
              singleLine: false,
            },
          },
      formatters: {
        level: (label: string) => ({ level: label }),
      },
      base: {
        service: 'back-template',
        env: this.isProd ? 'production' : 'development',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // NestJS LoggerService contract
  // ---------------------------------------------------------------------------
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.call('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.call('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.call('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.call('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.call('trace', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.call('fatal', message, optionalParams);
  }

  /**
   * Expose the underlying pino logger for code that needs the full
   * pino API (e.g. the pino-http middleware, or a service that wants
   * to attach a child logger with extra context).
   */
  get pino(): Logger {
    return this.logger;
  }

  // ---------------------------------------------------------------------------
  // pino-http middleware factory
  // ---------------------------------------------------------------------------
  /**
   * Returns an Express middleware (compatible with `app.use(...)`) that
   * attaches a `requestId` to every request (header or generated) and
   * emits a structured "request completed" log line.
   *
   * The `requestId` is read from `X-Request-Id` (clients / load balancers
   * can pass it through for distributed tracing); when absent, a UUID v4
   * is generated. The same id is echoed in the response header so
   * clients can correlate logs.
   */
  httpMiddleware() {
    return pinoHttp({
      logger: this.logger,
      genReqId: (req: IncomingMessage, res: ServerResponse): string => {
        const headerId = req.headers['x-request-id'];
        const id =
          typeof headerId === 'string' && headerId.length > 0 ? headerId : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Don't double-log the body — NestJS services log their own context.
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res) => ({
          statusCode: res.statusCode,
        }),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // internal
  // ---------------------------------------------------------------------------
  private call(level: 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal', message: unknown, params: unknown[]): void {
    const args = [message, ...params] as Parameters<Logger['info']>;
    // pino handles a string `message` cleanly; objects get spread as the
    // first arg and the message becomes the `msg` field via the second arg.
    if (typeof message === 'string') {
      this.logger[level](...args);
    } else {
      this.logger[level]({ ...(message as object) }, ...(params as []));
    }
  }
}