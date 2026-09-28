import { ExecutionContext, createParamDecorator } from '@nestjs/common';

/**
 * `@CurrentUser()` extracts the authenticated user from the request.
 * Populated by `JwtStrategy.validate()` via Passport on a successful JWT auth.
 *
 * Spec §2 — exposes the JWT payload (userId, email, role) to controllers.
 */
export interface JwtUser {
  userId: string;
  email: string;
  role: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtUser }>();
    return request.user as JwtUser;
  },
);