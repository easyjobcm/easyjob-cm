"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoSpinnerProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showText?: boolean;
}

const sizeMap = {
  sm: { container: "w-12 h-12", text: "text-xs" },
  md: { container: "w-20 h-20", text: "text-sm" },
  lg: { container: "w-32 h-32", text: "text-base" },
  xl: { container: "w-48 h-48", text: "text-lg" },
};

export function LogoSpinner({
  size = "md",
  className,
  showText = false,
}: LogoSpinnerProps) {
  const { container, text } = sizeMap[size];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4",
        className,
      )}
    >
      <div className={cn("perspective-800", container)}>
        <div className="relative w-full h-full animate-logo-flip">
          <Image
            src="/images/easyjob-logo.png"
            alt="EasyJob CM"
            fill
            className="object-contain"
            priority
          />
        </div>
      </div>
      {showText && (
        <p className={cn("text-muted-foreground font-medium", text)}>
          Chargement...
        </p>
      )}
    </div>
  );
}

// Full page loader variant with gradient background
export function PageLoader() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-background via-background to-secondary/30">
      <div className="animate-pulse-glow">
        <LogoSpinner size="xl" />
      </div>
      <div className="mt-6 flex flex-col items-center gap-2">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          EasyJob CM
        </h1>
        <p className="text-muted-foreground text-sm">Chargement en cours...</p>
      </div>
    </div>
  );
}

// Inline loader for buttons or small areas
export function InlineLoader({ className }: { className?: string }) {
  return <LogoSpinner size="sm" className={className} />;
}
