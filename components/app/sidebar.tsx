"use client";

import { cn } from "@/lib/utils/cn";
import {
  BarChart2,
  Bell,
  BookMarked,
  BookOpen,
  Library,
  LogOut,
  MessageSquare,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  disabled?: boolean;
}

const BASE_NAV_ITEMS: NavItem[] = [
  { label: "Books", href: "/books", icon: BookOpen },
  { label: "Search", href: "/search", icon: Search },
  { label: "Loans", href: "/loans", icon: BookMarked },
  { label: "Holds", href: "/holds", icon: RotateCcw },
  { label: "Reports", href: "/reports", icon: BarChart2, disabled: true },
];

const TRASH_ITEM: NavItem = { label: "Trash", href: "/books/trash", icon: Trash2 };

/** Nav items visible to librarians and tenant_admins (member:read permission). */
const STAFF_MEMBERS_ITEMS: NavItem[] = [
  { label: "All members", href: "/members", icon: Users },
  { label: "Pending approvals", href: "/members/pending", icon: Users },
];

/** Nav item visible to all authenticated members. */
const MY_PROFILE_ITEM: NavItem = { label: "My profile", href: "/members/me", icon: User };

interface SidebarProps {
  canViewTrash: boolean;
  /** Whether the user can read all members (librarian + tenant_admin). */
  canReadMembers: boolean;
  /** Whether the Reader's Advisor feature flag is ON (REQ-06-10). */
  advisorEnabled: boolean;
  /** Whether the user can compose batch emails (librarian + tenant_admin). */
  canComposeEmail: boolean;
  canViewReports: boolean;
  /** Whether the user can access tenant settings (tenant_admin only). */
  canManageSettings: boolean;
}

export function Sidebar({
  canViewTrash,
  canReadMembers,
  advisorEnabled,
  canComposeEmail,
  canViewReports,
  canManageSettings,
}: SidebarProps) {
  const pathname = usePathname();
  const rawItems = canViewTrash ? [...BASE_NAV_ITEMS, TRASH_ITEM] : BASE_NAV_ITEMS;
  const baseItems = rawItems.map((item) =>
    item.label === "Reports" ? { ...item, disabled: !canViewReports } : item,
  );

  function renderItem(item: NavItem) {
    const isActive = !item.disabled && pathname.startsWith(item.href);
    const Icon = item.icon;

    if (item.disabled) {
      return (
        <span
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-body",
            "text-text-tertiary cursor-not-allowed",
          )}
          aria-disabled="true"
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          {item.label}
        </span>
      );
    }

    return (
      <Link
        href={item.href}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-body",
          "transition-instant transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
          isActive
            ? // REVIEW: bg-[hsl(var(--accent)/0.12)] — opacity variant; needs oklch/rgb token to use Tailwind modifier
              "bg-[hsl(var(--accent)/0.12)] text-accent font-medium"
            : "text-text-secondary hover:bg-elevated hover:text-text-primary",
        )}
        aria-current={isActive ? "page" : undefined}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        {item.label}
      </Link>
    );
  }

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border-subtle bg-surface">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2 px-4 border-b border-border-subtle">
        <Library className="h-5 w-5 text-accent" aria-hidden />
        <span className="text-h3 font-semibold text-text-primary">Stack</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3" aria-label="Main navigation">
        <ul className="space-y-0.5 px-2">
          {baseItems.map((item) => (
            <li key={item.href}>{renderItem(item)}</li>
          ))}

          {/* Members section — visible to staff */}
          {canReadMembers && (
            <>
              <li className="pt-3 pb-1 px-3">
                <span className="text-caption text-text-tertiary font-medium uppercase tracking-wide">
                  Members
                </span>
              </li>
              {STAFF_MEMBERS_ITEMS.map((item) => (
                <li key={item.href}>{renderItem(item)}</li>
              ))}
            </>
          )}

          {/* Notifications — visible to librarians and tenant_admins (email:compose) */}
          {canComposeEmail && (
            <>
              <li className="pt-3 pb-1 px-3">
                <span className="text-caption text-text-tertiary font-medium uppercase tracking-wide">
                  Notifications
                </span>
              </li>
              <li>
                {renderItem({
                  label: "Notifications",
                  href: "/notifications",
                  icon: Bell,
                })}
              </li>
            </>
          )}

          {/* Settings — visible to tenant_admin only (tenant:settings) */}
          {canManageSettings && (
            <>
              <li className="pt-3 pb-1 px-3">
                <span className="text-caption text-text-tertiary font-medium uppercase tracking-wide">
                  Administration
                </span>
              </li>
              <li>
                {renderItem({
                  label: "Settings",
                  href: "/settings",
                  icon: Settings,
                })}
              </li>
            </>
          )}

          {/* My profile + Sign out — all authenticated users */}
          <li className="pt-3 pb-1 px-3">
            <span className="text-caption text-text-tertiary font-medium uppercase tracking-wide">
              Account
            </span>
          </li>
          <li>{renderItem(MY_PROFILE_ITEM)}</li>
          <li>
            <button
              type="button"
              onClick={() => {
                // Build an absolute returnTo URL — Auth0 /v2/logout rejects relative paths.
                // Land on the public catalog (a middleware-bypass path) so we don't bounce
                // through /auth/login and trigger silent SSO re-auth.
                const origin = window.location.origin;
                const returnTo = `${origin}/stack-public/catalog`;
                window.location.href = `/auth/logout?returnTo=${encodeURIComponent(returnTo)}`;
              }}
              className={cn(
                "w-full flex items-center gap-3 rounded-md px-3 py-2 text-body text-left",
                "transition-instant transition-colors",
                "text-text-secondary hover:bg-elevated hover:text-text-primary",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
              )}
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden />
              Sign out
            </button>
          </li>
        </ul>
      </nav>

      {/* Divider + Ask Stack entry (REQ-06-10: gated on advisorEnabled) */}
      <div className="border-t border-border-subtle p-2">
        {advisorEnabled ? (
          <Link
            href="/chat"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-body",
              "transition-instant transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
              pathname.startsWith("/chat")
                ? // REVIEW: bg-[hsl(var(--accent)/0.12)] — opacity variant; needs oklch/rgb token to use Tailwind modifier
                  "bg-[hsl(var(--accent)/0.12)] text-accent font-medium"
                : "text-text-secondary hover:bg-elevated hover:text-text-primary",
            )}
            aria-current={pathname.startsWith("/chat") ? "page" : undefined}
          >
            <MessageSquare className="h-4 w-4 shrink-0" aria-hidden />
            Ask Stack
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
