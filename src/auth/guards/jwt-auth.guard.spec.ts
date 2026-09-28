import { ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/**
 * JwtAuthGuard is a thin subclass of @nestjs/passport's AuthGuard('jwt').
 * The unit-level guarantee we want is that the guard exists, that it
 * delegates to Passport's `jwt` strategy name, and that it rejects when
 * no PassportStrategy is registered (the canonical failure mode for a
 * guard whose backing strategy is missing).
 */

const buildContext = (): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, cookies: {} }),
      getResponse: () => ({}),
      getNext: () => () => undefined,
    }),
    getHandler: () => () => undefined,
    getClass: () => class AuthController {},
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard],
    }).compile();
    guard = module.get(JwtAuthGuard);
  });

  it('THEN it is an instance of AuthGuard("jwt") from @nestjs/passport', () => {
    expect(guard).toBeDefined();
    // The guard name is internal to @nestjs/passport; we assert the guard
    // has the inherited `getAuthenticateOptions` method (a public Passport API).
    expect(typeof (guard as unknown as { getAuthenticateOptions?: () => unknown }).getAuthenticateOptions).toBe('function');
  });

  it('GIVEN no Passport strategy registered → canActivate rejects', async () => {
    // No JwtStrategy provider → AuthGuard('jwt') has nothing to call → rejects.
    await expect(guard.canActivate(buildContext())).rejects.toBeDefined();
  });

  it('THEN handleRequest forwards a successful user payload', () => {
    // handleRequest is the Passport-supplied error handler; with no error
    // it returns the user as-is. We exercise it directly.
    const handle = (
      guard as unknown as { handleRequest: (err: unknown, user: unknown) => unknown }
    ).handleRequest;
    const user = { userId: 'u1', email: 'a@b.c', role: 'USER' };
    expect(handle(null, user)).toEqual(user);
  });

  it('THEN handleRequest rejects when an error is provided', () => {
    const handle = (
      guard as unknown as {
        handleRequest: (err: unknown, user: unknown, info?: unknown) => unknown;
      }
    ).handleRequest;
    expect(() => handle(new Error('boom'), null)).toThrowError();
  });

  it('THEN handleRequest rejects when no user is present', () => {
    const handle = (
      guard as unknown as {
        handleRequest: (err: unknown, user: unknown, info?: unknown) => unknown;
      }
    ).handleRequest;
    expect(() => handle(null, false)).toThrowError();
  });
});