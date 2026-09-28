import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import type { AppConfig } from '../config/configuration.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';

/**
 * AuthModule — wires JWT verification (plain JwtAuthGuard using
 * @nestjs/jwt's JwtService), token issuance (JwtModule.registerAsync),
 * guards (JwtAuthGuard, RolesGuard), and the AuthService. Exports AuthService
 * + guards so other modules can reuse the role-based access control.
 *
 * ThrottlerModule is registered locally to ensure @Throttle() metadata on
 * the login route resolves even before the global wiring lands in PR #4.
 * Spec §2 — login is 5 req/min per IP.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        secret: configService.get<string>('jwt.accessSecret', { infer: true }),
        signOptions: {
          // expiresIn is a template-literal type from `ms`; the loose env
          // string union from ConfigService needs a cast.
          expiresIn: configService.get<string>('jwt.accessExpiresIn', {
            infer: true,
          }) as unknown as number,
        },
      }),
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 5,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}