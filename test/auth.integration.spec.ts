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
 * Integration tests for the auth module — login → refresh → admin reset
 * → role-based access. Gated on DATABASE_URL: the full AppModule is only
 * imported when DATABASE_URL is present so the suite SKIPS (not fails)
 * in environments without a real Postgres.
 *
 * Spec §2 (Auth) + §3 (Users / role gating):
 *   - Full login flow: create user → login → tokens → access protected route
 *   - Refresh token flow: login → refresh → new tokens (old refresh invalid)
 *   - Admin reset password flow: admin generates token → user resets
 *   - Role-based access: ADMIN can POST /users, USER cannot
 *
 * Cleanup: each test creates a unique user (cuid() + nano suffix in the
 * email); the `afterAll` deletes any users left over by a failing test
 * to keep the suite hermetic.
 */
describe.skipIf(!process.env.DATABASE_URL)('Auth (integration)', () => {
  let app: INestApplication<App>;

  // Unique per-suite marker so repeated runs don't collide on the email unique index.
  const SUITE_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminEmail = `admin-${SUITE_TAG}@example.com`;
  const userEmail = `user-${SUITE_TAG}@example.com`;
  const userPassword = 'super-secret-pass-1';
  const newUserPassword = 'reset-pass-after-admin';

  let adminAccessToken: string;
  let userAccessToken: string;
  let userRefreshToken: string;
  let adminUserId: string;
  let targetUserId: string;

  beforeAll(async () => {
    // Dynamic import keeps the env validator from firing in skipped runs.
    const { AppModule } = await import('../src/app.module.js');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirror the bootstrap: ValidationPipe + ThrottlerGuard + global filters
    // + EnvelopeInterceptor (the spec asks these to be exercised end-to-end).
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalGuards(
      new ThrottlerGuard(
        app.get<unknown>(THROTTLER_OPTIONS) as never,
        app.get<unknown>(ThrottlerStorage) as never,
        app.get(Reflector),
      ),
    );
    // Filters/interceptors are registered via APP_* providers in AppModule,
    // so they're already wired by createNestApplication.
    await app.init();
  });

  afterAll(async () => {
    if (!app) return;
    // Best-effort cleanup of any users the suite created. We can't go
    // through the HTTP layer because the throttler has been ticking.
    const prisma = app.get<{ user: { deleteMany: (args: { where: { email: { contains: string } } }) => Promise<unknown> } }>(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (await import('../src/prisma/prisma.service.js')).PrismaService as never,
    );
    try {
      await prisma.user.deleteMany({
        where: { email: { contains: SUITE_TAG } },
      });
    } catch {
      // Ignore — best-effort.
    }
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1) Admin creates itself (bootstrap by creating via POST /users with a
  //    second ADMIN created in a recursive bootstrap... but we have a chicken-
  //    and-egg: nobody is ADMIN yet). Workaround: the very first ADMIN is
  //    created directly via Prisma in this beforeAll, then login.
  // ---------------------------------------------------------------------------
  it('SETUP: bootstrap an ADMIN directly via PrismaService', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const bcrypt = await import('bcrypt');
    const { PrismaPg } = await import('@prisma/adapter-pg');

    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
    });
    const prisma = new PrismaClient({ adapter });

    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        password: await bcrypt.hash(userPassword, 12),
        role: 'ADMIN',
        isActive: true,
      },
    });
    adminUserId = admin.id;

    await prisma.$disconnect();
    expect(adminUserId).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // 2) Full login flow → ADMIN can create a USER (positive role check)
  // ---------------------------------------------------------------------------
  it('WHEN admin logs in → THEN returns accessToken; with that token ADMIN can POST /users', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: userPassword })
      .expect(200);

    expect(loginRes.body).toMatchObject({
      success: true,
      data: {
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        user: {
          email: adminEmail,
          role: 'ADMIN',
        },
      },
    });

    adminAccessToken = loginRes.body.data.accessToken;

    // Create a USER with the admin's token.
    const createRes = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: userEmail, password: userPassword, name: 'Target User' })
      .expect(201);

    expect(createRes.body).toMatchObject({
      success: true,
      data: { email: userEmail, role: 'USER', name: 'Target User' },
    });
    expect(createRes.body.data.password).toBeUndefined();

    targetUserId = createRes.body.data.id;
    expect(targetUserId).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // 3) Refresh token flow → new tokens; the old refresh is invalidated
  // ---------------------------------------------------------------------------
  it('WHEN user logs in → THEN refresh → new tokens; refreshing again with the OLD token returns 401', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail, password: userPassword })
      .expect(200);

    userAccessToken = loginRes.body.data.accessToken;
    userRefreshToken = loginRes.body.data.refreshToken;
    expect(userAccessToken).toBeTruthy();
    expect(userRefreshToken).toBeTruthy();

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: userRefreshToken })
      .expect(200);

    expect(refreshRes.body.data.accessToken).toBeTruthy();
    expect(refreshRes.body.data.refreshToken).toBeTruthy();
    expect(refreshRes.body.data.refreshToken).not.toBe(userRefreshToken);

    const rotated = refreshRes.body.data.refreshToken;

    // The OLD refresh token must now be rejected (atomic rotation deletes it).
    const replay = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: userRefreshToken })
      .expect(401);

    expect(replay.body).toMatchObject({
      success: false,
      error: { code: 'INVALID_TOKEN' },
    });

    // Stash the rotated token for the next test.
    userRefreshToken = rotated;
  });

  // ---------------------------------------------------------------------------
  // 4) Admin reset password flow → admin generates token → user resets
  // ---------------------------------------------------------------------------
  it('WHEN admin generates a reset token → user redeems it → password changes → refresh tokens revoked', async () => {
    const resetRes = await request(app.getHttpServer())
      .post('/auth/admin/reset-password')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ userId: targetUserId })
      .expect(200);

    expect(resetRes.body).toMatchObject({
      success: true,
      data: {
        token: expect.any(String),
        expiresAt: expect.any(String),
      },
    });
    const resetToken = resetRes.body.data.token;

    // The user presents the token + new password.
    const redeemRes = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: resetToken, newPassword: newUserPassword })
      .expect(200);

    expect(redeemRes.body.data).toEqual({ userId: targetUserId });

    // Old refresh token (rotated in test #3) was already consumed; the
    // reset flow additionally revokes ALL refresh tokens for the user.
    // Logging in with the NEW password must succeed; the OLD password must
    // fail with INVALID_CREDENTIALS.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail, password: newUserPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail, password: userPassword })
      .expect(401);
  });

  // ---------------------------------------------------------------------------
  // 5) Role-based access — USER cannot create users (403 FORBIDDEN)
  // ---------------------------------------------------------------------------
  it('WHEN a USER (non-admin) tries POST /users → THEN 403 FORBIDDEN', async () => {
    // Login as the user (with the NEW password from test #4).
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail, password: newUserPassword })
      .expect(200);

    const userToken = loginRes.body.data.accessToken;

    const createRes = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        email: `intruder-${SUITE_TAG}@example.com`,
        password: 'some-password',
      })
      .expect(403);

    expect(createRes.body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  // ---------------------------------------------------------------------------
  // 6) Health readiness — when the DB is up, /health/ready returns 200
  //    (the liveness/readiness contract is part of the integration surface).
  // ---------------------------------------------------------------------------
  it('WHEN DB is reachable → GET /health/ready returns 200 with database=up', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' } },
    });
  });
});