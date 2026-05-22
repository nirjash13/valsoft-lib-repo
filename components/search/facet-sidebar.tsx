"use client";

import type { Facets } from "@/lib/domain/search/schemas";
import { cn } from "@/lib/utils/cn";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

interface FacetSidebarProps {
  facets: Facets;
  /** Active filter values from the URL searchParams. */
  activeSubjects: string[];
  activeLanguage: string | undefined;
  activeAvailability: "in_stock" | "on_loan" | undefined;
  activeYearFrom: number | undefined;
  activeYearTo: number | undefined;
}

/**
 * Facet sidebar — renders subject, language, availability, and year-decade facets.
 * Selecting/deselecting a facet updates the URL so the RSC re-renders with filters.
 */
export function FacetSidebar({
  facets,
  activeSubjects,
  activeLanguage,
  activeAvailability,
  activeYearFrom,
  activeYearTo,
}: FacetSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [subjectsExpanded, setSubjectsExpanded] = useState(true);
  const [langExpanded, setLangExpanded] = useState(true);

  const buildParams = useCallback(
    (overrides: Record<string, string | string[] | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      // Always reset cursor on filter change
      params.delete("cursor");

      for (const [key, val] of Object.entries(overrides)) {
        if (val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) {
          params.delete(key);
        } else if (Array.isArray(val)) {
          params.delete(key);
          for (const v of val) params.append(key, v);
        } else {
          params.set(key, val);
        }
      }
      return params.toString();
    },
    [searchParams],
  );

  const navigate = useCallback(
    (qs: string) => {
      startTransition(() => {
        router.replace(`/search?${qs}`);
      });
    },
    [router],
  );

  const toggleSubject = useCallback(
    (subject: string) => {
      const next = activeSubjects.includes(subject)
        ? activeSubjects.filter((s) => s !== subject)
        : [...activeSubjects, subject];
      navigate(buildParams({ subjects: next }));
    },
    [activeSubjects, buildParams, navigate],
  );

  const toggleAvailability = useCallback(
    (value: "in_stock" | "on_loan") => {
      const next = activeAvailability === value ? undefined : value;
      navigate(buildParams({ availability: next }));
    },
    [activeAvailability, buildParams, navigate],
  );

  const toggleLanguage = useCallback(
    (lang: string) => {
      const next = activeLanguage === lang ? undefined : lang;
      navigate(buildParams({ language: next }));
    },
    [activeLanguage, buildParams, navigate],
  );

  const toggleDecade = useCallback(
    (decade: number) => {
      const isActive = activeYearFrom === decade && activeYearTo === decade + 9;
      if (isActive) {
        navigate(buildParams({ yearFrom: undefined, yearTo: undefined }));
      } else {
        navigate(buildParams({ yearFrom: String(decade), yearTo: String(decade + 9) }));
      }
    },
    [activeYearFrom, activeYearTo, buildParams, navigate],
  );

  const hasAnyFacets =
    facets.subjects.length > 0 ||
    facets.languages.length > 0 ||
    facets.yearBuckets.length > 0 ||
    facets.availability.inStock > 0 ||
    facets.availability.onLoan > 0;

  if (!hasAnyFacets) return null;

  return (
    <aside className="w-56 shrink-0 flex flex-col gap-5" aria-label="Search filters">
      {/* Subjects */}
      {facets.subjects.length > 0 && (
        <FacetGroup
          label="Subjects"
          expanded={subjectsExpanded}
          onToggle={() => setSubjectsExpanded((v) => !v)}
        >
          <ul className="space-y-0.5 list-none m-0 p-0">
            {facets.subjects.map((bucket) => (
              <FacetOption
                key={bucket.value}
                label={bucket.value}
                count={bucket.count}
                active={activeSubjects.includes(bucket.value)}
                onToggle={() => toggleSubject(bucket.value)}
              />
            ))}
          </ul>
        </FacetGroup>
      )}

      {/* Availability */}
      {(facets.availability.inStock > 0 || facets.availability.onLoan > 0) && (
        <FacetGroup label="Availability">
          <ul className="space-y-0.5 list-none m-0 p-0">
            {facets.availability.inStock > 0 && (
              <FacetOption
                label="Available now"
                count={facets.availability.inStock}
                active={activeAvailability === "in_stock"}
                onToggle={() => toggleAvailability("in_stock")}
              />
            )}
            {facets.availability.onLoan > 0 && (
              <FacetOption
                label="On loan"
                count={facets.availability.onLoan}
                active={activeAvailability === "on_loan"}
                onToggle={() => toggleAvailability("on_loan")}
              />
            )}
          </ul>
        </FacetGroup>
      )}

      {/* Language */}
      {facets.languages.length > 0 && (
        <FacetGroup
          label="Language"
          expanded={langExpanded}
          onToggle={() => setLangExpanded((v) => !v)}
        >
          <ul className="space-y-0.5 list-none m-0 p-0">
            {facets.languages.map((bucket) => (
              <FacetOption
                key={bucket.value}
                label={bucket.value.toUpperCase()}
                count={bucket.count}
                active={activeLanguage === bucket.value}
                onToggle={() => toggleLanguage(bucket.value)}
              />
            ))}
          </ul>
        </FacetGroup>
      )}

      {/* Year (decade) */}
      {facets.yearBuckets.length > 0 && (
        <FacetGroup label="Published">
          <ul className="space-y-0.5 list-none m-0 p-0">
            {facets.yearBuckets.map((bucket) => {
              const isActive =
                activeYearFrom === bucket.decade && activeYearTo === bucket.decade + 9;
              return (
                <FacetOption
                  key={bucket.decade}
                  label={`${bucket.decade}s`}
                  count={bucket.count}
                  active={isActive}
                  onToggle={() => toggleDecade(bucket.decade)}
                />
              );
            })}
          </ul>
        </FacetGroup>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FacetGroup({
  label,
  expanded = true,
  onToggle,
  children,
}: {
  label: string;
  expanded?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-center justify-between mb-2",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded",
          onToggle ? "cursor-pointer" : "cursor-default pointer-events-none",
        )}
        aria-expanded={expanded}
      >
        <span className="text-caption text-text-tertiary">{label}</span>
        {onToggle &&
          (expanded ? (
            <ChevronUp className="h-3 w-3 text-text-tertiary" aria-hidden />
          ) : (
            <ChevronDown className="h-3 w-3 text-text-tertiary" aria-hidden />
          ))}
      </button>
      {expanded && children}
    </div>
  );
}

function FacetOption({
  label,
  count,
  active,
  onToggle,
}: {
  label: string;
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-center justify-between rounded px-2 py-1.5 text-meta",
          "transition-instant transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          active
            ? "bg-accent/10 text-accent font-medium"
            : "text-text-secondary hover:bg-elevated hover:text-text-primary",
        )}
        aria-pressed={active}
      >
        <span className="truncate text-left">{label}</span>
        <span
          className={cn(
            "ml-2 shrink-0 tabular-nums text-caption",
            active ? "text-accent" : "text-text-tertiary",
          )}
        >
          {count}
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// ActiveFilterChips — removable chips for selected facets
// ---------------------------------------------------------------------------

interface ActiveFilterChipsProps {
  activeSubjects: string[];
  activeLanguage: string | undefined;
  activeAvailability: "in_stock" | "on_loan" | undefined;
  activeYearFrom: number | undefined;
  activeYearTo: number | undefined;
}

export function ActiveFilterChips({
  activeSubjects,
  activeLanguage,
  activeAvailability,
  activeYearFrom,
  activeYearTo,
}: ActiveFilterChipsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const removeParam = useCallback(
    (key: string, value?: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("cursor");
      if (key === "subjects" && value) {
        const remaining = params.getAll("subjects").filter((s) => s !== value);
        params.delete("subjects");
        for (const s of remaining) params.append("subjects", s);
      } else {
        params.delete(key);
      }
      startTransition(() => {
        router.replace(`/search?${params.toString()}`);
      });
    },
    [router, searchParams],
  );

  const chips: Array<{ key: string; label: string; remove: () => void }> = [];

  for (const subject of activeSubjects) {
    chips.push({
      key: `subject:${subject}`,
      label: subject,
      remove: () => removeParam("subjects", subject),
    });
  }
  if (activeLanguage) {
    chips.push({
      key: "language",
      label: activeLanguage.toUpperCase(),
      remove: () => removeParam("language"),
    });
  }
  if (activeAvailability) {
    chips.push({
      key: "availability",
      label: activeAvailability === "in_stock" ? "Available now" : "On loan",
      remove: () => removeParam("availability"),
    });
  }
  if (activeYearFrom !== undefined) {
    chips.push({
      key: "year",
      label: `${activeYearFrom}–${activeYearTo ?? activeYearFrom + 9}`,
      remove: () => {
        // Build ONE updated params object removing both year keys, then issue
        // a single router.replace to avoid the stale-snapshot race where the
        // second removeParam call overwrites the first using the old searchParams.
        const params = new URLSearchParams(searchParams.toString());
        params.delete("cursor");
        params.delete("yearFrom");
        params.delete("yearTo");
        startTransition(() => {
          router.replace(`/search?${params.toString()}`);
        });
      },
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Active filters">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1",
            "bg-accent/10 text-accent text-meta font-medium",
            "border border-accent/20",
          )}
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.remove}
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            aria-label={`Remove ${chip.label} filter`}
          >
            <X className="h-2.5 w-2.5" aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}
