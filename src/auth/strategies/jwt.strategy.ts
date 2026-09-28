import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';
import type { AppConfig } from '../../config/configuration.js';
import { JwtUser } from '../decorators/current-user.decorator.js';

/**
 * Passport strategy that validates the JWT access token using @nestjs/jwt's
 * JwtModule config (JWT_ACCESS_SECRET). On success, the returned payload is
 * attached to `request.user` for downstream handlers / guards.
 *
 * The strategy is wired in AuthModule via `PassportStrategy(Strategy, 'jwt')`.
 *
 * Spec §2 — JWT verification + token-shape contract.
 */
export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(@Inject(ConfigService) configService: ConfigService<AppConfig, true>) {
    const accessSecret = configService.get<string>('jwt.accessSecret', { infer: true });
    if (!accessSecret) {
      // ConfigModule validation guarantees this, but guard for tests.
      throw new Error('JWT_ACCESS_SECRET is required to construct JwtStrategy');
    }

    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: accessSecret,
    };

    super(options);
  }

  /**
   * Called by Passport after a token's signature/expiry are verified.
   * Throwing here surfaces as a 401 to the client.
   */
  validate(payload: JwtPayload): JwtUser {
    if (!payload?.sub || !payload?.email || !payload?.role) {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Token payload missing required claims',
      });
    }

    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  }
}