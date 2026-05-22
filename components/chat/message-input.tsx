"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { SendHorizontal, Square } from "lucide-react";
import { useRef } from "react";

const MAX_INPUT_CHARS = 1000;

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  isDisabled: boolean;
  className?: string;
}

/**
 * MessageInput — textarea + send/stop button for the chat thread.
 *
 * - Enter sends; Shift+Enter inserts a newline.
 * - Input > 1000 chars shows a visible warning and soft-truncates (spec §9).
 * - Disabled while status is submitted|streaming or when isDisabled (quota).
 */
export function MessageInput({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming,
  isDisabled,
  className,
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isOverLimit = value.length > MAX_INPUT_CHARS;
  const canSend = value.trim().length > 0 && !isStreaming && !isDisabled;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        handleSend();
      }
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
  }

  function handleSend() {
    if (!canSend) return;
    onSend();
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {/* Over-limit warning (spec §9) */}
      {isOverLimit && (
        <output aria-live="polite" className="text-meta text-warning px-1" id="input-limit-warning">
          Message exceeds {MAX_INPUT_CHARS} characters — only the first {MAX_INPUT_CHARS} will be
          sent.
        </output>
      )}

      <div
        className={cn(
          "flex items-end gap-2 rounded-lg border bg-surface-2 px-3 py-2",
          "transition-instant transition-colors",
          isDisabled
            ? "border-border-subtle opacity-50 cursor-not-allowed"
            : isOverLimit
              ? "border-warning focus-within:border-warning"
              : "border-border-default focus-within:border-border-strong focus-within:ring-1 focus-within:ring-accent",
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={isDisabled && !isStreaming}
          placeholder="Ask about books in this library…"
          rows={1}
          aria-label="Message"
          aria-describedby={isOverLimit ? "input-limit-warning" : undefined}
          className={cn(
            "flex-1 resize-none bg-transparent text-body text-text-primary",
            "placeholder:text-text-tertiary",
            "focus:outline-none",
            "min-h-[24px] max-h-[160px] overflow-y-auto",
            "disabled:cursor-not-allowed",
            // Grow with content
            "field-sizing-content",
          )}
        />

        {/* Stop button while streaming */}
        {isStreaming ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onStop}
            aria-label="Stop generating"
            className="shrink-0 h-8 w-8"
          >
            <Square className="h-4 w-4" aria-hidden />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className="shrink-0 h-8 w-8"
          >
            <SendHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>

      <p className="text-[11px] text-text-tertiary px-1">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
