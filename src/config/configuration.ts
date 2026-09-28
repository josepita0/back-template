import type { ConfigService } from '@nestjs/config';

/**
 * Typed shape returned by the configuration factory.
 * Feature modules read these via `configService.get<keyof AppConfig>('…')`.
 */
export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  database: {
    url: string;
  };
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
    refreshEnabled: boolean;
  };
  auth: {
    cookieEnabled: boolean;
  };
  throttle: {
    ttlMs: number;
    limit: number;
  };
  log: {
    level: string;
  };
  cors: {
    origins: string[];
  };
  swagger: {
    enabled: boolean;
  };
}

/**
 * Configuration factory for `ConfigModule.forRoot({ load: [configuration] })`.
 * Returns the typed AppConfig object — env vars are read defensively here so
 * the validator can describe missing/required keys in one place.
 */
export const configuration = (): AppConfig => {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];

  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    nodeEnv,
    database: {
      url: process.env.DATABASE_URL ?? '',
    },
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '30m',
      refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
      refreshEnabled: (process.env.JWT_REFRESH_ENABLED ?? 'true') === 'true',
    },
    auth: {
      cookieEnabled: (process.env.AUTH_COOKIE_ENABLED ?? 'false') === 'true',
    },
    throttle: {
      ttlMs: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
      limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
    },
    log: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
    cors: {
      origins: corsOrigins,
    },
    swagger: {
      enabled: (process.env.SWAGGER_ENABLED ?? 'false') === 'true',
    },
  };
};

/**
 * Helper type for modules that inject ConfigService.
 * Re-exported here so consumers can do `configService: ConfigService<AppConfig, true>`.
 */
export type AppConfigService = ConfigService<AppConfig, true>;