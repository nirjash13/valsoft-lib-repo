"use client";

import { placeHoldAction } from "@/app/(app)/holds/actions";
import { Button } from "@/components/ui/button";
import type { ProblemDetails } from "@/lib/utils/problem";
import { BookMarked } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

interface PlaceHoldButtonProps {
  bookId: string;
  memberId: string;
  bookTitle: string;
}

/**
 * Client component: places a hold via `placeHoldAction`.
 *
 * Handles HOLD_ALREADY_EXISTS gracefully (not a hard error — show informational toast).
 * Handles HOLD_NOT_PLACEABLE (book available — suggest borrowing directly).
 * All other server errors shown as error toasts.
 */
export function PlaceHoldButton({ bookId, memberId, bookTitle }: PlaceHoldButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handlePlaceHold() {
    startTransition(async () => {
      const result = await placeHoldAction({ bookId, memberId });
      if (result?.serverError) {
        const err = parseProblemDetails(result.serverError);
        if (err?.code === "HOLD_ALREADY_EXISTS") {
          toast.info("You already have a hold on this book.");
        } else if (err?.code === "HOLD_NOT_PLACEABLE") {
          toast.info("This book is currently available — borrow it directly instead.", {
            description: "Holds are only for books that are currently checked out.",
          });
        } else {
          toast.error(err?.title ?? "Could not place hold", {
            description: err?.detail ?? result.serverError,
          });
        }
      } else {
        const position = result?.data?.position;
        toast.success(
          position !== undefined
            ? `Hold placed — you are #${position} in the queue`
            : `Hold placed for "${bookTitle}"`,
        );
      }
    });
  }

  return (
    <Button onClick={handlePlaceHold} disabled={isPending} variant="secondary">
      <BookMarked className="h-4 w-4" aria-hidden />
      {isPending ? "Placing hold…" : "Place Hold"}
    </Button>
  );
}

function parseProblemDetails(raw: string): ProblemDetails | null {
  try {
    return JSON.parse(raw) as ProblemDetails;
  } catch {
    return null;
  }
}
