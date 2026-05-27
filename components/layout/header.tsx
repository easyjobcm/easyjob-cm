"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";

interface HeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  variant?: "default" | "transparent" | "primary";
  className?: string;
}

export function Header({
  title,
  subtitle,
  showBack = false,
  onBack,
  rightAction,
  variant = "default",
  className,
}: HeaderProps) {
  const router = useRouter();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  const variantClasses = {
    default: "bg-card/80 backdrop-blur-xl border-b border-border/50",
    transparent: "bg-transparent",
    primary: "bg-gradient-primary text-white",
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-30 safe-area-top",
        variantClasses[variant],
        className,
      )}
    >
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {showBack && (
            <button
              onClick={handleBack}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl transition-all active:scale-95",
                variant === "primary"
                  ? "bg-white/10 hover:bg-white/20"
                  : "bg-muted hover:bg-muted/80",
              )}
            >
              <ChevronLeft className="h-5 w-5" />
              <span className="sr-only">Retour</span>
            </button>
          )}
          <div>
            <h1
              className={cn(
                "text-lg font-semibold",
                variant === "primary" ? "text-white" : "text-foreground",
              )}
            >
              {title}
            </h1>
            {subtitle && (
              <p
                className={cn(
                  "text-xs",
                  variant === "primary"
                    ? "text-white/80"
                    : "text-muted-foreground",
                )}
              >
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {rightAction && (
          <div className="flex items-center gap-2">{rightAction}</div>
        )}
      </div>
    </header>
  );
}
