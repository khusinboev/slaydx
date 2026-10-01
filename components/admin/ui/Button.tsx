"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "dangerOutline" | "ghost";
export type ButtonSize = "sm" | "md";

// Variant + size are props (not className overrides): there is no tailwind-merge,
// so conflicting utilities from the caller would resolve by stylesheet order.
const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-primary bg-primary text-primary-foreground font-semibold hover:brightness-95",
  secondary: "border-input bg-card text-foreground hover:border-ring",
  // Solid danger: light text on the dark-red light theme, dark text on the lighter dark-theme red.
  danger:
    "border-destructive bg-destructive text-destructive-foreground dark:text-primary-foreground font-semibold hover:brightness-95",
  dangerOutline: "border-destructive/40 bg-card text-destructive hover:border-destructive",
  ghost: "border-transparent bg-transparent text-foreground hover:bg-muted",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-[13px]",
};

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and sets `aria-busy`. */
  loading?: boolean;
  /** Optional leading icon (replaced by the spinner while loading). */
  icon?: ReactNode;
  /** Layout-only extras (width, margins). Never use it to override colours or sizes. */
  className?: string;
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  disabled,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "focus-visible:ring-ring inline-flex shrink-0 items-center justify-center rounded-lg border whitespace-nowrap transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
