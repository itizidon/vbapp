"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export function DialogContent({
  children,
  className,
  onCloseAutoFocus,
  overlayClassName,
  style,
  closeLabel = "Close dialog",
  placement = "center",
}: {
  children: React.ReactNode;
  className?: string;
  overlayClassName?: string;
  style?: React.CSSProperties;
  closeLabel?: string;
  placement?: "center" | "custom";
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm",
          overlayClassName,
        )}
      />
      <DialogPrimitive.Content
        onCloseAutoFocus={onCloseAutoFocus}
        style={style}
        className={cn(
          "fixed z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-2xl border border-border bg-card p-6 shadow-xl",
          placement === "center" &&
            "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
          className,
        )}
      >
        {children}
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className="absolute right-3 top-3 grid size-11 place-items-center rounded-lg hover:bg-muted"
        >
          <X size={18} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
