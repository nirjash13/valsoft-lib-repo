import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema/index";

// Required for interactive transactions (SET LOCAL + dependent statements);
// neon-http throws "No transactions support in neon-http driver".
// Node.js < v22 has no built-in WebSocket; supply the ws shim for Vercel Node 20 functions.
neonConfig.webSocketConstructor = ws;

// --- Environment validation ---

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL environment variable is not set. " +
      "Copy .env.local.example to .env.local and fill in the value.",
  );
}

if (databaseUrl.startsWith("<") || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
  throw new Error(
    `DATABASE_URL looks like a placeholder ("${databaseUrl.slice(0, 32)}…"). Replace it in .env.local with a real Neon connection string of the form postgresql://<user>:<password>@<host>/<db>?sslmode=require`,
  );
}

// --- Drizzle client backed by the Neon WebSocket Pool ---

/**
 * Drizzle client backed by the Neon serverless WebSocket Pool.
 *
 * Uses @neondatabase/serverless Pool over WebSockets (not the neon-http driver).
 * This supports interactive transactions — required by withTenantTx, which must
 * issue SET LOCAL app.tenant_id and then run dependent queries in the same
 * transaction. The neon-http driver throws on db.transaction() calls.
 *
 * On Vercel: each serverless invocation connects, runs its transaction, and the
 * Pool is closed when the function exits. No connection storms — the Pool holds
 * at most one connection per function instance.
 */
const pool = new Pool({ connectionString: databaseUrl });

export const db: NeonDatabase<typeof schema> = drizzle(pool, { schema });
