/**
 * Typed domain errors for the loans module.
 *
 * These extend Error so they are distinguishable in handleServerError and in
 * the CASL/authz middleware without instanceof-on-string games.
 */

export class BookAlreadyBorrowedError extends Error {
  override readonly name = "BookAlreadyBorrowedError";
  constructor(public readonly bookId: string) {
    super(`Book ${bookId} is currently borrowed`);
  }
}

export class BookWithdrawnError extends Error {
  override readonly name = "BookWithdrawnError";
  constructor(public readonly bookId: string) {
    super(`Book ${bookId} has been withdrawn from the catalog`);
  }
}

export class MemberNotActiveError extends Error {
  override readonly name = "MemberNotActiveError";
  constructor(public readonly memberId: string) {
    super(`Member ${memberId} is not active`);
  }
}

export class LoanNotFoundError extends Error {
  override readonly name = "LoanNotFoundError";
  constructor(public readonly loanId: string) {
    super(`Loan ${loanId} not found`);
  }
}

export class LoanAlreadyReturnedError extends Error {
  override readonly name = "LoanAlreadyReturnedError";
  constructor(public readonly loanId: string) {
    super(`Loan ${loanId} has already been returned`);
  }
}

export class RenewalLimitReachedError extends Error {
  override readonly name = "RenewalLimitReachedError";
  constructor(
    public readonly loanId: string,
    public readonly maxRenewals: number,
  ) {
    super(`Renewal limit reached (max ${maxRenewals}) for loan ${loanId}`);
  }
}

export class RenewalBlockedByHoldError extends Error {
  override readonly name = "RenewalBlockedByHoldError";
  constructor(public readonly bookId: string) {
    super(`Cannot renew — another member is waiting for book ${bookId}`);
  }
}
