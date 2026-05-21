import { IsbnInvalidError } from "@/lib/domain/books/errors";
import { isbn10ToIsbn13, normalizeIsbn, validateIsbn13Checksum } from "@/lib/domain/books/isbn";
import { describe, expect, it } from "vitest";

describe("validateIsbn13Checksum", () => {
  it("accepts a known-good ISBN-13 (Clean Code)", () => {
    // ISBN-13 for Clean Code — real barcode, checksum verified
    expect(validateIsbn13Checksum("9780132350884")).toBe(true);
  });

  it("rejects an ISBN-13 with a wrong check digit", () => {
    // Same digits but check digit incremented by 1
    expect(validateIsbn13Checksum("9780132350885")).toBe(false);
  });
});

describe("isbn10ToIsbn13", () => {
  it("converts a valid ISBN-10 to its ISBN-13 equivalent", () => {
    // "0132350882" is the ISBN-10 for Clean Code; its ISBN-13 is "9780132350884"
    const result = isbn10ToIsbn13("0132350882");
    expect(result).toBe("9780132350884");
    // The resulting ISBN-13 must itself pass checksum validation
    expect(validateIsbn13Checksum(result)).toBe(true);
  });
});

describe("normalizeIsbn", () => {
  it("strips dashes from a valid ISBN-13 and returns normalized form", () => {
    expect(normalizeIsbn("978-0-13-235088-4")).toBe("9780132350884");
  });

  it("converts ISBN-10 (with dashes) to ISBN-13", () => {
    expect(normalizeIsbn("0-13-235088-2")).toBe("9780132350884");
  });

  it("throws IsbnInvalidError when ISBN-13 checksum is wrong", () => {
    // 9999999999999 — all 9s; checksum is wrong
    expect(() => normalizeIsbn("9999999999999")).toThrow(IsbnInvalidError);
  });

  it("throws IsbnInvalidError for non-digit input", () => {
    expect(() => normalizeIsbn("not-an-isbn")).toThrow(IsbnInvalidError);
  });
});
