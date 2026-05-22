"use client";

import { createBookAction, previewIsbnAction } from "@/app/(app)/books/actions";
import { IsbnBanner } from "@/components/books/isbn-banner";
import type { PreviewState } from "@/components/books/isbn-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PreviewResult } from "@/lib/domain/books/preview-isbn";
import { type CreateBookInput, CreateBookSchema } from "@/lib/domain/books/schemas";
import type { BookRecord } from "@/lib/domain/books/schemas";
import { coverGradient } from "@/lib/utils/cover-color";
import type { ProblemDetails } from "@/lib/utils/problem";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info, Search } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

/**
 * NewBookForm — ISBN preview + manual entry form.
 *
 * Flow:
 * 1. User pastes ISBN → previewIsbnAction → preview shown in the form
 * 2. User reviews / edits fields
 * 3. User clicks Save → createBookAction → redirect to /books/:id
 *
 * BDD scenarios covered:
 *   REQ-02-01 happy path: ISBN found, preview renders
 *   REQ-02-01 both-sources-empty: not_found banner
 *   REQ-02-02 schema rejection: inline field errors
 *   REQ-02-10 no-ISBN: requires title + author
 */
export function NewBookForm() {
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [isbnInput, setIsbnInput] = useState("");
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const [isSavePending, startSaveTransition] = useTransition();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CreateBookInput>({
    resolver: zodResolver(CreateBookSchema),
    defaultValues: {
      authors: [],
    },
  });

  // Populate form from preview data
  const applyPreview = useCallback(
    (data: BookRecord) => {
      if (data.title) setValue("title", data.title, { shouldValidate: false });
      if (data.authors && data.authors.length > 0)
        setValue("authors", data.authors, { shouldValidate: false });
      if (data.isbn13) setValue("isbn13", data.isbn13, { shouldValidate: false });
      if (data.year) setValue("year", data.year, { shouldValidate: false });
      if (data.publisher) setValue("publisher", data.publisher, { shouldValidate: false });
      if (data.pageCount) setValue("pageCount", data.pageCount, { shouldValidate: false });
      if (data.description) setValue("description", data.description, { shouldValidate: false });
      if (data.language) setValue("language", data.language, { shouldValidate: false });
      if (data.subjects) setValue("subjects", data.subjects, { shouldValidate: false });
      if (data.coverUrl) setValue("coverUrl", data.coverUrl, { shouldValidate: false });
    },
    [setValue],
  );

  function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    if (!isbnInput.trim()) return;

    startPreviewTransition(async () => {
      setPreview({ kind: "loading" });
      const result = await previewIsbnAction({ rawIsbn: isbnInput.trim() });

      if (result?.serverError) {
        const err = parseProblemDetails(result.serverError);
        setPreview({ kind: "error", message: err?.detail ?? result.serverError });
        return;
      }

      const preview = result?.data as PreviewResult | undefined;
      if (!preview) {
        setPreview({ kind: "not_found" });
        // Pre-fill ISBN so the librarian doesn't retype it
        setValue(
          "isbn13",
          isbnInput
            .trim()
            .replace(/[^0-9X]/g, "")
            .slice(0, 13),
        );
        return;
      }

      const { record, sourcesDiff } = preview;

      // If the record has no title, both sources returned nothing
      if (!record.title) {
        setPreview({ kind: "not_found" });
        setValue("isbn13", preview.isbn13);
        return;
      }

      setPreview({
        kind: "found",
        data: record,
        sourceDiffs: sourcesDiff as Record<string, string>,
      });
      applyPreview(record as BookRecord);
    });
  }

  function onSubmit(input: CreateBookInput) {
    startSaveTransition(async () => {
      const result = await createBookAction(input);
      if (result?.serverError) {
        const err = parseProblemDetails(result.serverError);
        toast.error(err?.title ?? "Could not save book", { description: err?.detail });
        return;
      }
      const newId = (result?.data as { id?: string } | undefined)?.id;
      toast.success(`"${input.title}" added to the catalog`);
      if (newId) {
        router.push(`/books/${newId}`);
      } else {
        router.push("/books");
      }
    });
  }

  const previewData = preview.kind === "found" ? preview.data : null;

  return (
    <div className="flex flex-col gap-8">
      {/* ISBN lookup */}
      <section
        className="rounded-xl border border-border-subtle p-5 bg-surface"
        aria-label="ISBN lookup"
      >
        <h2 className="text-h3 text-text-primary mb-1">ISBN Lookup</h2>
        <p className="text-meta text-text-secondary mb-4">
          Paste an ISBN-10 or ISBN-13 to auto-fill the form.
        </p>

        <form onSubmit={handlePreview} className="flex gap-2">
          <Input
            type="text"
            value={isbnInput}
            onChange={(e) => setIsbnInput(e.target.value)}
            placeholder="e.g. 9780132350884"
            aria-label="ISBN number"
            className="max-w-xs"
          />
          <Button type="submit" disabled={isPreviewPending || !isbnInput.trim()}>
            {isPreviewPending ? (
              "Looking up…"
            ) : (
              <>
                <Search className="h-4 w-4" aria-hidden />
                Preview
              </>
            )}
          </Button>
        </form>

        {/* Banner: ISBN state feedback */}
        <IsbnBanner state={preview} />

        {/* Source diffs — show when sources disagree (BDD REQ-02-01 sources disagree) */}
        {preview.kind === "found" &&
          preview.sourceDiffs &&
          Object.entries(preview.sourceDiffs).length > 0 && (
            <div
              className="mt-3 flex items-start gap-2 rounded-lg px-4 py-3 text-meta border"
              style={{
                background: "hsl(var(--info)/0.06)",
                borderColor: "hsl(var(--info)/0.25)",
                color: "hsl(var(--info))",
              }}
              role="note"
              aria-label="Source differences"
            >
              <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
              <div>
                <p className="font-medium mb-1">Sources disagree on some fields:</p>
                <ul className="space-y-0.5">
                  {Object.entries(preview.sourceDiffs).map(([field, altValue]) => (
                    <li key={field}>
                      <span className="text-caption">{field}:</span> other source says{" "}
                      <strong>{altValue}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

        {/* Mini preview card */}
        {previewData?.title && (
          <div className="mt-4 flex gap-4 items-center p-4 rounded-lg bg-surface-2 border border-border-subtle">
            <div
              className="relative shrink-0 rounded-md overflow-hidden"
              style={{ width: 56, height: 76 }}
              aria-hidden
            >
              {previewData.coverUrl ? (
                <Image
                  src={previewData.coverUrl}
                  alt={`Cover of ${previewData.title}`}
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              ) : (
                <div
                  className="absolute inset-0"
                  style={{ background: coverGradient(previewData.title) }}
                />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-meta font-semibold text-text-primary truncate">
                {previewData.title}
              </p>
              {/* REVIEW: text-[12px] — below text-meta(13px); text-caption adds uppercase which changes appearance */}
              <p className="text-[12px] text-text-secondary truncate">
                {previewData.authors?.join(", ")}
              </p>
              {previewData.year && (
                <p className="text-caption text-text-tertiary">{previewData.year}</p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Book form */}
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="rounded-xl border border-border-subtle p-5 bg-surface space-y-5"
        aria-label="Book details form"
        noValidate
      >
        <h2 className="text-h3 text-text-primary">Book Details</h2>

        {/* Title */}
        <div className="space-y-1.5">
          <Label htmlFor="title">
            Title{" "}
            <span className="text-danger" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            id="title"
            placeholder="Book title"
            aria-required="true"
            aria-describedby={errors.title ? "title-error" : undefined}
            aria-invalid={errors.title ? "true" : "false"}
            {...register("title")}
          />
          {errors.title && (
            <p id="title-error" className="text-meta text-danger" role="alert">
              {errors.title.message}
            </p>
          )}
        </div>

        {/* Authors */}
        <div className="space-y-1.5">
          <Label htmlFor="authors">
            Author(s){" "}
            <span className="text-danger" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            id="authors"
            placeholder="Author names, comma-separated"
            aria-required="true"
            aria-describedby={errors.authors ? "authors-error" : "authors-hint"}
            aria-invalid={errors.authors ? "true" : "false"}
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value;
              const authors = value
                .split(",")
                .map((a) => a.trim())
                .filter(Boolean);
              setValue("authors", authors.length > 0 ? authors : [], { shouldValidate: true });
            }}
          />
          <p id="authors-hint" className="text-meta text-text-tertiary">
            Separate multiple authors with commas
          </p>
          {errors.authors && (
            <p id="authors-error" className="text-meta text-danger" role="alert">
              {Array.isArray(errors.authors)
                ? errors.authors
                    .map((e) => e?.message)
                    .filter(Boolean)
                    .join(", ")
                : (errors.authors as { message?: string }).message}
            </p>
          )}
        </div>

        {/* ISBN */}
        <div className="space-y-1.5">
          <Label htmlFor="isbn13">ISBN-13</Label>
          <Input
            id="isbn13"
            placeholder="13 digits"
            aria-describedby={errors.isbn13 ? "isbn13-error" : undefined}
            aria-invalid={errors.isbn13 ? "true" : "false"}
            {...register("isbn13")}
          />
          {errors.isbn13 && (
            <p id="isbn13-error" className="text-meta text-danger" role="alert">
              {errors.isbn13.message}
            </p>
          )}
        </div>

        {/* Year + Page count (2-col) */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="year">Year</Label>
            <Input
              id="year"
              type="number"
              placeholder="e.g. 2008"
              aria-describedby={errors.year ? "year-error" : undefined}
              aria-invalid={errors.year ? "true" : "false"}
              {...register("year", {
                setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
              })}
            />
            {errors.year && (
              <p id="year-error" className="text-meta text-danger" role="alert">
                {errors.year.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pageCount">Pages</Label>
            <Input
              id="pageCount"
              type="number"
              placeholder="e.g. 320"
              aria-describedby={errors.pageCount ? "page-count-error" : undefined}
              aria-invalid={errors.pageCount ? "true" : "false"}
              {...register("pageCount", {
                setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
              })}
            />
            {errors.pageCount && (
              <p id="page-count-error" className="text-meta text-danger" role="alert">
                {errors.pageCount.message}
              </p>
            )}
          </div>
        </div>

        {/* Publisher + Language (2-col) */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="publisher">Publisher</Label>
            <Input id="publisher" placeholder="e.g. Prentice Hall" {...register("publisher")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="language">Language</Label>
            <Input
              id="language"
              placeholder="e.g. en"
              maxLength={2}
              aria-describedby={errors.language ? "language-error" : "language-hint"}
              aria-invalid={errors.language ? "true" : "false"}
              {...register("language")}
            />
            <p id="language-hint" className="text-meta text-text-tertiary">
              ISO 639-1 code
            </p>
            {errors.language && (
              <p id="language-error" className="text-meta text-danger" role="alert">
                {errors.language.message}
              </p>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            placeholder="Book synopsis or blurb…"
            rows={4}
            aria-describedby={errors.description ? "description-error" : undefined}
            aria-invalid={errors.description ? "true" : "false"}
            {...register("description")}
          />
          {errors.description && (
            <p id="description-error" className="text-meta text-danger" role="alert">
              {errors.description.message}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={isSavePending}>
            {isSavePending ? "Saving…" : "Save Book"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/books")}
            disabled={isSavePending}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function parseProblemDetails(raw: string): ProblemDetails | null {
  try {
    return JSON.parse(raw) as ProblemDetails;
  } catch {
    return null;
  }
}
