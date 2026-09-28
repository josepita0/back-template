import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * PaginationDto — query-string binding for paginated list endpoints.
 *
 * Applied with `@Query() query: PaginationDto` on the controller method.
 * class-validator + class-transformer (both already used by the auth DTOs)
 * coerce and validate the raw query strings.
 *
 * Defaults match the spec's expected list-shape (`page=1&limit=20`); the
 * upper bound on `limit` prevents accidental huge scans.
 *
 * Spec §3 (Users Module) — GET /users?page&limit accepts this DTO.
 */
export class PaginationDto {
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be >= 1' })
  page: number = 1;

  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be >= 1' })
  @Max(100, { message: 'limit must be <= 100' })
  limit: number = 20;
}
