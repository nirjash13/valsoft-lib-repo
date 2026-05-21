import { cn } from "@/lib/utils/cn";
import * as React from "react";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md",
          "bg-[hsl(var(--bg-surface-2))] text-[hsl(var(--text-primary))]",
          "border border-[hsl(var(--border-default))]",
          "px-3 py-2 text-body",
          "placeholder:text-[hsl(var(--text-tertiary))]",
          "focus-visible:outline-none focus-visible:border-[hsl(var(--border-strong))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--accent))]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "transition-instant transition-colors resize-y",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
