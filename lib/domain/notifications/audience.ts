/**
 * getAudiencePreview — query module for batch email audience segments.
 *
 * Returns a preview list of recipients for a given audience filter.
 * Used by the compose-batch UI to show the librarian who will receive
 * the email before they confirm the send.
 *
 * Domain rules:
 *   - bouncing recipients are excluded (no point showing them in preview).
 *   - soft-deleted members, loans, holds, and books are excluded.
 *   - The function is a pure query — no mutations, no HTTP imports.
 *
 * Pure TS domain module — no next/* or @auth0/* imports allowed (backend.md).
 * Accepts a TxClient from the caller.
 */

import { books } from "@/lib/db/schema/books";
import { holds } from "@/lib/db/schema/holds";
import { loans } from "@/lib/db/schema/loans";
import { members } from "@/lib/db/schema/members";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";
import type { AudienceFilter } from "@/lib/notifications/schemas";
import { and, eq, gte, isNull, lt, lte } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AudiencePreviewRow {
  memberId: string;
  email: string;
  displayName: string;
  bookTitle: string | null;
  dueDate: string | null;
  pickupWindow: string | null;
}

// ---------------------------------------------------------------------------
// getAudiencePreview
// ---------------------------------------------------------------------------

/**
 * Returns the audience preview for the given filter.
 *
 * Bouncing recipients are excluded — they cannot receive email and should
 * not be counted in the preview or charged against the monthly cap.
 *
 * @param tx     Active tenant transaction (tenant_id bound via withTenantTx).
 * @param ctx    Tenant context.
 * @param filter One of the four AudienceFilter enum values.
 */
export async function getAudiencePreview(
  tx: TxClient,
  ctx: TenantCtx,
  filter: AudienceFilter,
): Promise<ReadonlyArray<AudiencePreviewRow>> {
  const now = new Date();

  switch (filter) {
    case "overdue_7d": {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const rows = await tx
        .select({
          memberId: members.id,
          email: members.email,
          displayName: members.displayName,
          bookTitle: books.title,
          dueAt: loans.dueAt,
        })
        .from(loans)
        .innerJoin(members, eq(loans.memberId, members.id))
        .innerJoin(books, eq(loans.bookId, books.id))
        .where(
          and(
            eq(loans.tenantId, ctx.tenantId),
            isNull(loans.returnedAt),
            isNull(loans.deletedAt),
            isNull(members.deletedAt),
            isNull(books.deletedAt),
            lt(loans.dueAt, now),
            gte(loans.dueAt, sevenDaysAgo),
            // Exclude bouncing recipients.
            eq(members.emailStatus, "ok"),
          ),
        );

      return rows.map((r) => ({
        memberId: r.memberId,
        email: r.email,
        displayName: r.displayName,
        bookTitle: r.bookTitle,
        dueDate: r.dueAt.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }),
        pickupWindow: null,
      }));
    }

    case "overdue_5d": {
      const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      const rows = await tx
        .select({
          memberId: members.id,
          email: members.email,
          displayName: members.displayName,
          bookTitle: books.title,
          dueAt: loans.dueAt,
        })
        .from(loans)
        .innerJoin(members, eq(loans.memberId, members.id))
        .innerJoin(books, eq(loans.bookId, books.id))
        .where(
          and(
            eq(loans.tenantId, ctx.tenantId),
            isNull(loans.returnedAt),
            isNull(loans.deletedAt),
            isNull(members.deletedAt),
            isNull(books.deletedAt),
            lt(loans.dueAt, now),
            gte(loans.dueAt, fiveDaysAgo),
            eq(members.emailStatus, "ok"),
          ),
        );

      return rows.map((r) => ({
        memberId: r.memberId,
        email: r.email,
        displayName: r.displayName,
        bookTitle: r.bookTitle,
        dueDate: r.dueAt.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }),
        pickupWindow: null,
      }));
    }

    case "due_this_week": {
      const endOfWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const rows = await tx
        .select({
          memberId: members.id,
          email: members.email,
          displayName: members.displayName,
          bookTitle: books.title,
          dueAt: loans.dueAt,
        })
        .from(loans)
        .innerJoin(members, eq(loans.memberId, members.id))
        .innerJoin(books, eq(loans.bookId, books.id))
        .where(
          and(
            eq(loans.tenantId, ctx.tenantId),
            isNull(loans.returnedAt),
            isNull(loans.deletedAt),
            isNull(members.deletedAt),
            isNull(books.deletedAt),
            gte(loans.dueAt, now),
            lte(loans.dueAt, endOfWeek),
            eq(members.emailStatus, "ok"),
          ),
        );

      return rows.map((r) => ({
        memberId: r.memberId,
        email: r.email,
        displayName: r.displayName,
        bookTitle: r.bookTitle,
        dueDate: r.dueAt.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }),
        pickupWindow: null,
      }));
    }

    case "holds_ready": {
      const rows = await tx
        .select({
          memberId: members.id,
          email: members.email,
          displayName: members.displayName,
          bookTitle: books.title,
          readyUntil: holds.readyUntil,
        })
        .from(holds)
        .innerJoin(members, eq(holds.memberId, members.id))
        .innerJoin(books, eq(holds.bookId, books.id))
        .where(
          and(
            eq(holds.tenantId, ctx.tenantId),
            eq(holds.status, "ready"),
            isNull(members.deletedAt),
            isNull(books.deletedAt),
            eq(members.emailStatus, "ok"),
          ),
        );

      return rows.map((r) => ({
        memberId: r.memberId,
        email: r.email,
        displayName: r.displayName,
        bookTitle: r.bookTitle,
        dueDate: null,
        pickupWindow:
          r.readyUntil !== null
            ? r.readyUntil.toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })
            : null,
      }));
    }
  }
}
