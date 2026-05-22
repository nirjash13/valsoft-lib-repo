"use client";

import { cancelHoldAction } from "@/app/(app)/holds/actions";
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

interface CancelHoldButtonProps {
  holdId: string;
  bookTitle: string;
}

/**
 * Client component: cancels a hold via `cancelHoldAction`.
 *
 * Shows a confirmation dialog before submitting.
 * Renders a success or error toast via Sonner.
 */
export function CancelHoldButton({ holdId, bookTitle }: CancelHoldButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleCancel() {
    startTransition(async () => {
      const result = await cancelHoldAction({ holdId });
      if (result?.serverError) {
        const err = parseProblemDetails(result.serverError);
        toast.error(err?.title ?? "Could not cancel hold", {
          description: err?.detail ?? result.serverError,
        });
      } else {
        toast.success(`Hold for "${bookTitle}" cancelled`);
      }
      setOpen(false);
    });
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)} disabled={isPending}>
        Cancel Hold
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel hold?</DialogTitle>
            <DialogDescription>
              Your hold for &ldquo;{bookTitle}&rdquo; will be removed from the queue. You will lose
              your current position and will need to place a new hold to get back in line.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={isPending}>
                Keep Hold
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleCancel} disabled={isPending}>
              {isPending ? "Cancelling…" : "Cancel Hold"}
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
