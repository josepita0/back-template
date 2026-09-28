import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppConfig } from '../config/configuration.js';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 48;
const RESET_TOKEN_BYTES = 32;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * SHA-256 of an opaque secret (refresh token or password-reset token) so
 * the database never stores the plaintext that the client presents.
 */
const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const stripPassword = <T extends { password: string }>(user: T): Omit<T, 'password'> => {
  const { password: _password, ...rest } = user;
  return rest;
};

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface LoginResult extends AuthTokens {
  user: Omit<User, 'password'>;
}

export interface RefreshResult extends AuthTokens {
  user: Omit<User, 'password'>;
}

/**
 * AuthService — credential validation, token issuance, rotation, and the
 * admin-driven password-reset flow.
 *
 * Contract (spec §2):
 * - login returns tokens + user without password
 * - inactive users → 403 ACCOUNT_SUSPENDED
 * - refresh rotates atomically (delete-old + create-new in a transaction)
 * - reset password invalidates all refresh tokens for the user
 * - reset tokens are stored as SHA-256 hashes
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  // ---------------------------------------------------------------------------
  // login
  // ---------------------------------------------------------------------------
  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Same error message as wrong-password to avoid leaking which emails exist.
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    if (!user.isActive) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Account is suspended. Contact an administrator.',
      });
    }

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    const accessToken = await this.signAccessToken(user);

    const result: LoginResult = {
      accessToken,
      user: stripPassword(user),
    };

    if (this.configService.get<boolean>('jwt.refreshEnabled', { infer: true })) {
      const refreshToken = await this.issueRefreshToken(user.id);
      result.refreshToken = refreshToken;
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // refresh (atomic rotation)
  // ---------------------------------------------------------------------------
  async refreshToken(refreshToken: string): Promise<RefreshResult> {
    const tokenHash = sha256(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!existing || existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }

    if (!existing.user.isActive) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Account is suspended. Contact an administrator.',
      });
    }

    const refreshExpiresIn = this.configService.get<string>(
      'jwt.refreshExpiresIn',
      { infer: true },
    );

    // Atomic rotation: delete-old + create-new in a single transaction so
    // there's no gap with zero tokens.
    const newPlain = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const newHash = sha256(newPlain);
    const expiresAt = this.computeExpiry(refreshExpiresIn);

    const [, created] = await this.prisma.$transaction([
      this.prisma.refreshToken.delete({ where: { id: existing.id } }),
      this.prisma.refreshToken.create({
        data: {
          token: newHash,
          userId: existing.userId,
          expiresAt,
        },
      }),
    ]);

    // Trigger a logger signal that the token was rotated (helps audit traces).
    this.logger.log(
      `refresh token rotated for userId=${existing.userId} oldId=${existing.id} newId=${created.id}`,
    );

    const accessToken = await this.signAccessToken(existing.user);

    return {
      accessToken,
      refreshToken: newPlain,
      user: stripPassword(existing.user),
    };
  }

  // ---------------------------------------------------------------------------
  // adminResetPassword
  // ---------------------------------------------------------------------------
  async adminResetPassword(
    _adminUserId: string,
    targetUserId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) {
      throw new BadRequestException({
        code: 'USER_NOT_FOUND',
        message: `User with id "${targetUserId}" not found`,
      });
    }

    const raw = randomBytes(RESET_TOKEN_BYTES).toString('hex');
    const hash = sha256(raw);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await this.prisma.passwordResetToken.create({
      data: {
        token: hash,
        userId: targetUserId,
        expiresAt,
      },
    });

    return { token: raw, expiresAt };
  }

  // ---------------------------------------------------------------------------
  // resetPassword
  // ---------------------------------------------------------------------------
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ userId: string }> {
    const hash = sha256(token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token: hash },
      include: { user: true },
    });

    if (!record || record.usedAt !== null) {
      throw new BadRequestException({
        code: 'TOKEN_EXPIRED',
        message: 'Reset token is invalid or has already been used',
      });
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: 'TOKEN_EXPIRED',
        message: 'Reset token has expired',
      });
    }

    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // Transaction: update password, mark token used, revoke all refresh tokens.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { password: hashed },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId: record.userId } }),
    ]);

    return { userId: record.userId };
  }

  // ---------------------------------------------------------------------------
  // revokeAllRefreshTokens
  // ---------------------------------------------------------------------------
  async revokeAllRefreshTokens(userId: string): Promise<{ count: number }> {
    const { count } = await this.prisma.refreshToken.deleteMany({ where: { userId } });
    return { count };
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------
  private async signAccessToken(user: Pick<User, 'id' | 'email' | 'role'>): Promise<string> {
    const payload = { sub: user.id, email: user.email, role: user.role as Role };
    const expiresIn = this.configService.get<string>('jwt.accessExpiresIn', { infer: true });
    // expiresIn is a template-literal type from `ms`; cast from the loose
    // env-string union we receive from ConfigService.
    return this.jwtService.signAsync(payload, { expiresIn: expiresIn as unknown as number });
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const hash = sha256(raw);
    const expiresIn = this.configService.get<string>('jwt.refreshExpiresIn', { infer: true });
    const expiresAt = this.computeExpiry(expiresIn);

    await this.prisma.refreshToken.create({
      data: { token: hash, userId, expiresAt },
    });

    return raw;
  }

  /**
   * Translate a JWT-style duration string ("30m", "12h", "7d", "60s") into a
   * concrete `Date`. Falls back to 30 days if the format is unrecognized so
   * we never silently store a token with no expiry.
   */
  private computeExpiry(duration: string): Date {
    const match = /^(\d+)([smhd])$/.exec(duration.trim());
    if (!match) {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    const value = Number(match[1]);
    const unit = match[2];
    const ms =
      unit === 's'
        ? value * 1000
        : unit === 'm'
          ? value * 60 * 1000
          : unit === 'h'
            ? value * 60 * 60 * 1000
            : value * 24 * 60 * 60 * 1000;
    return new Date(Date.now() + ms);
  }
}