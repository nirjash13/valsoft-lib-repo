import { Button } from "@/components/ui/button";
import { Library, ShieldAlert } from "lucide-react";
import Link from "next/link";

/**
 * Access-denied page (Spec 01 §7 edge case).
 *
 * Shown when the user authenticated successfully via Auth0 but the JWT carries
 * no `org_id` claim — i.e., the account is not a member of any Auth0
 * Organization, and therefore not provisioned in any Stack library tenant.
 *
 * Reached via redirect from `app/(app)/layout.tsx` when `getSession()` throws
 * `OrganizationMembershipRequiredError`. Lives OUTSIDE the (app) group so it
 * does not re-trigger the same session check that brought us here.
 */
export default function AccessDeniedPage() {
  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-border-subtle bg-surface p-8 shadow-lg">
        {/* Brand */}
        <div className="flex items-center gap-2 mb-6">
          <Library className="h-6 w-6 text-accent" aria-hidden />
          <span className="text-h3 font-semibold text-text-primary">Stack</span>
        </div>

        {/* Icon + heading */}
        <div className="flex items-start gap-3 mb-4">
          <ShieldAlert className="h-6 w-6 text-warning shrink-0 mt-0.5" aria-hidden />
          <h1 className="text-h2 text-text-primary">Account not provisioned</h1>
        </div>

        <p className="text-body text-text-secondary mb-3">
          You're signed in, but your account isn't a member of any Stack library yet.
        </p>

        <p className="text-body text-text-secondary mb-6">
          Ask your administrator to invite your account to the library's organization, or sign in
          with a different account that already has access.
        </p>

        <div className="flex flex-col gap-2">
          <Button asChild>
            <a href="/auth/logout">Log out and try a different account</a>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
