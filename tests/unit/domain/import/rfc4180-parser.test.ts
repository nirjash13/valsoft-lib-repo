import { parseCsv } from "@/lib/domain/import/rfc4180-parser";
import { describe, expect, it } from "vitest";

describe("rfc4180-parser", () => {
  it("parses standard CSV records", () => {
    const csv = `isbn13,title,authors
9780132350884,Clean Code,Robert C. Martin
9780132350885,Refactoring,Martin Fowler`;

    const result = parseCsv(csv);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      isbn13: "9780132350884",
      title: "Clean Code",
      authors: "Robert C. Martin",
    });
    expect(result[1]).toEqual({
      isbn13: "9780132350885",
      title: "Refactoring",
      authors: "Martin Fowler",
    });
  });

  it("handles UTF-8 BOM characters correctly", () => {
    const csv = `\uFEFFisbn13,title
9780132350884,Clean Code`;

    const result = parseCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      isbn13: "9780132350884",
      title: "Clean Code",
    });
  });

  it("handles double-quoted cells containing commas", () => {
    const csv = `isbn13,title,authors
9780132350884,"Clean Code, A Handbook of Agile Software Craftsmanship","Robert C. Martin"`;

    const result = parseCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      isbn13: "9780132350884",
      title: "Clean Code, A Handbook of Agile Software Craftsmanship",
      authors: "Robert C. Martin",
    });
  });

  it("handles double-quoted cells containing double-double quotes", () => {
    const csv = `title,description
"Clean Code","A book about ""good"" software craftsmanship"`;

    const result = parseCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      title: "Clean Code",
      description: 'A book about "good" software craftsmanship',
    });
  });

  it("handles carriage return and line feeds embedded in quotes", () => {
    // RFC 4180 §2.6: fields may contain CRLF, LF or CR inside double quotes.
    // The parser must not split the field at the embedded newline.
    const csvWithActualNewlines = `title,description
"Clean Code","A book
with multiple
lines"`;

    const result = parseCsv(csvWithActualNewlines);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      title: "Clean Code",
      description: "A book\nwith multiple\nlines",
    });
  });

  it("supports Windows (CRLF), Unix (LF), and legacy Mac (CR) line endings", () => {
    const csvWindows = "title,authors\r\nBook 1,Author 1\r\nBook 2,Author 2";
    const csvUnix = "title,authors\nBook 1,Author 1\nBook 2,Author 2";
    const csvMac = "title,authors\rBook 1,Author 1\rBook 2,Author 2";

    const expected = [
      { title: "Book 1", authors: "Author 1" },
      { title: "Book 2", authors: "Author 2" },
    ];

    expect(parseCsv(csvWindows)).toEqual(expected);
    expect(parseCsv(csvUnix)).toEqual(expected);
    expect(parseCsv(csvMac)).toEqual(expected);
  });
});
