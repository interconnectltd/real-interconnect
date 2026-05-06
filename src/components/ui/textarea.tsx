"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Shared Textarea component.
 * - iOS auto-zoom 抑止 (text-base sm:text-sm; Input.tsx と同じ規約)
 * - aria-invalid / aria-errormessage / focus ring パターン統一
 * - Input と同等の border / bg / focus 設計を採用
 */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        "w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";
