import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Role, type User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { ErrorCodes } from '../common/constants/error-codes.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { toUserResponse, type UserResponse } from './dto/user-response.dto.js';

const BCRYPT_ROUNDS = 12;

/**
 * UsersService — CRUD over the `users` table.
 *
 * Contract (spec §3):
 * - CreateUserDto.password is bcrypt-hashed before storage.
 * - P2002 (unique email) → re-thrown as-is; the global PrismaExceptionFilter
 *   (src/common/filters/prisma-exception.filter.ts) maps it to 409
 *   EMAIL_ALREADY_EXISTS. The previous in-service mapping has been
 *   removed in PR #4 so the filter is the single source of truth.
 * - P2025 (record not found on update/delete) → re-thrown; same filter
 *   maps to 404 NOT_FOUND. Where a controller-level 404 needs a more
 *   specific message, the service throws NotFoundException explicitly
 *   with code USER_NOT_FOUND (e.g. findOne).
 * - findOne / findAll / update / remove never include the password
 *   column. `toUserResponse()` strips the field defensively.
 *
 * The envelope interceptor wraps returned values into `{ data, meta }`;
 * `PaginatedResult` is recognized and its pagination fields flow into
 * `meta`.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  async create(dto: CreateUserDto): Promise<UserResponse> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          password: passwordHash,
          name: dto.name,
          role: dto.role ?? Role.USER,
        },
      });

      this.logger.log(`created user id=${user.id} email=${user.email} role=${user.role}`);
      return toUserResponse(user);
    } catch (err) {
      // Prisma P2002 (unique email) → PrismaExceptionFilter (409 EMAIL_ALREADY_EXISTS).
      // Everything else → AllExceptionsFilter (500).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(
          `create failed: email "${dto.email}" already exists (Prisma P2002)`,
        );
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // findAll (paginated)
  // ---------------------------------------------------------------------------
  async findAll(page: number, limit: number): Promise<PaginatedResult<UserResponse>> {
    const skip = (page - 1) * limit;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: userSelectWithoutPassword,
      }),
      this.prisma.user.count(),
    ]);

    return PaginatedResult.create(items.map(toUserResponse), total, page, limit);
  }

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------
  async findOne(id: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSelectWithoutPassword,
    });

    if (!user) {
      throw new NotFoundException({
        code: ErrorCodes.USER_NOT_FOUND,
        message: `User with id "${id}" not found`,
      });
    }

    return toUserResponse(user);
  }

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  async update(id: string, dto: UpdateUserDto): Promise<UserResponse> {
    const data: Prisma.UserUpdateInput = {};

    if (dto.email !== undefined) data.email = dto.email;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.password !== undefined) {
      data.password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    }

    if (Object.keys(data).length === 0) {
      // No-op patch — return current user so the response is still meaningful.
      return this.findOne(id);
    }

    try {
      const user = await this.prisma.user.update({
        where: { id },
        data,
        select: userSelectWithoutPassword,
      });

      this.logger.log(`updated user id=${id} fields=${Object.keys(data).join(',')}`);
      return toUserResponse(user);
    } catch (err) {
      // P2025 → PrismaExceptionFilter (404 NOT_FOUND)
      // P2002 → PrismaExceptionFilter (409 EMAIL_ALREADY_EXISTS)
      // Both are 4xx client errors; the filter maps the canonical envelope.
      // We don't re-throw with our own ConflictException / NotFoundException
      // because that would override the filter's response shape.
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') {
          this.logger.warn(`update failed: user id=${id} not found (Prisma P2025)`);
        } else if (err.code === 'P2002') {
          this.logger.warn(`update failed: duplicate email on user id=${id} (Prisma P2002)`);
        }
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // remove (hard delete)
  // ---------------------------------------------------------------------------
  async remove(id: string): Promise<{ id: string }> {
    try {
      await this.prisma.user.delete({ where: { id } });
      this.logger.log(`deleted user id=${id}`);
      return { id };
    } catch (err) {
      // P2025 → PrismaExceptionFilter (404 NOT_FOUND)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        this.logger.warn(`delete failed: user id=${id} not found (Prisma P2025)`);
      }
      throw err;
    }
  }
}

/**
 * Shared SELECT for read paths — never returns the password column.
 * Kept in module scope so each read path uses the same projection.
 */
const userSelectWithoutPassword = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Helper type used implicitly by the `select` literal — re-exported so the
// controller and tests have a stable UserResponse type to assert against.
export type UserSelectResult = {
  [K in keyof typeof userSelectWithoutPassword]: User[K];
};