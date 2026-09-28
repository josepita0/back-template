import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PaginationDto } from '../common/pagination/pagination.dto.js';
import { CurrentUser, type JwtUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { type UserResponse } from './dto/user-response.dto.js';
import { UsersService } from './users.service.js';
import type { PaginatedResult } from '../common/pagination/paginated-result.js';

/**
 * UsersController — CRUD over the `users` resource.
 *
 * Class-level `JwtAuthGuard` requires every endpoint to be called with a
 * valid bearer token. `RolesGuard` is applied per-handler on the ADMIN-only
 * routes (`POST`, `GET`, `GET :id`, `PATCH :id`, `DELETE :id`); the
 * `GET /me` endpoint deliberately omits `RolesGuard` so any authenticated
 * user can read their own profile (spec §3 — "Any authenticated user reads
 * own profile via GET /users/me").
 *
 * The envelope interceptor (PR #4) is wired globally in `main.ts` and
 * wraps every successful response; `PaginatedResult` is recognized and its
 * pagination fields flow into `meta`.
 *
 * Spec §3 — ADMIN writes; password is never echoed back (handled by
 * UsersService / DTOs).
 */
@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get the authenticated user\u2019s own profile',
    description:
      'Any authenticated user can read their own profile. The id is taken from the JWT payload, so no path/query parameter is required.',
  })
  @ApiResponse({ status: 200, description: 'Profile returned.' })
  @ApiResponse({
    status: 401,
    description: 'INVALID_TOKEN — missing or expired access token.',
  })
  async getMyProfile(@CurrentUser() user: JwtUser): Promise<UserResponse> {
    return this.usersService.findOne(user.userId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a user (ADMIN)',
    description: 'Hashes the password server-side before storage.',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, description: 'User created.' })
  @ApiResponse({
    status: 409,
    description: 'EMAIL_ALREADY_EXISTS — email is taken.',
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN — caller is not an ADMIN.',
  })
  async create(@Body() dto: CreateUserDto): Promise<UserResponse> {
    return this.usersService.create(dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'List users with pagination (ADMIN)',
    description:
      'Returns a PaginatedResult; pagination fields (total, page, limit, totalPages, hasNextPage, hasPreviousPage) flow into the envelope meta.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 200, description: 'Paginated list of users.' })
  async findAll(
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResult<UserResponse>> {
    return this.usersService.findAll(pagination.page, pagination.limit);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get a user by id (ADMIN)' })
  @ApiResponse({ status: 200, description: 'User found.' })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND.' })
  async findOne(@Param('id') id: string): Promise<UserResponse> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Update a user (ADMIN)',
    description: 'Partial update — only provided fields are applied.',
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({ status: 200, description: 'User updated.' })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND.' })
  @ApiResponse({
    status: 409,
    description: 'EMAIL_ALREADY_EXISTS — new email is taken.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hard-delete a user (ADMIN)' })
  @ApiResponse({ status: 200, description: 'User deleted — returns the id.' })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND.' })
  async remove(@Param('id') id: string): Promise<{ id: string }> {
    return this.usersService.remove(id);
  }
}
