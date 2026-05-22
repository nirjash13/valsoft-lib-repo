/**
 * ComposeBatch — "use client" compose panel for batch patron emails.
 *
 * US-04: librarian selects audience filter.
 * US-05: AI drafts the email; librarian MUST review and may edit before send.
 * REQ-07-06: live token-validation warnings; Send disabled while warnings exist.
 * WCAG 2.2 AA: labels on every control; aria-live on warnings + result regions.
 */

"use client";

import { draftBatchEmailAction, sendBatchEmailAction } from "@/app/(app)/notifications/actions";
import { validateDraftTokens } from "@/lib/notifications/draft-validation";
import type { AudienceFilter, PatronEmailDraft } from "@/lib/notifications/schemas";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";

// ---------------------------------------------------------------------------
// AudienceFilter labels
// ---------------------------------------------------------------------------

const AUDIENCE_OPTIONS: { value: AudienceFilter; label: string }[] = [
  { value: "overdue_7d", label: "Overdue 7+ days" },
  { value: "overdue_5d", label: "Overdue 5+ days" },
  { value: "due_this_week", label: "Due this week" },
  { value: "holds_ready", label: "Holds ready for pickup" },
];

// ---------------------------------------------------------------------------
// ComposeBatch
// ---------------------------------------------------------------------------

export function ComposeBatch() {
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("overdue_7d");
  const [intent, setIntent] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [draft, setDraft] = useState<PatronEmailDraft | null>(null);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [sendResult, setSendResult] = useState<{
    batchId: string;
    sent: number;
    failed: number;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Live token validation (REQ-07-06)
  // ---------------------------------------------------------------------------
  const tokenWarnings = draft !== null ? validateDraftTokens(body, draft.required_fields) : [];

  // ---------------------------------------------------------------------------
  // Draft action
  // ---------------------------------------------------------------------------
  const {
    execute: executeDraft,
    isPending: isDrafting,
    result: draftResult,
  } = useAction(draftBatchEmailAction, {
    onSuccess: ({ data }) => {
      if (!data) return;
      setDraft(data.draft);
      setSubject(data.draft.subject);
      setBody(data.draft.body_markdown);
      setRecipientCount(data.recipientCount);
      setSendResult(null);
    },
  });

  // ---------------------------------------------------------------------------
  // Send action
  // ---------------------------------------------------------------------------
  const {
    execute: executeSend,
    isPending: isSending,
    result: sendActionResult,
  } = useAction(sendBatchEmailAction, {
    onSuccess: ({ data }) => {
      if (!data) return;
      setSendResult(data);
    },
  });

  // Parse server errors from either action
  const draftServerError = parseServerError(draftResult.serverError);
  const sendServerError = parseServerError(sendActionResult.serverError);

  // Disable send when: no draft, warnings exist, currently sending, or already sent
  const canSend =
    draft !== null &&
    tokenWarnings.length === 0 &&
    !isSending &&
    sendResult === null &&
    subject.trim().length > 0 &&
    body.trim().length > 0;

  function handleDraft() {
    if (intent.trim().length === 0) return;
    executeDraft({ audienceFilter, intent });
  }

  function handleSend() {
    if (!canSend) return;
    executeSend({
      audienceFilter,
      subject: subject.trim(),
      bodyMarkdown: body.trim(),
      aiDrafted: draft !== null,
    });
  }

  return (
    <div className="space-y-5">
      {/* Audience filter */}
      <div className="space-y-1.5">
        <label htmlFor="audience-filter" className="block text-sm font-medium text-text-primary">
          Audience
        </label>
        <select
          id="audience-filter"
          value={audienceFilter}
          onChange={(e) => {
            setAudienceFilter(e.target.value as AudienceFilter);
            setDraft(null);
            setRecipientCount(null);
            setSendResult(null);
          }}
          className="w-full rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          aria-describedby="audience-hint"
        >
          {AUDIENCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {recipientCount !== null && (
          <p id="audience-hint" className="text-xs text-text-tertiary" aria-live="polite">
            {recipientCount === 0
              ? "No recipients match this filter."
              : `${recipientCount} recipient${recipientCount === 1 ? "" : "s"} will receive this email.`}
          </p>
        )}
      </div>

      {/* Intent */}
      <div className="space-y-1.5">
        <label htmlFor="intent" className="block text-sm font-medium text-text-primary">
          Librarian intent
        </label>
        <textarea
          id="intent"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="e.g. Remind members their books are overdue and ask them to return or renew."
          className="w-full resize-none rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
          aria-describedby="intent-hint"
        />
        <p id="intent-hint" className="text-xs text-text-tertiary">
          Describe the goal of this email. The AI uses this to draft the content.
        </p>
      </div>

      {/* AI draft button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleDraft}
          disabled={isDrafting || intent.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          aria-busy={isDrafting}
        >
          {isDrafting ? (
            <>
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"
                aria-hidden="true"
              />
              Drafting…
            </>
          ) : (
            "AI draft"
          )}
        </button>
        {draft !== null && !isDrafting && (
          <span className="text-xs text-text-tertiary">
            Review and edit the draft before sending.
          </span>
        )}
      </div>

      {/* Draft error */}
      {draftServerError !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {draftServerError}
        </p>
      )}

      {/* Subject + body editors (shown after draft) */}
      {draft !== null && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email-subject" className="block text-sm font-medium text-text-primary">
              Subject
            </label>
            <input
              id="email-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={120}
              className="w-full rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
              aria-required="true"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="email-body" className="block text-sm font-medium text-text-primary">
              Body
            </label>
            <textarea
              id="email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              maxLength={4000}
              className="w-full resize-y rounded-md border border-border-subtle bg-surface px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
              aria-required="true"
              aria-describedby="body-token-hint token-warnings"
            />
            <p id="body-token-hint" className="text-xs text-text-tertiary">
              Use <code className="rounded bg-elevated px-1 py-0.5">{"{{book_title}}"}</code>,{" "}
              <code className="rounded bg-elevated px-1 py-0.5">{"{{due_date}}"}</code>,{" "}
              <code className="rounded bg-elevated px-1 py-0.5">{"{{pickup_window}}"}</code> for
              per-patron personalization.
            </p>
          </div>

          {/* Token validation warnings (REQ-07-06) */}
          <output
            id="token-warnings"
            aria-live="polite"
            aria-label="Email validation warnings"
            className="block space-y-1"
          >
            {tokenWarnings.map((warning) => (
              <p
                key={warning}
                className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400"
              >
                <svg
                  className="h-3.5 w-3.5 shrink-0"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
                {warning}
              </p>
            ))}
          </output>

          {/* Send button + result */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className="inline-flex items-center gap-2 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-800 focus:outline-none focus:ring-2 focus:ring-green-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              aria-busy={isSending}
            >
              {isSending ? (
                <>
                  <span
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"
                    aria-hidden="true"
                  />
                  Sending…
                </>
              ) : (
                "Send emails"
              )}
            </button>

            {/* Send result */}
            <output aria-live="polite" aria-label="Send result">
              {sendResult !== null && (
                <p className="text-sm text-green-700 dark:text-green-400 font-medium">
                  Sent {sendResult.sent} email{sendResult.sent === 1 ? "" : "s"}
                  {sendResult.failed > 0 ? ` (${sendResult.failed} failed)` : ""}
                </p>
              )}
            </output>
          </div>

          {/* Send error */}
          {sendServerError !== null && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {sendServerError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// parseServerError — decode ProblemDetails JSON from next-safe-action
// ---------------------------------------------------------------------------

function parseServerError(serverError: string | undefined): string | null {
  if (!serverError) return null;
  try {
    const parsed = JSON.parse(serverError) as { detail?: string; title?: string };
    return parsed.detail ?? parsed.title ?? serverError;
  } catch {
    return serverError;
  }
}
