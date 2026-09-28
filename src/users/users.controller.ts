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
import { Role } from '@prisma/client';
import { PaginationDto } from '../common/pagination/pagination.dto.js';
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
 * All endpoints are gated by `JwtAuthGuard` + `RolesGuard` with the ADMIN
 * role. The envelope interceptor (PR #4) is wired globally in `main.ts`
 * and wraps every successful response; `PaginatedResult` is recognized
 * and its pagination fields flow into `meta`.
 *
 * Spec §3 — every write endpoint requires ADMIN; password is never echoed
 * back (handled by UsersService / DTOs).
 */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateUserDto): Promise<UserResponse> {
    return this.usersService.create(dto);
  }

  @Get()
  @Roles(Role.ADMIN)
  async findAll(
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResult<UserResponse>> {
    return this.usersService.findAll(pagination.page, pagination.limit);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  async findOne(@Param('id') id: string): Promise<UserResponse> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string): Promise<{ id: string }> {
    return this.usersService.remove(id);
  }
}
