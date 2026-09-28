import { NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

// ---- Fixtures ----------------------------------------------------------------

const NOW = new Date('2026-09-28T18:00:00.000Z');

type StoredUser = {
  id: string;
  email: string;
  password: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const userFixture = (overrides: Partial<StoredUser> = {}): StoredUser => ({
  id: 'user-1',
  email: 'alice@example.com',
  password: bcrypt.hashSync('correct-password', 4),
  name: 'Alice',
  role: 'USER',
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

// ---- Prisma mock builder -----------------------------------------------------

interface PrismaMockOverrides {
  users?: StoredUser[];
}

const buildPrismaMock = (overrides: PrismaMockOverrides = {}) => {
  const users = overrides.users ?? [];

  const selectWithoutPassword = (u: StoredUser) => {
    const { password: _pw, ...rest } = u;
    return rest;
  };

  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return users.find((u) => u.id === where.id) ?? null;
        if (where.email) return users.find((u) => u.email === where.email) ?? null;
        return null;
      }),
      findMany: vi.fn(
        async ({
          skip,
          take,
        }: {
          skip?: number;
          take?: number;
          orderBy?: unknown;
          select?: unknown;
        }) => {
          const sorted = [...users].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
          const start = skip ?? 0;
          return sorted.slice(start, start + (take ?? sorted.length)).map(selectWithoutPassword);
        },
      ),
      count: vi.fn(async () => users.length),
      create: vi.fn(
        async ({ data }: { data: Omit<StoredUser, 'id' | 'createdAt' | 'updatedAt' | 'isActive'> }) => {
          const exists = users.some((u) => u.email === data.email);
          if (exists) {
            // Prisma throws P2002 on duplicate unique constraint.
            const err = new Prisma.PrismaClientKnownRequestError(
              'Unique constraint failed on the fields: (`email`)',
              { code: 'P2002', clientVersion: '7.10.0', meta: { target: ['email'] } },
            );
            throw err;
          }
          const created: StoredUser = {
            id: `user-${users.length + 1}`,
            email: data.email,
            password: data.password,
            name: data.name ?? null,
            role: data.role,
            isActive: true,
            createdAt: NOW,
            updatedAt: NOW,
          };
          users.push(created);
          return created;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
          select: _select,
        }: {
          where: { id: string };
          data: Partial<StoredUser> & { password?: string };
          select?: unknown;
        }) => {
          const user = users.find((u) => u.id === where.id);
          if (!user) {
            throw new Prisma.PrismaClientKnownRequestError('Record not found', {
              code: 'P2025',
              clientVersion: '7.10.0',
              meta: { target: ['id'] },
            });
          }
          // Email uniqueness check
          if (data.email && data.email !== user.email) {
            const dup = users.some((u) => u.email === data.email);
            if (dup) {
              throw new Prisma.PrismaClientKnownRequestError(
                'Unique constraint failed on the fields: (`email`)',
                { code: 'P2002', clientVersion: '7.10.0', meta: { target: ['email'] } },
              );
            }
          }
          Object.assign(user, data);
          user.updatedAt = NOW;
          return user;
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const idx = users.findIndex((u) => u.id === where.id);
        if (idx < 0) {
          throw new Prisma.PrismaClientKnownRequestError('Record not found', {
            code: 'P2025',
            clientVersion: '7.10.0',
            meta: { target: ['id'] },
          });
        }
        const [removed] = users.splice(idx, 1);
        return removed;
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return prisma;
};

// ---- Tests -------------------------------------------------------------------

describe('UsersService', () => {
  let service: UsersService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock({ users: [userFixture()] });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('GIVEN a valid DTO → returns the new user (no password) and bcrypt-hashes the password', async () => {
      const dto: CreateUserDto = {
        email: 'new@example.com',
        password: 'plain-text-pw',
        name: 'Newbie',
      };

      const result = await service.create(dto);

      expect(result.email).toBe('new@example.com');
      expect(result.name).toBe('Newbie');
      expect(result.role).toBe(Role.USER);
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('passwordHash');

      // The DB row must contain the hashed password, never plaintext.
      const created = prisma.user.create.mock.calls[0]?.[0] as { data: { password: string } };
      expect(created.data.password).not.toBe('plain-text-pw');
      expect(await bcrypt.compare('plain-text-pw', created.data.password)).toBe(true);
    });

    it('GIVEN an explicit role → the new user is created with that role', async () => {
      const dto: CreateUserDto = {
        email: 'admin@example.com',
        password: 'plain-text-pw',
        role: Role.ADMIN,
      };

      const result = await service.create(dto);

      expect(result.role).toBe(Role.ADMIN);
      expect(result).not.toHaveProperty('password');
    });

    it('GIVEN a duplicate email → re-throws Prisma P2002 (mapped by PrismaExceptionFilter)', async () => {
      const dto: CreateUserDto = {
        email: 'alice@example.com', // already in the seeded fixture
        password: 'plain-text-pw',
      };

      // PR #4: UsersService no longer maps P2002 to ConflictException — the
      // global PrismaExceptionFilter (src/common/filters/prisma-exception.filter.ts)
      // owns the 409 EMAIL_ALREADY_EXISTS mapping. The service just logs and
      // re-throws so the filter can produce the canonical envelope.
      const caught = await service.create(dto).catch((err) => err);
      expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((caught as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
    });
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------
  describe('findAll', () => {
    it('GIVEN page=1, limit=10 → returns a PaginatedResult of users (no password) and the total', async () => {
      prisma = buildPrismaMock({
        users: [
          userFixture({ id: 'u1' }),
          userFixture({ id: 'u2', email: 'b@b.c' }),
          userFixture({ id: 'u3', email: 'c@c.c' }),
        ],
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          UsersService,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      service = module.get(UsersService);

      const result = await service.findAll(1, 10);

      expect(result).toBeInstanceOf(PaginatedResult);
      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(1);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
      result.items.forEach((u) => {
        expect(u).not.toHaveProperty('password');
      });
    });

    it('GIVEN multiple pages → totalPages + hasNextPage + hasPreviousPage reflect the math', async () => {
      const many = Array.from({ length: 25 }, (_, i) =>
        userFixture({ id: `u${i + 1}`, email: `u${i + 1}@x.c` }),
      );
      prisma = buildPrismaMock({ users: many });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          UsersService,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      service = module.get(UsersService);

      const page1 = await service.findAll(1, 10);
      const page2 = await service.findAll(2, 10);
      const page3 = await service.findAll(3, 10);

      expect(page1.totalPages).toBe(3);
      expect(page1.hasNextPage).toBe(true);
      expect(page1.hasPreviousPage).toBe(false);

      expect(page2.hasNextPage).toBe(true);
      expect(page2.hasPreviousPage).toBe(true);

      expect(page3.hasNextPage).toBe(false);
      expect(page3.hasPreviousPage).toBe(true);
      expect(page3.items).toHaveLength(5);
    });
  });

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------
  describe('findOne', () => {
    it('GIVEN a valid id → returns the user (no password)', async () => {
      const result = await service.findOne('user-1');

      expect(result.id).toBe('user-1');
      expect(result.email).toBe('alice@example.com');
      expect(result).not.toHaveProperty('password');
    });

    it('GIVEN an unknown id → throws NotFoundException(USER_NOT_FOUND)', async () => {
      await expect(service.findOne('does-not-exist')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.findOne('does-not-exist')).rejects.toMatchObject({
        status: 404,
        response: { code: 'USER_NOT_FOUND' },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('GIVEN a name change → returns the updated user with new name (no password)', async () => {
      const dto: UpdateUserDto = { name: 'Alicia' };

      const result = await service.update('user-1', dto);

      expect(result.name).toBe('Alicia');
      expect(result).not.toHaveProperty('password');
    });

    it('GIVEN a password change → the stored password is re-hashed (not plaintext)', async () => {
      const dto: UpdateUserDto = { password: 'fresh-password-1' };

      const result = await service.update('user-1', dto);

      expect(result).not.toHaveProperty('password');
      const updated = prisma.user.update.mock.calls[0]?.[0] as {
        data: { password: string };
      };
      expect(updated.data.password).not.toBe('fresh-password-1');
      expect(await bcrypt.compare('fresh-password-1', updated.data.password)).toBe(true);
    });

    it('GIVEN a duplicate email → re-throws Prisma P2002 (mapped by PrismaExceptionFilter)', async () => {
      prisma = buildPrismaMock({
        users: [
          userFixture({ id: 'u1', email: 'a@a.c' }),
          userFixture({ id: 'u2', email: 'b@b.c' }),
        ],
      });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          UsersService,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      service = module.get(UsersService);

      // PR #4: P2002 is now handled by PrismaExceptionFilter — the service
      // just logs and re-throws.
      const dto: UpdateUserDto = { email: 'b@b.c' };
      const caught = await service.update('u1', dto).catch((err) => err);
      expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((caught as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
    });

    it('GIVEN an unknown id → re-throws Prisma P2025 (mapped by PrismaExceptionFilter)', async () => {
      // PR #4: P2025 is also handled by PrismaExceptionFilter. The service
      // logs and re-throws so the filter can produce the 404 envelope.
      const dto: UpdateUserDto = { name: 'X' };
      const caught = await service.update('missing', dto).catch((err) => err);
      expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((caught as Prisma.PrismaClientKnownRequestError).code).toBe('P2025');
    });

    it('GIVEN an empty patch → returns the current user (no DB write)', async () => {
      const result = await service.update('user-1', {});

      expect(result.id).toBe('user-1');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------
  describe('remove', () => {
    it('GIVEN a valid id → deletes the user and returns { id }', async () => {
      const result = await service.remove('user-1');
      expect(result).toEqual({ id: 'user-1' });
    });

    it('GIVEN an unknown id → re-throws Prisma P2025 (mapped by PrismaExceptionFilter)', async () => {
      // PR #4: P2025 is also handled by PrismaExceptionFilter. The service
      // logs and re-throws so the filter can produce the 404 envelope.
      const caught = await service.remove('does-not-exist').catch((err) => err);
      expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((caught as Prisma.PrismaClientKnownRequestError).code).toBe('P2025');
    });
  });

  // ---------------------------------------------------------------------------
  // password-exclusion invariant
  // ---------------------------------------------------------------------------
  describe('password exclusion', () => {
    it('findOne never returns a `password` field', async () => {
      const result = await service.findOne('user-1');
      expect(Object.keys(result)).not.toContain('password');
    });

    it('findAll items never carry a `password` field', async () => {
      const result = await service.findAll(1, 10);
      result.items.forEach((u) => {
        expect(Object.keys(u)).not.toContain('password');
      });
    });

    it('update never returns a `password` field', async () => {
      const result = await service.update('user-1', { name: 'New' });
      expect(Object.keys(result)).not.toContain('password');
    });

    it('create never returns a `password` field', async () => {
      const result = await service.create({
        email: 'fresh@x.c',
        password: 'plain-text-pw',
      });
      expect(Object.keys(result)).not.toContain('password');
    });
  });
});
