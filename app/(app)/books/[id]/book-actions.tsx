"use client";

import { restoreBookAction, softDeleteBookAction } from "@/app/(app)/books/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProblemDetails } from "@/lib/utils/problem";
import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface BookActionsProps {
  book: {
    id: string;
    title: string;
    updatedAt: string;
    isDeleted: boolean;
  };
  canDelete: boolean;
}

/**
 * Client component that renders the delete / restore action buttons for a book.
 *
 * Soft-delete: shows a confirmation dialog before removing.
 * Restore: shows a confirmation dialog before restoring.
 * Both give Sonner toasts on success/failure.
 *
 * CASL gate: buttons are hidden entirely when canDelete is false.
 */
export function BookActions({ book, canDelete }: BookActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  if (!canDelete) return null;

  function handleDelete() {
    startTransition(async () => {
      const result = await softDeleteBookAction({ id: book.id });
      if (result?.serverError) {
        const err = parseProblemDetails(result.serverError);
        // Refuse-with-active-loan shows the detail from BookHasActiveLoanError
        toast.error(err?.title ?? "Could not remove book", {
          description: err?.detail ?? result.serverError,
        });
      } else {
        toast.success(`"${book.title}" moved to Trash`);
        router.push("/books");
      }
      setConfirmDelete(false);
    });
  }

  function handleRestore() {
    startTransition(async () => {
      const result = await restoreBookAction({ id: book.id });
      if (result?.serverError) {
        const err = parseProblemDetails(result.serverError);
        toast.error(err?.title ?? "Could not restore book", {
          description: err?.detail,
        });
      } else {
        toast.success(`"${book.title}" restored`);
        router.refresh();
      }
      setConfirmRestore(false);
    });
  }

  return (
    <>
      {book.isDeleted ? (
        <>
          <Button variant="secondary" onClick={() => setConfirmRestore(true)} disabled={isPending}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Restore
          </Button>

          {/* Restore confirmation */}
          <Dialog open={confirmRestore} onOpenChange={setConfirmRestore}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Restore book?</DialogTitle>
                <DialogDescription>
                  &ldquo;{book.title}&rdquo; will be restored and appear in the catalog again.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary" disabled={isPending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button onClick={handleRestore} disabled={isPending}>
                  {isPending ? "Restoring…" : "Restore"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <>
          <Button variant="destructive" onClick={() => setConfirmDelete(true)} disabled={isPending}>
            <Trash2 className="h-4 w-4" aria-hidden />
            Remove
          </Button>

          {/* Delete confirmation */}
          <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove book?</DialogTitle>
                <DialogDescription>
                  &ldquo;{book.title}&rdquo; will be moved to Trash. Loan history is preserved. A
                  tenant admin can restore it within 30 days.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary" disabled={isPending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
                  {isPending ? "Removing…" : "Remove"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </>
  );
}

function parseProblemDetails(raw: string): ProblemDetails | null {
  try {
    return JSON.parse(raw) as ProblemDetails;
  } catch {
    return null;
  }
}
