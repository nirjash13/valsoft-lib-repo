"use client";

import { returnBookAction } from "@/app/(app)/loans/actions";
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
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface ReturnButtonProps {
  loanId: string;
  bookTitle: string;
}

/**
 * Client component: returns a loan via `returnBookAction`.
 *
 * Shows a confirmation dialog before submitting.
 * Renders a success or error toast via Sonner.
 */
export function ReturnButton({ loanId, bookTitle }: ReturnButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleReturn() {
    startTransition(async () => {
      const result = await returnBookAction({ loanId });
      if (result?.serverError) {
        const err = parseProblemDetails(result.serverError);
        toast.error(err?.title ?? "Could not return book", {
          description: err?.detail ?? result.serverError,
        });
      } else {
        toast.success(`"${bookTitle}" returned`);
      }
      setOpen(false);
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={isPending}>
        Return
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return book?</DialogTitle>
            <DialogDescription>
              Mark &ldquo;{bookTitle}&rdquo; as returned. This will notify the next member in the
              hold queue if one exists.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={handleReturn} disabled={isPending}>
              {isPending ? "Returning…" : "Confirm Return"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
