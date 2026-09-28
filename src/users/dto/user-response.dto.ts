import { ApiProperty } from '@nestjs/swagger';
import { Role, User } from '@prisma/client';

/**
 * UserResponseDto — the shape returned to clients. Never includes the
 * password hash.
 *
 * We export both a runtime instance factory (`toUserResponse`) and a
 * type alias. The type is a structural subset of the Prisma `User`
 * type with `password` removed, so existing services can return
 * `Omit<User, 'password'>` directly without conversion.
 *
 * The `@ApiProperty` decorators are picked up by Swagger to produce
 * the OpenAPI schema; they don't affect runtime behavior.
 *
 * Spec §3 (Users Module) — password NEVER in any response.
 */
export class UserResponse {
  @ApiProperty({ format: 'cuid', example: 'ckl5g8b3p0001...', description: 'cuid identifier' })
  id!: string;

  @ApiProperty({ example: 'jane@example.com' })
  email!: string;

  @ApiProperty({ example: 'Jane Doe', required: false, nullable: true })
  name!: string | null;

  @ApiProperty({ enum: Role, example: Role.USER })
  role!: Role;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-01-15T12:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time', example: '2026-01-15T12:00:00.000Z' })
  updatedAt!: Date;
}

/**
 * Build a `UserResponse` from a Prisma `User` row (or a Prisma
 * `select`-narrowed subset that already omits `password`). Strips the
 * password hash defensively — even when a query already excluded it,
 * this is the canonical boundary for the API surface.
 */
export const toUserResponse = (user: User | Omit<User, 'password'>): UserResponse => {
  const { password: _password, ...rest } = user as User;
  return rest as unknown as UserResponse;
};

// Keep the type-alias around for code that already destructures
// `Omit<User, 'password'>` and assigns directly to the controller
// response — the class shape is structurally compatible at runtime.
export type UserResponseType = Omit<User, 'password'>;

/**
 * Re-export Prisma's `Role` enum so feature code can import both the DTO
 * and the role enum from the same module path.
 */
export { Role };
