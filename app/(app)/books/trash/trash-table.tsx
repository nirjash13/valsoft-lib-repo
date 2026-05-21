"use client";

import { restoreBookAction } from "@/app/(app)/books/actions";
import { Button } from "@/components/ui/button";
import type { BookRow } from "@/lib/db/schema/books";
import type { ProblemDetails } from "@/lib/utils/problem";
import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface TrashTableProps {
  books: ReadonlyArray<BookRow>;
}

/**
 * TrashTable — client component that renders the list of soft-deleted books
 * with restore buttons.
 */
export function TrashTable({ books }: TrashTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  function handleRestore(book: BookRow) {
    setPendingId(book.id);
    startTransition(async () => {
      const result = await restoreBookAction({ id: book.id });
      setPendingId(null);

      if (result?.serverError) {
        const err = parseProblemDetails(result.serverError);
        toast.error(err?.title ?? "Could not restore book", { description: err?.detail });
        return;
      }

      toast.success(`"${book.title}" restored — back in the catalog.`);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-[hsl(var(--border-subtle))] overflow-hidden">
      <table className="w-full border-collapse" aria-label="Deleted books">
        <thead className="bg-[hsl(var(--bg-surface-2))] border-b border-[hsl(var(--border-subtle))]">
          <tr>
            <th
              scope="col"
              className="text-caption text-[hsl(var(--text-tertiary))] px-4 py-2.5 text-left font-medium"
            >
              Title / Author
            </th>
            <th
              scope="col"
              className="text-caption text-[hsl(var(--text-tertiary))] px-4 py-2.5 text-right font-medium w-36"
            >
              Deleted
            </th>
            <th
              scope="col"
              className="text-caption text-[hsl(var(--text-tertiary))] px-4 py-2.5 text-right font-medium w-36"
            >
              Retention
            </th>
            <th scope="col" className="w-24 px-4 py-2.5" aria-label="Actions" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[hsl(var(--border-subtle))]">
          {books.map((book) => {
            const deletedAt = book.deletedAt ? new Date(book.deletedAt) : null;
            const retentionEnd = deletedAt
              ? new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
              : null;
            const daysLeft = retentionEnd
              ? Math.ceil((retentionEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
              : null;
            const isExpired = daysLeft !== null && daysLeft <= 0;

            return (
              <tr
                key={book.id}
                className="bg-[hsl(var(--bg-surface))] hover:bg-[hsl(var(--bg-surface-2))] transition-instant transition-colors"
              >
                <td className="px-4 py-3 min-w-0">
                  <Link
                    href={`/books/${book.id}`}
                    className="text-meta font-medium text-[hsl(var(--text-primary))] hover:text-[hsl(var(--accent))] transition-instant truncate block"
                  >
                    {book.title}
                  </Link>
                  <p className="text-[12px] text-[hsl(var(--text-secondary))] truncate">
                    {book.authors.join(", ")}
                  </p>
                </td>

                <td className="px-4 py-3 text-meta text-[hsl(var(--text-secondary))] text-right">
                  {deletedAt ? deletedAt.toLocaleDateString("en-US", { dateStyle: "medium" }) : "—"}
                </td>

                <td
                  className="px-4 py-3 text-meta text-right"
                  style={{
                    color: isExpired
                      ? "hsl(var(--danger))"
                      : daysLeft !== null && daysLeft <= 5
                        ? "hsl(var(--warning))"
                        : "hsl(var(--text-secondary))",
                  }}
                >
                  {isExpired ? "Expired" : daysLeft !== null ? `${daysLeft}d left` : "—"}
                </td>

                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    {!isExpired && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleRestore(book)}
                        disabled={isPending && pendingId === book.id}
                        aria-label={`Restore ${book.title}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        Restore
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function parseProblemDetails(raw: string): ProblemDetails | null {
  try {
    return JSON.parse(raw) as ProblemDetails;
  } catch {
    return null;
  }
}
