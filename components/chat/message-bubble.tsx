"use client";

import type { BookCardData } from "@/components/chat/book-card-inline";
import { BookCardInline } from "@/components/chat/book-card-inline";
import { RefusalNotice } from "@/components/chat/refusal-notice";
import { extractBookRefs } from "@/lib/domain/chat/book-refs";
import { isRefusalText } from "@/lib/domain/chat/refusal";
import { cn } from "@/lib/utils/cn";
import type { UIMessage } from "ai";
import { isTextUIPart } from "ai";

interface MessageBubbleProps {
  message: UIMessage;
  /** Lookup map of bookId → BookCardData, built from all tool-result parts in the thread. */
  bookLookup: ReadonlyMap<string, BookCardData>;
}

/**
 * Splits assistant text on <book:UUID> tokens and renders:
 *   - Plain text spans between tokens
 *   - BookCardInline at each token IF the id resolves in the lookup map (REQ-06-05)
 *   - Tokens with unknown ids are silently dropped (spec §9 edge case)
 */
function renderTextWithBookCards(
  text: string,
  bookLookup: ReadonlyMap<string, BookCardData>,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRe = /<book:([^>]+)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop pattern
  while ((match = tokenRe.exec(text)) !== null) {
    const [fullMatch, rawId] = match;
    const beforeText = text.slice(lastIndex, match.index);

    if (beforeText) {
      nodes.push(
        <span key={`t-${key++}`} className="whitespace-pre-wrap">
          {beforeText}
        </span>,
      );
    }

    // Only render card if the id resolves (REQ-06-05)
    const bookId = (rawId ?? "").toLowerCase();
    const bookData = bookLookup.get(bookId);
    if (bookData !== undefined) {
      nodes.push(<BookCardInline key={`b-${bookId}`} data={bookData} className="my-2" />);
    }
    // Unknown ids are silently dropped — no raw token rendered

    lastIndex = match.index + fullMatch.length;
    key++;
  }

  // Remaining text after the last token
  const tail = text.slice(lastIndex);
  if (tail) {
    nodes.push(
      <span key={`t-${key}`} className="whitespace-pre-wrap">
        {tail}
      </span>,
    );
  }

  return nodes;
}

/**
 * MessageBubble — renders a single chat message (user or assistant).
 *
 * For assistant messages:
 *   - Iterates parts array (text parts and tool parts)
 *   - Within text parts: splits on <book:UUID> tokens to inline BookCardInline components
 *   - Detects refusal text and renders RefusalNotice instead
 *   - Tool-invocation parts are shown as a subtle "Searching…" indicator while streaming
 */
export function MessageBubble({ message, bookLookup }: MessageBubbleProps) {
  const isUser = message.role === "user";

  if (isUser) {
    // User messages: collect all text parts and render as a single bubble
    const userText = message.parts
      .filter(isTextUIPart)
      .map((p) => p.text)
      .join("");

    return (
      <div className="flex justify-end">
        <div
          className={cn(
            "max-w-[80%] rounded-2xl rounded-br-sm px-4 py-2.5",
            "bg-accent text-accent-text",
            "text-body",
          )}
        >
          <p className="whitespace-pre-wrap">{userText}</p>
        </div>
      </div>
    );
  }

  // Assistant message — render parts in order
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] flex flex-col gap-1">
        {message.parts.map((part, idx) => {
          // Parts are ordered and stable within a message; use type+idx as composite key.
          const partKey = `${part.type}-${idx}`;

          // Text part
          if (part.type === "text") {
            const { text, state } = part;

            if (!text) return null;

            // Check for refusal — only on complete (non-streaming) text
            if (state !== "streaming" && isRefusalText(text)) {
              return <RefusalNotice key={partKey} text={text} />;
            }

            const refs = extractBookRefs(text);
            const hasBookTokens = refs.length > 0;

            return (
              <div
                key={partKey}
                className={cn(
                  "rounded-2xl rounded-bl-sm px-4 py-2.5",
                  "bg-surface border border-border-subtle",
                  "text-body text-text-primary",
                  state === "streaming" && "animate-pulse-subtle",
                )}
              >
                {hasBookTokens ? (
                  renderTextWithBookCards(text, bookLookup)
                ) : (
                  <span className="whitespace-pre-wrap">{text}</span>
                )}
              </div>
            );
          }

          // Dynamic tool parts — shown as a subtle indicator while the tool runs
          if (part.type === "dynamic-tool") {
            const isRunning = part.state === "input-streaming" || part.state === "input-available";
            const toolName = part.toolName;

            if (!isRunning) return null; // done — results reflected in text parts

            const label =
              toolName === "search_catalog"
                ? "Searching the catalog…"
                : toolName === "get_book_detail"
                  ? "Looking up book details…"
                  : toolName === "check_availability"
                    ? "Checking availability…"
                    : toolName === "place_hold"
                      ? "Placing hold…"
                      : "Thinking…";

            return (
              <div
                key={partKey}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 w-fit text-meta text-text-tertiary"
                aria-live="polite"
                aria-label={label}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce" aria-hidden />
                {label}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
