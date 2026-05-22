"use client";

import { updateMemberAdminAction, updateMemberRoleAction } from "@/app/(app)/members/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Member } from "@/lib/db/schema/members";
import {
  type UpdateMemberAdminInput,
  UpdateMemberAdminSchema,
  type UpdateMemberRoleInput,
  UpdateMemberRoleSchema,
} from "@/lib/domain/members/schemas";
import type { ProblemDetails } from "@/lib/utils/problem";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

interface EditMemberFormProps {
  member: Member;
  /** Whether the current user can change the role (tenant_admin only). */
  canChangeRole: boolean;
}

/**
 * Admin member-edit form.
 *
 * Sends two independent requests when both are changed:
 *   1. updateMemberAdminAction — status, displayName, phone
 *   2. updateMemberRoleAction  — role (tenant_admin only)
 *
 * OCC: passes expectedUpdatedAt; shows banner on OPTIMISTIC_CONCURRENCY.
 * Last-admin invariant: server returns LAST_TENANT_ADMIN → specific toast.
 */
export function EditMemberForm({ member, canChangeRole }: EditMemberFormProps) {
  const router = useRouter();
  const [concurrencyConflict, setConcurrencyConflict] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const adminForm = useForm<UpdateMemberAdminInput>({
    resolver: zodResolver(UpdateMemberAdminSchema),
    defaultValues: {
      memberId: member.id,
      expectedUpdatedAt: member.updatedAt.toISOString(),
      displayName: member.displayName,
      phone: member.phone ?? undefined,
      status:
        member.status === "active" || member.status === "inactive" || member.status === "suspended"
          ? member.status
          : undefined,
    },
  });

  const roleForm = useForm<UpdateMemberRoleInput>({
    resolver: zodResolver(UpdateMemberRoleSchema),
    defaultValues: {
      memberId: member.id,
      expectedUpdatedAt: member.updatedAt.toISOString(),
      role:
        member.role === "tenant_admin" || member.role === "librarian" || member.role === "member"
          ? member.role
          : "member",
    },
  });

  async function onSubmit() {
    const adminValues = adminForm.getValues();
    const roleValues = roleForm.getValues();

    setIsPending(true);
    setConcurrencyConflict(false);

    // Submit admin update
    const adminResult = await updateMemberAdminAction(adminValues);

    if (adminResult?.serverError) {
      setIsPending(false);
      const err = parseProblemDetails(adminResult.serverError);
      if (err?.code === "OPTIMISTIC_CONCURRENCY") {
        setConcurrencyConflict(true);
        return;
      }
      toast.error(err?.title ?? "Could not save changes", { description: err?.detail });
      return;
    }

    // Submit role update only if canChangeRole and role field touched
    if (canChangeRole) {
      // Use the updatedAt returned by the admin action (if it ran) so the OCC token
      // reflects the row written in the previous step, not a wall-clock approximation.
      const expectedUpdatedAt = adminResult?.data?.updatedAt ?? member.updatedAt.toISOString();
      const roleResult = await updateMemberRoleAction({
        ...roleValues,
        expectedUpdatedAt,
      });

      if (roleResult?.serverError) {
        setIsPending(false);
        const err = parseProblemDetails(roleResult.serverError);
        if (err?.code === "LAST_TENANT_ADMIN") {
          toast.error("Cannot remove the last admin", {
            description:
              "This member is the only tenant administrator. Promote another member first.",
          });
          return;
        }
        if (err?.code === "OPTIMISTIC_CONCURRENCY") {
          toast.warning("Profile saved, but role update needs a refresh", {
            description: "The profile was saved. Reload the page and update the role again.",
          });
          router.push(`/members/${member.id}/edit`);
          return;
        }
        toast.error(err?.title ?? "Could not update role", { description: err?.detail });
        return;
      }
    }

    setIsPending(false);
    toast.success("Member updated");
    router.push("/members");
  }

  return (
    <div
      className="rounded-xl border border-border-subtle p-5 bg-surface space-y-5"
      aria-label="Edit member form"
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
            <p className="font-medium">Refresh — this member was updated by someone else.</p>
            <p className="text-meta mt-0.5">
              Reload this page to see the latest version before saving again.
            </p>
          </div>
        </div>
      )}

      {/* Display name */}
      <div className="space-y-1.5">
        <Label htmlFor="displayName">Full name</Label>
        <Input
          id="displayName"
          aria-invalid={adminForm.formState.errors.displayName ? "true" : "false"}
          {...adminForm.register("displayName")}
        />
        {adminForm.formState.errors.displayName && (
          <p className="text-meta text-danger" role="alert">
            {adminForm.formState.errors.displayName.message}
          </p>
        )}
      </div>

      {/* Phone */}
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input id="phone" type="tel" {...adminForm.register("phone")} />
      </div>

      {/* Status */}
      <div className="space-y-1.5">
        <Label htmlFor="status">Status</Label>
        {member.status === "pending" || member.status === "rejected" ? (
          <>
            <p className="text-body text-text-secondary capitalize">{member.status}</p>
            <p className="text-caption text-text-tertiary">
              Status is managed via the approval queue and cannot be changed here.
            </p>
          </>
        ) : (
          <>
            <select
              id="status"
              className="w-full rounded-md border border-border-default bg-surface-2 text-body text-text-primary px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              {...adminForm.register("status")}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
            <p className="text-caption text-text-tertiary">
              Setting to inactive or suspended removes borrowing access immediately.
            </p>
          </>
        )}
      </div>

      {/* Role — tenant_admin only */}
      {canChangeRole ? (
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            className="w-full rounded-md border border-border-default bg-surface-2 text-body text-text-primary px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            {...roleForm.register("role")}
          >
            <option value="member">Member</option>
            <option value="librarian">Librarian</option>
            <option value="tenant_admin">Admin</option>
          </select>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>Role</Label>
          <p className="text-body text-text-secondary capitalize">{member.role}</p>
          <p className="text-caption text-text-tertiary">Role changes require admin access.</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="button" onClick={onSubmit} disabled={isPending}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/members")}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
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
