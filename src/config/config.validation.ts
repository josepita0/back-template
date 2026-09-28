/**
 * Manual startup validation for required environment variables.
 *
 * Why manual (not class-validator on env)?
 * - No extra dependency for a tiny check.
 * - Clear, single-line error messages that name the missing variable.
 * - Runs once at boot inside ConfigModule.forRoot({ validate }) before any
 *   module is instantiated, so the app fails fast and predictably.
 *
 * Required (spec §5 + PR #1 scope):
 *   - DATABASE_URL
 *   - JWT_ACCESS_SECRET
 *   - JWT_REFRESH_SECRET
 *
 * Optional (with defaults applied in configuration.ts):
 *   - NODE_ENV          (default: 'development')
 *   - PORT              (default: 3000)
 *   - JWT_ACCESS_EXPIRES_IN  (default: 30m)
 *   - JWT_REFRESH_EXPIRES_IN (default: 30d)
 *   - JWT_REFRESH_ENABLED    (default: true)
 *   - AUTH_COOKIE_ENABLED    (default: false)
 *   - THROTTLE_TTL / THROTTLE_LIMIT (defaults: 60000 / 100)
 *   - LOG_LEVEL              (default: info)
 *   - CORS_ORIGINS           (default: http://localhost:3000)
 *   - SWAGGER_ENABLED        (default: false)
 */

export interface ConfigValidationError extends Error {
  missing: string[];
}

interface RawEnvRecord {
  DATABASE_URL?: string;
  JWT_ACCESS_SECRET?: string;
  JWT_REFRESH_SECRET?: string;
  [key: string]: string | undefined;
}

const REQUIRED_KEYS = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
] as const;

const NODE_ENV_VALUES = new Set(['development', 'production', 'test']);

/**
 * Validates the raw process.env object passed by ConfigModule.
 * Throws a single Error with the list of missing/invalid keys when invalid;
 * returns the validated, normalized env on success.
 */
export function validate(rawEnv: Record<string, unknown>): RawEnvRecord {
  const env = rawEnv as RawEnvRecord;

  const missing = REQUIRED_KEYS.filter((key) => {
    const value = env[key];
    return typeof value !== 'string' || value.trim() === '';
  });

  if (env.NODE_ENV !== undefined && !NODE_ENV_VALUES.has(env.NODE_ENV)) {
    throw new Error(
      `Invalid NODE_ENV: "${env.NODE_ENV}". Expected one of: ${Array.from(
        NODE_ENV_VALUES,
      ).join(', ')}.`,
    );
  }

  if (missing.length > 0) {
    const error = new Error(
      `Environment validation failed. Missing required variable(s): ${missing.join(', ')}. ` +
        `Set them in your .env file or environment before starting the server.`,
    ) as ConfigValidationError;
    error.missing = missing;
    throw error;
  }

  return env;
}