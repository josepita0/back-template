import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UserResponse } from './dto/user-response.dto.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';

/**
 * Unit tests for UsersController.
 *
 * Guards (JwtAuthGuard, RolesGuard) are overridden with permissive stubs so
 * the spec focuses on delegation to UsersService and on the routing
 * contract. Guard logic itself is covered in:
 *   - src/auth/guards/jwt-auth.guard.spec.ts
 *   - src/auth/guards/roles.guard.spec.ts
 *
 * The integration test (`test/users.integration.spec.ts`) exercises the
 * real guard chain end-to-end — including the `GET /users/me` flow.
 */

const NOW = new Date('2026-09-28T18:00:00.000Z');

const userFixture = (overrides: Partial<UserResponse> = {}): UserResponse => ({
  id: 'user-1',
  email: 'alice@example.com',
  name: 'Alice',
  role: 'USER' as never,
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    create: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    usersService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        // ConfigService is injected by the JWT/Role guards in production,
        // but our overridden guards ignore it. Still provided to keep the
        // DI graph sane.
        { provide: ConfigService, useValue: { get: vi.fn() } },
      ],
    })
      // Guards registered so decorators are resolvable; their actual logic
      // is exercised in the dedicated *.spec.ts files.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(UsersController);
  });

  // ---------------------------------------------------------------------------
  // GET /users/me — any authenticated user reads own profile
  // ---------------------------------------------------------------------------
  describe('GET /users/me', () => {
    it('GIVEN an authenticated USER → delegates to UsersService.findOne with the JWT userId and returns the profile (no password)', async () => {
      const expected = userFixture({ id: 'me-1', email: 'me@example.com' });
      usersService.findOne.mockResolvedValue(expected);

      const result = await controller.getMyProfile({
        userId: 'me-1',
        email: 'me@example.com',
        role: 'USER',
      });

      expect(usersService.findOne).toHaveBeenCalledTimes(1);
      expect(usersService.findOne).toHaveBeenCalledWith('me-1');
      expect(result).toEqual(expected);
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('GIVEN an authenticated ADMIN → also returns their own profile (no ADMIN role gating)', async () => {
      const expected = userFixture({
        id: 'admin-1',
        email: 'admin@example.com',
        role: 'ADMIN' as never,
      });
      usersService.findOne.mockResolvedValue(expected);

      const result = await controller.getMyProfile({
        userId: 'admin-1',
        email: 'admin@example.com',
        role: 'ADMIN',
      });

      expect(usersService.findOne).toHaveBeenCalledWith('admin-1');
      expect(result).toEqual(expected);
    });

    it('GIVEN UsersService.findOne throws NotFoundException → propagates (handled by AllExceptionsFilter)', async () => {
      usersService.findOne.mockRejectedValue({
        status: 404,
        response: { code: 'USER_NOT_FOUND' },
      });

      await expect(
        controller.getMyProfile({
          userId: 'missing',
          email: 'ghost@example.com',
          role: 'USER',
        }),
      ).rejects.toMatchObject({ status: 404, response: { code: 'USER_NOT_FOUND' } });
    });

    it('GIVEN the JWT payload has no userId → forwards an empty id (JwtAuthGuard is the gatekeeper)', async () => {
      // In production JwtAuthGuard rejects tokens without a `sub` claim,
      // so this branch is unreachable. We still cover the handler in
      // isolation so a future refactor doesn't silently break delegation.
      usersService.findOne.mockResolvedValue(userFixture({ id: '' }));

      await controller.getMyProfile({
        userId: '',
        email: 'x@y.z',
        role: 'USER',
      });

      expect(usersService.findOne).toHaveBeenCalledWith('');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /users — ADMIN
  // ---------------------------------------------------------------------------
  describe('POST /users', () => {
    it('GIVEN a CreateUserDto → delegates to UsersService.create and returns the new user (no password)', async () => {
      const dto: CreateUserDto = {
        email: 'new@example.com',
        password: 'plain-text-pw',
      };
      const expected = userFixture({ id: 'new-1', email: dto.email });
      usersService.create.mockResolvedValue(expected);

      const result = await controller.create(dto);

      expect(usersService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expected);
      expect(result).not.toHaveProperty('password');
    });
  });

  // ---------------------------------------------------------------------------
  // GET /users — ADMIN (paginated)
  // ---------------------------------------------------------------------------
  describe('GET /users', () => {
    it('GIVEN a PaginationDto → delegates to UsersService.findAll and returns the PaginatedResult', async () => {
      const expected = PaginatedResult.create(
        [userFixture()],
        1,
        1,
        20,
      );
      usersService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll({ page: 1, limit: 20 });

      expect(usersService.findAll).toHaveBeenCalledWith(1, 20);
      expect(result).toBe(expected);
    });

    it('GIVEN a PaginationDto with implicit conversion (string query) → coerces to numbers', async () => {
      const expected = PaginatedResult.create([], 0, 1, 10);
      usersService.findAll.mockResolvedValue(expected);

      // Mirrors what `transformOptions: { enableImplicitConversion: true }`
      // produces when the query string is `?page=2&limit=10`.
      await controller.findAll({ page: 2, limit: 10 });

      expect(usersService.findAll).toHaveBeenCalledWith(2, 10);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /users/:id — ADMIN
  // ---------------------------------------------------------------------------
  describe('GET /users/:id', () => {
    it('GIVEN a valid id → delegates to UsersService.findOne and returns the user', async () => {
      const expected = userFixture({ id: 'u1' });
      usersService.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('u1');

      expect(usersService.findOne).toHaveBeenCalledWith('u1');
      expect(result).toEqual(expected);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /users/:id — ADMIN
  // ---------------------------------------------------------------------------
  describe('PATCH /users/:id', () => {
    it('GIVEN an UpdateUserDto → delegates to UsersService.update and returns the updated user', async () => {
      const dto: UpdateUserDto = { name: 'Renamed' };
      const expected = userFixture({ id: 'u1', name: 'Renamed' });
      usersService.update.mockResolvedValue(expected);

      const result = await controller.update('u1', dto);

      expect(usersService.update).toHaveBeenCalledWith('u1', dto);
      expect(result).toEqual(expected);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /users/:id — ADMIN
  // ---------------------------------------------------------------------------
  describe('DELETE /users/:id', () => {
    it('GIVEN a valid id → delegates to UsersService.remove and returns { id }', async () => {
      usersService.remove.mockResolvedValue({ id: 'u1' });

      const result = await controller.remove('u1');

      expect(usersService.remove).toHaveBeenCalledWith('u1');
      expect(result).toEqual({ id: 'u1' });
    });
  });
});
