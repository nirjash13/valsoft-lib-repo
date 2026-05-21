"use client";

import { cn } from "@/lib/utils/cn";
import { Moon, Search, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function TopBar({ tenantName }: { tenantName?: string }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Sync theme from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("stack-theme");
    if (saved === "light") {
      setTheme("light");
      document.documentElement.setAttribute("data-theme", "light");
    }
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("stack-theme", next);
    if (next === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 items-center gap-4 px-4",
        "glass-surface border-b border-[hsl(var(--border-subtle))]",
      )}
    >
      {/* Search hint (Cmd+K — Spec 06 full implementation deferred) */}
      <div className="flex-1 max-w-md">
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-meta",
            "bg-[hsl(var(--bg-surface-2))] border border-[hsl(var(--border-subtle))]",
            "text-[hsl(var(--text-tertiary))] transition-instant hover:border-[hsl(var(--border-default))]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))]",
          )}
          aria-label="Search (coming soon)"
          disabled
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span>Search or ask…</span>
          <kbd className="ml-auto rounded border border-[hsl(var(--border-subtle))] px-1.5 py-0.5 text-caption font-mono">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-3">
        {tenantName && (
          <span className="text-meta text-[hsl(var(--text-secondary))] hidden sm:block">
            {tenantName}
          </span>
        )}

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md",
            "text-[hsl(var(--text-secondary))] transition-instant",
            "hover:bg-[hsl(var(--bg-elevated))] hover:text-[hsl(var(--text-primary))]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))]",
          )}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" aria-hidden />
          ) : (
            <Moon className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    </header>
  );
}
