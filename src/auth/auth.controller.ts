import type { Request, Response } from 'express';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { AppConfig } from '../config/configuration.js';
import { AuthService } from './auth.service.js';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { CurrentUser, type JwtUser } from './decorators/current-user.decorator.js';
import { Roles } from './decorators/roles.decorator.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';

interface CookieBag {
  name: string;
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    path: string;
    maxAge?: number;
  };
}

const REFRESH_COOKIE_NAME = 'rt';

/**
 * AuthController — POST endpoints for the auth module.
 *
 * Throttling: spec §2 mandates 5 req/min on POST /auth/login. The global
 * ThrottlerModule is wired in PR #4; the @Throttle override here is what
 * will be picked up once the module is registered. It's safe to declare
 * now because @nestjs/throttler reads metadata regardless of whether the
 * module is loaded.
 *
 * Cookie storage: when AUTH_COOKIE_ENABLED=true, refresh tokens are set as
 * an httpOnly cookie (Secure in production, SameSite=strict). Otherwise
 * the token is returned in the response body.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto.email, dto.password);
    this.applyRefreshCookie(response, result.refreshToken);
    return result;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Prefer cookie if present, otherwise accept the body payload.
    const cookieToken = this.readRefreshCookie(request);
    const token = cookieToken ?? dto.refreshToken;

    const result = await this.authService.refreshToken(token);
    this.applyRefreshCookie(response, result.refreshToken);
    return result;
  }

  @Post('admin/reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async adminResetPassword(
    @CurrentUser() admin: JwtUser,
    @Body() dto: AdminResetPasswordDto,
  ) {
    return this.authService.adminResetPassword(admin.userId, dto.userId);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Post('revoke-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async revokeAll(@CurrentUser() user: JwtUser) {
    return this.authService.revokeAllRefreshTokens(user.userId);
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------
  private get cookie(): CookieBag {
    const enabled = this.configService.get<boolean>('auth.cookieEnabled', { infer: true });
    const isProd = this.configService.get<string>('nodeEnv', { infer: true }) === 'production';
    return {
      name: REFRESH_COOKIE_NAME,
      options: {
        httpOnly: true,
        secure: isProd,
        sameSite: 'strict',
        path: '/auth',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30d — matches default JWT_REFRESH_EXPIRES_IN
      },
    };
  }

  private applyRefreshCookie(response: Response, refreshToken?: string): void {
    const { name, options } = this.cookie;
    if (!this.configService.get<boolean>('auth.cookieEnabled', { infer: true })) {
      return;
    }
    if (!refreshToken) {
      response.clearCookie(name, options);
      return;
    }
    response.cookie(name, refreshToken, options);
  }

  private readRefreshCookie(request: Request): string | undefined {
    const { name } = this.cookie;
    return (request.cookies as Record<string, string | undefined> | undefined)?.[name];
  }
}