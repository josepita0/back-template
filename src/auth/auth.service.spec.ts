import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppConfig } from '../config/configuration.js';

// ---- Fixtures ----------------------------------------------------------------

const NOW = new Date('2026-09-28T18:00:00.000Z');

const userFixture = (overrides: Partial<{
  id: string;
  email: string;
  password: string;
  isActive: boolean;
  role: 'USER' | 'ADMIN';
}> = {}) => ({
  id: 'user-1',
  email: 'alice@example.com',
  password: bcrypt.hashSync('correct-password', 4),
  name: 'Alice',
  role: 'USER' as const,
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

// ---- Prisma mock builder -----------------------------------------------------

type RefreshTokenRecord = {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
};

type PasswordResetTokenRecord = {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

interface PrismaMockOverrides {
  users?: ReturnType<typeof userFixture>[];
  refreshTokens?: RefreshTokenRecord[];
  passwordResetTokens?: PasswordResetTokenRecord[];
  /** Capture of $transaction calls */
  transactions?: unknown[][];
}

const buildPrismaMock = (overrides: PrismaMockOverrides = {}) => {
  const users = overrides.users ?? [];
  const refreshTokens = overrides.refreshTokens ?? [];
  const passwordResetTokens = overrides.passwordResetTokens ?? [];

  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email) return users.find((u) => u.email === where.email) ?? null;
        if (where.id) return users.find((u) => u.id === where.id) ?? null;
        return null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { password: string } }) => {
        const user = users.find((u) => u.id === where.id);
        if (!user) throw new Error('user not found');
        Object.assign(user, data);
        return user;
      }),
    },
    refreshToken: {
      findUnique: vi.fn(
        async ({ where, include }: { where: { id?: string; token?: string }; include?: unknown }) => {
          let record: RefreshTokenRecord | undefined;
          if (where.id) record = refreshTokens.find((t) => t.id === where.id);
          if (where.token) record = refreshTokens.find((t) => t.token === where.token);
          if (!record) return null;
          if (include) {
            const user = users.find((u) => u.id === record!.userId);
            return { ...record, user };
          }
          return record;
        },
      ),
      create: vi.fn(async ({ data }: { data: Omit<RefreshTokenRecord, 'id' | 'createdAt'> }) => {
        const record: RefreshTokenRecord = {
          id: `rt-${refreshTokens.length + 1}`,
          token: data.token,
          userId: data.userId,
          expiresAt: data.expiresAt,
          createdAt: NOW,
        };
        refreshTokens.push(record);
        return record;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const idx = refreshTokens.findIndex((t) => t.id === where.id);
        if (idx < 0) throw new Error('refresh token not found');
        const [removed] = refreshTokens.splice(idx, 1);
        return removed;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const before = refreshTokens.length;
        const remaining = refreshTokens.filter((t) => t.userId !== where.userId);
        const removed = before - remaining.length;
        refreshTokens.length = 0;
        refreshTokens.push(...remaining);
        return { count: removed };
      }),
    },
    passwordResetToken: {
      findUnique: vi.fn(
        async ({ where, include }: { where: { id?: string; token?: string }; include?: unknown }) => {
          let record: PasswordResetTokenRecord | undefined;
          if (where.id) record = passwordResetTokens.find((t) => t.id === where.id);
          if (where.token) record = passwordResetTokens.find((t) => t.token === where.token);
          if (!record) return null;
          if (include) {
            const user = users.find((u) => u.id === record!.userId);
            return { ...record, user };
          }
          return record;
        },
      ),
      create: vi.fn(
        async ({ data }: { data: Omit<PasswordResetTokenRecord, 'id' | 'createdAt' | 'usedAt'> }) => {
          const record: PasswordResetTokenRecord = {
            id: `prt-${passwordResetTokens.length + 1}`,
            token: data.token,
            userId: data.userId,
            expiresAt: data.expiresAt,
            usedAt: null,
            createdAt: NOW,
          };
          passwordResetTokens.push(record);
          return record;
        },
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { usedAt: Date } }) => {
          const record = passwordResetTokens.find((t) => t.id === where.id);
          if (!record) throw new Error('reset token not found');
          Object.assign(record, data);
          return record;
        },
      ),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => {
      overrides.transactions?.push(ops);
      return Promise.all(ops);
    }),
  };

  return prisma;
};

// ---- JwtService mock ---------------------------------------------------------

const buildJwtMock = () => ({
  signAsync: vi.fn(async (payload: { sub: string; email: string; role: string }) =>
    `jwt.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`),
});

// ---- ConfigService mock ------------------------------------------------------

const buildConfigMock = (overrides: Partial<AppConfig> = {}): ConfigService =>
  ({
    get: vi.fn((key: string) => {
      const map: Record<string, unknown> = {
        'jwt.accessExpiresIn': '30m',
        'jwt.refreshExpiresIn': '30d',
        'jwt.refreshEnabled': true,
        'jwt.accessSecret': 'test-access-secret',
        'jwt.refreshSecret': 'test-refresh-secret',
        'auth.cookieEnabled': false,
        'nodeEnv': 'test',
      };
      if (key in overrides && overrides[key as keyof AppConfig] !== undefined) {
        return (overrides as Record<string, unknown>)[key];
      }
      return map[key];
    }),
  }) as unknown as ConfigService;

// ---- Tests -------------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let jwt: ReturnType<typeof buildJwtMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock({ users: [userFixture()] });
    jwt = buildJwtMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useFactory: () => buildConfigMock() },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  // ----------------------- login ------------------------------------------------
  describe('login', () => {
    it('GIVEN valid credentials → returns accessToken, refreshToken, user (no password)', async () => {
      const result = await service.login('alice@example.com', 'correct-password');

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.user.email).toBe('alice@example.com');
      // Password must never appear in the response.
      expect('password' in (result.user as object)).toBe(false);
    });

    it('GIVEN wrong password → throws UNAUTHORIZED INVALID_CREDENTIALS', async () => {
      await expect(service.login('alice@example.com', 'wrong-password')).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_CREDENTIALS' },
      });
    });

    it('GIVEN unknown email → throws UNAUTHORIZED INVALID_CREDENTIALS (no email enumeration)', async () => {
      await expect(service.login('nobody@example.com', 'anything')).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_CREDENTIALS' },
      });
    });

    it('GIVEN inactive user → throws FORBIDDEN ACCOUNT_SUSPENDED', async () => {
      prisma = buildPrismaMock({ users: [userFixture({ isActive: false })] });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: prisma },
          { provide: JwtService, useValue: jwt },
          { provide: ConfigService, useFactory: () => buildConfigMock() },
        ],
      }).compile();
      const local = module.get(AuthService);

      await expect(
        local.login('alice@example.com', 'correct-password'),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'ACCOUNT_SUSPENDED' },
      });
    });
  });

  // ----------------------- refresh ----------------------------------------------
  describe('refreshToken', () => {
    // We seed the store with a known SHA-256 hash so the service can find it.
    // The "raw" plaintext is whatever we pass to refreshToken().
    const seedRefresh = async (
      userId: string,
      opts: { expired?: boolean; inactive?: boolean } = {},
    ): Promise<{ raw: string; record: RefreshTokenRecord }> => {
      const crypto = await import('node:crypto');
      const raw = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
      const record: RefreshTokenRecord = {
        id: 'rt-existing',
        token: hash,
        userId,
        expiresAt: opts.expired
          ? new Date(Date.now() - 60_000)
          : new Date(Date.now() + 60 * 60 * 1000),
        createdAt: NOW,
      };
      prisma = buildPrismaMock({
        users: [userFixture({ id: userId, isActive: !opts.inactive })],
        refreshTokens: [record],
        transactions: [],
      });
      jwt = buildJwtMock();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: prisma },
          { provide: JwtService, useValue: jwt },
          { provide: ConfigService, useFactory: () => buildConfigMock() },
        ],
      }).compile();
      service = module.get(AuthService);
      return { raw, record };
    };

    it('GIVEN valid refresh token → rotates atomically (old deleted + new created in $transaction)', async () => {
      const { raw } = await seedRefresh('user-1');

      const result = await service.refreshToken(raw);

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.refreshToken).not.toBe(raw);

      // The transaction wrapper carried two operations: delete-old + create-new
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = (prisma.$transaction.mock.calls[0]?.[0] as unknown[]) ?? [];
      expect(ops).toHaveLength(2);
    });

    it('GIVEN unknown refresh token → throws UNAUTHORIZED INVALID_TOKEN', async () => {
      await seedRefresh('user-1');

      await expect(service.refreshToken('not-a-real-token')).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_TOKEN' },
      });
    });

    it('GIVEN expired refresh token → throws UNAUTHORIZED INVALID_TOKEN', async () => {
      const { raw } = await seedRefresh('user-1', { expired: true });

      await expect(service.refreshToken(raw)).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_TOKEN' },
      });
    });

    it('GIVEN refresh token for inactive user → throws FORBIDDEN ACCOUNT_SUSPENDED', async () => {
      const { raw } = await seedRefresh('user-1', { inactive: true });

      await expect(service.refreshToken(raw)).rejects.toMatchObject({
        status: 403,
        response: { code: 'ACCOUNT_SUSPENDED' },
      });
    });
  });

  // ----------------------- admin reset ------------------------------------------
  describe('adminResetPassword', () => {
    it('GIVEN existing user → returns plaintext token with 1h expiry + persists hashed', async () => {
      const result = await service.adminResetPassword('admin-1', 'user-1');

      expect(result.token).toMatch(/^[a-f0-9]{64}$/); // 32 bytes hex
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Persisted record stores the SHA-256 hash, NOT the plaintext.
      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const persisted = (prisma.passwordResetToken.create.mock.calls[0]?.[0] as { data: { token: string } }).data;
      const crypto = await import('node:crypto');
      const expectedHash = crypto.createHash('sha256').update(result.token, 'utf8').digest('hex');
      expect(persisted.token).toBe(expectedHash);
      expect(persisted.token).not.toBe(result.token);
    });

    it('GIVEN unknown target user → throws BAD_REQUEST USER_NOT_FOUND', async () => {
      await expect(service.adminResetPassword('admin-1', 'ghost')).rejects.toMatchObject({
        status: 400,
        response: { code: 'USER_NOT_FOUND' },
      });
    });
  });

  // ----------------------- user reset -------------------------------------------
  describe('resetPassword', () => {
    const seedReset = async (
      opts: { expired?: boolean; used?: boolean } = {},
    ): Promise<{ raw: string; userId: string }> => {
      const crypto = await import('node:crypto');
      const raw = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
      const userId = 'user-1';
      const record: PasswordResetTokenRecord = {
        id: 'prt-1',
        token: hash,
        userId,
        expiresAt: opts.expired
          ? new Date(Date.now() - 60_000)
          : new Date(Date.now() + 60 * 60 * 1000),
        usedAt: opts.used ? new Date(Date.now() - 60_000) : null,
        createdAt: NOW,
      };
      prisma = buildPrismaMock({
        users: [userFixture({ id: userId })],
        passwordResetTokens: [record],
        refreshTokens: [
          {
            id: 'rt-existing',
            token: 'hash',
            userId,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            createdAt: NOW,
          },
        ],
        transactions: [],
      });
      jwt = buildJwtMock();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: prisma },
          { provide: JwtService, useValue: jwt },
          { provide: ConfigService, useFactory: () => buildConfigMock() },
        ],
      }).compile();
      service = module.get(AuthService);
      return { raw, userId };
    };

    it('GIVEN valid token + new password → updates password, marks used, revokes all refresh tokens in $transaction', async () => {
      const { raw } = await seedReset();

      const result = await service.resetPassword(raw, 'new-passw0rd');

      expect(result.userId).toBe('user-1');

      // $transaction should wrap the 3 ops: updateUser + markUsed + revokeAll
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = (prisma.$transaction.mock.calls[0]?.[0] as unknown[]) ?? [];
      expect(ops).toHaveLength(3);

      // Password updated with a bcrypt hash, NOT plaintext.
      const userUpdate = (prisma.user.update.mock.calls[0]?.[0] as { data: { password: string } }).data;
      expect(userUpdate.password).not.toBe('new-passw0rd');
      expect(await bcrypt.compare('new-passw0rd', userUpdate.password)).toBe(true);
    });

    it('GIVEN expired token → throws BAD_REQUEST TOKEN_EXPIRED', async () => {
      const { raw } = await seedReset({ expired: true });
      await expect(service.resetPassword(raw, 'new-passw0rd')).rejects.toMatchObject({
        status: 400,
        response: { code: 'TOKEN_EXPIRED' },
      });
    });

    it('GIVEN already-used token → throws BAD_REQUEST TOKEN_EXPIRED', async () => {
      const { raw } = await seedReset({ used: true });
      await expect(service.resetPassword(raw, 'new-passw0rd')).rejects.toMatchObject({
        status: 400,
        response: { code: 'TOKEN_EXPIRED' },
      });
    });

    it('GIVEN unknown token → throws BAD_REQUEST TOKEN_EXPIRED', async () => {
      await expect(service.resetPassword('nope', 'new-passw0rd')).rejects.toMatchObject({
        status: 400,
        response: { code: 'TOKEN_EXPIRED' },
      });
    });
  });

  // ----------------------- revokeAll --------------------------------------------
  describe('revokeAllRefreshTokens', () => {
    it('GIVEN a userId → deletes their refresh tokens and returns count', async () => {
      prisma = buildPrismaMock({
        refreshTokens: [
          {
            id: 'rt-1',
            token: 'h1',
            userId: 'user-1',
            expiresAt: new Date(Date.now() + 1000),
            createdAt: NOW,
          },
          {
            id: 'rt-2',
            token: 'h2',
            userId: 'user-1',
            expiresAt: new Date(Date.now() + 2000),
            createdAt: NOW,
          },
        ],
      });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: prisma },
          { provide: JwtService, useValue: buildJwtMock() },
          { provide: ConfigService, useFactory: () => buildConfigMock() },
        ],
      }).compile();
      const local = module.get(AuthService);

      const result = await local.revokeAllRefreshTokens('user-1');
      expect(result.count).toBe(2);
    });
  });
});