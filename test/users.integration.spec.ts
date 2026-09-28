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
 * Integration tests for the Users module — CRUD, pagination, duplicate
 * email handling. Gated on DATABASE_URL: the full AppModule is only
 * imported when DATABASE_URL is present so the suite SKIPS in
 * environments without a real Postgres.
 *
 * Spec §3 (Users Module):
 *   - Create user → find user → update user → delete user
 *   - Duplicate email returns 409 EMAIL_ALREADY_EXISTS
 *   - Pagination works correctly (envelope meta has total/page/totalPages/
 *     hasNextPage/hasPreviousPage)
 *
 * Cleanup: a unique tag per suite run scopes every created user so the
 * `afterAll` deletes only the test data (no risk of nuking real users).
 */
describe.skipIf(!process.env.DATABASE_URL)('Users (integration)', () => {
  let app: INestApplication<App>;
  let adminAccessToken: string;

  const SUITE_TAG = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminEmail = `users-admin-${SUITE_TAG}@example.com`;
  const adminPassword = 'super-secret-pass-1';

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module.js');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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
    await app.init();
  });

  afterAll(async () => {
    if (!app) return;
    const prisma = app.get<{
      user: {
        deleteMany: (args: {
          where: { email: { contains: string } };
        }) => Promise<unknown>;
      };
    }>(
      (await import('../src/prisma/prisma.service.js')).PrismaService as never,
    );
    try {
      await prisma.user.deleteMany({ where: { email: { contains: SUITE_TAG } } });
    } catch {
      // best-effort cleanup
    }
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // SETUP: bootstrap ADMIN directly via Prisma and log in to obtain a token.
  // ---------------------------------------------------------------------------
  it('SETUP: bootstrap an ADMIN and login to obtain an access token', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const bcrypt = await import('bcrypt');
    const { PrismaPg } = await import('@prisma/adapter-pg');

    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    });

    await prisma.user.create({
      data: {
        email: adminEmail,
        password: await bcrypt.hash(adminPassword, 12),
        role: 'ADMIN',
        isActive: true,
      },
    });
    await prisma.$disconnect();

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword })
      .expect(200);

    adminAccessToken = loginRes.body.data.accessToken;
    expect(adminAccessToken).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // 1) CRUD: create → find → update → delete
  // ---------------------------------------------------------------------------
  it('WHEN ADMIN creates a user → reads → updates → deletes → each step returns the expected envelope', async () => {
    const createEmail = `crud-${SUITE_TAG}@example.com`;

    const createRes = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: createEmail, password: 'plaintext-pass', name: 'Original' })
      .expect(201);

    expect(createRes.body).toMatchObject({
      success: true,
      data: {
        email: createEmail,
        name: 'Original',
        role: 'USER',
        isActive: true,
      },
    });
    // password MUST NEVER be in any response.
    expect(createRes.body.data.password).toBeUndefined();
    const userId = createRes.body.data.id;

    // Find by id
    const findRes = await request(app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);
    expect(findRes.body.data).toMatchObject({ id: userId, email: createEmail });
    expect(findRes.body.data.password).toBeUndefined();

    // Update
    const patchRes = await request(app.getHttpServer())
      .patch(`/users/${userId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Renamed' })
      .expect(200);
    expect(patchRes.body.data).toMatchObject({ id: userId, name: 'Renamed' });

    // Delete
    const deleteRes = await request(app.getHttpServer())
      .delete(`/users/${userId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);
    expect(deleteRes.body.data).toEqual({ id: userId });

    // Subsequent GET should 404 NOT_FOUND
    await request(app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(404);
  });

  // ---------------------------------------------------------------------------
  // 2) Duplicate email → 409 EMAIL_ALREADY_EXISTS
  // ---------------------------------------------------------------------------
  it('WHEN creating a user with an email that already exists → 409 EMAIL_ALREADY_EXISTS', async () => {
    const dupEmail = `dup-${SUITE_TAG}@example.com`;

    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: dupEmail, password: 'plaintext-pass' })
      .expect(201);

    const dup = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: dupEmail, password: 'other-pass' })
      .expect(409);

    expect(dup.body).toMatchObject({
      success: false,
      error: { code: 'EMAIL_ALREADY_EXISTS' },
    });
  });

  // ---------------------------------------------------------------------------
  // 3) Pagination — page=1&limit=5 over a known set yields the right meta.
  // ---------------------------------------------------------------------------
  it('WHEN GET /users?page&limit → envelope meta has total/page/limit/totalPages/hasNextPage/hasPreviousPage', async () => {
    // Create 6 fresh users so we know the exact count for this suite.
    const orderedTag = `page-${SUITE_TAG}`;
    const created: string[] = [];
    for (let i = 0; i < 6; i++) {
      const email = `${orderedTag}-${i}@example.com`;
      const res = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({ email, password: 'plaintext-pass' })
        .expect(201);
      created.push(res.body.data.id);
    }

    const page1 = await request(app.getHttpServer())
      .get('/users?page=1&limit=5')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(page1.body).toMatchObject({
      success: true,
      meta: {
        page: 1,
        limit: 5,
        hasPreviousPage: false,
      },
    });
    expect(Array.isArray(page1.body.data)).toBe(true);
    expect(page1.body.data.length).toBeLessThanOrEqual(5);
    // total is global; we only assert it's >= our 6 created + the admin
    expect(page1.body.meta.total).toBeGreaterThanOrEqual(created.length + 1);
    expect(page1.body.meta.totalPages).toBe(
      Math.max(1, Math.ceil(page1.body.meta.total / 5)),
    );

    // page=2 with limit=5 → hasPreviousPage=true (unless total < 6)
    const page2 = await request(app.getHttpServer())
      .get('/users?page=2&limit=5')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    if (page2.body.meta.total > 5) {
      expect(page2.body.meta.hasPreviousPage).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // 4) Authenticated access required — no bearer → 401 INVALID_TOKEN
  // ---------------------------------------------------------------------------
  it('WHEN GET /users without bearer token → 401 INVALID_TOKEN', async () => {
    const res = await request(app.getHttpServer()).get('/users').expect(401);

    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'INVALID_TOKEN' },
    });
  });

  // ---------------------------------------------------------------------------
  // 5) GET /users/me — any authenticated user reads their own profile
  //    Spec §3 MUST: 'Any authenticated user reads own profile via GET /users/me'.
  //    The endpoint must NOT be ADMIN-gated.
  // ---------------------------------------------------------------------------
  it('WHEN an authenticated USER calls GET /users/me → 200 with their own profile (no password)', async () => {
    // Create a USER (the admin already exists in setup).
    const meEmail = `me-${SUITE_TAG}@example.com`;
    const mePassword = 'my-strong-password-1';

    const createRes = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: meEmail, password: mePassword, name: 'Me' })
      .expect(201);

    const myId = createRes.body.data.id;
    expect(myId).toBeTruthy();

    // Login as that USER (not as the admin) so we exercise the no-ADMIN
    // gating path: the caller is a plain USER and /me must still work.
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: meEmail, password: mePassword })
      .expect(200);

    const myToken = loginRes.body.data.accessToken;
    expect(myToken).toBeTruthy();

    // GET /users/me with the USER's token.
    const meRes = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${myToken}`)
      .expect(200);

    expect(meRes.body).toMatchObject({
      success: true,
      data: {
        id: myId,
        email: meEmail,
        role: 'USER',
        name: 'Me',
        isActive: true,
      },
    });
    // The password (hash) MUST NEVER appear in the response.
    expect(meRes.body.data.password).toBeUndefined();
    expect(meRes.body.data.passwordHash).toBeUndefined();
  });

  it('WHEN an ADMIN calls GET /users/me → 200 with their own profile (admins are users too)', async () => {
    const meRes = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(meRes.body).toMatchObject({
      success: true,
      data: {
        email: adminEmail,
        role: 'ADMIN',
        isActive: true,
      },
    });
    expect(meRes.body.data.password).toBeUndefined();
  });

  it('WHEN GET /users/me without a bearer token → 401 INVALID_TOKEN', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .expect(401);

    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'INVALID_TOKEN' },
    });
  });
});