#!/usr/bin/env node
// scripts/seed-demo.mjs
//
// Creates the demo tenant ("Stack Public Library") plus a small realistic
// catalog (8 books) and 5 demo member rows (one per intended role +
// 3 active members for circulation flows).
//
// Idempotent: if a tenant with slug='stack-public' already exists, the script
// reuses it; books/members are upserted by their natural key.
//
// Prerequisites:
//   - Migrations 0000-0007 applied (run scripts/apply-migration.mjs per file).
//   - DATABASE_URL_UNPOOLED set in .env.local (neondb_owner, BYPASSRLS).
//
// Usage:
//   node --env-file=.env.local scripts/seed-demo.mjs
//
// What this seed deliberately does NOT do:
//   - Issue loans or holds — that's seed-circulation.mjs's job.
//   - Wire Auth0 users — auth0_user_id is left NULL; sign-in flow will link
//     real Auth0 sub → existing member row at first login (post-Auth0-setup).

import { randomUUID } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const ownerUrl = process.env.DATABASE_URL_UNPOOLED;
if (!ownerUrl) {
  console.error("ERROR: DATABASE_URL_UNPOOLED not set");
  process.exit(1);
}
if (ownerUrl.startsWith("<") || !/^postgres(ql)?:\/\//.test(ownerUrl)) {
  console.error("ERROR: DATABASE_URL_UNPOOLED looks like a placeholder");
  process.exit(1);
}

function maskUrl(u) {
  try {
    const p = new URL(u);
    p.password = "***";
    return p.toString();
  } catch {
    return "<unparseable url>";
  }
}

// ---------------------------------------------------------------------------
// Demo content
// ---------------------------------------------------------------------------

const DEMO_TENANT = {
  slug: "stack-public",
  name: "Stack Public Library",
  auth0OrgId: "org_stack_public_demo",
  brandVoice: "Warm, literary, neighborhood.",
};

const DEMO_BOOKS = [
  {
    isbn13: "9780132350884",
    title: "Clean Code",
    authors: ["Robert C. Martin"],
    year: 2008,
    publisher: "Prentice Hall",
    pageCount: 464,
    subjects: ["Software Engineering", "Programming"],
    language: "en",
  },
  {
    isbn13: "9780201633610",
    title: "Design Patterns",
    authors: ["Erich Gamma", "Richard Helm", "Ralph Johnson", "John Vlissides"],
    year: 1994,
    publisher: "Addison-Wesley",
    pageCount: 395,
    subjects: ["Software Engineering", "Object-Oriented Programming"],
    language: "en",
  },
  {
    isbn13: "9780374533557",
    title: "Thinking, Fast and Slow",
    authors: ["Daniel Kahneman"],
    year: 2011,
    publisher: "Farrar, Straus and Giroux",
    pageCount: 499,
    subjects: ["Psychology", "Cognitive Science"],
    language: "en",
  },
  {
    isbn13: "9780140449136",
    title: "The Odyssey",
    authors: ["Homer"],
    year: 1996,
    publisher: "Penguin Classics",
    pageCount: 560,
    subjects: ["Classics", "Epic Poetry"],
    language: "en",
  },
  {
    isbn13: "9780062315007",
    title: "The Alchemist",
    authors: ["Paulo Coelho"],
    year: 1988,
    publisher: "HarperOne",
    pageCount: 208,
    subjects: ["Fiction", "Philosophy"],
    language: "en",
  },
  {
    isbn13: "9780451524935",
    title: "1984",
    authors: ["George Orwell"],
    year: 1949,
    publisher: "Signet Classics",
    pageCount: 328,
    subjects: ["Fiction", "Dystopian"],
    language: "en",
  },
  {
    isbn13: "9780743273565",
    title: "The Great Gatsby",
    authors: ["F. Scott Fitzgerald"],
    year: 1925,
    publisher: "Scribner",
    pageCount: 180,
    subjects: ["Fiction", "Classic"],
    language: "en",
  },
  {
    isbn13: "9780393358070",
    title: "Sapiens: A Brief History of Humankind",
    authors: ["Yuval Noah Harari"],
    year: 2015,
    publisher: "Harper Perennial",
    pageCount: 464,
    subjects: ["History", "Anthropology"],
    language: "en",
  },
];

const DEMO_MEMBERS = [
  {
    email: "admin@stack-public.demo",
    displayName: "Avery Administrator",
    role: "tenant_admin",
    status: "active",
    canBorrow: true,
  },
  {
    email: "librarian@stack-public.demo",
    displayName: "Lena Librarian",
    role: "librarian",
    status: "active",
    canBorrow: true,
  },
  {
    email: "ada@stack-public.demo",
    displayName: "Ada Lovelace",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  {
    email: "alan@stack-public.demo",
    displayName: "Alan Turing",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  {
    email: "grace@stack-public.demo",
    displayName: "Grace Hopper",
    role: "member",
    status: "active",
    canBorrow: true,
  },
  // One pending member to exercise the approval queue UI.
  {
    email: "newcomer@stack-public.demo",
    displayName: "Nora Newcomer",
    role: "member",
    status: "pending",
    canBorrow: false,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  const client = await pool.connect();
  console.log(`seed-demo: connecting to ${maskUrl(ownerUrl)}`);

  try {
    // -- TENANT -----------------------------------------------------------
    let tenantId;
    const existing = await client.query("SELECT id FROM tenants WHERE slug = $1", [
      DEMO_TENANT.slug,
    ]);
    if (existing.rowCount > 0) {
      tenantId = existing.rows[0].id;
      console.log(`  tenant: "${DEMO_TENANT.name}" already present (id=${tenantId})`);
    } else {
      tenantId = randomUUID();
      await client.query(
        `INSERT INTO tenants
           (id, auth0_org_id, name, slug, brand_voice, public_catalog_enabled)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [
          tenantId,
          DEMO_TENANT.auth0OrgId,
          DEMO_TENANT.name,
          DEMO_TENANT.slug,
          DEMO_TENANT.brandVoice,
        ],
      );
      console.log(`  tenant: "${DEMO_TENANT.name}" created (id=${tenantId})`);
    }

    // -- BOOKS ------------------------------------------------------------
    let inserted = 0;
    let skipped = 0;
    for (const b of DEMO_BOOKS) {
      const exists = await client.query(
        "SELECT id FROM books WHERE tenant_id = $1 AND isbn13 = $2 AND deleted_at IS NULL",
        [tenantId, b.isbn13],
      );
      if (exists.rowCount > 0) {
        skipped++;
        continue;
      }
      await client.query(
        `INSERT INTO books
           (tenant_id, isbn13, title, authors, year, publisher, page_count, subjects, language)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          tenantId,
          b.isbn13,
          b.title,
          b.authors,
          b.year,
          b.publisher,
          b.pageCount,
          b.subjects,
          b.language,
        ],
      );
      inserted++;
    }
    console.log(`  books: inserted=${inserted} skipped=${skipped} total=${DEMO_BOOKS.length}`);

    // -- MEMBERS ----------------------------------------------------------
    let mInserted = 0;
    let mSkipped = 0;
    for (const m of DEMO_MEMBERS) {
      const exists = await client.query(
        "SELECT id FROM members WHERE tenant_id = $1 AND email = $2",
        [tenantId, m.email],
      );
      if (exists.rowCount > 0) {
        mSkipped++;
        continue;
      }
      await client.query(
        `INSERT INTO members
           (tenant_id, display_name, email, status, role, can_borrow)
         VALUES ($1, $2, $3, $4::member_status, $5::member_role, $6)`,
        [tenantId, m.displayName, m.email, m.status, m.role, m.canBorrow],
      );
      mInserted++;
    }
    console.log(
      `  members: inserted=${mInserted} skipped=${mSkipped} total=${DEMO_MEMBERS.length}`,
    );

    console.log(`\nseed-demo: done. Use tenant id ${tenantId} in DEV_BYPASS_TENANT_ID.`);
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
