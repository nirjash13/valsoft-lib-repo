"use client";

import { cn } from "@/lib/utils/cn";
import {
  BarChart2,
  BookMarked,
  BookOpen,
  Library,
  MessageSquare,
  RotateCcw,
  Settings,
  Trash2,
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
  { label: "Members", href: "/members", icon: Users, disabled: true },
  { label: "Loans", href: "/loans", icon: BookMarked, disabled: true },
  { label: "Holds", href: "/holds", icon: RotateCcw, disabled: true },
  { label: "Reports", href: "/reports", icon: BarChart2, disabled: true },
  { label: "Settings", href: "/settings", icon: Settings, disabled: true },
];

const TRASH_ITEM: NavItem = { label: "Trash", href: "/books/trash", icon: Trash2 };

interface SidebarProps {
  canViewTrash: boolean;
}

export function Sidebar({ canViewTrash }: SidebarProps) {
  const pathname = usePathname();
  const navItems = canViewTrash ? [...BASE_NAV_ITEMS, TRASH_ITEM] : BASE_NAV_ITEMS;

  return (
    <aside className="flex h-full w-56 flex-col border-r border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-surface))]">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2 px-4 border-b border-[hsl(var(--border-subtle))]">
        <Library className="h-5 w-5 text-[hsl(var(--accent))]" aria-hidden />
        <span className="text-h3 font-semibold text-[hsl(var(--text-primary))]">Stack</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3" aria-label="Main navigation">
        <ul className="space-y-0.5 px-2">
          {navItems.map((item) => {
            const isActive = !item.disabled && pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <li key={item.href}>
                {item.disabled ? (
                  <span
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-body",
                      "text-[hsl(var(--text-tertiary))] cursor-not-allowed",
                    )}
                    aria-disabled="true"
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {item.label}
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-body",
                      "transition-instant transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-inset",
                      isActive
                        ? "bg-[hsl(var(--accent)/0.12)] text-[hsl(var(--accent))] font-medium"
                        : "text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-elevated))] hover:text-[hsl(var(--text-primary))]",
                    )}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Divider + Reader Advisor entry */}
      <div className="border-t border-[hsl(var(--border-subtle))] p-2">
        <span
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-body",
            "text-[hsl(var(--text-tertiary))] cursor-not-allowed",
          )}
          aria-disabled="true"
          title="Coming in Spec 06"
        >
          <MessageSquare className="h-4 w-4 shrink-0" aria-hidden />
          Reader Advisor
        </span>
      </div>
    </aside>
  );
}
