import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/configuration.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/**
 * JwtAuthGuard is a plain CanActivate that:
 *   1. pulls a Bearer token from the Authorization header
 *   2. delegates signature/expiry verification to @nestjs/jwt's JwtService
 *   3. attaches the verified payload to request.user
 *   4. throws UnauthorizedException on any failure
 *
 * These tests cover each branch with no Laravel — scaffold a plain CanActivate
 * guard with no Passport involved.
 */

const buildConfigMock = (overrides: Partial<AppConfig> = {}): ConfigService =>
  ({
    get: vi.fn((key: string) => {
      const map: Record<string, unknown> = {
        'jwt.accessSecret': 'test-access-secret',
        'jwt.accessExpiresIn': '30m',
        'jwt.refreshExpiresIn': '30d',
        'jwt.refreshEnabled': true,
      };
      return map[key] ?? (overrides as Record<string, unknown>)[key];
    }),
  }) as unknown as ConfigService;

const buildContext = (
  headers: Record<string, string | undefined> = {},
): ExecutionContext => {
  const request = { headers };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
    getHandler: () => () => undefined,
    getClass: () => class AuthController {},
  } as unknown as ExecutionContext;
};

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwt: { verifyAsync: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    jwt = { verifyAsync: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useFactory: () => buildConfigMock() },
      ],
    }).compile();

    guard = module.get(JwtAuthGuard);
  });

  describe('GIVEN no Authorization header', () => {
    it('THEN canActivate throws UnauthorizedException(INVALID_TOKEN) without calling JwtService', async () => {
      await expect(guard.canActivate(buildContext())).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_TOKEN' },
      });
      expect(jwt.verifyAsync).not.toHaveBeenCalled();
    });
  });

  describe('GIVEN Authorization header without Bearer prefix', () => {
    it('THEN canActivate throws UnauthorizedException(INVALID_TOKEN)', async () => {
      await expect(
        guard.canActivate(buildContext({ authorization: 'Basic abc' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwt.verifyAsync).not.toHaveBeenCalled();
    });
  });

  describe('GIVEN a valid Bearer token', () => {
    it('THEN canActivate resolves to true and attaches the payload to request.user', async () => {
      const payload = {
        sub: 'user-1',
        email: 'a@b.c',
        role: 'USER',
      };
      jwt.verifyAsync.mockResolvedValue(payload);

      const request: { headers: Record<string, string>; user?: unknown } = {
        headers: { authorization: 'Bearer valid-token' },
      };
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => ({}),
          getNext: () => () => undefined,
        }),
        getHandler: () => () => undefined,
        getClass: () => class AuthController {},
      } as unknown as ExecutionContext;

      const ok = await guard.canActivate(ctx);

      expect(ok).toBe(true);
      expect(request.user).toEqual({
        userId: 'user-1',
        email: 'a@b.c',
        role: 'USER',
      });
      expect(jwt.verifyAsync).toHaveBeenCalledWith('valid-token', {
        secret: 'test-access-secret',
      });
    });
  });

  describe('GIVEN JwtService.verifyAsync throws (expired / bad signature / malformed)', () => {
    it('THEN canActivate rejects with UnauthorizedException(INVALID_TOKEN)', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(
        guard.canActivate(buildContext({ authorization: 'Bearer bogus' })),
      ).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_TOKEN' },
      });
    });
  });

  describe('GIVEN a token whose payload is missing required claims', () => {
    it('THEN canActivate rejects with UnauthorizedException(INVALID_TOKEN)', async () => {
      jwt.verifyAsync.mockResolvedValue({ sub: 'user-1' }); // missing email + role

      await expect(
        guard.canActivate(buildContext({ authorization: 'Bearer incomplete' })),
      ).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_TOKEN' },
      });
    });
  });
});