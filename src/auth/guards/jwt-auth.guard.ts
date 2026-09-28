import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AppConfig } from '../../config/configuration.js';
import type { JwtUser } from '../decorators/current-user.decorator.js';

/**
 * `JwtAuthGuard` — plain CanActivate guard that validates the bearer token
 * using `@nestjs/jwt`'s `JwtService.verifyAsync()`. On success, the verified
 * payload is attached to `request.user` for downstream handlers / guards.
 *
 * Apply with `@UseGuards(JwtAuthGuard)` on protected routes.
 *
 * Spec §2 — JWT-based authentication on protected endpoints.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtUser }>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'No bearer token provided',
      });
    }

    const accessSecret = this.configService.get<string>('jwt.accessSecret', {
      infer: true,
    });

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        email: string;
        role: string;
      }>(token, { secret: accessSecret });

      if (!payload?.sub || !payload?.email || !payload?.role) {
        throw new UnauthorizedException({
          code: 'INVALID_TOKEN',
          message: 'Token payload missing required claims',
        });
      }

      request.user = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      } satisfies JwtUser;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Token is invalid or expired',
      });
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}