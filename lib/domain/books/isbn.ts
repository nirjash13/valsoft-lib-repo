/**
 * ISBN validation and normalization utilities.
 *
 * No external dependencies — pure computation, safe to run in any context.
 */

import { IsbnInvalidError } from "./errors";

// ---------------------------------------------------------------------------
// validateIsbn13Checksum
// ---------------------------------------------------------------------------

/**
 * Validates the check digit of a 13-digit ISBN-13 string.
 *
 * The ISBN-13 check digit is the last digit such that the alternating-weight
 * sum (weights 1, 3, 1, 3, …) of all 13 digits is divisible by 10.
 *
 * @param isbn - Must be exactly 13 decimal digits (no dashes).
 * @returns true if the check digit is correct, false otherwise.
 */
export function validateIsbn13Checksum(isbn: string): boolean {
  if (isbn.length !== 13 || !/^\d{13}$/.test(isbn)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(isbn[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(isbn[12]);
}

// ---------------------------------------------------------------------------
// isbn10ToIsbn13
// ---------------------------------------------------------------------------

/**
 * Converts an ISBN-10 string to its ISBN-13 equivalent.
 *
 * ISBN-10 → ISBN-13: prepend "978", drop the old check digit, compute new one.
 *
 * @param isbn10 - Exactly 10 digits (no dashes). The last char may be 'X'.
 * @returns The 13-digit ISBN-13 string.
 * @throws IsbnInvalidError if the input is not a valid ISBN-10 format.
 */
export function isbn10ToIsbn13(isbn10: string): string {
  if (!/^\d{9}[\dX]$/i.test(isbn10)) {
    throw new IsbnInvalidError(isbn10, "ISBN-10 must be 9 digits followed by a digit or X");
  }

  const base = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(base[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${base}${check}`;
}

// ---------------------------------------------------------------------------
// normalizeIsbn
// ---------------------------------------------------------------------------

/**
 * Strips whitespace and dashes from an ISBN string, converts ISBN-10 to
 * ISBN-13, then validates the checksum.
 *
 * @param raw - User-supplied ISBN (may contain dashes, spaces, be 10 or 13 digits).
 * @returns The normalized 13-digit ISBN-13 string.
 * @throws IsbnInvalidError if the input is not a valid ISBN after normalization.
 */
export function normalizeIsbn(raw: string): string {
  const stripped = raw.replace(/[\s\-]/g, "");

  if (/^\d{9}[\dX]$/i.test(stripped)) {
    // ISBN-10: convert to ISBN-13 then validate
    const isbn13 = isbn10ToIsbn13(stripped);
    if (!validateIsbn13Checksum(isbn13)) {
      throw new IsbnInvalidError(raw, "ISBN-10 check digit is invalid");
    }
    return isbn13;
  }

  if (/^\d{13}$/.test(stripped)) {
    if (!validateIsbn13Checksum(stripped)) {
      throw new IsbnInvalidError(raw, "ISBN-13 check digit is invalid");
    }
    return stripped;
  }

  throw new IsbnInvalidError(raw, "must be 10 or 13 digits (dashes/spaces allowed)");
}
