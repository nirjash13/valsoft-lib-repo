"use client";

import { cn } from "@/lib/utils/cn";
import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-md font-medium text-body",
    "transition-instant transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    "disabled:pointer-events-none disabled:opacity-40",
    "select-none",
  ],
  {
    variants: {
      variant: {
        default:
          // REVIEW: hover:bg-[hsl(var(--accent)/0.88)] — opacity variant; needs oklch/rgb token to use Tailwind modifier
          "bg-accent text-accent-text hover:bg-[hsl(var(--accent)/0.88)]",
        secondary: "bg-surface-2 text-text-primary border border-border-subtle hover:bg-elevated",
        ghost: "text-text-secondary hover:bg-elevated hover:text-text-primary",
        destructive:
          // REVIEW: hover:bg-[hsl(var(--danger)/0.88)] — opacity variant; needs oklch/rgb token to use Tailwind modifier
          "bg-danger text-white hover:bg-[hsl(var(--danger)/0.88)]",
        link: "text-accent underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-meta",
        default: "h-9 px-4",
        lg: "h-10 px-6",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
