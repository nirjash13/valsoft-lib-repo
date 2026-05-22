/**
 * Integration test: CSV Import domain logic and chunk processing.
 *
 * Requires DATABASE_URL pointing at a Neon test branch.
 */

import { randomUUID } from "node:crypto";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_UNPOOLED = process.env.DATABASE_URL_UNPOOLED;
const DATABASE_URL_APP_DIRECT = process.env.DATABASE_URL_APP_DIRECT;

if (!DATABASE_URL || !DATABASE_URL_UNPOOLED || !DATABASE_URL_APP_DIRECT) {
  describe.skip("csv-import (integration — requires DATABASE_URL)", () => {
    it("skipped: set database envs in .env.local", () => {});
  });
} else {
  const ownerPool = new Pool({ connectionString: DATABASE_URL_UNPOOLED });
  const appPool = new Pool({ connectionString: DATABASE_URL_APP_DIRECT });

  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    tenantA = randomUUID();
    tenantB = randomUUID();

    const owner = await ownerPool.connect();
    try {
      await owner.query(
        `INSERT INTO tenants (id, auth0_org_id, name, slug, ai_monthly_cap_usd)
         VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
        [
          tenantA,
          `org_csv_test_${tenantA.slice(0, 8)}`,
          "CSV Import Test A",
          `csv-test-a-${tenantA.slice(0, 8)}`,
          "10.00", // $10.00 budget
          tenantB,
          `org_csv_test_${tenantB.slice(0, 8)}`,
          "CSV Import Test B",
          `csv-test-b-${tenantB.slice(0, 8)}`,
          "0.0005", // Tiny budget to trigger cap violation
        ],
      );
    } finally {
      owner.release();
    }
  });

  afterAll(async () => {
    const owner = await ownerPool.connect();
    try {
      // Clean up audit log trigger bypass
      await owner.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete");

      // Clean up in dependency order
      await owner.query("DELETE FROM audit_log WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
      await owner.query("DELETE FROM import_rows WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
      await owner.query("DELETE FROM import_jobs WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
      await owner.query("DELETE FROM books WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
      await owner.query("DELETE FROM isbn_cache WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
      await owner.query("DELETE FROM ai_usage WHERE tenant_id IN ($1, $2)", [tenantA, tenantB]);
      await owner.query("DELETE FROM tenants WHERE id IN ($1, $2)", [tenantA, tenantB]);

      await owner.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete");
    } finally {
      owner.release();
    }
    await ownerPool.end();
    await appPool.end();
  });

  describe("csv-import (integration)", () => {
    it("processes a chunk of valid books and inserts them into catalog (happy path)", async () => {
      const { withTenantTx } = await import("@/lib/db/with-tenant-tx");
      const { processImportChunk } = await import("@/lib/domain/import/chunk-processor");
      const { importJobs: jobsTable } = await import("@/lib/db/schema/import-jobs");
      const { importRows: rowsTable } = await import("@/lib/db/schema/import-rows");
      const { books: booksTable } = await import("@/lib/db/schema/books");
      const { isbnCache } = await import("@/lib/db/schema/isbn-cache");
      const { eq } = await import("drizzle-orm");

      // tenantId is a plain string here — cast once via type assertion at the boundary
      const ctx = { tenantId: tenantA as string, userId: "test-librarian" };

      await withTenantTx(ctx, async (tx) => {
        // Seed ISBN Cache so previewIsbn does not hit external APIs
        await tx.insert(isbnCache).values({
          tenantId: tenantA,
          isbn13: "9780132350884",
          expiresAt: new Date(Date.now() + 86400000), // 24 hours
          payload: {
            title: "Clean Code",
            authors: ["Robert C. Martin"],
            year: 2008,
            publisher: "Prentice Hall",
          },
        });

        // Seed Import Job
        const jobRows = await tx
          .insert(jobsTable)
          .values({
            tenantId: tenantA,
            status: "running",
            totalRows: 1,
            dryRun: false,
            createdBy: "test-librarian",
          })
          .returning();

        const job = jobRows[0];
        expect(job).toBeDefined();
        if (!job) return;

        // Seed Import Row
        await tx.insert(rowsTable).values({
          tenantId: tenantA,
          jobId: job.id,
          rowIndex: 1,
          status: "pending",
          isbn13: "9780132350884",
          rawData: { isbn13: "9780132350884" },
        });

        // Run chunk processor
        const result = await processImportChunk(tx, job.id, ctx);

        expect(result.complete).toBe(true);
        expect(result.newBookIds).toHaveLength(1);

        // Verify row status is imported
        const importedRows = await tx.select().from(rowsTable).where(eq(rowsTable.jobId, job.id));
        const row = importedRows[0];
        expect(row).toBeDefined();
        if (!row) return;
        expect(row.status).toBe("imported");

        // Verify book was inserted in the catalog
        const insertedBooks = await tx
          .select()
          .from(booksTable)
          .where(eq(booksTable.isbn13, "9780132350884"));
        const book = insertedBooks[0];
        expect(book).toBeDefined();
        if (!book) return;
        expect(book.title).toBe("Clean Code");
        expect(book.authors).toEqual(["Robert C. Martin"]);
      });
    });

    it("processes a chunk in dry-run mode and does NOT write to catalog", async () => {
      const { withTenantTx } = await import("@/lib/db/with-tenant-tx");
      const { processImportChunk } = await import("@/lib/domain/import/chunk-processor");
      const { importJobs: jobsTable } = await import("@/lib/db/schema/import-jobs");
      const { importRows: rowsTable } = await import("@/lib/db/schema/import-rows");
      const { books: booksTable } = await import("@/lib/db/schema/books");
      const { isbnCache } = await import("@/lib/db/schema/isbn-cache");
      const { eq } = await import("drizzle-orm");

      const ctx = { tenantId: tenantA as string, userId: "test-librarian" };

      await withTenantTx(ctx, async (tx) => {
        // Seed ISBN Cache
        await tx.insert(isbnCache).values({
          tenantId: tenantA,
          isbn13: "9780132350885",
          expiresAt: new Date(Date.now() + 86400000),
          payload: {
            title: "Refactoring",
            authors: ["Martin Fowler"],
            year: 1999,
          },
        });

        // Seed Dry Run Job
        const jobRows = await tx
          .insert(jobsTable)
          .values({
            tenantId: tenantA,
            status: "running",
            totalRows: 1,
            dryRun: true, // DRY RUN
            createdBy: "test-librarian",
          })
          .returning();

        const job = jobRows[0];
        expect(job).toBeDefined();
        if (!job) return;

        // Seed Import Row
        await tx.insert(rowsTable).values({
          tenantId: tenantA,
          jobId: job.id,
          rowIndex: 1,
          status: "pending",
          isbn13: "9780132350885",
          rawData: { isbn13: "9780132350885" },
        });

        // Run chunk processor
        const result = await processImportChunk(tx, job.id, ctx);

        expect(result.complete).toBe(true);
        expect(result.newBookIds).toHaveLength(0); // None created

        // Verify row status is imported (valid)
        const importedRows = await tx.select().from(rowsTable).where(eq(rowsTable.jobId, job.id));
        const row = importedRows[0];
        expect(row).toBeDefined();
        if (!row) return;
        expect(row.status).toBe("imported");

        // Verify no book with this ISBN is in catalog
        const list = await tx
          .select()
          .from(booksTable)
          .where(eq(booksTable.isbn13, "9780132350885"));
        expect(list).toHaveLength(0);
      });
    });

    it("detects and flags duplicates in catalog", async () => {
      const { withTenantTx } = await import("@/lib/db/with-tenant-tx");
      const { processImportChunk } = await import("@/lib/domain/import/chunk-processor");
      const { importJobs: jobsTable } = await import("@/lib/db/schema/import-jobs");
      const { importRows: rowsTable } = await import("@/lib/db/schema/import-rows");
      const { books: booksTable } = await import("@/lib/db/schema/books");
      const { eq } = await import("drizzle-orm");

      const ctx = { tenantId: tenantA as string, userId: "test-librarian" };

      await withTenantTx(ctx, async (tx) => {
        // First insert a book manually to act as duplicate
        const existingBookRows = await tx
          .insert(booksTable)
          .values({
            tenantId: tenantA,
            isbn13: "9780132350886",
            title: "Existing Book",
            authors: ["Some Author"],
          })
          .returning();

        const existingBook = existingBookRows[0];
        expect(existingBook).toBeDefined();
        if (!existingBook) return;

        // Seed Import Job
        const jobRows = await tx
          .insert(jobsTable)
          .values({
            tenantId: tenantA,
            status: "running",
            totalRows: 1,
            dryRun: false,
            createdBy: "test-librarian",
          })
          .returning();

        const job = jobRows[0];
        expect(job).toBeDefined();
        if (!job) return;

        // Seed Import Row with duplicate ISBN
        await tx.insert(rowsTable).values({
          tenantId: tenantA,
          jobId: job.id,
          rowIndex: 1,
          status: "pending",
          isbn13: "9780132350886",
          rawData: { isbn13: "9780132350886" },
        });

        // Run chunk processor
        const result = await processImportChunk(tx, job.id, ctx);

        expect(result.complete).toBe(true);
        expect(result.newBookIds).toHaveLength(0); // No new book added

        // Verify row status is duplicate and points to existing book
        const dupRows = await tx.select().from(rowsTable).where(eq(rowsTable.jobId, job.id));
        const row = dupRows[0];
        expect(row).toBeDefined();
        if (!row) return;
        expect(row.status).toBe("duplicate");
        expect(row.existingBookId).toBe(existingBook.id);
      });
    });

    it("triggers quota pause when budget cap is exceeded", async () => {
      const { vi } = await import("vitest");
      const { withTenantTx } = await import("@/lib/db/with-tenant-tx");
      const { processImportChunk } = await import("@/lib/domain/import/chunk-processor");
      const { importJobs: jobsTable } = await import("@/lib/db/schema/import-jobs");
      const { importRows: rowsTable } = await import("@/lib/db/schema/import-rows");

      const ctx = { tenantId: tenantB as string, userId: "test-librarian" };
      const { AiBudgetExceededError } = await import("@/lib/ai/budget");
      const previewIsbnModule = await import("@/lib/domain/books/preview-isbn");

      // Spy on previewIsbn to simulate budget cap exhaustion
      const spy = vi
        .spyOn(previewIsbnModule, "previewIsbn")
        .mockRejectedValue(new AiBudgetExceededError(tenantB, 0.0005, 0.001));

      try {
        await withTenantTx(ctx, async (tx) => {
          // Seed Import Job
          const jobRows = await tx
            .insert(jobsTable)
            .values({
              tenantId: tenantB,
              status: "running",
              totalRows: 1,
              dryRun: false,
              createdBy: "test-librarian",
            })
            .returning();

          const job = jobRows[0];
          expect(job).toBeDefined();
          if (!job) return;

          // Seed Import Row
          await tx.insert(rowsTable).values({
            tenantId: tenantB,
            jobId: job.id,
            rowIndex: 1,
            status: "pending",
            isbn13: "9780132350887",
            rawData: { isbn13: "9780132350887" },
          });

          // Run chunk processor — it should propagate the budget error
          await expect(processImportChunk(tx, job.id, ctx)).rejects.toThrow(/AI budget exceeded/);
        });
      } finally {
        spy.mockRestore();
      }
    });

    // -------------------------------------------------------------------------
    // REQ-10-06 / US-05 — Duplicate resolve: merge and skip
    // -------------------------------------------------------------------------

    it("resolveDuplicate: merge updates the existing book with CSV fields", async () => {
      const { withTenantTx } = await import("@/lib/db/with-tenant-tx");
      const { books: booksTable } = await import("@/lib/db/schema/books");
      const { importJobs: jobsTable } = await import("@/lib/db/schema/import-jobs");
      const { importRows: rowsTable } = await import("@/lib/db/schema/import-rows");
      const { resolveDuplicate } = await import("@/lib/domain/import/resolve-duplicate");
      const { eq } = await import("drizzle-orm");

      const ctx = { tenantId: tenantA as string, userId: "test-librarian" };

      await withTenantTx(ctx, async (tx) => {
        // Existing book in catalog
        const existingRows = await tx
          .insert(booksTable)
          .values({
            tenantId: tenantA,
            isbn13: "9780201633610",
            title: "Design Patterns",
            authors: ["GoF"],
          })
          .returning();

        const existing = existingRows[0];
        expect(existing).toBeDefined();
        if (!existing) return;

        // Import job + duplicate row
        const jobRows = await tx
          .insert(jobsTable)
          .values({
            tenantId: tenantA,
            status: "running",
            totalRows: 1,
            dryRun: false,
            createdBy: "test-librarian",
          })
          .returning();
        const job = jobRows[0];
        expect(job).toBeDefined();
        if (!job) return;

        const dupRowInsert = await tx
          .insert(rowsTable)
          .values({
            tenantId: tenantA,
            jobId: job.id,
            rowIndex: 1,
            status: "duplicate",
            isbn13: "9780201633610",
            title: "Design Patterns (Updated)",
            authors: ["Gang of Four"],
            year: 1994,
            existingBookId: existing.id,
            rawData: {
              isbn13: "9780201633610",
              title: "Design Patterns (Updated)",
              authors: "Gang of Four",
              year: "1994",
            },
          })
          .returning();

        const dupRow = dupRowInsert[0];
        expect(dupRow).toBeDefined();
        if (!dupRow) return;

        const result = await resolveDuplicate(tx, ctx, { rowId: dupRow.id, choice: "merge" });
        expect(result.status).toBe("merged");

        // The existing book should be updated
        const updatedBookRows = await tx
          .select()
          .from(booksTable)
          .where(eq(booksTable.id, existing.id));
        const updatedBook = updatedBookRows[0];
        expect(updatedBook).toBeDefined();
        if (!updatedBook) return;
        expect(updatedBook.title).toBe("Design Patterns (Updated)");
        expect(updatedBook.year).toBe(1994);

        // The import row should be marked merged
        const importRowResults = await tx
          .select()
          .from(rowsTable)
          .where(eq(rowsTable.id, dupRow.id));
        const importRow = importRowResults[0];
        expect(importRow).toBeDefined();
        if (!importRow) return;
        expect(importRow.status).toBe("merged");
      });
    });

    it("resolveDuplicate: skip marks the row skipped without modifying the existing book", async () => {
      const { withTenantTx } = await import("@/lib/db/with-tenant-tx");
      const { books: booksTable } = await import("@/lib/db/schema/books");
      const { importJobs: jobsTable } = await import("@/lib/db/schema/import-jobs");
      const { importRows: rowsTable } = await import("@/lib/db/schema/import-rows");
      const { resolveDuplicate } = await import("@/lib/domain/import/resolve-duplicate");
      const { eq } = await import("drizzle-orm");

      const ctx = { tenantId: tenantA as string, userId: "test-librarian" };

      await withTenantTx(ctx, async (tx) => {
        const existingRows = await tx
          .insert(booksTable)
          .values({
            tenantId: tenantA,
            isbn13: "9780134685991",
            title: "Effective Java",
            authors: ["Joshua Bloch"],
          })
          .returning();
        const existing = existingRows[0];
        expect(existing).toBeDefined();
        if (!existing) return;

        const jobRows = await tx
          .insert(jobsTable)
          .values({
            tenantId: tenantA,
            status: "running",
            totalRows: 1,
            dryRun: false,
            createdBy: "test-librarian",
          })
          .returning();
        const job = jobRows[0];
        expect(job).toBeDefined();
        if (!job) return;

        const dupRowInsert = await tx
          .insert(rowsTable)
          .values({
            tenantId: tenantA,
            jobId: job.id,
            rowIndex: 1,
            status: "duplicate",
            isbn13: "9780134685991",
            title: "Effective Java (new edition)",
            existingBookId: existing.id,
            rawData: { isbn13: "9780134685991" },
          })
          .returning();
        const dupRow = dupRowInsert[0];
        expect(dupRow).toBeDefined();
        if (!dupRow) return;

        const result = await resolveDuplicate(tx, ctx, { rowId: dupRow.id, choice: "skip" });
        expect(result.status).toBe("skipped");

        // The existing book title is unchanged
        const unchangedBookRows = await tx
          .select()
          .from(booksTable)
          .where(eq(booksTable.id, existing.id));
        const unchangedBook = unchangedBookRows[0];
        expect(unchangedBook).toBeDefined();
        if (!unchangedBook) return;
        expect(unchangedBook.title).toBe("Effective Java");

        // The import row is marked skipped
        const importRowResults = await tx
          .select()
          .from(rowsTable)
          .where(eq(rowsTable.id, dupRow.id));
        const importRow = importRowResults[0];
        expect(importRow).toBeDefined();
        if (!importRow) return;
        expect(importRow.status).toBe("skipped");
      });
    });
  });
}
