"use client";

import type { BookCardData } from "@/components/chat/book-card-inline";
import { ErrorNotice } from "@/components/chat/error-notice";
import { MessageInput } from "@/components/chat/message-input";
import { MessageList } from "@/components/chat/message-list";
import { QuotaBanner } from "@/components/chat/quota-banner";
import { cn } from "@/lib/utils/cn";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";

interface ChatThreadProps {
  /**
   * If set, the thread sends this query exactly once on mount (from ?q= handoff via ⌘K).
   */
  initialQuery?: string | undefined;
  /** Page context for tool grounding — e.g. "global", "book:<uuid>". */
  pageContext?: string;
  className?: string;
}

/**
 * ChatThread — the main conversational component for "Ask Stack".
 *
 * Owns:
 *   - useChat hook wired to DefaultChatTransport → /api/chat/stream
 *   - Input state (v6 useChat does not manage input)
 *   - Autoscroll to bottom on new messages
 *   - initialQuery auto-send (exactly once, via ref guard)
 *   - Book lookup map built from tool-result parts
 *   - Quota (402) and stream error detection
 */
export function ChatThread({ initialQuery, pageContext = "global", className }: ChatThreadProps) {
  const [input, setInput] = useState("");
  const [quotaReached, setQuotaReached] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const initialQuerySentRef = useRef(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat/stream",
        body: { pageContext },
      }),
    [pageContext],
  );

  const { messages, sendMessage, status, error, stop } = useChat({ transport });

  const isStreaming = status === "submitted" || status === "streaming";

  // Detect 402 (quota exceeded) from the error object
  useEffect(() => {
    if (error !== undefined) {
      // The DefaultChatTransport surfaces HTTP errors — check for 402 in message
      const msg = error.message ?? "";
      if (msg.includes("402") || msg.toLowerCase().includes("quota")) {
        setQuotaReached(true);
      }
    }
  }, [error]);

  // Autoscroll to the bottom whenever messages change or while streaming.
  // Respects prefers-reduced-motion (spec US-08 / NFR-06-06).
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages and status are intentional triggers; scrollAnchorRef is a stable ref
  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (anchor === null) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    anchor.scrollIntoView({
      behavior: prefersReducedMotion ? "instant" : "smooth",
      block: "end",
    });
  }, [messages, status]);

  // Send initialQuery exactly once on mount (⌘K handoff — spec §"Ask Stack" handoff).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally empty — sendMessage is stable; initialQuery must only fire once on mount, not on every re-render
  useEffect(() => {
    if (initialQuery && !initialQuerySentRef.current) {
      initialQuerySentRef.current = true;
      sendMessage({ text: initialQuery });
    }
  }, []); // one-shot on mount

  /**
   * Build bookId → BookCardData lookup from all tool-result parts in the conversation.
   *
   * Tool results from search_catalog return arrays of BookCardData; get_book_detail returns one.
   * We scan every message's parts for 'dynamic-tool' parts with state 'output-available'.
   */
  const bookLookup = useMemo<ReadonlyMap<string, BookCardData>>(() => {
    const map = new Map<string, BookCardData>();

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "dynamic-tool") continue;
        if (part.state !== "output-available") continue;

        const output = part.output as unknown;
        if (output === null || typeof output !== "object") continue;

        // search_catalog returns an array
        if (Array.isArray(output)) {
          for (const item of output) {
            if (isBookCardData(item)) {
              map.set(item.book_id.toLowerCase(), item);
            }
          }
        } else if (isBookCardData(output)) {
          // get_book_detail returns a single object
          map.set(output.book_id.toLowerCase(), output);
        }
      }
    }

    return map;
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text || isStreaming || quotaReached) return;
    setInput("");
    sendMessage({ text });
  }

  const showError = !quotaReached && error !== undefined && status === "error";

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Main scrollable message region */}
      <section className="flex-1 overflow-y-auto px-4 md:px-6" aria-label="Chat messages">
        <div className="mx-auto max-w-2xl">
          <MessageList
            messages={messages}
            bookLookup={bookLookup}
            scrollAnchorRef={scrollAnchorRef}
          />
        </div>
      </section>

      {/* Bottom bar: banners + input */}
      <div className="border-t border-border-subtle bg-surface px-4 py-3 md:px-6">
        <div className="mx-auto max-w-2xl flex flex-col gap-3">
          {quotaReached && <QuotaBanner />}
          {showError && <ErrorNotice />}
          <MessageInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onStop={stop}
            isStreaming={isStreaming}
            isDisabled={quotaReached}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Type guard for BookCardData from tool output.
 * Validates the minimum required fields without using `any`.
 */
function isBookCardData(value: unknown): value is BookCardData {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.book_id === "string" && typeof v.title === "string" && Array.isArray(v.authors);
}
