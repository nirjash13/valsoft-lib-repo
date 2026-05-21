import { cn } from "@/lib/utils/cn";
import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium transition-instant",
  {
    variants: {
      variant: {
        default:
          "bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))] border border-[hsl(var(--accent)/0.3)]",
        success:
          "bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))] border border-[hsl(var(--success)/0.3)]",
        warning:
          "bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))] border border-[hsl(var(--warning)/0.3)]",
        danger:
          "bg-[hsl(var(--danger)/0.12)] text-[hsl(var(--danger))] border border-[hsl(var(--danger)/0.3)]",
        secondary:
          "bg-[hsl(var(--bg-surface-2))] text-[hsl(var(--text-secondary))] border border-[hsl(var(--border-subtle))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
