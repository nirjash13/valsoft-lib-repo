"use client";

import type { BookCardData } from "@/components/chat/book-card-inline";
import { MessageBubble } from "@/components/chat/message-bubble";
import { cn } from "@/lib/utils/cn";
import type { UIMessage } from "ai";

interface MessageListProps {
  messages: UIMessage[];
  /** Lookup map of bookId → BookCardData, built from all tool-result parts in the thread. */
  bookLookup: ReadonlyMap<string, BookCardData>;
  /** ref forwarded to the scroll anchor at the bottom of the list */
  scrollAnchorRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

/**
 * MessageList — renders the conversation thread.
 *
 * The list region is labelled for screen readers and the streaming region
 * carries aria-live="polite" so assistive technology announces completions (US-08, NFR-06-06).
 */
export function MessageList({
  messages,
  bookLookup,
  scrollAnchorRef,
  className,
}: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center flex-1 text-center py-16",
          className,
        )}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 bg-surface-2 text-2xl"
          aria-hidden
        >
          📚
        </div>
        <p className="text-h3 text-text-primary mb-2">Ask Stack anything about your library</p>
        <p className="text-body text-text-secondary max-w-sm">
          Try: "Recommend something like Pachinko", "Do we have any fantasy novels for teens?", or
          "What's popular right now?"
        </p>
      </div>
    );
  }

  return (
    <div
      role="log"
      aria-label="Conversation"
      aria-live="polite"
      aria-relevant="additions"
      className={cn("flex flex-col gap-4 py-4", className)}
    >
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} bookLookup={bookLookup} />
      ))}

      {/* Scroll anchor — scrollIntoView target for autoscroll */}
      <div ref={scrollAnchorRef} aria-hidden />
    </div>
  );
}
