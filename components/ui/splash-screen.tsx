"use client"

import { useState, useEffect } from "react"

interface SplashScreenProps {
  minDuration?: number
}

export function SplashScreen({ minDuration = 3000 }: SplashScreenProps) {
  const [showSplash, setShowSplash] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setFadeOut(true)
      setTimeout(() => setShowSplash(false), 500)
    }, minDuration)

    return () => clearTimeout(timer)
  }, [minDuration])

  if (!showSplash) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-purple-50 transition-opacity duration-500 ${
        fadeOut ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/4 -right-1/4 w-1/2 h-1/2 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-1/4 -left-1/4 w-1/2 h-1/2 rounded-full bg-accent/5 blur-3xl" />
      </div>

      {/* Video animation */}
      <div className="relative z-10 flex flex-col items-center">
        <div className="mb-4">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="w-48 h-48 object-contain"
          >
            <source src="/images/easyjob-logo-animation.webm" type="video/webm" />
          </video>
        </div>

        {/* Brand name with gradient */}
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent mb-2">
          EasyJob CM
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          L&apos;emploi temporaire simplifie
        </p>

        {/* Loading indicator */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
            <span className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
            <span className="w-2 h-2 rounded-full bg-primary animate-bounce" />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-8 text-center">
        <p className="text-xs text-muted-foreground">
          Version 1.0.0 - Made in Cameroon
        </p>
      </div>
    </div>
  )
}
