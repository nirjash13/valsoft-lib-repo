#!/usr/bin/env node
// scripts/seed-circulation.mjs
//
// Inserts demo circulation data (2 loans + 1 hold) for the first seeded tenant.
// Idempotent: skips rows that already exist for the (tenant, book, member) tuple.
//
// Prerequisites:
//   - pnpm db:seed or equivalent must have run (tenants, books, members rows must exist).
//   - DATABASE_URL_UNPOOLED must be set in .env.local (neondb_owner, BYPASSRLS).
//
// Usage:
//   node --env-file=.env.local scripts/seed-circulation.mjs
//
// Connection model:
//   Uses DATABASE_URL_UNPOOLED (neondb_owner, BYPASSRLS=true) exclusively.
//   This bypasses RLS so the seed can write across tenant boundaries without
//   the SET LOCAL app.tenant_id / assert_tenant() machinery.
//   Never seeds through DATABASE_URL (stack_app, NOBYPASSRLS) — RLS would block it.
//
// Audit log:
//   Each insert writes an audit_log row in the same transaction:
//     loans  → action = 'loan.borrowed'  (matches borrow-book.ts domain function)
//     holds  → action = 'hold.placed'
//
// Idempotency checks:
//   loans: skip if an active loan (returned_at IS NULL) already exists for
//          (tenant_id, book_id, member_id).
//   holds: skip if an active hold (status IN ('queued', 'ready')) already exists
//          for (tenant_id, book_id, member_id).
//          Mirrors the partial unique index holds_active_unique in migration 0006.

import { randomUUID } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

// ---------------------------------------------------------------------------
// Guard: DATABASE_URL_UNPOOLED required; reject placeholders
// ---------------------------------------------------------------------------
const ownerUrl = process.env.DATABASE_URL_UNPOOLED;
if (!ownerUrl) {
  console.error(
    "ERROR: DATABASE_URL_UNPOOLED is not set.\n" +
      "Copy .env.local.example to .env.local and set DATABASE_URL_UNPOOLED " +
      "to the neondb_owner direct connection string.",
  );
  process.exit(1);
}
if (ownerUrl.startsWith("<") || !/^postgres(ql)?:\/\//.test(ownerUrl)) {
  console.error(
    `ERROR: DATABASE_URL_UNPOOLED looks like a placeholder: "${ownerUrl.slice(0, 40)}…"\nReplace it with a real Neon connection string (postgresql://...).`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mask password for log output. Never log credentials. */
function maskUrl(u) {
  try {
    const parsed = new URL(u);
    parsed.password = "***";
    return parsed.toString();
  } catch {
    return "<unparseable url>";
  }
}

/** Return now() minus `days` days as a JS Date. */
function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Return now() plus `days` days as a JS Date. */
function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// seedLoan — insert one loan + audit_log row in a single transaction.
// Idempotency: skips if an active (returned_at IS NULL) loan already exists
// for (tenant_id, book_id, member_id).
// ---------------------------------------------------------------------------
async function seedLoan(client, { tenantId, book, member, actorId, checkedOutAt, dueAt, label }) {
  const existing = await client.query(
    `SELECT id FROM loans
     WHERE tenant_id = $1
       AND book_id   = $2
       AND member_id = $3
       AND returned_at IS NULL
     LIMIT 1`,
    [tenantId, book.id, member.id],
  );
  if (existing.rowCount > 0) {
    console.log(`  ${label}: already present — skipping`);
    return;
  }

  const loanId = randomUUID();

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO loans
         (id, tenant_id, book_id, member_id, librarian_id, checked_out_at, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [loanId, tenantId, book.id, member.id, actorId, checkedOutAt, dueAt],
    );

    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_id, action, subject_type, subject_id, after_json)
       VALUES ($1, $2, 'loan.borrowed', 'loan', $3, $4)`,
      [
        tenantId,
        actorId,
        loanId,
        JSON.stringify({
          loan_id: loanId,
          book_id: book.id,
          member_id: member.id,
          checked_out_at: checkedOutAt.toISOString(),
          due_at: dueAt.toISOString(),
        }),
      ],
    );

    await client.query("COMMIT");
    console.log(`  ${label}: inserted (id=${loanId})`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// seedHold — insert one hold + audit_log row in a single transaction.
// Idempotency: skips if an active (status IN ('queued','ready')) hold already
// exists for (tenant_id, book_id, member_id).
// Mirrors the partial unique index holds_active_unique from migration 0006.
// ---------------------------------------------------------------------------
async function seedHold(client, { tenantId, book, member, actorId, label }) {
  const existing = await client.query(
    `SELECT id FROM holds
     WHERE tenant_id = $1
       AND book_id   = $2
       AND member_id = $3
       AND status IN ('queued', 'ready')
     LIMIT 1`,
    [tenantId, book.id, member.id],
  );
  if (existing.rowCount > 0) {
    console.log(`  ${label}: already present — skipping`);
    return;
  }

  const holdId = randomUUID();
  const queuedAt = new Date();

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO holds
         (id, tenant_id, book_id, member_id, status, queued_at)
       VALUES ($1, $2, $3, $4, 'queued', $5)`,
      [holdId, tenantId, book.id, member.id, queuedAt],
    );

    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_id, action, subject_type, subject_id, after_json)
       VALUES ($1, $2, 'hold.placed', 'hold', $3, $4)`,
      [
        tenantId,
        actorId,
        holdId,
        JSON.stringify({
          hold_id: holdId,
          book_id: book.id,
          member_id: member.id,
          status: "queued",
          queued_at: queuedAt.toISOString(),
        }),
      ],
    );

    await client.query("COMMIT");
    console.log(`  ${label}: inserted (id=${holdId})`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main — wrapped in async function to allow early-exit via process.exit(1)
// after cleanup, and to avoid top-level return (illegal in ES modules).
// ---------------------------------------------------------------------------
async function main() {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  const client = await pool.connect();

  console.log(`seed-circulation: connecting to ${maskUrl(ownerUrl)}`);

  try {
    // -----------------------------------------------------------------------
    // 1. Resolve demo tenant — prefer the canonical demo slug if present,
    //    otherwise the oldest tenant that actually has at least 3 books and
    //    3 active members. Falling back to "oldest tenant" without those
    //    counts breaks when integration tests leave empty "Verify A/B" rows.
    // -----------------------------------------------------------------------
    const tenantRes = await client.query(
      `SELECT t.id, t.name
       FROM tenants t
       WHERE (
         SELECT COUNT(*) FROM books b
         WHERE b.tenant_id = t.id AND b.deleted_at IS NULL
       ) >= 3
       AND (
         SELECT COUNT(*) FROM members m
         WHERE m.tenant_id = t.id AND m.status = 'active'
       ) >= 3
       ORDER BY (t.slug = 'stack-public') DESC, t.created_at ASC
       LIMIT 1`,
    );
    if (tenantRes.rowCount === 0) {
      console.error(
        "ERROR: No tenant has ≥3 books and ≥3 active members. Run pnpm db:seed:demo first.",
      );
      process.exitCode = 1;
      return;
    }
    const tenant = tenantRes.rows[0];
    const tenantId = tenant.id;
    console.log(`  tenant: ${tenant.name} (${tenantId})`);

    // -----------------------------------------------------------------------
    // 2. Fetch demo books — need at least 3 distinct non-deleted books.
    //    Oldest 3 by created_at for determinism across re-runs.
    // -----------------------------------------------------------------------
    const booksRes = await client.query(
      `SELECT id, title FROM books
       WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY created_at
       LIMIT 3`,
      [tenantId],
    );
    if (booksRes.rowCount < 3) {
      console.error(
        `ERROR: Need at least 3 books for the demo tenant (found ${booksRes.rowCount}). Run pnpm db:seed first.`,
      );
      process.exitCode = 1;
      return;
    }
    const [book1, book2, book3] = booksRes.rows;
    console.log(`  books: "${book1.title}" | "${book2.title}" | "${book3.title}"`);

    // -----------------------------------------------------------------------
    // 3. Fetch demo members — need at least 3 distinct active members.
    // -----------------------------------------------------------------------
    const membersRes = await client.query(
      `SELECT id, display_name FROM members
       WHERE tenant_id = $1 AND status = 'active'
       ORDER BY created_at
       LIMIT 3`,
      [tenantId],
    );
    if (membersRes.rowCount < 3) {
      console.error(
        `ERROR: Need at least 3 active members for the demo tenant (found ${membersRes.rowCount}). Run pnpm db:seed first.`,
      );
      process.exitCode = 1;
      return;
    }
    const [member1, member2, member3] = membersRes.rows;
    console.log(
      `  members: "${member1.display_name}" | "${member2.display_name}" | "${member3.display_name}"`,
    );

    // Seed actor representing the librarian in the demo context.
    const seedActorId = "seed:system";

    // -----------------------------------------------------------------------
    // 4. LOAN 1 — active, within loan window (checked out 7 days ago, due 7 days from now)
    // -----------------------------------------------------------------------
    await seedLoan(client, {
      tenantId,
      book: book1,
      member: member1,
      actorId: seedActorId,
      checkedOutAt: daysAgo(7),
      dueAt: daysFromNow(7),
      label: "LOAN 1 (active, on-time)",
    });

    // -----------------------------------------------------------------------
    // 5. LOAN 2 — overdue (checked out 21 days ago, due 7 days ago)
    // -----------------------------------------------------------------------
    await seedLoan(client, {
      tenantId,
      book: book2,
      member: member2,
      actorId: seedActorId,
      checkedOutAt: daysAgo(21),
      dueAt: daysAgo(7),
      label: "LOAN 2 (overdue)",
    });

    // -----------------------------------------------------------------------
    // 6. HOLD 1 — queued, first in line (queue position implicit via queued_at).
    //    Note: the holds table uses FIFO ordering by queued_at; there is no
    //    queue_position column — position is derived at query time.
    // -----------------------------------------------------------------------
    await seedHold(client, {
      tenantId,
      book: book3,
      member: member3,
      actorId: seedActorId,
      label: "HOLD 1 (queued)",
    });

    console.log("\nseed-circulation: done.");
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
