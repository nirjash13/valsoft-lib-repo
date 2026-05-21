import { config as loadEnv } from "dotenv";
import type { Config } from "drizzle-kit";

// drizzle-kit doesn't auto-load .env.local (that's a Next.js convention).
// Load it explicitly so `pnpm db:migrate` works without manual env setup.
loadEnv({ path: ".env.local" });

// Prefer the unpooled (direct) connection for migrations: Neon's PgBouncer
// pooler runs in transaction mode and breaks DDL like `CREATE EXTENSION`,
// `CREATE TRIGGER`, and `SET LOCAL` ordering. drizzle-kit only ever runs
// short-lived migration sessions, so the unpooled endpoint is the right call.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set. " +
      "Copy .env.local.example to .env.local and fill in the values.",
  );
}

export default {
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
} satisfies Config;
