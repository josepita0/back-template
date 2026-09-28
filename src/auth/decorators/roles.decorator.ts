import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * `@Roles(Role.ADMIN)` decorates a controller method to require at least one of
 * the listed roles. Read by `RolesGuard` (src/auth/guards/roles.guard.ts).
 *
 * Spec §2 — role-based authorization.
 */
export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);