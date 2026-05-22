#!/usr/bin/env node
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED missing");
  process.exit(1);
}
const pool = new Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
try {
  const t = await c.query(`
    SELECT t.id, t.name, t.created_at,
           (SELECT COUNT(*)::int FROM books b WHERE b.tenant_id = t.id AND b.deleted_at IS NULL) AS books,
           (SELECT COUNT(*)::int FROM members m WHERE m.tenant_id = t.id AND m.status = 'active') AS active_members
    FROM tenants t
    ORDER BY t.created_at
  `);
  console.log("tenants:");
  for (const row of t.rows) {
    console.log(
      `  ${row.id}  name=${row.name}  books=${row.books}  active_members=${row.active_members}  created_at=${row.created_at?.toISOString?.() ?? row.created_at}`,
    );
  }
} finally {
  c.release();
  await pool.end();
}
