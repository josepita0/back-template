import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * GIVEN a LoginDto
 * THEN email must be a valid email; password must be a non-empty string
 *
 * Spec §2 (Auth Module) — POST /auth/login payload contract.
 */
export class LoginDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsNotEmpty({ message: 'email is required' })
  @MaxLength(255)
  email!: string;

  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password is required' })
  @MaxLength(128)
  password!: string;
}