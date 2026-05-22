import { extractBookRefs } from "@/lib/domain/chat/book-refs";
import { describe, expect, it } from "vitest";

const VALID_UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("extractBookRefs", () => {
  it("extracts valid UUID book tokens from assistant text", () => {
    const text = `I recommend <book:${VALID_UUID}> — a great read.`;
    expect(extractBookRefs(text)).toEqual([VALID_UUID]);
  });

  it("de-duplicates repeated book tokens for the same UUID", () => {
    const text = `<book:${VALID_UUID}> and again <book:${VALID_UUID.toUpperCase()}>`;
    expect(extractBookRefs(text)).toHaveLength(1);
  });

  it("drops tokens with malformed UUIDs and returns only valid ones", () => {
    const text = `<book:not-a-uuid> and <book:${VALID_UUID}>`;
    expect(extractBookRefs(text)).toEqual([VALID_UUID]);
  });
});
