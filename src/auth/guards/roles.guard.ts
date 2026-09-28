import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { JwtUser } from '../decorators/current-user.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/**
 * `RolesGuard` — checks the authenticated user (set by JwtAuthGuard) has at
 * least one of the roles declared via `@Roles(...)` on the handler.
 *
 * Unauthenticated users (no `request.user`) are rejected with 403.
 *
 * Spec §2 — role-based authorization. Error code: FORBIDDEN (mapped to
 * 403 by the global filter in PR #4; until then, NestJS default).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() metadata → guard is a no-op (let other guards decide).
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: JwtUser }>();
    const user = request.user;

    if (!user || !user.role) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Authenticated user has no role assigned',
      });
    }

    const hasRole = requiredRoles.includes(user.role as Role);
    if (!hasRole) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `Required role(s): ${requiredRoles.join(', ')}`,
      });
    }

    return true;
  }
}