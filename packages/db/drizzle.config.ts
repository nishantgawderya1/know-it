import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are generated into supabase/migrations and applied with src/migrate.ts.
 * DDL runs over the direct connection — Supabase's transaction pooler cannot run it reliably.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: '../../supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
