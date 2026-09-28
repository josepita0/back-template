// Prisma 7 requires connection config outside schema.prisma.
// This file is read by every `prisma` CLI command.
// `dotenv/config` loads .env before we read process.env.DATABASE_URL.
// `process.env.DATABASE_URL ?? ''` (not `env('DATABASE_URL')`) so commands that
// don't need a DB (e.g. `prisma generate`) don't fail when DATABASE_URL is unset.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});