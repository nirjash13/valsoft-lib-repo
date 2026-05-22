"use client";

import { updateMemberAction } from "@/app/(app)/members/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Member } from "@/lib/db/schema/members";
import { type UpdateMemberInput, UpdateMemberSchema } from "@/lib/domain/members/schemas";
import type { ProblemDetails } from "@/lib/utils/problem";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

interface EditProfileFormProps {
  member: Member;
}

/**
 * Member self-profile edit form (REQ-04-09).
 *
 * Editable: displayName, phone. Email is read-only (Auth0-owned).
 * OCC: passes expectedUpdatedAt; shows OPTIMISTIC_CONCURRENCY banner.
 */
export function EditProfileForm({ member }: EditProfileFormProps) {
  const [concurrencyConflict, setConcurrencyConflict] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateMemberInput>({
    resolver: zodResolver(UpdateMemberSchema),
    defaultValues: {
      memberId: member.id,
      expectedUpdatedAt: member.updatedAt.toISOString(),
      displayName: member.displayName,
      phone: member.phone ?? undefined,
    },
  });

  async function onSubmit(input: UpdateMemberInput) {
    setIsPending(true);
    setConcurrencyConflict(false);

    const result = await updateMemberAction(input);

    setIsPending(false);

    if (result?.serverError) {
      const err = parseProblemDetails(result.serverError);
      if (err?.code === "OPTIMISTIC_CONCURRENCY") {
        setConcurrencyConflict(true);
        return;
      }
      toast.error(err?.title ?? "Could not save changes", { description: err?.detail });
      return;
    }

    toast.success("Profile updated");
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="rounded-xl border border-border-subtle p-5 bg-surface space-y-5"
      aria-label="Edit profile form"
      noValidate
    >
      {/* Concurrency conflict banner */}
      {concurrencyConflict && (
        <div
          className="flex items-start gap-2 rounded-lg px-4 py-3 text-body border"
          style={{
            background: "hsl(var(--warning)/0.08)",
            borderColor: "hsl(var(--warning)/0.3)",
            color: "hsl(var(--warning))",
          }}
          role="alert"
          aria-live="assertive"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Refresh — your profile was updated elsewhere.</p>
            <p className="text-meta mt-0.5">Reload this page to see the latest version.</p>
          </div>
        </div>
      )}

      {/* Hidden fields */}
      <input type="hidden" {...register("memberId")} />
      <input type="hidden" {...register("expectedUpdatedAt")} />

      {/* Email — read-only */}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          type="email"
          value={member.email}
          readOnly
          disabled
          aria-readonly="true"
          className="opacity-60"
        />
        <p className="text-caption text-text-tertiary">
          Email is managed by your login provider and cannot be changed here.
        </p>
      </div>

      {/* Display name */}
      <div className="space-y-1.5">
        <Label htmlFor="displayName">Full name</Label>
        <Input
          id="displayName"
          autoComplete="name"
          aria-invalid={errors.displayName ? "true" : "false"}
          {...register("displayName")}
        />
        {errors.displayName && (
          <p className="text-meta text-danger" role="alert">
            {errors.displayName.message}
          </p>
        )}
      </div>

      {/* Phone */}
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone number (optional)</Label>
        <Input
          id="phone"
          type="tel"
          autoComplete="tel"
          aria-invalid={errors.phone ? "true" : "false"}
          {...register("phone")}
        />
        {errors.phone && (
          <p className="text-meta text-danger" role="alert">
            {errors.phone.message}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function parseProblemDetails(raw: string): ProblemDetails | null {
  try {
    return JSON.parse(raw) as ProblemDetails;
  } catch {
    return null;
  }
}
