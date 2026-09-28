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
 * Spec §3 (Users Module) — password NEVER in any response.
 */
export type UserResponse = Omit<User, 'password'>;

/**
 * Build a `UserResponse` from a Prisma `User` row. Strip the password hash
 * defensively (even if a query already excluded it, this is the canonical
 * boundary for the API surface).
 */
export const toUserResponse = (user: User | UserResponse): UserResponse => {
  const { password: _password, ...rest } = user as User;
  return rest as UserResponse;
};

/**
 * Re-export Prisma's `Role` enum so feature code can import both the DTO
 * and the role enum from the same module path.
 */
export { Role };
