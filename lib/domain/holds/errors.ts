/**
 * Typed domain errors for the holds module.
 *
 * These extend Error so they are distinguishable in handleServerError and in
 * the CASL/authz middleware without instanceof-on-string games.
 */

export class HoldNotFoundError extends Error {
  override readonly name = "HoldNotFoundError";
  constructor(public readonly holdId: string) {
    super(`Hold ${holdId} not found`);
  }
}

export class HoldAlreadyExistsError extends Error {
  override readonly name = "HoldAlreadyExistsError";
  constructor(
    public readonly bookId: string,
    public readonly memberId: string,
  ) {
    super(`Member ${memberId} already has an active hold on book ${bookId}`);
  }
}

export class HoldNotPlaceableError extends Error {
  override readonly name = "HoldNotPlaceableError";
  constructor(public readonly bookId: string) {
    super(
      `Book ${bookId} is not currently borrowed — you can borrow it directly instead of placing a hold`,
    );
  }
}
