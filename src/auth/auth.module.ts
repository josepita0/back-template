import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
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
 * ThrottlerModule is registered GLOBALLY in AppModule (PR #4); the
 * @Throttle override on POST /auth/login resolves against the global
 * registration. Spec §2 — login is 5 req/min per IP, default is 100/min.
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
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}