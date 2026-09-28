import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto.js';

/**
 * UpdateUserDto — PartialType of CreateUserDto.
 *
 * All fields become optional; class-validator still runs the same rules on
 * whatever fields are present. Email and password follow the same rules as
 * on create; the service layer re-hashes the password if it changed.
 *
 * Using `@nestjs/swagger`'s `PartialType` (not `@nestjs/mapped-types`)
 * so Swagger's CLI plugin generates the OpenAPI schema with `required: false`
 * on every inherited field.
 *
 * Spec §3 (Users Module) — PATCH /users/:id payload contract (ADMIN-only).
 */
export class UpdateUserDto extends PartialType(CreateUserDto) {}
