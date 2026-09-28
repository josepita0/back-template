import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * UsersModule — CRUD over the `users` table.
 *
 * Imports AuthModule so the JwtAuthGuard + RolesGuard can be reused without
 * re-declaring their providers (auth exports both guards).
 *
 * PrismaModule is global (PR #1), so UsersService can inject PrismaService
 * directly without re-importing it here.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
