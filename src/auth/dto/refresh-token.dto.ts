import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * GIVEN a RefreshTokenDto
 * THEN refreshToken must be a non-empty string
 *
 * Spec §2 (Auth Module) — POST /auth/refresh payload contract.
 * The refresh token is presented in the body. When AUTH_COOKIE_ENABLED,
 * the controller may accept it from a cookie instead; this DTO still applies
 * to the body payload path.
 */
export class RefreshTokenDto {
  @ApiProperty({ minLength: 16, example: 'a1b2c3d4e5f6...hex-string-from-login' })
  @IsString({ message: 'refreshToken must be a string' })
  @IsNotEmpty({ message: 'refreshToken is required' })
  @MinLength(16)
  refreshToken!: string;
}