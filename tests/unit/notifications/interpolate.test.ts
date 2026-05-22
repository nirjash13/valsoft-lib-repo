import { interpolate } from "@/lib/notifications/interpolate";
import { describe, expect, it } from "vitest";

describe("interpolate", () => {
  it("replaces a known token with its value", () => {
    const result = interpolate("Hello, {{name}}!", { name: "Alice" });
    expect(result).toBe("Hello, Alice!");
  });

  it("replaces multiple occurrences of the same token", () => {
    const result = interpolate("{{name}} borrowed {{name}}'s book", { name: "Bob" });
    expect(result).toBe("Bob borrowed Bob's book");
  });

  it("leaves unknown tokens intact rather than removing them", () => {
    const result = interpolate("Due: {{due_date}} — {{unknown}}", { due_date: "2026-06-01" });
    expect(result).toBe("Due: 2026-06-01 — {{unknown}}");
  });
});
