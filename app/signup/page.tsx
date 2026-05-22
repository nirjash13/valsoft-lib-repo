import { Library } from "lucide-react";
import { SignupForm } from "./signup-form";

interface SignupPageProps {
  searchParams: Promise<{ tenant?: string }>;
}

/**
 * Public member self-signup page (REQ-04-02, FU-04-B-2).
 *
 * OUTSIDE the (app) group — no auth required.
 * Resolves tenant slug from ?tenant= searchParam (fallback: "demo" for local dev).
 *
 * In production the middleware sets X-Tenant-Slug from the subdomain, so the
 * Route Handler reads from the header; this page's slug is surfaced in the URL
 * purely for the form's POST target query param (a convenience for multi-tenant
 * demo environments where there is no subdomain).
 */
export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const tenantSlug = params.tenant ?? "demo";

  return (
    <div className="w-full max-w-md">
      {/* Card */}
      <div className="rounded-2xl border border-border-subtle bg-surface p-8 shadow-lg">
        {/* Brand header */}
        <div className="flex items-center gap-2 mb-2">
          <Library className="h-6 w-6 text-accent" aria-hidden />
          <span className="text-h3 font-semibold text-text-primary">Stack</span>
        </div>

        <h1 className="text-h2 text-text-primary mb-1">Request membership</h1>
        <p className="text-body text-text-secondary mb-6">
          Fill in your details and a librarian will approve your account.
        </p>

        <SignupForm tenantSlug={tenantSlug} />
      </div>

      <p className="text-caption text-text-tertiary text-center mt-4">
        Already a member?{" "}
        <a href="/api/auth/login" className="text-accent hover:underline underline-offset-2">
          Sign in
        </a>
      </p>
    </div>
  );
}
