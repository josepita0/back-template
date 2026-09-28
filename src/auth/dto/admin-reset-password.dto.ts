import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * GIVEN an AdminResetPasswordDto
 * THEN userId must reference an existing user (existence verified by AuthService)
 *
 * Spec §2 (Auth Module) — POST /auth/admin/reset-password payload contract.
 * Only admins can call this endpoint (enforced by RolesGuard).
 */
export class AdminResetPasswordDto {
  @ApiProperty({ example: 'ckl5g8b3p0001...' })
  @IsString({ message: 'userId must be a string' })
  @IsNotEmpty({ message: 'userId is required' })
  userId!: string;
}