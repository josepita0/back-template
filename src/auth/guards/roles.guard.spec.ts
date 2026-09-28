import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

const buildContext = (user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
    getHandler: () => () => undefined,
    getClass: () => class AuthController {},
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  describe('GIVEN no @Roles() metadata on the handler', () => {
    it('THEN returns true (guard is a no-op)', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      expect(guard.canActivate(buildContext({ userId: 'u1', role: 'USER' }))).toBe(true);
    });
  });

  describe('GIVEN @Roles(ADMIN) and an authenticated ADMIN user', () => {
    it('THEN returns true', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
      expect(
        guard.canActivate(buildContext({ userId: 'u1', email: 'a@b.c', role: 'ADMIN' })),
      ).toBe(true);
    });
  });

  describe('GIVEN @Roles(ADMIN) but the user has role USER', () => {
    it('THEN throws ForbiddenException with code FORBIDDEN', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
      expect(() =>
        guard.canActivate(buildContext({ userId: 'u1', email: 'a@b.c', role: 'USER' })),
      ).toThrowError(ForbiddenException);
    });
  });

  describe('GIVEN @Roles(ADMIN, USER) and the user has role USER', () => {
    it('THEN returns true (matches at least one of the required roles)', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN', 'USER']);
      expect(
        guard.canActivate(buildContext({ userId: 'u1', email: 'a@b.c', role: 'USER' })),
      ).toBe(true);
    });
  });

  describe('GIVEN @Roles(ADMIN) but no authenticated user on the request', () => {
    it('THEN throws ForbiddenException', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
      expect(() => guard.canActivate(buildContext(undefined))).toThrowError(ForbiddenException);
    });
  });

  describe('GIVEN metadata key', () => {
    it('THEN it reads from the canonical ROLES_KEY constant', () => {
      const spy = vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
      guard.canActivate(buildContext({ userId: 'u1', role: 'ADMIN' }));
      expect(spy).toHaveBeenCalledWith(ROLES_KEY, expect.anything());
    });
  });
});