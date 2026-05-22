import { cn } from "@/lib/utils/cn";
import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium transition-instant",
  {
    variants: {
      variant: {
        // REVIEW: opacity-alpha variants below need oklch/rgb @theme tokens to use Tailwind opacity modifiers
        default: "bg-[hsl(var(--accent)/0.15)] text-accent border border-[hsl(var(--accent)/0.3)]",
        success:
          "bg-[hsl(var(--success)/0.12)] text-success border border-[hsl(var(--success)/0.3)]",
        warning:
          "bg-[hsl(var(--warning)/0.12)] text-warning border border-[hsl(var(--warning)/0.3)]",
        danger: "bg-[hsl(var(--danger)/0.12)] text-danger border border-[hsl(var(--danger)/0.3)]",
        secondary: "bg-surface-2 text-text-secondary border border-border-subtle",
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
