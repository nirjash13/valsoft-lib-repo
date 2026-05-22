"use client";

import { updateBookAction } from "@/app/(app)/books/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type UpdateBookInput, UpdateBookSchema } from "@/lib/domain/books/schemas";
import type { ProblemDetails } from "@/lib/utils/problem";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

interface EditableBook {
  id: string;
  title: string;
  authors: readonly string[];
  isbn13: string | undefined;
  year: number | undefined;
  publisher: string | undefined;
  pageCount: number | undefined;
  subjects: readonly string[] | undefined;
  language: string | undefined;
  coverUrl: string | undefined;
  description: string | undefined;
  updatedAt: string;
}

interface EditBookFormProps {
  book: EditableBook;
}

/**
 * EditBookForm — pre-filled form for updating an existing book.
 *
 * Optimistic concurrency: the `expectedUpdatedAt` field is sent with every
 * save. If another session saved the book first, the server returns a 409
 * and we show the "Refresh — the record was updated" banner (BDD REQ-02-04).
 */
export function EditBookForm({ book }: EditBookFormProps) {
  const router = useRouter();
  const [concurrencyConflict, setConcurrencyConflict] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<UpdateBookInput>({
    resolver: zodResolver(UpdateBookSchema),
    defaultValues: {
      id: book.id,
      expectedUpdatedAt: book.updatedAt,
      title: book.title,
      authors: book.authors as string[],
      isbn13: book.isbn13,
      year: book.year,
      publisher: book.publisher,
      pageCount: book.pageCount,
      subjects: book.subjects as string[] | undefined,
      language: book.language,
      coverUrl: book.coverUrl,
      description: book.description,
    },
  });

  async function onSubmit(input: UpdateBookInput) {
    setIsPending(true);
    setConcurrencyConflict(false);

    const result = await updateBookAction(input);

    setIsPending(false);

    if (result?.serverError) {
      const err = parseProblemDetails(result.serverError);

      // Optimistic concurrency failure (BDD REQ-02-04)
      if (err?.code === "OPTIMISTIC_CONCURRENCY") {
        setConcurrencyConflict(true);
        return;
      }

      toast.error(err?.title ?? "Could not save changes", {
        description: err?.detail,
      });
      return;
    }

    toast.success("Book updated");
    router.push(`/books/${book.id}`);
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="rounded-xl border border-border-subtle p-5 bg-surface space-y-5"
      aria-label="Edit book form"
      noValidate
    >
      {/* Concurrency conflict banner (BDD REQ-02-04) */}
      {concurrencyConflict && (
        <div
          className="flex items-start gap-2 rounded-lg px-4 py-3 text-body border"
          style={{
            background: "hsl(var(--warning)/0.08)",
            borderColor: "hsl(var(--warning)/0.3)",
            color: "hsl(var(--warning))",
          }}
          role="alert"
          aria-live="assertive"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Refresh — the record was updated by someone else.</p>
            <p className="text-meta mt-0.5">
              Reload this page to see the latest version before saving again.
            </p>
          </div>
        </div>
      )}

      {/* Hidden fields */}
      <input type="hidden" {...register("id")} />
      <input type="hidden" {...register("expectedUpdatedAt")} />

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
          defaultValue={(book.authors as string[]).join(", ")}
          onChange={(e) => {
            const authors = e.target.value
              .split(",")
              .map((a) => a.trim())
              .filter(Boolean);
            setValue("authors", authors.length > 0 ? authors : [], { shouldValidate: true });
          }}
        />
        {errors.authors && (
          <p className="text-meta text-danger" role="alert">
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
        <Input id="isbn13" placeholder="13 digits" {...register("isbn13")} />
        {errors.isbn13 && (
          <p className="text-meta text-danger" role="alert">
            {errors.isbn13.message}
          </p>
        )}
      </div>

      {/* Year + Pages */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="year">Year</Label>
          <Input
            id="year"
            type="number"
            aria-describedby={errors.year ? "year-error" : undefined}
            aria-invalid={errors.year ? "true" : "false"}
            {...register("year", { valueAsNumber: true })}
          />
          {errors.year && (
            <p id="year-error" className="text-meta text-danger" role="alert">
              {errors.year.message}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pageCount">Pages</Label>
          <Input id="pageCount" type="number" {...register("pageCount", { valueAsNumber: true })} />
        </div>
      </div>

      {/* Publisher + Language */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="publisher">Publisher</Label>
          <Input id="publisher" {...register("publisher")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="language">Language</Label>
          <Input id="language" maxLength={2} placeholder="en" {...register("language")} />
          {errors.language && (
            <p className="text-meta text-danger" role="alert">
              {errors.language.message}
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" rows={4} {...register("description")} />
        {errors.description && (
          <p className="text-meta text-danger" role="alert">
            {errors.description.message}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save Changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(`/books/${book.id}`)}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function parseProblemDetails(raw: string): ProblemDetails | null {
  try {
    return JSON.parse(raw) as ProblemDetails;
  } catch {
    return null;
  }
}
