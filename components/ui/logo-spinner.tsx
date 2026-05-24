"use client"

import Image from "next/image"
import { cn } from "@/lib/utils"

interface LogoSpinnerProps {
  size?: "sm" | "md" | "lg" | "xl"
  className?: string
  showText?: boolean
}

const sizeMap = {
  sm: { container: "w-12 h-12", text: "text-xs" },
  md: { container: "w-20 h-20", text: "text-sm" },
  lg: { container: "w-32 h-32", text: "text-base" },
  xl: { container: "w-48 h-48", text: "text-lg" },
}

export function LogoSpinner({ size = "md", className, showText = false }: LogoSpinnerProps) {
  const { container, text } = sizeMap[size]

  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", className)}>
      <div className={cn("perspective-1000", container)}>
        <div className="relative w-full h-full animate-logo-spin transform-style-3d">
          <Image
            src="/images/easyjob-logo.png"
            alt="EasyJob CM"
            fill
            className="object-contain drop-shadow-2xl"
            priority
          />
        </div>
      </div>
      {showText && (
        <p className={cn("text-muted-foreground animate-pulse font-medium", text)}>
          Chargement...
        </p>
      )}
    </div>
  )
}

// Full page loader variant
export function PageLoader() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <LogoSpinner size="lg" showText />
    </div>
  )
}

// Inline loader for buttons or small areas
export function InlineLoader({ className }: { className?: string }) {
  return <LogoSpinner size="sm" className={className} />
}
