import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import type { AppConfig } from '../config/configuration.js';
import { RolesGuard } from './guards/roles.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

const buildConfigMock = (overrides: Partial<AppConfig> = {}): ConfigService =>
  ({
    get: vi.fn((key: string) => {
      const map: Record<string, unknown> = {
        'auth.cookieEnabled': false,
        'nodeEnv': 'test',
        'jwt.accessSecret': 'a',
        'jwt.refreshSecret': 'b',
        'jwt.accessExpiresIn': '30m',
        'jwt.refreshExpiresIn': '30d',
        'jwt.refreshEnabled': true,
      };
      return map[key] ?? (overrides as Record<string, unknown>)[key];
    }),
  }) as unknown as ConfigService;

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    login: ReturnType<typeof vi.fn>;
    refreshToken: ReturnType<typeof vi.fn>;
    adminResetPassword: ReturnType<typeof vi.fn>;
    resetPassword: ReturnType<typeof vi.fn>;
    revokeAllRefreshTokens: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authService = {
      login: vi.fn(),
      refreshToken: vi.fn(),
      adminResetPassword: vi.fn(),
      resetPassword: vi.fn(),
      revokeAllRefreshTokens: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useFactory: () => buildConfigMock() },
        // Guards registered so decorators are resolvable; their actual logic
        // is exercised in the dedicated *.spec.ts files.
        { provide: JwtAuthGuard, useValue: { canActivate: () => true } },
        { provide: RolesGuard, useValue: { canActivate: () => true } },
      ],
    }).compile();

    controller = module.get(AuthController);
  });

  // ----------------------- login ------------------------------------------------
  describe('POST /auth/login', () => {
    it('GIVEN valid DTO → delegates to AuthService.login and returns its result', async () => {
      const expected = {
        accessToken: 'access',
        refreshToken: 'refresh',
        user: { id: 'u1', email: 'a@b.c' },
      };
      authService.login.mockResolvedValue(expected);

      const result = await controller.login(
        { email: 'a@b.c', password: 'pw' },
        { cookie: vi.fn(), clearCookie: vi.fn() } as never,
      );

      expect(authService.login).toHaveBeenCalledWith('a@b.c', 'pw');
      expect(result).toEqual(expected);
    });

    it('GIVEN AuthService.login throws UNAUTHORIZED → propagates the exception', async () => {
      authService.login.mockRejectedValue({
        status: 401,
        response: { code: 'INVALID_CREDENTIALS' },
      });

      await expect(
        controller.login(
          { email: 'a@b.c', password: 'wrong' },
          { cookie: vi.fn(), clearCookie: vi.fn() } as never,
        ),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  // ----------------------- refresh ----------------------------------------------
  describe('POST /auth/refresh', () => {
    it('GIVEN body token → delegates to AuthService.refreshToken', async () => {
      const expected = { accessToken: 'new', refreshToken: 'new-rt' };
      authService.refreshToken.mockResolvedValue(expected);

      const result = await controller.refresh(
        { refreshToken: 'old-rt' },
        { cookies: {} } as never,
        { cookie: vi.fn(), clearCookie: vi.fn() } as never,
      );

      expect(authService.refreshToken).toHaveBeenCalledWith('old-rt');
      expect(result).toEqual(expected);
    });

    it('GIVEN AuthService.refreshToken throws INVALID_TOKEN → propagates', async () => {
      authService.refreshToken.mockRejectedValue({
        status: 401,
        response: { code: 'INVALID_TOKEN' },
      });

      await expect(
        controller.refresh(
          { refreshToken: 'bogus' },
          { cookies: {} } as never,
          { cookie: vi.fn(), clearCookie: vi.fn() } as never,
        ),
      ).rejects.toMatchObject({ status: 401, response: { code: 'INVALID_TOKEN' } });
    });
  });

  // ----------------------- admin reset ------------------------------------------
  describe('POST /auth/admin/reset-password', () => {
    it('GIVEN admin JWT user → calls service with adminId and target userId', async () => {
      authService.adminResetPassword.mockResolvedValue({
        token: 'plain',
        expiresAt: new Date(),
      });

      await controller.adminResetPassword(
        { userId: 'admin-1', email: 'a@b.c', role: 'ADMIN' },
        { userId: 'target-1' },
      );

      expect(authService.adminResetPassword).toHaveBeenCalledWith('admin-1', 'target-1');
    });
  });

  // ----------------------- user reset -------------------------------------------
  describe('POST /auth/reset-password', () => {
    it('GIVEN valid DTO → delegates to AuthService.resetPassword', async () => {
      authService.resetPassword.mockResolvedValue({ userId: 'u1' });

      await controller.resetPassword({ token: 'tok', newPassword: 'newpass1' });

      expect(authService.resetPassword).toHaveBeenCalledWith('tok', 'newpass1');
    });
  });

  // ----------------------- revoke-all -------------------------------------------
  describe('POST /auth/revoke-all', () => {
    it('GIVEN authenticated user → calls revokeAllRefreshTokens with userId', async () => {
      authService.revokeAllRefreshTokens.mockResolvedValue({ count: 3 });

      const result = await controller.revokeAll({
        userId: 'user-1',
        email: 'a@b.c',
        role: 'USER',
      });

      expect(authService.revokeAllRefreshTokens).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ count: 3 });
    });
  });
});