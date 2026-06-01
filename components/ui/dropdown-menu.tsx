"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface DropdownContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DropdownContext = React.createContext<DropdownContextValue | null>(null);

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      {children}
    </DropdownContext.Provider>
  );
}

interface DropdownMenuTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  children: React.ReactNode;
}

export function DropdownMenuTrigger({
  asChild,
  children,
  ...props
}: DropdownMenuTriggerProps) {
  const context = React.useContext(DropdownContext);
  if (!context) return null;

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      onClick?: React.MouseEventHandler;
    }>;
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event);
        context.setOpen(!context.open);
      },
    });
  }

  return (
    <button
      type="button"
      onClick={() => context.setOpen(!context.open)}
      {...props}
    >
      {children}
    </button>
  );
}

interface DropdownMenuContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end";
}

export function DropdownMenuContent({
  className,
  align: _align,
  ...props
}: DropdownMenuContentProps) {
  const context = React.useContext(DropdownContext);
  if (!context || !context.open) return null;

  return (
    <div
      className={cn(
        "z-50 min-w-48 rounded-xl border border-border bg-card p-1 shadow-lg",
        className,
      )}
      {...props}
    />
  );
}

interface DropdownMenuItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  children?: React.ReactNode;
}

export function DropdownMenuItem({
  className,
  onClick,
  asChild,
  children,
  ...props
}: DropdownMenuItemProps) {
  const context = React.useContext(DropdownContext);

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      className?: string;
      onClick?: React.MouseEventHandler;
    }>;
    return React.cloneElement(child, {
      className: cn(
        "flex w-full items-center rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted",
        className,
        child.props.className,
      ),
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event);
        context?.setOpen(false);
      },
    });
  }

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        context?.setOpen(false);
      }}
      {...props}
    >
      {children}
    </button>
  );
}
