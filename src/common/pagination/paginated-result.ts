/**
 * PaginatedResult<T> — generic container for list endpoints.
 *
 * Used by services that paginate a Prisma query. The envelope interceptor
 * (src/common/interceptors/envelope.interceptor.ts) recognizes instances of
 * this class and extracts the pagination fields into the envelope `meta`,
 * keeping `data` as the `items` array.
 *
 * Spec §3 (Users Module) — GET /users?page&limit returns this shape.
 *
 * The static factory validates inputs and computes `totalPages` /
 * `hasNextPage` / `hasPreviousPage` so callers can't accidentally produce
 * inconsistent results.
 */
export class PaginatedResult<T> {
  readonly items: T[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;

  private constructor(params: {
    items: T[];
    total: number;
    page: number;
    limit: number;
  }) {
    this.items = params.items;
    this.total = params.total;
    this.page = params.page;
    this.limit = params.limit;
    this.totalPages = Math.max(1, Math.ceil(params.total / params.limit));
    this.hasNextPage = params.page < this.totalPages;
    this.hasPreviousPage = params.page > 1;
  }

  /**
   * Build a PaginatedResult from the raw list + total count returned by a
   * paginated Prisma query.
   *
   * GIVEN `page=1, limit=10` and `total=25` → totalPages=3, hasNextPage=true.
   * GIVEN `page=0` or `limit<=0` → throws (callers should validate at the
   * DTO layer; this is a defensive check).
   */
  static create<T>(items: T[], total: number, page: number, limit: number): PaginatedResult<T> {
    if (!Number.isInteger(page) || page < 1) {
      throw new Error(`PaginatedResult.create: page must be >= 1 (got ${page})`);
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`PaginatedResult.create: limit must be >= 1 (got ${limit})`);
    }
    if (!Number.isInteger(total) || total < 0) {
      throw new Error(`PaginatedResult.create: total must be >= 0 (got ${total})`);
    }
    return new PaginatedResult<T>({ items, total, page, limit });
  }
}
