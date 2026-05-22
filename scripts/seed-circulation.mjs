#!/usr/bin/env node
// scripts/seed-circulation.mjs
//
// Inserts a realistic spread of circulation data for the demo tenant:
//   ~14 active loans  (varied due dates, several within 3 days)
//   ~6  overdue loans (due in the past, not returned)
//   ~12 returned/historical loans (spread across last ~90 days for trend charts)
//   ~6  holds (mix of 'queued' and 'ready')
//
// Idempotent: skips rows that already exist for the (tenant, book, member) tuple.
//
// Prerequisites:
//   - seed-demo.mjs must have run (tenants, books, members rows must exist).
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
//     active loans   → action = 'loan.borrowed'  (matches borrow-book.ts)
//     returned loans → action = 'loan.returned'  (matches return-book.ts)
//     holds          → action = 'hold.placed'    (matches place-hold.ts)
//
// Idempotency checks:
//   loans: skip if an active loan (returned_at IS NULL) already exists for
//          (tenant_id, book_id, member_id).
//   returned loans: skip if ANY loan (including returned) already exists for
//          (tenant_id, book_id, member_id) with a matching checked_out_at.
//   holds: skip if an active hold (status IN ('queued', 'ready')) already exists
//          for (tenant_id, book_id, member_id).

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

/**
 * Pick book and member by round-robin index.
 * @param {Array} arr
 * @param {number} i
 */
function pick(arr, i) {
  return arr[i % arr.length];
}

// ---------------------------------------------------------------------------
// seedLoan — insert one active loan + audit_log row in a single transaction.
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
// seedReturnedLoan — insert a completed (returned) loan with both
// loan.borrowed and loan.returned audit rows in a single transaction.
// Idempotency: skips if any loan with the same (tenant_id, book_id, member_id,
// checked_out_at) already exists (handles both active and returned duplicates).
// ---------------------------------------------------------------------------
async function seedReturnedLoan(
  client,
  { tenantId, book, member, actorId, checkedOutAt, dueAt, returnedAt, label },
) {
  const existing = await client.query(
    `SELECT id FROM loans
     WHERE tenant_id    = $1
       AND book_id      = $2
       AND member_id    = $3
       AND checked_out_at = $4
     LIMIT 1`,
    [tenantId, book.id, member.id, checkedOutAt],
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
         (id, tenant_id, book_id, member_id, librarian_id,
          checked_out_at, due_at, returned_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [loanId, tenantId, book.id, member.id, actorId, checkedOutAt, dueAt, returnedAt],
    );

    // Borrow audit row
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_id, action, subject_type, subject_id, after_json, occurred_at)
       VALUES ($1, $2, 'loan.borrowed', 'loan', $3, $4, $5)`,
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
        checkedOutAt,
      ],
    );

    // Return audit row — action string matches return-book.ts line 59
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_id, action, subject_type, subject_id, after_json, occurred_at)
       VALUES ($1, $2, 'loan.returned', 'loan', $3, $4, $5)`,
      [
        tenantId,
        actorId,
        loanId,
        JSON.stringify({
          loan_id: loanId,
          book_id: book.id,
          member_id: member.id,
          returned_at: returnedAt.toISOString(),
        }),
        returnedAt,
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
async function seedHold(client, { tenantId, book, member, actorId, status, label }) {
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
  const holdStatus = status ?? "queued";

  // For 'ready' holds, set a readyUntil 3 days from now.
  const readyUntil = holdStatus === "ready" ? daysFromNow(3) : null;

  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO holds
         (id, tenant_id, book_id, member_id, status, queued_at, ready_until)
       VALUES ($1, $2, $3, $4, $5::hold_status, $6, $7)`,
      [holdId, tenantId, book.id, member.id, holdStatus, queuedAt, readyUntil],
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
          status: holdStatus,
          queued_at: queuedAt.toISOString(),
        }),
      ],
    );

    await client.query("COMMIT");
    console.log(`  ${label}: inserted (id=${holdId}, status=${holdStatus})`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  const client = await pool.connect();

  console.log(`seed-circulation: connecting to ${maskUrl(ownerUrl)}`);

  try {
    // -----------------------------------------------------------------------
    // 1. Resolve demo tenant — prefer the canonical demo slug if present,
    //    otherwise the oldest tenant with ≥3 books and ≥3 active members.
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
    // 2. Fetch up to 40 books for wide distribution.
    // -----------------------------------------------------------------------
    const booksRes = await client.query(
      `SELECT id, title FROM books
       WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY created_at
       LIMIT 40`,
      [tenantId],
    );
    if (booksRes.rowCount < 3) {
      console.error(
        `ERROR: Need at least 3 books for the demo tenant (found ${booksRes.rowCount}). Run pnpm db:seed first.`,
      );
      process.exitCode = 1;
      return;
    }
    const books = booksRes.rows;
    console.log(`  books loaded: ${books.length}`);

    // -----------------------------------------------------------------------
    // 3. Fetch up to 14 active members for wide distribution.
    // -----------------------------------------------------------------------
    const membersRes = await client.query(
      `SELECT id, display_name FROM members
       WHERE tenant_id = $1 AND status = 'active'
       ORDER BY created_at
       LIMIT 14`,
      [tenantId],
    );
    if (membersRes.rowCount < 3) {
      console.error(
        `ERROR: Need at least 3 active members for the demo tenant (found ${membersRes.rowCount}). Run pnpm db:seed first.`,
      );
      process.exitCode = 1;
      return;
    }
    const members = membersRes.rows;
    console.log(`  members loaded: ${members.length}`);

    // Seed actor representing the librarian in the demo context.
    const seedActorId = "seed:system";

    // -----------------------------------------------------------------------
    // 4. Active loans (~14)
    //    Varied due dates: some coming soon (1-3 days), most mid-window, one far out.
    // -----------------------------------------------------------------------
    console.log("\n-- Active loans --");

    // Due within 3 days (urgent)
    await seedLoan(client, {
      tenantId,
      book: pick(books, 0),
      member: pick(members, 0),
      actorId: seedActorId,
      checkedOutAt: daysAgo(18),
      dueAt: daysFromNow(1),
      label: "LOAN active-01 (due in 1d)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 1),
      member: pick(members, 1),
      actorId: seedActorId,
      checkedOutAt: daysAgo(19),
      dueAt: daysFromNow(2),
      label: "LOAN active-02 (due in 2d)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 2),
      member: pick(members, 2),
      actorId: seedActorId,
      checkedOutAt: daysAgo(18),
      dueAt: daysFromNow(3),
      label: "LOAN active-03 (due in 3d)",
    });

    // Mid-window (7-10 days remaining)
    await seedLoan(client, {
      tenantId,
      book: pick(books, 3),
      member: pick(members, 3),
      actorId: seedActorId,
      checkedOutAt: daysAgo(14),
      dueAt: daysFromNow(7),
      label: "LOAN active-04 (due in 7d)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 4),
      member: pick(members, 4),
      actorId: seedActorId,
      checkedOutAt: daysAgo(12),
      dueAt: daysFromNow(9),
      label: "LOAN active-05 (due in 9d)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 5),
      member: pick(members, 5),
      actorId: seedActorId,
      checkedOutAt: daysAgo(11),
      dueAt: daysFromNow(10),
      label: "LOAN active-06 (due in 10d)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 6),
      member: pick(members, 6),
      actorId: seedActorId,
      checkedOutAt: daysAgo(10),
      dueAt: daysFromNow(11),
      label: "LOAN active-07 (due in 11d)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 7),
      member: pick(members, 7),
      actorId: seedActorId,
      checkedOutAt: daysAgo(9),
      dueAt: daysFromNow(12),
      label: "LOAN active-08 (due in 12d)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 8),
      member: pick(members, 8),
      actorId: seedActorId,
      checkedOutAt: daysAgo(8),
      dueAt: daysFromNow(13),
      label: "LOAN active-09 (due in 13d)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 9),
      member: pick(members, 9),
      actorId: seedActorId,
      checkedOutAt: daysAgo(7),
      dueAt: daysFromNow(14),
      label: "LOAN active-10 (due in 14d)",
    });

    // Longer window
    await seedLoan(client, {
      tenantId,
      book: pick(books, 10),
      member: pick(members, 10),
      actorId: seedActorId,
      checkedOutAt: daysAgo(5),
      dueAt: daysFromNow(16),
      label: "LOAN active-11 (due in 16d)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 11),
      member: pick(members, 11),
      actorId: seedActorId,
      checkedOutAt: daysAgo(4),
      dueAt: daysFromNow(17),
      label: "LOAN active-12 (due in 17d)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 12),
      member: pick(members, 12),
      actorId: seedActorId,
      checkedOutAt: daysAgo(3),
      dueAt: daysFromNow(18),
      label: "LOAN active-13 (due in 18d)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 13),
      member: pick(members, 0),
      actorId: seedActorId,
      checkedOutAt: daysAgo(2),
      dueAt: daysFromNow(21),
      label: "LOAN active-14 (due in 21d)",
    });

    // -----------------------------------------------------------------------
    // 5. Overdue loans (~6) — due in the past, not returned
    // -----------------------------------------------------------------------
    console.log("\n-- Overdue loans --");

    await seedLoan(client, {
      tenantId,
      book: pick(books, 14),
      member: pick(members, 1),
      actorId: seedActorId,
      checkedOutAt: daysAgo(28),
      dueAt: daysAgo(7),
      label: "LOAN overdue-01 (7d overdue)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 15),
      member: pick(members, 2),
      actorId: seedActorId,
      checkedOutAt: daysAgo(35),
      dueAt: daysAgo(14),
      label: "LOAN overdue-02 (14d overdue)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 16),
      member: pick(members, 3),
      actorId: seedActorId,
      checkedOutAt: daysAgo(42),
      dueAt: daysAgo(21),
      label: "LOAN overdue-03 (21d overdue)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 17),
      member: pick(members, 4),
      actorId: seedActorId,
      checkedOutAt: daysAgo(40),
      dueAt: daysAgo(19),
      label: "LOAN overdue-04 (19d overdue)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 18),
      member: pick(members, 5),
      actorId: seedActorId,
      checkedOutAt: daysAgo(50),
      dueAt: daysAgo(29),
      label: "LOAN overdue-05 (29d overdue)",
    });
    await seedLoan(client, {
      tenantId,
      book: pick(books, 19),
      member: pick(members, 6),
      actorId: seedActorId,
      checkedOutAt: daysAgo(38),
      dueAt: daysAgo(3),
      label: "LOAN overdue-06 (3d overdue)",
    });

    // -----------------------------------------------------------------------
    // 6. Returned / historical loans (~12) — spread over last ~90 days
    //    so reporting trend charts have meaningful history.
    // -----------------------------------------------------------------------
    console.log("\n-- Returned/historical loans --");

    await seedReturnedLoan(client, {
      tenantId,
      book: pick(books, 20),
      member: pick(members, 7),
      actorId: seedActorId,
      checkedOutAt: daysAgo(88),
      dueAt: daysAgo(67),
      returnedAt: daysAgo(70),
      label: "LOAN returned-01 (~88d ago)",
    });
    await seedReturnedLoan(client, {
      tenantId,
      book: pick(books, 21),
      member: pick(members, 8),
      actorId: seedActorId,
      checkedOutAt: daysAgo(82),
      dueAt: daysAgo(61),
      returnedAt: daysAgo(63),
      label: "LOAN returned-02 (~82d ago)",
    });
    await seedReturnedLoan(client, {
      tenantId,
      book: pick(books, 22),
      member: pick(members, 9),
      actorId: seedActorId,
      checkedOutAt: daysAgo(75),
      dueAt: daysAgo(54),
      returnedAt: daysAgo(57),
      label: "LOAN returned-03 (~75d ago)",
    });
    await seedReturnedLoan(client, {
      tenantId,
      book: pick(books, 23),
      member: pick(members, 10),
      actorId: seedActorId,
      checkedOutAt: daysAgo(68),
      dueAt: daysAgo(47),
      returnedAt: daysAgo(50),
      label: "LOAN returned-04 (~68d ago)",
    });
    await seedReturnedLoan(client, {
      tenantId,
      book: pick(books, 24),
      member: pick(members, 11),
      actorId: seedActorId,
      checkedOutAt: daysAgo(60),
      dueAt: daysAgo(39),
      returnedAt: daysAgo(41),
      label: "LOAN returned-05 (~60d ago)",
    });
    await seedReturnedLoan(client, {
      tenantId,
      book: pick(books, 25),
      member: pick(members, 12),
      actorId: seedActorId,
      checkedOutAt: daysAgo(55),
      dueAt: daysAgo(34),
      returnedAt: daysAgo(36),
      label: "LOAN returned-06 (~55d ago)",
    });
    await seedReturnedLoan(client, {
      tenantId,
      book: pick(books, 26),
      member: pick(members, 0),
      actorId: seedActorId,
      checkedOutAt: daysAgo(47),
      dueAt: daysAgo(26),
      returnedAt: daysAgo(28),
      label: "LOAN returned-07 (~47d ago)",
    });
    await seedReturnedLoan(client, {
      tenantId,
      book: pick(books, 27),
      member: pick(members, 1),
      actorId: seedActorId,
      checkedOutAt: daysAgo(40),
      dueAt: daysAgo(19),
      returnedAt: daysAgo(22),
      label: "LOAN returned-08 (~40d ago)",
    });
    await seedReturnedLoan(client, {
      tenantId,
      book: pick(books, 28),
      member: pick(members, 2),
      actorId: seedActorId,
      checkedOutAt: daysAgo(34),
      dueAt: daysAgo(13),
      returnedAt: daysAgo(14),
      label: "LOAN returned-09 (~34d ago)",
    });
    await seedReturnedLoan(client, {
      tenantId,
      book: pick(books, 29),
      member: pick(members, 3),
      actorId: seedActorId,
      checkedOutAt: daysAgo(25),
      dueAt: daysAgo(4),
      returnedAt: daysAgo(5),
      label: "LOAN returned-10 (~25d ago)",
    });
    await seedReturnedLoan(client, {
      tenantId,
      book: pick(books, 30),
      member: pick(members, 4),
      actorId: seedActorId,
      checkedOutAt: daysAgo(18),
      dueAt: daysAgo(0),
      returnedAt: daysAgo(1),
      label: "LOAN returned-11 (~18d ago)",
    });
    await seedReturnedLoan(client, {
      tenantId,
      book: pick(books, 31),
      member: pick(members, 5),
      actorId: seedActorId,
      checkedOutAt: daysAgo(10),
      dueAt: daysFromNow(11),
      returnedAt: daysAgo(2),
      label: "LOAN returned-12 (early return ~10d ago)",
    });

    // -----------------------------------------------------------------------
    // 7. Holds (~6) — mix of 'queued' and 'ready'
    //    Use books that have active loans so holds make narrative sense.
    // -----------------------------------------------------------------------
    console.log("\n-- Holds --");

    await seedHold(client, {
      tenantId,
      book: pick(books, 0),
      member: pick(members, 6),
      actorId: seedActorId,
      status: "queued",
      label: "HOLD queued-01",
    });
    await seedHold(client, {
      tenantId,
      book: pick(books, 1),
      member: pick(members, 7),
      actorId: seedActorId,
      status: "queued",
      label: "HOLD queued-02",
    });
    await seedHold(client, {
      tenantId,
      book: pick(books, 2),
      member: pick(members, 8),
      actorId: seedActorId,
      status: "queued",
      label: "HOLD queued-03",
    });
    await seedHold(client, {
      tenantId,
      book: pick(books, 3),
      member: pick(members, 9),
      actorId: seedActorId,
      status: "queued",
      label: "HOLD queued-04",
    });
    // Ready holds — book available, member notified
    await seedHold(client, {
      tenantId,
      book: pick(books, 32),
      member: pick(members, 10),
      actorId: seedActorId,
      status: "ready",
      label: "HOLD ready-01",
    });
    await seedHold(client, {
      tenantId,
      book: pick(books, 33),
      member: pick(members, 11),
      actorId: seedActorId,
      status: "ready",
      label: "HOLD ready-02",
    });

    console.log("\nseed-circulation: done.");
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
