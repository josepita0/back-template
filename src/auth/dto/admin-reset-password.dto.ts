import { IsNotEmpty, IsString } from 'class-validator';

/**
 * GIVEN an AdminResetPasswordDto
 * THEN userId must reference an existing user (existence verified by AuthService)
 *
 * Spec §2 (Auth Module) — POST /auth/admin/reset-password payload contract.
 * Only admins can call this endpoint (enforced by RolesGuard).
 */
export class AdminResetPasswordDto {
  @IsString({ message: 'userId must be a string' })
  @IsNotEmpty({ message: 'userId is required' })
  userId!: string;
}