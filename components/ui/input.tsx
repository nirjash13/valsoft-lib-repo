import { cn } from "@/lib/utils/cn";
import * as React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md",
          "bg-[hsl(var(--bg-surface-2))] text-[hsl(var(--text-primary))]",
          "border border-[hsl(var(--border-default))]",
          "px-3 py-2 text-body",
          "placeholder:text-[hsl(var(--text-tertiary))]",
          "focus-visible:outline-none focus-visible:border-[hsl(var(--border-strong))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--accent))]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "transition-instant transition-colors",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
