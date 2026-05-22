"use client";

import { renewLoanAction } from "@/app/(app)/loans/actions";
import { Button } from "@/components/ui/button";
import type { ProblemDetails } from "@/lib/utils/problem";
import { RotateCcw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

interface RenewButtonProps {
  loanId: string;
  /** ISO-8601 updatedAt — optimistic concurrency token (RenewLoanSchema.expectedUpdatedAt). */
  expectedUpdatedAt: string;
  canRenew: boolean;
  /** Human-readable reason why renewal is blocked (shown as button tooltip). */
  blockedReason?: string | undefined;
}

/**
 * Client component: renews a loan via `renewLoanAction`.
 *
 * Disabled when `canRenew=false` (limit reached or hold blocking).
 * On OPTIMISTIC_CONCURRENCY (409) shows a specific "refresh and retry" toast.
 * All other server errors show a generic error toast.
 */
export function RenewButton({
  loanId,
  expectedUpdatedAt,
  canRenew,
  blockedReason,
}: RenewButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleRenew() {
    startTransition(async () => {
      const result = await renewLoanAction({ loanId, expectedUpdatedAt });
      if (result?.serverError) {
        const err = parseProblemDetails(result.serverError);
        if (err?.code === "OPTIMISTIC_CONCURRENCY") {
          toast.error("Loan was updated elsewhere — refresh and retry.", {
            description:
              "Someone else modified this loan. Reload the page to see the latest state.",
          });
        } else if (err?.code === "RENEWAL_BLOCKED_BY_HOLD") {
          toast.error("Cannot renew — another member is waiting", {
            description: err.detail,
          });
        } else if (err?.code === "RENEWAL_LIMIT_REACHED") {
          toast.error("Renewal limit reached", {
            description: err?.detail ?? "This loan has reached its maximum renewals.",
          });
        } else {
          toast.error(err?.title ?? "Could not renew loan", {
            description: err?.detail ?? result.serverError,
          });
        }
      } else {
        toast.success("Loan renewed");
      }
    });
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleRenew}
      disabled={!canRenew || isPending}
      title={!canRenew && blockedReason ? blockedReason : undefined}
      aria-disabled={!canRenew || isPending}
    >
      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
      {isPending ? "Renewing…" : "Renew"}
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
