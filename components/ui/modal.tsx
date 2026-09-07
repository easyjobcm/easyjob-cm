"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface ModalProps {
  open?: boolean;
  isOpen?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
}

export function Modal({
  open,
  isOpen,
  onClose,
  children,
  title,
  className,
}: ModalProps) {
  const { t } = useI18n();
  const visible = open ?? isOpen ?? false;
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  // Le portail nécessite `document` : vrai côté client, toujours faux au rendu serveur.
  const [canPortal] = React.useState(() => typeof document !== "undefined");

  React.useEffect(() => {
    if (visible) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [visible]);

  // Focus initial sur le panneau + fermeture au clavier (Échap).
  React.useEffect(() => {
    if (!visible) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [visible, onClose]);

  if (!visible || !canPortal) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in-0"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          "relative z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-t-3xl bg-card shadow-2xl outline-none animate-in slide-in-from-bottom-4 sm:max-h-[85vh] sm:rounded-2xl sm:slide-in-from-bottom-0 sm:zoom-in-95",
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1 w-12 shrink-0 rounded-full bg-muted sm:hidden" />
        <button
          onClick={onClose}
          aria-label={t.common.close}
          className="absolute right-4 top-4 z-10 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain safe-area-bottom">
          {title ? (
            <ModalHeader id={titleId}>{title}</ModalHeader>
          ) : (
            <div className="pt-6" />
          )}
          <div className="px-6 pb-6">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ModalHeader({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn("px-6 pt-6 pb-2", className)}>
      <h2 id={id} className="text-xl font-semibold text-foreground">
        {children}
      </h2>
    </div>
  );
}

export function ModalContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("px-6 py-4", className)}>{children}</div>;
}

export function ModalFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-3 px-6 pb-6 pt-2", className)}>{children}</div>
  );
}
