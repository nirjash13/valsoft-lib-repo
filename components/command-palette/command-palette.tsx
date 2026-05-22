"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { BookMarked, MessageSquare, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCommandPalette } from "./command-palette-context";

interface CommandPaletteProps {
  advisorEnabled: boolean;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

type OptionId = "search" | "ask" | "hold";

interface PaletteOption {
  id: OptionId;
  icon: React.ReactNode;
  label: (q: string) => string;
  description: string;
  href: (q: string) => string;
}

function buildOptions(advisorEnabled: boolean): PaletteOption[] {
  const opts: PaletteOption[] = [
    {
      id: "search",
      icon: <Search className="h-4 w-4 shrink-0" aria-hidden />,
      label: (q) => `Search catalog for "${q}"`,
      description: "Browse matching books in your library",
      href: (q) => `/search?q=${encodeURIComponent(q)}`,
    },
  ];

  if (advisorEnabled) {
    opts.push({
      id: "ask",
      icon: <MessageSquare className="h-4 w-4 shrink-0" aria-hidden />,
      label: (q) => `Ask Stack about "${q}"`,
      description: "Get AI-powered reading recommendations",
      href: (q) => `/chat?q=${encodeURIComponent(q)}`,
    });
  }

  opts.push({
    id: "hold",
    icon: <BookMarked className="h-4 w-4 shrink-0" aria-hidden />,
    label: (q) => `Find a book to place a hold — "${q}"`,
    description: "Search for a specific book to reserve",
    href: (q) => `/search?q=${encodeURIComponent(q)}`,
  });

  return opts;
}

/**
 * ⌘K command palette overlay (Spec 06 REQ-06-01, REQ-06-10).
 *
 * - Opens via Cmd+K (Mac) / Ctrl+K (Win) global keydown or programmatically via useCommandPalette().open()
 * - Debounces input 250 ms before showing options
 * - Shows up to 3 options once query > 2 chars; hides "Ask Stack" when advisorEnabled=false
 * - Arrow Up/Down to navigate, Enter to select, Esc to close (Radix Dialog handles Esc + focus trap)
 */
export function CommandPalette({ advisorEnabled }: CommandPaletteProps) {
  const { isOpen, open, close } = useCommandPalette();
  const router = useRouter();

  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = buildOptions(advisorEnabled);

  // Global Cmd/Ctrl+K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        open();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Reset state when the dialog opens
  useEffect(() => {
    if (isOpen) {
      setInputValue("");
      setDebouncedQuery("");
      setActiveIndex(0);
      // Delay focus to allow Radix to mount and manage initial focus
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setInputValue(next);
    setActiveIndex(0);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(next);
    }, DEBOUNCE_MS);
  }, []);

  const showOptions = debouncedQuery.trim().length > MIN_QUERY_LENGTH;

  const selectOption = useCallback(
    (option: PaletteOption) => {
      close();
      router.push(option.href(debouncedQuery.trim()));
    },
    [close, router, debouncedQuery],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showOptions) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = options[activeIndex];
        if (selected) selectOption(selected);
      }
    },
    [showOptions, options, activeIndex, selectOption],
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className={cn("top-[20%] translate-y-0 p-0 gap-0 overflow-hidden", "max-w-xl w-full")}
        // Override default top-1/2 positioning for palette — sits in upper third
        style={{ top: "20%", transform: "translateX(-50%)" }}
      >
        {/* Visually hidden title for screen readers */}
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Type to search the catalog, ask the reading advisor, or find a book to place a hold.
        </DialogDescription>

        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
          <Search className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
          <Input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Search or ask…"
            aria-label="Search or ask"
            aria-expanded={showOptions}
            aria-controls="command-palette-listbox"
            aria-activedescendant={
              showOptions ? `palette-option-${options[activeIndex]?.id ?? ""}` : undefined
            }
            autoComplete="off"
            spellCheck={false}
            className={cn(
              "border-0 shadow-none ring-0 focus-visible:ring-0 focus-visible:border-0",
              "bg-transparent h-8 px-0 text-body",
            )}
          />
          <kbd className="shrink-0 rounded border border-border-subtle px-1.5 py-0.5 text-caption font-mono text-text-tertiary">
            Esc
          </kbd>
        </div>

        {/* Options listbox — div+role is the correct pattern for a custom styled listbox widget */}
        {showOptions && (
          <div
            id="command-palette-listbox"
            role="listbox"
            aria-label="Command options"
            className="py-2"
            tabIndex={-1}
          >
            {options.map((option, index) => (
              <div
                key={option.id}
                id={`palette-option-${option.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 cursor-pointer",
                  "text-body transition-instant",
                  index === activeIndex
                    ? "bg-surface-2 text-text-primary"
                    : "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                )}
                onClick={() => selectOption(option)}
                onMouseEnter={() => setActiveIndex(index)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectOption(option);
                  }
                }}
                tabIndex={-1}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                    index === activeIndex
                      ? "bg-accent/15 text-accent"
                      : "bg-elevated text-text-tertiary",
                  )}
                >
                  {option.icon}
                </span>
                <span className="flex flex-col min-w-0">
                  <span className="truncate font-medium">
                    {option.label(debouncedQuery.trim())}
                  </span>
                  <span className="text-meta text-text-tertiary">{option.description}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Empty / hint state */}
        {!showOptions && (
          <div className="px-4 py-6 text-center text-meta text-text-tertiary">
            {inputValue.length > 0 && inputValue.length <= MIN_QUERY_LENGTH
              ? "Keep typing…"
              : "Type to search, ask, or find books"}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
