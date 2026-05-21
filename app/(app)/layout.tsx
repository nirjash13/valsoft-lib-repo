import { Sidebar } from "@/components/app/sidebar";
import { TopBar } from "@/components/app/topbar";
import { buildAbility } from "@/lib/auth/ability";
import { getSession } from "@/lib/auth/session";
import { Toaster } from "sonner";

/**
 * (app) layout — authenticated shell.
 *
 * Renders:
 *   - Left sidebar with navigation (Books, Members, Loans…)
 *   - Glass top bar with search hint and theme toggle
 *   - Main content area
 *   - Sonner toast region (aria-live="polite")
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const ability = buildAbility(session?.roles ?? []);
  const canViewTrash = ability.can("delete", "Book");

  return (
    <div className="flex h-screen overflow-hidden bg-[hsl(var(--bg-canvas))]">
      {/* Sidebar */}
      <Sidebar canViewTrash={canViewTrash} />

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
    </div>
  );
}
