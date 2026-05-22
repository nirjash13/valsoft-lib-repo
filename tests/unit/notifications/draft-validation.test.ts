/**
 * Unit tests for validateDraftTokens — REQ-07-06 BDD scenario:
 * "draft missing required field" flagged; "all tokens present" passes.
 */

import { validateDraftTokens } from "@/lib/notifications/draft-validation";
import { describe, expect, it } from "vitest";

describe("validateDraftTokens", () => {
  it("flags a missing {{due_date}} when has_due_date is true", () => {
    const body = "Your book {{book_title}} is overdue. Please return it soon.";
    const problems = validateDraftTokens(body, {
      has_book_title: true,
      has_due_date: true,
      has_pickup_window: false,
    });
    expect(problems).toContain("Add a due date — patrons need this");
  });

  it("returns an empty array when all declared required tokens are present", () => {
    const body =
      "Your book {{book_title}} was due on {{due_date}}. Pick up your hold by {{pickup_window}}.";
    const problems = validateDraftTokens(body, {
      has_book_title: true,
      has_due_date: true,
      has_pickup_window: true,
    });
    expect(problems).toHaveLength(0);
  });
});
