import { Sidebar } from "@/components/app/sidebar";
import { TopBar } from "@/components/app/topbar";
import { CommandPalette, CommandPaletteProvider } from "@/components/command-palette";
import { buildAbility } from "@/lib/auth/ability";
import { OrganizationMembershipRequiredError, UnauthorizedError } from "@/lib/auth/errors";
import { getSession, sessionToTenantCtx } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { getMemberByUserId } from "@/lib/domain/members/get-member-by-user-id";
import { isFeatureEnabled } from "@/lib/flags";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";

/** Maps the JWT roles array to a single human-readable label for the sidebar. */
function roleLabel(roles: readonly string[]): string {
  if (roles.includes("tenant_admin")) return "Admin";
  if (roles.includes("librarian")) return "Librarian";
  if (roles.includes("member")) return "Member";
  return "User";
}

/**
 * (app) layout — authenticated shell.
 *
 * Auth gate: Auth0 SDK v4's middleware attaches the session but does NOT
 * auto-redirect unauthenticated or unprovisioned users. We handle two cases:
 *   - No session → /auth/login
 *   - Session exists but JWT has no org_id (user not a member of any Auth0
 *     Organization) → /access-denied (a friendly page with a logout link).
 *     getSession() throws OrganizationMembershipRequiredError in this case;
 *     left uncaught it surfaces as a cryptic 500.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let session: Session | null;
  try {
    session = await getSession();
  } catch (err) {
    if (err instanceof OrganizationMembershipRequiredError) {
      redirect("/access-denied");
    }
    if (err instanceof UnauthorizedError) {
      redirect("/auth/login");
    }
    throw err;
  }
  if (!session) {
    redirect("/auth/login");
  }
  const ability = buildAbility(session.roles);
  const canViewTrash = ability.can("delete", "Book");
  const canReadMembers = ability.can("read", "Member");
  const canComposeEmail = ability.can("compose", "Email");
  const canViewReports = ability.can("view", "Report");
  const canManageSettings = ability.can("settings", "Tenant");
  // Resolved here so Builder F (⌘K palette) can reuse it from this same layout.
  const advisorEnabled = await isFeatureEnabled("readers_advisor");

  // Sidebar identity card — display name from members.display_name (authoritative),
  // falling back to the email local-part if the row is not yet linked.
  const tenantCtx = await sessionToTenantCtx(session);
  const member = await withTenantTx(tenantCtx, (tx) =>
    getMemberByUserId(tx, tenantCtx, session.sub),
  );
  const userName = member?.displayName ?? session.email.split("@")[0] ?? "User";
  const userRoleLabel = roleLabel(session.roles);

  return (
    <CommandPaletteProvider>
      <div className="flex h-screen overflow-hidden bg-canvas">
        {/* Sidebar */}
        <Sidebar
          canViewTrash={canViewTrash}
          canReadMembers={canReadMembers}
          advisorEnabled={advisorEnabled}
          canComposeEmail={canComposeEmail}
          canViewReports={canViewReports}
          canManageSettings={canManageSettings}
          userName={userName}
          userRoleLabel={userRoleLabel}
        />

        {/* Right side: topbar + scrollable content */}
        <div className="flex flex-1 flex-col min-w-0">
          <TopBar tenantName="Demo Library" />
          <main className="flex-1 overflow-y-auto p-6" id="main-content">
            {children}
          </main>
        </div>

        {/* Sonner toast container — aria-live="polite" per brief §Accessibility */}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "hsl(var(--bg-elevated))",
              color: "hsl(var(--text-primary))",
              border: "1px solid hsl(var(--border-subtle))",
            },
          }}
        />

        {/* ⌘K command palette — app-wide, gated by advisorEnabled (REQ-06-10) */}
        <CommandPalette advisorEnabled={advisorEnabled} />
      </div>
    </CommandPaletteProvider>
  );
}
