import { PromptParseError, parsePrompt } from "@/lib/ai/prompts/load-prompt";
import { describe, expect, it } from "vitest";

const VALID_RAW = `---
name: test-prompt
version: 1.2
changed_in: spec-99
---

This is the body of the prompt.
It spans multiple lines.
`;

describe("parsePrompt", () => {
  it("parses well-formed frontmatter and body", () => {
    const result = parsePrompt("test.md", VALID_RAW);
    expect(result.name).toBe("test-prompt");
    expect(result.version).toBe("1.2");
    expect(result.changedIn).toBe("spec-99");
    expect(result.body).toContain("This is the body");
  });

  it("throws PromptParseError when a required field is missing", () => {
    const raw = `---
name: missing-version
changed_in: spec-99
---

Body.
`;
    expect(() => parsePrompt("test.md", raw)).toThrow(PromptParseError);
  });

  it("throws PromptParseError when the closing fence is absent", () => {
    const raw = `---
name: bad
version: 1.0
changed_in: spec-00
`;
    expect(() => parsePrompt("test.md", raw)).toThrow(PromptParseError);
  });
});
