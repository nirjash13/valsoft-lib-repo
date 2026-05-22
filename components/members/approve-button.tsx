"use client";

import { approveMemberAction } from "@/app/(app)/members/actions";
import { Button } from "@/components/ui/button";
import type { ProblemDetails } from "@/lib/utils/problem";
import { Check } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

interface ApproveButtonProps {
  memberId: string;
  expectedUpdatedAt: string;
}

/**
 * Client component: approves a pending member via `approveMemberAction`.
 *
 * Handles OPTIMISTIC_CONCURRENCY (another librarian acted first) and
 * MEMBER_NOT_PENDING (already processed) gracefully via toast.
 */
export function ApproveButton({ memberId, expectedUpdatedAt }: ApproveButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleApprove() {
    startTransition(async () => {
      const result = await approveMemberAction({ memberId, expectedUpdatedAt });
      if (result?.serverError) {
        const err = parseProblemDetails(result.serverError);
        if (err?.code === "OPTIMISTIC_CONCURRENCY") {
          toast.error("Already processed", {
            description:
              "This member was updated by someone else. Refresh to see the latest state.",
          });
        } else if (err?.code === "MEMBER_NOT_PENDING") {
          toast.error("Member is not pending", {
            description: "This member's status has already been changed.",
          });
        } else {
          toast.error(err?.title ?? "Could not approve member", {
            description: err?.detail,
          });
        }
      } else {
        toast.success("Member approved");
      }
    });
  }

  return (
    <Button size="sm" onClick={handleApprove} disabled={isPending} aria-disabled={isPending}>
      <Check className="h-3.5 w-3.5" aria-hidden />
      {isPending ? "Approving…" : "Approve"}
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
