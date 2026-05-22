"use client";

import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  CheckCircle,
  Download,
  FileSpreadsheet,
  GitMerge,
  Info,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  SkipForward,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  cancelImportJobAction,
  cleanupImportedBooksAction,
  getImportJobStatusAction,
  resolveImportDuplicateAction,
  resumeImportJobAction,
  startImportJobAction,
} from "./actions";

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

interface DuplicateRow {
  rowId: string;
  isbn13: string | null;
  title: string | null;
  existingBookId: string;
}

interface RowSampleEntry {
  rowIndex: number;
  status: string;
  errorReason: string | null;
}

interface JobProgress {
  id: string;
  status: "running" | "completed" | "failed" | "paused_quota" | "cancelled";
  totalRows: number;
  processedRows: number;
  errorCount: number;
  duplicateCount: number;
  dryRun: boolean;
  duplicates?: DuplicateRow[];
  rowSample?: RowSampleEntry[];
}

/** Per-row resolution state tracked locally until next status poll overwrites. */
type DuplicateResolution = "merged" | "skipped";

export function ImportWizard() {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, startUploadTransition] = useTransition();
  const [isActionPending, startActionTransition] = useTransition();

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Track per-row duplicate resolution state (rowId → resolution)
  const [resolvedDuplicates, setResolvedDuplicates] = useState<Record<string, DuplicateResolution>>(
    {},
  );
  const [resolvingRowId, setResolvingRowId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const { execute: executeResolve } = useAction(resolveImportDuplicateAction, {
    onSuccess: ({ data, input }) => {
      if (data?.status) {
        setResolvedDuplicates((prev) => ({ ...prev, [input.rowId]: data.status }));
      }
      setResolvingRowId(null);
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "Failed to resolve duplicate");
      setResolvingRowId(null);
    },
  });

  // Poll job status while running
  useEffect(() => {
    if (jobId && jobProgress?.status === "running") {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await getImportJobStatusAction({ jobId });
          if (res?.data) {
            const data = res.data as JobProgress;
            setJobProgress(data);
            if (data.status !== "running") {
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            }
          }
        } catch (err) {
          console.error("Error polling job status:", err);
        }
      }, 1500);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [jobId, jobProgress?.status]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      const selectedFile = droppedFiles[0];
      if (selectedFile) {
        if (selectedFile.type === "text/csv" || selectedFile.name.endsWith(".csv")) {
          if (selectedFile.size > MAX_FILE_BYTES) {
            setErrorMessage(
              "File exceeds the 50 MB limit. Please split your catalog into smaller files.",
            );
            return;
          }
          setFile(selectedFile);
          setErrorMessage(null);
        } else {
          setErrorMessage("Please upload a valid CSV file.");
        }
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      const firstFile = selectedFiles[0];
      if (firstFile) {
        if (firstFile.size > MAX_FILE_BYTES) {
          setErrorMessage(
            "File exceeds the 50 MB limit. Please split your catalog into smaller files.",
          );
          return;
        }
        setFile(firstFile);
        setErrorMessage(null);
      }
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = () => {
    if (!file) return;

    // Guard: should already be caught by handleFileChange/handleDrop, but verify here too
    if (file.size > MAX_FILE_BYTES) {
      setErrorMessage(
        "File exceeds the 50 MB limit. Please split your catalog into smaller files.",
      );
      return;
    }

    startUploadTransition(async () => {
      try {
        setErrorMessage(null);
        const text = await file.text();

        const result = await startImportJobAction({ csvText: text, dryRun });

        if (result?.serverError) {
          try {
            const parsed = JSON.parse(result.serverError);
            setErrorMessage(parsed.detail || parsed.title || result.serverError);
          } catch {
            setErrorMessage(result.serverError);
          }
          return;
        }

        if (result?.data?.jobId) {
          const newJobId = result.data.jobId;
          setJobId(newJobId);
          setJobProgress({
            id: newJobId,
            status: "running",
            totalRows: 0,
            processedRows: 0,
            errorCount: 0,
            duplicateCount: 0,
            dryRun,
          });
          setResolvedDuplicates({});
          toast.success("CSV Uploaded! Starting import job...");
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        toast.error("Failed to start import job");
      }
    });
  };

  const handleCancel = () => {
    if (!jobId) return;
    startActionTransition(async () => {
      try {
        const result = await cancelImportJobAction({ jobId });
        if (result?.serverError) {
          toast.error(result.serverError);
          return;
        }
        setJobProgress((prev) => (prev ? { ...prev, status: "cancelled" } : null));
        toast.success("Import job cancelled");
      } catch {
        toast.error("Failed to cancel job");
      }
    });
  };

  const handleResume = () => {
    if (!jobId) return;
    startActionTransition(async () => {
      try {
        const result = await resumeImportJobAction({ jobId });
        if (result?.serverError) {
          toast.error(result.serverError);
          return;
        }
        setJobProgress((prev) => (prev ? { ...prev, status: "running" } : null));
        toast.success("Import job resumed");
      } catch {
        toast.error("Failed to resume job");
      }
    });
  };

  const handleCleanup = () => {
    if (!jobId) return;
    startActionTransition(async () => {
      try {
        const result = await cleanupImportedBooksAction({ jobId });
        if (result?.serverError) {
          toast.error(result.serverError);
          return;
        }
        const deletedCount = result?.data?.deletedCount ?? 0;
        toast.success(`Cleanup complete. Soft-deleted ${deletedCount} imported books.`);
        setFile(null);
        setJobId(null);
        setJobProgress(null);
      } catch {
        toast.error("Failed to cleanup imported books");
      }
    });
  };

  const handleReset = () => {
    setFile(null);
    setJobId(null);
    setJobProgress(null);
    setErrorMessage(null);
    setResolvedDuplicates({});
  };

  const handleResolveDuplicate = (rowId: string, choice: "merge" | "skip") => {
    setResolvingRowId(rowId);
    executeResolve({ rowId, choice });
  };

  // Format file size helper
  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  };

  // Calculate percentages
  const total = jobProgress?.totalRows ?? 0;
  const processed = jobProgress?.processedRows ?? 0;
  const errors = jobProgress?.errorCount ?? 0;
  const duplicates = jobProgress?.duplicateCount ?? 0;
  const imported = processed - errors - duplicates;

  const progressPercent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const isStarting = jobProgress?.status === "running" && total === 0;

  // Duplicates that are still pending resolution
  const pendingDuplicates = (jobProgress?.duplicates ?? []).filter(
    (d) => !resolvedDuplicates[d.rowId],
  );

  return (
    <div className="space-y-6">
      {/* Upload Screen */}
      {!jobId && (
        <div className="space-y-6">
          <div
            className={`relative border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center transition-standard cursor-pointer ${
              isDragging
                ? "border-accent bg-[hsl(var(--accent)/0.04)] scale-[0.99]"
                : "border-border-subtle bg-surface hover:border-border-default hover:bg-surface-2"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={triggerFileSelect}
            // biome-ignore lint/a11y/useSemanticElements: complex drag and drop target container
            role="button"
            tabIndex={0}
            aria-label="Drag and drop CSV file here"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                triggerFileSelect();
              }
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".csv"
              className="hidden"
            />

            <div className="h-16 w-16 rounded-full bg-surface-2 flex items-center justify-center mb-4 border border-border-subtle transition-quick">
              <Upload className="h-8 w-8 text-text-secondary" />
            </div>

            {file ? (
              <div className="space-y-2">
                <p className="text-h3 font-semibold text-text-primary flex items-center justify-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-accent" />
                  {file.name}
                </p>
                <p className="text-meta text-text-tertiary">Size: {formatSize(file.size)}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-h3 font-semibold text-text-primary">
                  Drag and drop your CSV catalog file here
                </p>
                <p className="text-meta text-text-secondary">or click to browse your computer</p>
                <p className="text-[12px] text-text-tertiary mt-2">
                  Supports .csv files up to 50 MB (maximum 50,000 rows)
                </p>
              </div>
            )}
          </div>

          {/* Validation Message */}
          {errorMessage && (
            <div className="flex items-center gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4 text-meta text-danger">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <p>{errorMessage}</p>
            </div>
          )}

          {/* Settings Section */}
          {file && (
            <div className="rounded-xl border border-border-subtle bg-surface p-5 space-y-4 elev-1">
              <h2 className="text-h3 text-text-primary font-semibold">Import Settings</h2>

              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <label
                    htmlFor="dry-run"
                    className="text-body font-medium text-text-primary block cursor-pointer"
                  >
                    Dry Run Mode (Preview)
                  </label>
                  <p className="text-meta text-text-secondary">
                    Validate records and warm caches without writing books to the public catalog.
                  </p>
                </div>
                <input
                  type="checkbox"
                  id="dry-run"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  className="h-5 w-5 rounded border-border-default text-accent focus:ring-accent accent-accent cursor-pointer mt-1"
                />
              </div>

              <div className="border-t border-border-subtle pt-4 flex justify-end gap-3">
                <Button variant="ghost" onClick={handleReset} disabled={isUploading}>
                  Reset
                </Button>
                <Button onClick={handleUpload} disabled={isUploading}>
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Start Import Job
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Info Card on Supported Columns */}
          <div className="rounded-xl border border-border-subtle bg-surface p-5 space-y-3">
            <h3 className="text-meta font-semibold uppercase tracking-wider text-text-tertiary flex items-center gap-2">
              <Info className="h-4 w-4 text-accent" />
              Supported CSV Headers & Minimum Requirements
            </h3>

            <p className="text-meta text-text-secondary leading-relaxed">
              We stream-parse standard RFC-4180 CSV uploads. Row validation requires:
              <strong className="text-text-primary"> isbn13 </strong> (with valid checksum) or both{" "}
              <strong className="text-text-primary"> title </strong> and at least one{" "}
              <strong className="text-text-primary"> author</strong>.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2 pt-2 border-t border-border-subtle">
              {[
                { name: "isbn13", desc: "13-digit code" },
                { name: "title", desc: "Book title string" },
                { name: "authors", desc: "Semicolon separated" },
                { name: "year", desc: "Publication year" },
                { name: "publisher", desc: "Publishing house" },
                { name: "page_count", desc: "Total page count" },
                { name: "subjects", desc: "Semicolon separated" },
                { name: "language", desc: "2-letter ISO code" },
                { name: "description", desc: "Book synopsis" },
              ].map((col) => (
                <div
                  key={col.name}
                  className="bg-surface-2 rounded-lg p-2.5 border border-border-subtle"
                >
                  <code className="text-meta font-semibold text-accent block">{col.name}</code>
                  <span className="text-[12px] text-text-tertiary block mt-0.5">{col.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Processing Screen */}
      {jobId && jobProgress && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border-subtle bg-surface p-6 shadow-lg space-y-6 elev-1">
            {/* Header / Status Banner */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border-subtle pb-5">
              <div>
                <span className="text-[12px] font-semibold text-text-tertiary tracking-widest uppercase block mb-1">
                  CSV Import Job
                </span>
                <h2 className="text-h2 font-semibold text-text-primary flex items-center gap-2">
                  {file?.name || "Catalog Import"}
                  {jobProgress.dryRun && (
                    <span className="bg-surface-2 text-accent border border-accent/20 rounded-md px-2 py-0.5 text-caption font-semibold">
                      Dry Run
                    </span>
                  )}
                </h2>
                <p className="text-meta text-text-secondary mt-1 font-mono text-[11px]">
                  ID: {jobId}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {jobProgress.status === "running" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta font-medium bg-info/10 text-info border border-info/20 animate-pulse">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Processing Chunks
                  </span>
                )}
                {jobProgress.status === "paused_quota" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta font-medium bg-warning/10 text-warning border border-warning/20">
                    <Pause className="h-3.5 w-3.5" />
                    Paused: Quota Cap
                  </span>
                )}
                {jobProgress.status === "completed" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta font-medium bg-success/10 text-success border border-success/20">
                    <CheckCircle className="h-3.5 w-3.5" />
                    Completed
                  </span>
                )}
                {jobProgress.status === "cancelled" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta font-medium bg-text-tertiary/10 text-text-secondary border border-border-default">
                    <XCircle className="h-3.5 w-3.5" />
                    Cancelled
                  </span>
                )}
                {jobProgress.status === "failed" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta font-medium bg-danger/10 text-danger border border-danger/20">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Failed
                  </span>
                )}
              </div>
            </div>

            {/* Quota Pause Alert */}
            {jobProgress.status === "paused_quota" && (
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-5 flex items-start gap-4 transition-standard">
                <AlertCircle className="h-6 w-6 text-warning shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <h4 className="text-body font-semibold text-warning">AI Quota Cap Exceeded</h4>
                  <p className="text-meta text-text-secondary leading-relaxed">
                    This import job requires ISBN metadata enrichment from AI services. The
                    projected cost of completing this import exceeds your monthly tenant AI budget
                    cap.
                  </p>
                  <p className="text-meta text-text-tertiary">
                    To proceed, please raise your tenant AI monthly budget in settings or wait until
                    the next billing cycle resets.
                  </p>
                  <div className="flex items-center gap-3 pt-3">
                    <Button
                      size="sm"
                      onClick={handleResume}
                      disabled={isActionPending}
                      className="bg-warning text-black hover:bg-warning/90 border-0"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${isActionPending ? "animate-spin" : ""}`}
                      />
                      Resume Job
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancel}
                      disabled={isActionPending}
                    >
                      Cancel Import
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-meta font-semibold">
                <span className="text-text-secondary">Progress</span>
                {isStarting ? (
                  <span className="text-text-tertiary italic">Starting&hellip;</span>
                ) : (
                  <span className="text-text-primary" data-tabular>
                    {progressPercent}% ({processed} of {total} rows)
                  </span>
                )}
              </div>
              <div className="h-3.5 w-full bg-surface-2 rounded-full overflow-hidden border border-border-subtle">
                {isStarting ? (
                  /* Indeterminate animation while totalRows is not yet known */
                  <div className="h-full w-1/3 bg-gradient-to-r from-accent/40 via-accent to-accent/40 rounded-full animate-pulse" />
                ) : (
                  <div
                    className="h-full bg-gradient-to-r from-accent via-indigo-500 to-accent rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                )}
              </div>
            </div>

            {/* Stats Dashboard Grid */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-surface-2 rounded-xl p-4 border border-border-subtle flex flex-col justify-between">
                <span className="text-caption text-text-tertiary font-semibold">Total Rows</span>
                <span className="text-display mt-2 font-bold" data-tabular>
                  {total}
                </span>
              </div>
              <div className="bg-[hsl(var(--info)/0.04)] rounded-xl p-4 border border-[hsl(var(--info)/0.15)] flex flex-col justify-between">
                <span className="text-caption text-info font-semibold">Processed</span>
                <span className="text-display mt-2 font-bold text-info" data-tabular>
                  {processed}
                </span>
              </div>
              <div className="bg-[hsl(var(--success)/0.04)] rounded-xl p-4 border border-[hsl(var(--success)/0.15)] flex flex-col justify-between">
                <span className="text-caption text-success font-semibold">
                  {jobProgress.dryRun ? "Valid" : "Imported"}
                </span>
                <span className="text-display mt-2 font-bold text-success" data-tabular>
                  {imported}
                </span>
              </div>
              <div className="bg-[hsl(var(--warning)/0.04)] rounded-xl p-4 border border-[hsl(var(--warning)/0.15)] flex flex-col justify-between">
                <span className="text-caption text-warning font-semibold">Duplicates</span>
                <span className="text-display mt-2 font-bold text-warning" data-tabular>
                  {duplicates}
                </span>
              </div>
              <div className="bg-[hsl(var(--danger)/0.04)] rounded-xl p-4 border border-[hsl(var(--danger)/0.15)] flex flex-col justify-between">
                <span className="text-caption text-danger font-semibold">Errors</span>
                <span className="text-display mt-2 font-bold text-danger" data-tabular>
                  {errors}
                </span>
              </div>
            </div>

            {/* Duplicate Review Panel (REQ-10-06 / US-05) */}
            {duplicates > 0 && (jobProgress.duplicates ?? []).length > 0 && (
              <div className="rounded-xl border border-warning/30 bg-warning/5 space-y-4 overflow-hidden">
                <div className="px-5 pt-5 flex items-center justify-between">
                  <h4 className="text-body font-semibold text-text-primary flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-warning" />
                    {duplicates} Duplicate{duplicates !== 1 ? "s" : ""} — Review &amp; Resolve
                  </h4>
                  {pendingDuplicates.length === 0 && (
                    <span className="text-meta text-success font-medium flex items-center gap-1">
                      <CheckCircle className="h-4 w-4" />
                      All resolved
                    </span>
                  )}
                </div>
                <p className="px-5 text-meta text-text-secondary">
                  These ISBNs already exist in your catalog. Choose to merge (update existing
                  record) or skip (keep the existing record unchanged) for each row.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-meta">
                    <thead>
                      <tr className="border-b border-warning/20 bg-warning/5">
                        <th className="text-left px-5 py-2.5 text-caption font-semibold text-text-tertiary uppercase tracking-wider">
                          Row
                        </th>
                        <th className="text-left px-5 py-2.5 text-caption font-semibold text-text-tertiary uppercase tracking-wider">
                          ISBN-13
                        </th>
                        <th className="text-left px-5 py-2.5 text-caption font-semibold text-text-tertiary uppercase tracking-wider">
                          Title
                        </th>
                        <th className="text-right px-5 py-2.5 text-caption font-semibold text-text-tertiary uppercase tracking-wider">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {(jobProgress.duplicates ?? []).map((dup) => {
                        const resolution = resolvedDuplicates[dup.rowId];
                        const isResolving = resolvingRowId === dup.rowId;
                        return (
                          <tr
                            key={dup.rowId}
                            className={`transition-standard ${
                              resolution ? "opacity-60" : "hover:bg-warning/5"
                            }`}
                          >
                            <td className="px-5 py-3 font-mono text-[11px] text-text-tertiary">
                              {dup.rowId.slice(0, 8)}
                            </td>
                            <td className="px-5 py-3 font-mono text-text-secondary">
                              {dup.isbn13 ?? "—"}
                            </td>
                            <td className="px-5 py-3 text-text-primary max-w-[200px] truncate">
                              {dup.title ?? "Untitled"}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {resolution ? (
                                <span
                                  className={`inline-flex items-center gap-1 text-meta font-medium ${
                                    resolution === "merged" ? "text-success" : "text-text-secondary"
                                  }`}
                                >
                                  {resolution === "merged" ? (
                                    <>
                                      <CheckCircle className="h-4 w-4" />
                                      Merged
                                    </>
                                  ) : (
                                    <>
                                      <SkipForward className="h-4 w-4" />
                                      Skipped
                                    </>
                                  )}
                                </span>
                              ) : (
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleResolveDuplicate(dup.rowId, "merge")}
                                    disabled={isResolving}
                                    title="Merge CSV data into the existing book record"
                                  >
                                    {isResolving ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <GitMerge className="h-3.5 w-3.5" />
                                    )}
                                    Merge
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleResolveDuplicate(dup.rowId, "skip")}
                                    disabled={isResolving}
                                    title="Keep the existing book record, discard CSV row"
                                  >
                                    {isResolving ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <SkipForward className="h-3.5 w-3.5" />
                                    )}
                                    Skip
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Dry-Run Row Sample Preview (REQ-10-05 / US-02) */}
            {jobProgress.dryRun &&
              jobProgress.status !== "running" &&
              (jobProgress.rowSample ?? []).length > 0 && (
                <div className="rounded-xl border border-accent/20 bg-accent/5 space-y-4 overflow-hidden">
                  <div className="px-5 pt-5">
                    <h4 className="text-body font-semibold text-text-primary flex items-center gap-2">
                      <Info className="h-5 w-5 text-accent" />
                      Dry Run — Row-Level Preview
                    </h4>
                    <p className="text-meta text-text-secondary mt-1">
                      Sample of row outcomes. No books were written. Run a live import to commit
                      these results.
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-meta">
                      <thead>
                        <tr className="border-b border-accent/20 bg-accent/5">
                          <th className="text-left px-5 py-2.5 text-caption font-semibold text-text-tertiary uppercase tracking-wider">
                            Row #
                          </th>
                          <th className="text-left px-5 py-2.5 text-caption font-semibold text-text-tertiary uppercase tracking-wider">
                            Outcome
                          </th>
                          <th className="text-left px-5 py-2.5 text-caption font-semibold text-text-tertiary uppercase tracking-wider">
                            Detail
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle">
                        {(jobProgress.rowSample ?? []).map((row) => (
                          <tr key={row.rowIndex} className="hover:bg-accent/5 transition-quick">
                            <td className="px-5 py-2.5 font-mono text-[11px] text-text-tertiary">
                              {row.rowIndex}
                            </td>
                            <td className="px-5 py-2.5">
                              <span
                                className={`inline-flex items-center gap-1 text-meta font-medium rounded-full px-2 py-0.5 ${
                                  row.status === "failed"
                                    ? "bg-danger/10 text-danger"
                                    : row.status === "duplicate"
                                      ? "bg-warning/10 text-warning"
                                      : "bg-success/10 text-success"
                                }`}
                              >
                                {row.status === "failed" ? (
                                  <XCircle className="h-3.5 w-3.5" />
                                ) : row.status === "duplicate" ? (
                                  <AlertCircle className="h-3.5 w-3.5" />
                                ) : (
                                  <CheckCircle className="h-3.5 w-3.5" />
                                )}
                                {row.status}
                              </span>
                            </td>
                            <td className="px-5 py-2.5 text-text-secondary">
                              {row.errorReason ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            {/* Error Report Section */}
            {errors > 0 && (
              <div className="rounded-xl border border-border-subtle bg-surface-2 p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-body font-semibold text-text-primary flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-danger" />
                    Partial Failure: {errors} rows failed validation
                  </h4>
                  <p className="text-meta text-text-secondary leading-relaxed">
                    Some rows could not be imported because they were missing required fields, had
                    invalid ISBN-13 checksums, or encountered server-side errors.
                  </p>
                </div>
                <Button variant="secondary" asChild className="shrink-0">
                  <a href={`/api/import/${jobId}/error-report`} download>
                    <Download className="h-4 w-4" />
                    Download Error Report
                  </a>
                </Button>
              </div>
            )}

            {/* Footer Control Panel */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 border-t border-border-subtle pt-5">
              <div className="text-meta text-text-secondary flex items-center gap-2">
                {jobProgress.status === "running" && (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin text-accent" />
                    <span>Background processing is secure. You can close this page.</span>
                  </>
                )}
                {jobProgress.status === "completed" && (
                  <>
                    <CheckCircle className="h-4 w-4 text-success" />
                    <span>Import job completed. All valid rows have been cataloged.</span>
                  </>
                )}
                {jobProgress.status === "cancelled" && (
                  <>
                    <XCircle className="h-4 w-4 text-text-secondary" />
                    <span>Job was cancelled by librarian. Partial imports are preserved.</span>
                  </>
                )}
                {jobProgress.status === "failed" && (
                  <>
                    <AlertCircle className="h-4 w-4 text-danger" />
                    <span>Job failed due to a critical server error.</span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3">
                {jobProgress.status === "running" && (
                  <Button variant="destructive" onClick={handleCancel} disabled={isActionPending}>
                    Cancel Import
                  </Button>
                )}

                {(jobProgress.status === "cancelled" || jobProgress.status === "failed") &&
                  imported > 0 &&
                  !jobProgress.dryRun && (
                    <Button
                      variant="destructive"
                      onClick={handleCleanup}
                      disabled={isActionPending}
                      title="Soft-delete books created during this partial run"
                    >
                      <Trash2 className="h-4 w-4" />
                      {isActionPending ? "Cleaning..." : "Cleanup Imported Books"}
                    </Button>
                  )}

                {jobProgress.status !== "running" && jobProgress.status !== "paused_quota" && (
                  <Button onClick={handleReset}>Import Another File</Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
