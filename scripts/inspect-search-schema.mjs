#!/usr/bin/env node
// One-shot check that Spec 05 search objects exist with RLS FORCED.
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
  const rls = await c.query(`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN ('book_embeddings', 'search_zero_result_log')
    ORDER BY relname
  `);
  console.log("RLS on new tables:");
  for (const r of rls.rows) {
    console.log(`  ${r.relname}  rowsecurity=${r.relrowsecurity}  force=${r.relforcerowsecurity}`);
  }

  const tsv = await c.query(`
    SELECT column_name, is_generated, generation_expression
    FROM information_schema.columns
    WHERE table_name = 'books' AND column_name = 'tsv'
  `);
  console.log("books.tsv column:");
  for (const r of tsv.rows) {
    console.log(`  ${r.column_name}  generated=${r.is_generated}`);
  }

  const idx = await c.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename IN ('books', 'book_embeddings', 'search_zero_result_log')
      AND indexname LIKE ANY (ARRAY['books_tsv%', 'books_%trgm', 'book_embeddings_%', 'search_zero%'])
    ORDER BY indexname
  `);
  console.log("search indexes:");
  for (const r of idx.rows) console.log(`  ${r.indexname}`);
} finally {
  c.release();
  await pool.end();
}
