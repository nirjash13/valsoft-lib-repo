/**
 * Typed domain errors for the search module (Spec 05).
 *
 * These extend Error so they are distinguishable in handleServerError and
 * can be mapped to stable ProblemDetails codes in lib/auth/safe-action.ts.
 */

export class SearchQueryTooShortError extends Error {
  override readonly name = "SearchQueryTooShortError";
  /** Stable code for ProblemDetails mapping. */
  readonly code = "SEARCH_QUERY_TOO_SHORT" as const;

  constructor() {
    super("Search query must be at least 1 character");
  }
}

export class SearchFeatureDisabledError extends Error {
  override readonly name = "SearchFeatureDisabledError";
  readonly code = "SEARCH_FEATURE_DISABLED" as const;

  constructor() {
    super("Search feature is currently disabled for this tenant");
  }
}

export class EmbeddingFailedError extends Error {
  override readonly name = "EmbeddingFailedError";
  readonly code = "EMBEDDING_FAILED" as const;

  constructor(cause?: unknown) {
    super(
      `Failed to generate embedding: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
