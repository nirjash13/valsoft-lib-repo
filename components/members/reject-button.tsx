"use client";

import { rejectMemberAction } from "@/app/(app)/members/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProblemDetails } from "@/lib/utils/problem";
import { X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface RejectButtonProps {
  memberId: string;
  expectedUpdatedAt: string;
}

/**
 * Client component: rejects a pending member with an optional reason.
 *
 * Renders a small inline confirmation UI (no modal dependency).
 * Handles OPTIMISTIC_CONCURRENCY and MEMBER_NOT_PENDING gracefully.
 */
export function RejectButton({ memberId, expectedUpdatedAt }: RejectButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleReject() {
    startTransition(async () => {
      const result = await rejectMemberAction({
        memberId,
        expectedUpdatedAt,
        rejectionReason: reason.trim() || "Application declined",
      });
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
          toast.error(err?.title ?? "Could not reject member", {
            description: err?.detail,
          });
        }
        setConfirming(false);
      } else {
        toast.success("Member rejected");
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setConfirming(true)}
        disabled={isPending}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
        Reject
      </Button>
    );
  }

  return (
    <fieldset
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-elevated p-3"
      aria-label="Confirm rejection"
    >
      <div className="space-y-1">
        <Label htmlFor={`reason-${memberId}`} className="text-caption">
          Reason (optional)
        </Label>
        <Input
          id={`reason-${memberId}`}
          placeholder="Application declined"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          disabled={isPending}
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={handleReject}
          disabled={isPending}
          aria-disabled={isPending}
        >
          {isPending ? "Rejecting…" : "Confirm reject"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}

function parseProblemDetails(raw: string): ProblemDetails | null {
  try {
    return JSON.parse(raw) as ProblemDetails;
  } catch {
    return null;
  }
}
