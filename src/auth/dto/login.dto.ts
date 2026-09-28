import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * GIVEN a LoginDto
 * THEN email must be a valid email; password must be a non-empty string
 *
 * Spec §2 (Auth Module) — POST /auth/login payload contract.
 */
export class LoginDto {
  @ApiProperty({ example: 'jane@example.com', maxLength: 255 })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsNotEmpty({ message: 'email is required' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ minLength: 1, maxLength: 128, example: 'plaintext-password' })
  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password is required' })
  @MaxLength(128)
  password!: string;
}