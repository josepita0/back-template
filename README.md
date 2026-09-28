# back-template

> A production-ready NestJS 12 backend template with JWT auth, users CRUD, structured envelope responses, Pino logging, helmet+CORS+throttler, Terminus health probes, and Swagger.

The template favors **convention over configuration** — every project built on top of it inherits a consistent envelope response shape, error code surface, log structure, and security baseline, so feature work is mostly business logic instead of plumbing.

## Highlights

- **NestJS 12** + **Prisma 7** (stable, with `@prisma/adapter-pg`) + **PostgreSQL**
- **JWT auth** with rotating refresh tokens + admin-driven password reset (no SMTP dependency)
- **Role-based authorization** (`USER` / `ADMIN`) via a plain `CanActivate` guard
- **Envelope response format** — every successful response is `{ success: true, data, meta }`; every error is `{ success: false, error: { code, message, details? }, meta }`. Streams/files opt out via `@SkipEnvelope()`.
- **Pino structured logging** (JSON in production, pino-pretty in dev) with X-Request-Id correlation
- **Global error filters** that map Prisma `P2002` → 409, `P2025` → 404, `P2003` → 400, `HttpException` → canonical codes
- **Security baseline** — helmet, CORS, `@nestjs/throttler` (100/min default + 5/min on login)
- **Health probes** — `/health/live` (process) and `/health/ready` (DB ping via Terminus)
- **Swagger** at `/api/docs` (development on by default, production on only when `SWAGGER_ENABLED=true`)
- **Tests** — units alongside code, integration gated on `DATABASE_URL`

---

## Prerequisites

| Tool | Version |
|---|---|
| Node | **24.x** (engines.node: `>=24.0.0`) |
| PostgreSQL | 14+ (any modern Postgres) |
| npm | 10+ (or pnpm / yarn — examples use npm) |

If you don't have a local Postgres handy, integration tests skip gracefully — the rest of the suite still runs.

---

## Quick start

```bash
# 1. Install
npm ci

# 2. Configure environment (copy .env.example → .env, fill in secrets)
cp .env.example .env
$EDITOR .env

# 3. Generate the Prisma client + run the first migration
npx prisma migrate dev --name init

# 4. Start the server (development, watch mode)
npm run start:dev
```

The app listens on `http://localhost:3000` by default. The first time, the server logs a `Mapped {/auth/login, POST}` style line for every route.

### Required environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | `postgresql://user:pass@host:5432/db` |
| `JWT_ACCESS_SECRET` | yes | — | `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | yes | — | `openssl rand -base64 48` |
| `NODE_ENV` | no | `development` | `development` \| `production` \| `test` |
| `PORT` | no | `3000` | |
| `JWT_ACCESS_EXPIRES_IN` | no | `30m` | any `ms`-format duration |
| `JWT_REFRESH_EXPIRES_IN` | no | `30d` | |
| `JWT_REFRESH_ENABLED` | no | `true` | `true` to issue refresh tokens; `false` for single-token auth |
| `AUTH_COOKIE_ENABLED` | no | `false` | `true` to set refresh tokens as httpOnly cookies |
| `THROTTLE_TTL` | no | `60000` | global rate limit TTL in ms |
| `THROTTLE_LIMIT` | no | `100` | global rate limit per IP per TTL |
| `LOG_LEVEL` | no | `info` | pino levels: `trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal` |
| `CORS_ORIGINS` | no | `http://localhost:3000` | comma-separated allowlist |
| `SWAGGER_ENABLED` | no | `false` | `true` to expose `/api/docs` in production |

Startup fails fast with a clear error if a required variable is missing or empty — see `src/config/config.validation.ts`.

---

## Available scripts

| Script | What it does |
|---|---|
| `npm run start` | Boot once with the compiled `dist/` output (requires `build` first) |
| `npm run start:dev` | Watch-mode dev server (`nest start --watch`) |
| `npm run start:debug` | Dev with `--inspect-brk` for the Node debugger |
| `npm run start:prod` | Run `node dist/main` (assumes `npm run build` was run) |
| `npm run build` | Compile TypeScript via `nest build` → `dist/` |
| `npm run format` | Prettier over `src/` and `test/` |
| `npm run lint` | `oxlint --type-aware` over `src/` and `test/` |
| `npm test` | Vitest unit suite (integration tests skip without `DATABASE_URL`) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:cov` | Vitest with v8 coverage |
| `npm run test:e2e` | Reserved for a future `*.e2e-spec.ts` suite |

---

## API

The full OpenAPI document is served by Swagger UI when enabled:

- **Development:** `http://localhost:3000/api/docs` (always on)
- **Production:** `http://your-host/api/docs` (only when `SWAGGER_ENABLED=true`; otherwise `/api/docs` returns 404)
- **Raw JSON:** `http://localhost:3000/api/docs-json` (handy for codegen)

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/auth/login` | public | Email + password → access token (and refresh if enabled) |
| `POST` | `/auth/refresh` | public | Rotate refresh token → new tokens |
| `POST` | `/auth/admin/reset-password` | ADMIN | Generate a one-shot reset token for a user |
| `POST` | `/auth/reset-password` | public | Redeem reset token + new password |
| `POST` | `/auth/revoke-all` | bearer | Revoke every refresh token for the authenticated user |
| `POST` | `/users` | ADMIN | Create a user |
| `GET` | `/users` | ADMIN | Paginated list (`?page=1&limit=20`) |
| `GET` | `/users/:id` | ADMIN | Get a user by id |
| `PATCH` | `/users/:id` | ADMIN | Partial update |
| `DELETE` | `/users/:id` | ADMIN | Hard delete |
| `GET` | `/health/live` | public | Liveness probe (always 200 if process is up) |
| `GET` | `/health/ready` | public | Readiness probe — 200 if DB responds, 503 if not |

### Response shape

Every successful response is wrapped in an envelope:

```json
{
  "success": true,
  "data": { "...": "..." },
  "meta": {
    "timestamp": "2026-01-15T12:00:00.000Z",
    "path": "/users?page=1&limit=20"
  }
}
```

Paginated responses surface pagination fields in `meta`:

```json
{
  "success": true,
  "data": [ /* items */ ],
  "meta": {
    "timestamp": "2026-01-15T12:00:00.000Z",
    "path": "/users?page=1&limit=20",
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

Errors are returned in a parallel shape:

```json
{
  "success": false,
  "error": {
    "code": "EMAIL_ALREADY_EXISTS",
    "message": "A record with the same unique value already exists",
    "details": { "fields": ["email"] }
  },
  "meta": {
    "timestamp": "2026-01-15T12:00:00.000Z",
    "path": "/users"
  }
}
```

### Standard error codes

| Code | Status | When |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Bad email/password on login |
| `INVALID_TOKEN` | 401 | Missing/expired JWT, or invalid refresh token |
| `TOKEN_EXPIRED` | 400 | Used or expired reset token |
| `ACCOUNT_SUSPENDED` | 403 | `isActive=false` user tried to authenticate |
| `FORBIDDEN` | 403 | Authenticated but role mismatch |
| `USER_NOT_FOUND` | 404 | Explicit 404 from a service |
| `NOT_FOUND` | 404 | Generic 404 / Prisma P2025 |
| `EMAIL_ALREADY_EXISTS` | 409 | Unique-email collision (Prisma P2002) |
| `VALIDATION_ERROR` | 400 | DTO/class-validator failure or Prisma P2003 |
| `INTERNAL_ERROR` | 500 | Unhandled exception (no stack in production) |

---

## Health checks

Two probe paths tuned to k8s conventions:

- **`GET /health/live`** — liveness. Returns `200 { status: "ok" }` whenever the Node process is running. Deliberately does NOT touch the database; a transient DB outage shouldn't trigger pod restarts.
- **`GET /health/ready`** — readiness. Returns `200 { status: "ok", info: { database: { status: "up" } } }` when `SELECT 1` succeeds, `503 { status: "error", error: { database: { status: "down" } } }` otherwise. Use this to gate traffic until the DB is reachable.

Both are public — no auth, no throttling — so an orchestrator can probe them without credentials.

---

## Architecture

```
src/
├── main.ts                    # bootstrap — wires logger, helmet, CORS, ValidationPipe,
│                              #          filters, EnvelopeInterceptor, Swagger
├── app.module.ts              # root wiring + APP_GUARD ThrottlerGuard
│
├── config/                    # typed configuration factory + manual validator
│   ├── configuration.ts       #   reads process.env into an AppConfig object
│   └── config.validation.ts   #   fail-fast on missing required vars
│
├── prisma/                    # @Global() PrismaModule — PrismaService extends PrismaClient
│                              # with the @prisma/adapter-pg driver adapter (Prisma 7 mandate)
│
├── auth/                      # AuthModule — login, refresh, admin reset, user reset, revoke-all
│   ├── auth.controller.ts     #   POST /auth/login, /auth/refresh, /auth/admin/reset-password,
│   │                          #   /auth/reset-password, /auth/revoke-all
│   ├── auth.service.ts        #   SHA-256-hashed tokens, atomic $transaction rotation,
│   │                          #   bcrypt password hashing
│   ├── guards/                #   JwtAuthGuard (plain CanActivate, no Passport),
│   │                          #   RolesGuard
│   └── dto/                   #   class-validator DTOs (email, password, token, etc.)
│
├── users/                     # UsersModule — CRUD with envelope pagination
│   ├── users.controller.ts    #   GET/POST/PATCH/DELETE /users (ADMIN-only)
│   ├── users.service.ts       #   password never in response; P2002/P2025 delegated to
│   │                          #   global PrismaExceptionFilter
│   └── dto/                   #   CreateUserDto, UpdateUserDto (PartialType),
│                              #   UserResponse (password excluded)
│
├── health/                    # HealthModule — Terminus probes
│   ├── health.controller.ts   #   GET /health/live, /health/ready
│   └── prisma-db.indicator.ts #   custom DB indicator using PrismaService.$queryRawUnsafe
│
└── common/                    # shared cross-cutting infrastructure
    ├── common.module.ts       #   @Global() — exposes Reflector + ThrottlerModule providers
    ├── constants/             #   ErrorCodes const + HttpStatusByCode
    ├── filters/               #   AllExceptionsFilter + PrismaExceptionFilter
    │                          #   (registered globally in main.ts)
    ├── interceptors/          #   EnvelopeInterceptor (global) + @SkipEnvelope() opt-out
    ├── logger/                #   PinoLoggerService — NestJS LoggerService on top of pino
    ├── pagination/            #   PaginatedResult<T> utility + PaginationDto query binding
    └── decorators/           #   @SkipEnvelope() metadata
```

### Cross-cutting wiring (canonical order in `main.ts`)

1. `bufferLogs: true` on `NestFactory.create` → logs queue until logger attached
2. `useLogger(pinoLogger)` → NestJS logs routed through pino
3. `use(pinoLogger.httpMiddleware())` → request log line + X-Request-Id
4. `use(helmet())` → security headers
5. `enableCors({ origin, credentials })` → CORS from `CORS_ORIGINS`
6. `useGlobalPipes(new ValidationPipe({ whitelist, forbidNonWhitelisted, transform }))` → DTO validation
7. `useGlobalFilters(AllExceptionsFilter, PrismaExceptionFilter)` → Prisma filter registered LAST so it sees Prisma errors first
8. `useGlobalInterceptors(new EnvelopeInterceptor(reflector))` → every successful response wrapped
9. `SwaggerModule.setup` → only when `SWAGGER_ENABLED=true` or `NODE_ENV !== 'production'`
10. `APP_GUARD` (in AppModule) → ThrottlerGuard wired via `useFactory`

---

## Testing strategy

| Layer | Where | Approach | Needs DB? |
|---|---|---|---|
| **Unit** | `src/**/*.spec.ts` (co-located) | Mocked dependencies — services, guards, interceptors, filters | No |
| **Integration** | `test/*.integration.spec.ts` | Real `AppModule` + supertest + real PrismaService | **Yes** — `describe.skipIf(!process.env.DATABASE_URL)` |

### Run the suites

```bash
# Unit suite (always runs; integration tests skip when DATABASE_URL is unset)
npm test

# With a real Postgres — set DATABASE_URL in .env or inline
DATABASE_URL=postgresql://user:pass@localhost:5432/back_template npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:cov
```

### Integration suites shipped in this template

- **`test/auth.integration.spec.ts`** — login → refresh (atomic rotation verified) → admin reset → role gating (`USER` cannot `POST /users`) → health/ready
- **`test/users.integration.spec.ts`** — CRUD round-trip → duplicate email → 409 → pagination meta → unauthenticated 401
- **`test/throttler.spec.ts`** — 6th login within 60s returns 429

Each suite bootstraps an ADMIN directly via `PrismaService` (chicken-and-egg with `/users` being ADMIN-only), runs the scenarios, and cleans up rows tagged with a per-run marker in `afterAll`.

---

## Production checklist

Before deploying:

- [ ] Generate strong secrets: `openssl rand -base64 48` for both `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
- [ ] Run migrations against the production DB: `npx prisma migrate deploy`
- [ ] Set `NODE_ENV=production`
- [ ] Leave `SWAGGER_ENABLED=false` unless you intentionally want the API surface exposed (consider IP allowlisting at the proxy)
- [ ] Set `CORS_ORIGINS` to your real frontend origins (comma-separated)
- [ ] Adjust `THROTTLE_TTL` / `THROTTLE_LIMIT` to match expected traffic
- [ ] Set `AUTH_COOKIE_ENABLED=true` if you want refresh tokens in httpOnly cookies (production also gets the `Secure` flag)
- [ ] Point log aggregation at stdout — pino emits one JSON line per event with `requestId`, `level`, `time`, and the message

---

## License

[MIT](LICENSE) © josepita0