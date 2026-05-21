/**
 * Typed domain errors for the books module.
 *
 * These extend Error so they are distinguishable in handleServerError and in
 * the CASL/authz middleware without instanceof-on-string games.
 */

export class BookNotFoundError extends Error {
  override readonly name = "BookNotFoundError";
  constructor(public readonly bookId: string) {
    super(`Book ${bookId} not found`);
  }
}

export class OptimisticConcurrencyError extends Error {
  override readonly name = "OptimisticConcurrencyError";
  constructor(public readonly bookId: string) {
    super(`Book ${bookId} was updated concurrently — refresh and retry`);
  }
}

export class BookHasActiveLoanError extends Error {
  override readonly name = "BookHasActiveLoanError";
  constructor(public readonly bookId: string) {
    super(`Cannot remove book ${bookId} — it has an active loan`);
  }
}

export class IsbnInvalidError extends Error {
  override readonly name = "IsbnInvalidError";
  constructor(
    public readonly raw: string,
    reason: string,
  ) {
    super(`Invalid ISBN "${raw}": ${reason}`);
  }
}
