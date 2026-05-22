"use client";

import { borrowBookAction } from "@/app/(app)/loans/actions";
import { searchMembersAction } from "@/app/(app)/members/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { MemberSearchResult } from "@/lib/domain/members/search-members";
import { cn } from "@/lib/utils/cn";
import { BookOpen } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface CheckoutButtonProps {
  bookId: string;
  bookTitle: string;
}

/**
 * CheckoutButton — opens a dialog for the librarian to search for a member
 * and check out the book to them by calling borrowBookAction.
 *
 * @permission loan:create (enforced server-side by borrowBookAction)
 * @permission member:read (enforced server-side by searchMembersAction)
 */
export function CheckoutButton({ bookId, bookTitle }: CheckoutButtonProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadonlyArray<MemberSearchResult>>([]);
  const [selected, setSelected] = useState<MemberSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { execute: executeBorrow, isPending: isBorrowPending } = useAction(borrowBookAction, {
    onSuccess: ({ data }) => {
      if (data) {
        toast.success(`Checked out "${bookTitle}" to ${selected?.displayName ?? "member"}`);
        setOpen(false);
      }
    },
    onError: ({ error }) => {
      const serverError = error.serverError;
      if (serverError) {
        try {
          const parsed = JSON.parse(serverError) as { title?: string; detail?: string };
          toast.error(parsed.title ?? "Checkout failed", {
            description: parsed.detail ?? serverError,
          });
        } catch {
          toast.error("Checkout failed", { description: serverError });
        }
      }
    },
  });

  const runSearch = useCallback(async (q: string) => {
    setIsSearching(true);
    try {
      const result = await searchMembersAction({ query: q });
      setResults(result?.data?.members ?? []);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(query);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  // Reset dialog state when opened
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      setSelected(null);
      setResults([]);
      void runSearch("");
    }
  }

  function handleConfirm() {
    if (!selected) return;
    executeBorrow({ bookId, memberId: selected.id });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="default">
          <BookOpen className="h-4 w-4" aria-hidden />
          Check out
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Check out book</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-meta text-text-secondary truncate">
            Checking out: <span className="font-medium text-text-primary">{bookTitle}</span>
          </p>

          {/* Member search input */}
          <Input
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            aria-label="Search members"
            autoFocus
          />

          {/* Results list */}
          <ul
            className="max-h-52 overflow-y-auto rounded-lg border border-border-subtle list-none m-0 p-0"
            aria-label="Member search results"
          >
            {isSearching && <li className="px-4 py-3 text-meta text-text-secondary">Searching…</li>}
            {!isSearching && results.length === 0 && (
              <li className="px-4 py-3 text-meta text-text-secondary">
                No matching members found.
              </li>
            )}
            {!isSearching &&
              results.map((member) => (
                <li key={member.id} className="border-b border-border-subtle last:border-0">
                  <button
                    type="button"
                    onClick={() => setSelected(member)}
                    aria-pressed={selected?.id === member.id}
                    className={cn(
                      "w-full text-left px-4 py-2.5 flex flex-col gap-0.5",
                      "transition-colors",
                      "hover:bg-surface-2 focus-visible:outline-none focus-visible:bg-surface-2",
                      selected?.id === member.id && "bg-accent/10 hover:bg-accent/15",
                    )}
                  >
                    <span className="text-body text-text-primary font-medium">
                      {member.displayName}
                    </span>
                    <span className="text-meta text-text-secondary">{member.email}</span>
                  </button>
                </li>
              ))}
          </ul>

          {selected && (
            <p className="text-meta text-text-secondary">
              Selected:{" "}
              <span className="font-medium text-text-primary">{selected.displayName}</span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleConfirm} disabled={!selected || isBorrowPending}>
            {isBorrowPending ? "Checking out…" : "Confirm checkout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
