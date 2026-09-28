import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  THROTTLER_OPTIONS,
} from '@nestjs/throttler/dist/throttler.constants.js';
import {
  ThrottlerStorage,
} from '@nestjs/throttler/dist/throttler-storage.interface.js';
import request from 'supertest';
import type { App } from 'supertest/types.js';

/**
 * Integration test for the global throttler.
 *
 * Spec §8 — Security:
 *   - GIVEN 101st request within 1 min from same IP → THEN 429
 *   - GIVEN 6th login attempt within 1 min → THEN 429
 *
 * The login route has `@Throttle({ default: { limit: 5, ttl: 60_000 } })`
 * (AuthController). With 5 allowed per minute, the 6th request returns 429.
 *
 * Gated on DATABASE_URL because the bootstrap wires PrismaModule which
 * would fail to connect without one. Locally you can set up Postgres or
 * skip this suite.
 *
 * AppModule is imported DYNAMICALLY (inside the test) so the env validator
 * doesn't fire when DATABASE_URL is unset and the suite is skipped.
 *
 * This test does NOT need a real user — the throttler counts ALL requests
 * to the route regardless of authentication status, so we send the same
 * (invalid) login payload 6 times and verify the 6th is throttled.
 */
describe.skipIf(!process.env.DATABASE_URL)('Throttler (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    // Dynamic import keeps the env validator from firing in skipped runs.
    const { AppModule } = await import('../src/app.module.js');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts wires the global ValidationPipe + ThrottlerGuard; mirror
    // them here so the test exercises the same middleware stack.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    const throttlerOptions = app.get<unknown>(THROTTLER_OPTIONS);
    const throttlerStorage = app.get<unknown>(ThrottlerStorage);
    const reflector = app.get(Reflector);
    app.useGlobalGuards(
      new ThrottlerGuard(
        throttlerOptions as never,
        throttlerStorage as never,
        reflector,
      ),
    );
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('THEN the 6th POST /auth/login within 60s returns HTTP 429', async () => {
    // POST /auth/login has @Throttle({ default: { limit: 5, ttl: 60_000 } }).
    // We send 5 requests that pass through the throttler and reach the
    // controller. The controller may return 401 (no such user), 400
    // (validation), or 500 (DB unreachable) — all of which still
    // increment the throttler counter, because the throttler runs
    // BEFORE the controller. The 6th attempt must be blocked at the
    // throttler and return 429 regardless of what the controller would
    // have done.
    const payload = {
      email: 'throttle-test@example.com',
      password: 'some-password',
    };

    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send(payload);
      // None of the first 5 should be throttled. The controller may
      // respond with 400/401/500 — any of those is acceptable for this
      // test, because what matters is that the throttle counter ticked.
      expect(res.status).not.toBe(429);
    }

    // 6th attempt → throttler returns 429 before the controller runs.
    const blocked = await request(app.getHttpServer())
      .post('/auth/login')
      .send(payload);

    expect(blocked.status).toBe(429);
  });
});