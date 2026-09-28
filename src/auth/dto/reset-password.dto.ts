import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * GIVEN a ResetPasswordDto
 * THEN token must match a pending PasswordResetToken; newPassword must be
 * 8–128 chars
 *
 * Spec §2 (Auth Module) — POST /auth/reset-password payload contract.
 * The token is hashed (SHA-256) server-side before lookup; the plaintext
 * token is communicated out-of-band by the admin.
 */
export class ResetPasswordDto {
  @IsString({ message: 'token must be a string' })
  @IsNotEmpty({ message: 'token is required' })
  @MinLength(16)
  token!: string;

  @IsString({ message: 'newPassword must be a string' })
  @IsNotEmpty({ message: 'newPassword is required' })
  @MinLength(8, { message: 'newPassword must be at least 8 characters' })
  @MaxLength(128)
  newPassword!: string;
}