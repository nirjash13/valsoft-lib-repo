/**
 * Draft token validation — REQ-07-06 BDD scenario: "draft missing required field".
 *
 * Pure function: no I/O, no imports from AI or DB layers.
 * Called by the UI before allowing send, and by the Server Action as a final guard.
 */

// ---------------------------------------------------------------------------
// validateDraftTokens
// ---------------------------------------------------------------------------

/**
 * Validates that all tokens declared as required by the AI draft are present
 * in the email body.
 *
 * @param bodyMarkdown   - The email body as Markdown (from PatronEmailDraft.body_markdown).
 * @param requiredFields - The required_fields object from PatronEmailDraft (AI-declared).
 *
 * @returns An array of human-readable problem messages. Empty array means valid.
 *          Messages are used verbatim in the UI (REQ-07-06 acceptance scenario).
 */
export function validateDraftTokens(
  bodyMarkdown: string,
  requiredFields: {
    has_book_title: boolean;
    has_due_date: boolean;
    has_pickup_window: boolean;
  },
): string[] {
  const problems: string[] = [];

  if (requiredFields.has_book_title && !bodyMarkdown.includes("{{book_title}}")) {
    problems.push("Add a book title — patrons need this");
  }

  if (requiredFields.has_due_date && !bodyMarkdown.includes("{{due_date}}")) {
    // REQ-07-06 UI copy: "Add a due date — patrons need this"
    problems.push("Add a due date — patrons need this");
  }

  if (requiredFields.has_pickup_window && !bodyMarkdown.includes("{{pickup_window}}")) {
    problems.push("Add a pickup window — patrons need this");
  }

  return problems;
}
