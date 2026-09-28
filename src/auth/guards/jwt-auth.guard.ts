import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * `JwtAuthGuard` — Passport-backed guard registered under the name `jwt`.
 * Delegates token validation to `JwtStrategy` (src/auth/strategies/jwt.strategy.ts).
 *
 * Apply with `@UseGuards(JwtAuthGuard)` on protected routes.
 *
 * DEVIATION from design.md: design chose "plain @nestjs/jwt, no Passport".
 * Task description overrides: "extends AuthGuard('jwt')" implies Passport.
 * Strategy still uses @nestjs/jwt's JwtService (not passport-jwt's verifier).
 *
 * Spec §2 — JWT-based authentication on protected endpoints.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}