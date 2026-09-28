# Back-Template — Plan de Arquitectura

## Stack Tecnológico

- **Framework**: NestJS
- **Base de datos**: PostgreSQL
- **ORM**: Prisma
- **Autenticación**: JWT con Passport
- **Autorización**: Roles básicos (admin, user) — minimalista, escalable
- **Arquitectura**: Híbrido NestJS + feature-based
- **Testing**: Unit + Integration (Jest + @nestjs/testing)

---

## Arquitectura del Proyecto

Estructura híbrida: módulos autocontenidos por feature + código compartido bien organizado.

```
src/
  users/              # Módulo autocontenido (CRUD + perfil)
  auth/               # Módulo autocontenido (JWT + roles)
  common/             # Guards, filters, interceptors, pipes, decorators
  config/             # Configuración por ambiente
prisma/             # Servicio Prisma compartido
}

---

## Database Schema

Esquema Prisma inicial para autenticación y gestión de usuarios. Diseñado para ser la base sobre la cual cada proyecto agregue sus modelos de dominio.

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String
  name      String?
  role      Role     @default(USER)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

enum Role {
  USER
  ADMIN
}

model RefreshToken {
  id        String   @id @default(cuid())
  token     String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  expiresAt DateTime
  createdAt DateTime @default(now())
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  token     String    @unique
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
}
```

**Decisiones clave:**

- **Sin soft delete**: se usa `isActive` para suspender/activar usuarios. Mantiene el schema simple y evita queries complejas con `deletedAt IS NULL` en cada listado.
- **Roles como Enum** (`USER`, `ADMIN`): suficiente para un template minimalista. Si un proyecto necesita roles dinámicos, se extiende después.
- **Timestamps automáticos**: `createdAt` y `updatedAt` en todas las tablas operacionales.
- **Tablas de auth separadas**: `RefreshToken` y `PasswordResetToken` con relación a `User` para manejar rotación y revocación sin acoplarse al modelo principal.
- **Tokens opacos**: el `token` almacenado es el valor que viaja al usuario (hasheado opcionalmente si se necesita mayor seguridad).

---

## Autenticación Detallada

Flujo de autenticación JWT con refresh tokens y password reset, configurable por variables de entorno.

### Token Strategy (configurable)

- **Access token**: 30 minutos por defecto (configurable vía `JWT_ACCESS_EXPIRES_IN`)
- **Refresh token**: 30 días por defecto (configurable vía `JWT_REFRESH_EXPIRES_IN`)
- **Refresh deshabilitable**: `JWT_REFRESH_ENABLED=false` para proyectos simples donde alcanza con access tokens

### Configuración

```env
JWT_ACCESS_SECRET=your-secret-key
JWT_ACCESS_EXPIRES_IN=30m
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRES_IN=30d
JWT_REFRESH_ENABLED=true
AUTH_COOKIE_ENABLED=true
AUTH_COOKIE_SAMESITE=strict
```

### Password Reset Flow

1. El usuario solicita reset → se genera un token con expiración de **1 hora**
2. Se envía un email con link: `/reset-password?token=abc123`
3. El usuario ingresa la nueva contraseña
4. El token se invalida al usarse (`usedAt` se setea)
5. Tokens expirados o usados no pueden reutilizarse

### Storage Strategy (configurable)

- **Cookies httpOnly** (recomendado, default): `AUTH_COOKIE_ENABLED=true` — seguro contra XSS, funciona bien con SameSite
- **localStorage** (simple): `AUTH_COOKIE_ENABLED=false` — útil para SPAs que no pueden usar cookies fácilmente, menor seguridad

---

## Formato de Respuestas API

Todas las respuestas de la API siguen un envelope consistente. El formato de error ya está alineado con esta convención (ver sección *Manejo de Errores*).

### Envelope Format

**Success — recurso único:**

```typescript
{
  "success": true,
  "data": { "id": "abc123", "email": "user@example.com" },
  "meta": {
    "timestamp": "2026-09-28T10:30:00Z",
    "path": "/api/users/abc123"
  }
}
```

**Success — colección con paginación:**

```typescript
{
  "success": true,
  "data": [...],
  "meta": {
    "timestamp": "2026-09-28T10:30:00Z",
    "path": "/api/users",
    "total": 50,
    "page": 1,
    "limit": 10,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

**Error:**

```typescript
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [...]
  },
  "meta": {
    "timestamp": "2026-09-28T10:30:00Z",
    "path": "/api/users"
  }
}
```

### Implementación

- **Herramienta**: `ResponseInterceptor` global de NestJS
- **Comportamiento**:
  - Envuelve automáticamente toda respuesta exitosa en el envelope estándar
  - Si el controller retorna un `PaginatedResult`, el interceptor extrae los items a `data` y agrega metadata de paginación a `meta`
  - Se puede desactivar por endpoint con `@UseInterceptors()` si se necesita un response crudo

### Paginación

- **Estrategia**: Offset-based (`page` + `limit`)
- **Razón**: simple, predecible y suficiente para la mayoría de casos. Si un proyecto requiere cursor-based (scroll infinito, datasets enormes), se agrega después.

---

## Configuración

Validación al arrancar y configuración por módulos usando variables de entorno. Sin archivos de config separados por ambiente — solo `.env` por ambiente.

### Estrategia

- **Validación al arrancar**: si falta una variable crítica, la app no inicia
- **Todo en `.env`**: `DATABASE_URL`, `JWT_*`, `AUTH_*`, `PORT`, `NODE_ENV`
- **Config por módulos**: `database.config.ts`, `auth.config.ts`, `app.config.ts`
- **Sin config files por ambiente**: solo `.env` por ambiente (`.env.development`, `.env.production`)

### Implementación

```typescript
// src/config/configuration.ts
export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    accessToken: {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '30m',
    },
    refreshToken: {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
      enabled: process.env.JWT_REFRESH_ENABLED === 'true',
    },
  },
  auth: {
    cookie: {
      enabled: process.env.AUTH_COOKIE_ENABLED === 'true',
      sameSite: process.env.AUTH_COOKIE_SAMESITE || 'strict',
    },
  },
});

// src/config/config.validation.ts
export function validate(config: Record<string, unknown>) {
  const errors = [];
  if (!config.DATABASE_URL) errors.push('DATABASE_URL is required');
  if (!config.JWT_ACCESS_SECRET) errors.push('JWT_ACCESS_SECRET is required');
  if (errors.length) throw new Error(errors.join(', '));
  return config;
}
```

---

## Logging Estructurado

Pino sobre Winston — más rápido, JSON nativo y más simple para structured logging.

### Librería: pino (sobre Winston)

- **6x más rápido** que Winston
- **JSON nativo** para structured logging
- **Más moderno y simple**

### Implementación

```typescript
// src/common/logger/pino-logger.service.ts
import { Injectable, LoggerService } from '@nestjs/common';
import pino from 'pino';

@Injectable()
export class PinoLoggerService implements LoggerService {
  private logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty' }
      : undefined,
  });

  log(message: string, context?: string) {
    this.logger.info({ context }, message);
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error({ context, trace }, message);
  }

  warn(message: string, context?: string) {
    this.logger.warn({ context }, message);
  }

  debug(message: string, context?: string) {
    this.logger.debug({ context }, message);
  }
}
```

### Features

- **Integración**: Datadog, ELK, CloudWatch
- **Niveles**: debug, info, warn, error, fatal
- **Formato**: nivel, mensaje, timestamp, contexto, requestId, stack

---

## Manejo de Errores Detallado

Estrategia refinada: error codes estándar sin custom exceptions en el template. Custom exceptions se configuran por proyecto.

### Estrategia

- **Error codes estándar** definidos como constantes (`as const`)
- **Sin custom exceptions en el template** — cada proyecto agrega las suyas
- **Mapeo de errores de Prisma** → códigos HTTP consistentes

### Error Codes

```typescript
// src/common/constants/error-codes.ts
export const ErrorCodes = {
  // Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',

  // Users
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // General
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
```

### Prisma Error Mapping

```typescript
// src/common/filters/prisma-exception.filter.ts
// P2002 (unique constraint) → 409 Conflict
// P2025 (record not found) → 404 Not Found
// P2003 (foreign key constraint) → 400 Bad Request
```

### ExceptionFilter Global

- **Formato**: `{ success: false, error: { code, message, details }, meta }`
- **Consistente** con API Response Format (mismo envelope que errores en respuestas)
- **Custom exceptions**: configuradas por proyecto (no en el template)

---

## Estrategia de Testing

Tests al lado del código siguiendo la convención de NestJS. Sin mínimo estricto de cobertura para el template.

### Organización

Tests al lado del código (convención NestJS):

```
src/
  users/
    users.controller.ts
    users.controller.spec.ts  ← Test al lado
    users.service.ts
    users.service.spec.ts     ← Test al lado
```

### Layers

- **Unit tests**: Jest (milisegundos)
- **Integration tests**: Jest + `@nestjs/testing` (segundos)
- **E2E tests**: opcional por proyecto

### Coverage

Sin mínimo estricto para el template. Cada proyecto define su propia cobertura objetivo.

---

## Patrones de Validación

DTOs en carpeta `dto/` dentro de cada módulo, con `class-validator` + `class-transformer`.

### Organización

```
src/
  users/
    dto/
      create-user.dto.ts
      update-user.dto.ts
```

### Herramientas

- **class-validator + class-transformer** con `ValidationPipe` global
- **Custom validators** (ej: `@IsUnique`) configurados por proyecto, no en el template
- **Transformaciones automáticas**: trim, lowercase con `class-transformer`
- **`@Exclude()`** para excluir campos sensibles del response

### Ejemplo

```typescript
// src/users/dto/create-user.dto.ts
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsOptional()
  name?: string;
}
```

---

## Módulos y Features (orden de prioridad)

1. **Módulo de usuarios** (CRUD + perfil) — base del template
2. **Health check** (endpoint para monitoreo)
3. **Configuración** (variables de entorno, config por ambiente)
4. **Logging** (estructurado, niveles)
5. **Swagger/OpenAPI** (documentación automática de la API)
6. **Testing** (unit + integration)
7. **Docker** (Dockerfile, docker-compose para desarrollo)
8. **Seguridad**: Rate Limiting + Helmet + CORS
9. **Validación**: class-validator + class-transformer
10. **Manejo de errores**: Filtro global + Logging estructurado
11. **Performance**: Compresión + Timeout 1min

---

## Seguridad y Protección

### Rate Limiting
- **Herramienta**: `@nestjs/throttler`
- **Propósito**: Proteger contra brute force y abuso
- **Configuración típica**: 100 requests/minuto por IP (global), más restrictivo para login
- **Nota**: Requiere Redis en producción para tracking distribuido

### Helmet
- **Herramienta**: `helmet` (middleware de Express)
- **Propósito**: Headers HTTP de seguridad automáticos
- **Headers que agrega**: X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, Content-Security-Policy, etc.
- **Impacto**: Protección contra XSS, clickjacking, MIME sniffing con cero configuración

### CORS
- **Herramienta**: Built-in en NestJS
- **Propósito**: Control de orígenes permitidos
- **Configuración**: Whitelist de dominios en producción, localhost en desarrollo
- **Nota**: Esencial si el frontend está en un dominio diferente

---

## Validación y Transformación

### Validation (class-validator)
- **Herramienta**: `class-validator` + `ValidationPipe` global
- **Propósito**: Validación automática de DTOs con decoradores
- **Ejemplo**: `@IsEmail()`, `@MinLength(8)`, `@IsString()`
- **Beneficio**: Datos inválidos devuelven 400 automáticamente

### Transformación (class-transformer)
- **Herramienta**: `class-transformer` + `ClassSerializerInterceptor` global
- **Propósito**: Controlar qué campos se incluyen en responses
- **Ejemplo**: `@Exclude()` para excluir password del response
- **Beneficio**: Previene exposición accidental de datos sensibles

---

## Manejo de Errores

### Filtro Global de Excepciones
- **Herramienta**: ExceptionFilter custom de NestJS
- **Propósito**: Formato JSON consistente para todos los errores
- **Estructura**:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [...]
  },
  "timestamp": "2026-09-28T10:30:00Z",
  "path": "/api/users"
}
```

### Logging Estructurado
- **Herramienta**: `winston` o `pino`
- **Propósito**: Capturar errores con contexto rico para análisis y monitoreo
- **Formato**: JSON con nivel, mensaje, timestamp, contexto, requestId, stack
- **Niveles**: debug, info, warn, error, fatal
- **Integración**: Datadog, ELK, CloudWatch, etc.

---

## Performance y Monitoreo

### Compresión de Responses
- **Herramienta**: `compression` (middleware de Express)
- **Propósito**: Reducir tamaño de respuestas HTTP
- **Algoritmos**: gzip (compatible) o brotli (mejor compresión)
- **Beneficio**: Respuestas más rápidas, menos bandwidth

### Timeout de Requests
- **Configuración**: 1 minuto (60 segundos) por defecto para API REST
- **Propósito**: Prevenir requests colgados y proteger el server
- **Nota**: Para operaciones que tarden más (reportes, imports), hacerlas async

---

## Testing

### Unit Tests
- **Herramienta**: Jest (por defecto en NestJS)
- **Propósito**: Testear funciones/métodos individuales en aislamiento
- **Velocidad**: Milisegundos

### Integration Tests
- **Herramienta**: Jest + `@nestjs/testing`
- **Propósito**: Testear integración entre componentes (controller + service + DB)
- **Velocidad**: Segundos

**Nota**: E2E tests quedan como opcional por proyecto según necesidad.

---

## Decisiones de Diseño

### Filosofía
- **Minimalista pero robusto**: Lo indispensable bien hecho
- **Progresivo**: Agregar features incrementalmente
- **Escalable**: Estructura que crece sin romperse
- **Reutilizable**: Base para múltiples proyectos

### Principios
- Módulos autocontenidos (feature-based)
- Código compartido centralizado (common/, config/, prisma/)
- Seguridad desde el inicio (no agregar después)
- Testing como base (no como afterthought)
- Documentación automática (Swagger)

---

## Próximos Pasos

Orden ajustado según las decisiones refinadas de schema, auth, formato de respuestas, configuración, logging, errores, testing y validación.

1. Inicializar proyecto NestJS
2. Definir `schema.prisma` con modelos `User`, `RefreshToken` y `PasswordResetToken`, y ejecutar la primera migración
3. Configurar `JwtModule` con access + refresh tokens y variables de entorno (`JWT_*`)
4. Implementar `AuthModule`: login, refresh, validación de tokens, storage cookies/localStorage configurable
5. Implementar flujo de password reset (request + confirmación + invalidación)
6. Implementar `UsersModule` (CRUD + perfil) usando `isActive` para suspender/activar
7. Implementar `ResponseInterceptor` global con soporte para `PaginatedResult`
8. Configurar `ConfigurationModule` con validación al arrancar, `config/` por módulos y `.env` por ambiente
9. Integrar `PinoLoggerService` como logger global con formato JSON (`pino-pretty` en desarrollo)
10. Implementar `ExceptionFilter` global con error codes estándar y mapeo de errores de Prisma (P2002/P2025/P2003)
11. Configurar seguridad (rate limiting, helmet, CORS) y validación con `class-validator` + DTOs en `dto/`
12. Configurar performance (compresión, timeout) y health check
13. Documentar todo en Swagger/OpenAPI
14. Escribir tests (unit + integration) al lado del código (`*.spec.ts` junto al módulo)

### Pendientes por proyecto

- **Docker**: dejado pendiente en el template. Cada proyecto puede implementar según necesidad (single-stage, multi-stage, docker-compose con Redis, etc.)
- **E2E tests**: opcional según necesidad del proyecto

---

## Notas Adicionales

- **Fecha de planificación**: Septiembre 2026
- **Tipo de proyecto**: Template base reutilizable
- **Enfoque**: Backend funcional con lo mínimo indispensable pero bien hecho
- **Objetivo**: Ahorrar decisiones repetitivas en futuros proyectos
