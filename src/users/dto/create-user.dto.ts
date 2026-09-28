import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

/**
 * GIVEN a CreateUserDto
 * THEN email must be a valid email; password must be 8–128 chars;
 *       name is optional; role defaults to USER (DB default) when omitted.
 *
 * Spec §3 (Users Module) — POST /users payload contract (ADMIN-only).
 * Passwords are hashed with bcrypt server-side before storage.
 */
export class CreateUserDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsNotEmpty({ message: 'email is required' })
  @MaxLength(255)
  email!: string;

  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password is required' })
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString({ message: 'name must be a string' })
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(Role, { message: 'role must be USER or ADMIN' })
  role?: Role;
}
