import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { toUserResponse, type UserResponse } from './dto/user-response.dto.js';

const BCRYPT_ROUNDS = 12;

/**
 * UsersService — CRUD over the `users` table.
 *
 * Contract (spec §3):
 * - CreateUserDto.password is bcrypt-hashed before storage.
 * - P2002 (unique email) → ConflictException(EMAIL_ALREADY_EXISTS, 409).
 * - P2025 (record not found on update/delete) → NotFoundException(USER_NOT_FOUND, 404).
 * - findOne / findAll / update / remove never include the password column.
 *   `toUserResponse()` strips the field defensively before returning.
 *
 * The envelope interceptor wraps the returned values into
 * `{ data, meta }`; `PaginatedResult` is recognized and its pagination
 * fields flow into `meta`.
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
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_EXISTS',
          message: `A user with email "${dto.email}" already exists`,
        });
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
        code: 'USER_NOT_FOUND',
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
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') {
          throw new NotFoundException({
            code: 'USER_NOT_FOUND',
            message: `User with id "${id}" not found`,
          });
        }
        if (err.code === 'P2002') {
          throw new ConflictException({
            code: 'EMAIL_ALREADY_EXISTS',
            message: `A user with that email already exists`,
          });
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
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException({
          code: 'USER_NOT_FOUND',
          message: `User with id "${id}" not found`,
        });
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
