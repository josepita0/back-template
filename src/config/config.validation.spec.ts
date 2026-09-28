import { describe, expect, it } from 'vitest';
import { configuration } from './configuration.js';
import { validate, type ConfigValidationError } from './config.validation.js';

describe('config.validation', () => {
  const baseEnv = {
    DATABASE_URL: 'postgresql://localhost:5432/dev',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  };

  describe('GIVEN all required vars are present', () => {
    it('THEN validate() returns the env untouched', () => {
      const result = validate(baseEnv);
      expect(result.DATABASE_URL).toBe(baseEnv.DATABASE_URL);
      expect(result.JWT_ACCESS_SECRET).toBe(baseEnv.JWT_ACCESS_SECRET);
      expect(result.JWT_REFRESH_SECRET).toBe(baseEnv.JWT_REFRESH_SECRET);
    });
  });

  describe('GIVEN DATABASE_URL is missing', () => {
    it('THEN validate() throws listing DATABASE_URL in `missing`', () => {
      const { DATABASE_URL: _dropped, ...withoutDb } = baseEnv;
      let caught: ConfigValidationError | null = null;
      try {
        validate(withoutDb);
      } catch (err) {
        caught = err as ConfigValidationError;
      }
      expect(caught).not.toBeNull();
      expect(caught!.message).toMatch(/DATABASE_URL/);
      expect(caught!.missing).toEqual(['DATABASE_URL']);
    });

    it('THEN the error message lists every missing key when multiple are absent', () => {
      let caught: ConfigValidationError | null = null;
      try {
        validate({});
      } catch (err) {
        caught = err as ConfigValidationError;
      }
      expect(caught).not.toBeNull();
      expect(caught!.missing).toEqual([
        'DATABASE_URL',
        'JWT_ACCESS_SECRET',
        'JWT_REFRESH_SECRET',
      ]);
      expect(caught!.message).toContain('DATABASE_URL');
      expect(caught!.message).toContain('JWT_ACCESS_SECRET');
      expect(caught!.message).toContain('JWT_REFRESH_SECRET');
    });
  });

  describe('GIVEN DATABASE_URL is an empty string', () => {
    it('THEN validate() still throws (treats "" as missing)', () => {
      let caught: ConfigValidationError | null = null;
      try {
        validate({ ...baseEnv, DATABASE_URL: '   ' });
      } catch (err) {
        caught = err as ConfigValidationError;
      }
      expect(caught).not.toBeNull();
      expect(caught!.missing).toEqual(['DATABASE_URL']);
    });
  });

  describe('GIVEN JWT_ACCESS_SECRET is missing', () => {
    it('THEN validate() throws listing JWT_ACCESS_SECRET', () => {
      const { JWT_ACCESS_SECRET: _dropped, ...withoutAccess } = baseEnv;
      let caught: ConfigValidationError | null = null;
      try {
        validate(withoutAccess);
      } catch (err) {
        caught = err as ConfigValidationError;
      }
      expect(caught).not.toBeNull();
      expect(caught!.missing).toEqual(['JWT_ACCESS_SECRET']);
    });
  });

  describe('GIVEN an invalid NODE_ENV', () => {
    it('THEN validate() throws a clear NODE_ENV error', () => {
      expect(() => validate({ ...baseEnv, NODE_ENV: 'staging' })).toThrowError(
        /Invalid NODE_ENV/,
      );
    });
  });

  describe('GIVEN NODE_ENV is undefined', () => {
    it('THEN validate() accepts the env (defaults applied in configuration factory)', () => {
      expect(() => validate(baseEnv)).not.toThrow();
    });
  });
});

describe('configuration factory', () => {
  describe('GIVEN only required env vars are set', () => {
    it('THEN factory applies spec §5 defaults', () => {
      // The factory reads process.env at call time — snapshot & restore to avoid leaking state.
      const snapshot = { ...process.env };
      try {
        process.env = {
          ...process.env,
          DATABASE_URL: 'postgresql://localhost:5432/dev',
          JWT_ACCESS_SECRET: 'x',
          JWT_REFRESH_SECRET: 'y',
          // explicitly clear override targets
          PORT: undefined,
          NODE_ENV: undefined,
          JWT_ACCESS_EXPIRES_IN: undefined,
          JWT_REFRESH_EXPIRES_IN: undefined,
          JWT_REFRESH_ENABLED: undefined,
          AUTH_COOKIE_ENABLED: undefined,
          THROTTLE_TTL: undefined,
          THROTTLE_LIMIT: undefined,
          LOG_LEVEL: undefined,
          CORS_ORIGINS: undefined,
          SWAGGER_ENABLED: undefined,
        } as NodeJS.ProcessEnv;

        const cfg = configuration();

        expect(cfg.port).toBe(3000);
        expect(cfg.nodeEnv).toBe('development');
        expect(cfg.jwt.accessExpiresIn).toBe('30m');
        expect(cfg.jwt.refreshExpiresIn).toBe('30d');
        expect(cfg.jwt.refreshEnabled).toBe(true);
        expect(cfg.auth.cookieEnabled).toBe(false);
        expect(cfg.throttle.ttlMs).toBe(60000);
        expect(cfg.throttle.limit).toBe(100);
        expect(cfg.log.level).toBe('info');
        expect(cfg.cors.origins).toEqual(['http://localhost:3000']);
        expect(cfg.swagger.enabled).toBe(false);
      } finally {
        process.env = snapshot;
      }
    });
  });

  describe('GIVEN PORT=8080', () => {
    it('THEN factory returns config.port = 8080', () => {
      const snapshot = { ...process.env };
      try {
        process.env = { ...process.env, PORT: '8080' };
        const cfg = configuration();
        expect(cfg.port).toBe(8080);
      } finally {
        process.env = snapshot;
      }
    });
  });
});