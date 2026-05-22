"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type SelfSignupInput, SelfSignupSchema } from "@/lib/domain/members/schemas";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

interface SignupFormProps {
  /** Resolved tenant slug — sent as query param to the signup Route Handler. */
  tenantSlug: string;
}

/**
 * Public self-signup form (REQ-04-02).
 *
 * POSTs to /api/members/signup with ?slug=<tenantSlug>.
 * On success: shows a confirmation panel.
 * On duplicate email (409 MEMBER_ALREADY_EXISTS): surfaces a friendly message.
 * On validation errors: shows field-level messages via react-hook-form.
 */
export function SignupForm({ tenantSlug }: SignupFormProps) {
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SelfSignupInput>({
    resolver: zodResolver(SelfSignupSchema),
    defaultValues: {
      agreedToTerms: true,
    },
  });

  async function onSubmit(data: SelfSignupInput) {
    setIsPending(true);
    setServerError(null);

    try {
      const res = await fetch(`/api/members/signup?slug=${encodeURIComponent(tenantSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        setSuccess(true);
        return;
      }

      const body = await res.json().catch(() => null);
      const code = (body as { code?: string } | null)?.code;

      if (code === "MEMBER_ALREADY_EXISTS") {
        setServerError(
          "This email already has an account at this library. Try signing in, or contact your librarian.",
        );
      } else if (code === "TENANT_NOT_FOUND") {
        setServerError("Library not found. Please check your signup link.");
      } else {
        const detail = (body as { detail?: string } | null)?.detail;
        setServerError(detail ?? "Something went wrong. Please try again.");
      }
    } catch {
      setServerError("Unable to connect. Please check your connection and try again.");
    } finally {
      setIsPending(false);
    }
  }

  if (success) {
    return (
      <output className="flex flex-col items-center gap-4 py-6 text-center" aria-live="polite">
        <CheckCircle className="h-12 w-12 text-success" aria-hidden />
        <h2 className="text-h2 text-text-primary">Request received</h2>
        <p className="text-body text-text-secondary max-w-sm">
          A librarian will review your application and approve it shortly. You will receive an email
          invitation once your account is ready.
        </p>
      </output>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-5"
      aria-label="Member signup form"
      noValidate
    >
      {/* Server error banner */}
      {serverError && (
        <div
          className="rounded-lg px-4 py-3 text-body border"
          style={{
            background: "hsl(var(--danger)/0.08)",
            borderColor: "hsl(var(--danger)/0.3)",
            color: "hsl(var(--danger))",
          }}
          role="alert"
          aria-live="assertive"
        >
          {serverError}
        </div>
      )}

      {/* Hidden agreed-to-terms (pre-set true; displayed as checkbox below) */}
      <input type="hidden" {...register("agreedToTerms", { value: true })} />

      {/* Display name */}
      <div className="space-y-1.5">
        <Label htmlFor="displayName">
          Full name{" "}
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        </Label>
        <Input
          id="displayName"
          autoComplete="name"
          aria-required="true"
          aria-invalid={errors.displayName ? "true" : "false"}
          {...register("displayName")}
        />
        {errors.displayName && (
          <p className="text-meta text-danger" role="alert">
            {errors.displayName.message}
          </p>
        )}
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <Label htmlFor="email">
          Email address{" "}
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-required="true"
          aria-invalid={errors.email ? "true" : "false"}
          {...register("email")}
        />
        {errors.email && (
          <p className="text-meta text-danger" role="alert">
            {errors.email.message}
          </p>
        )}
      </div>

      {/* Phone (optional) */}
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

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Submitting…" : "Request membership"}
      </Button>
    </form>
  );
}
