"use client"

import { useState, useEffect } from "react"
import Image from "next/image"

interface SplashScreenProps {
  children: React.ReactNode
  minDuration?: number
}

export function SplashScreen({ children, minDuration = 2500 }: SplashScreenProps) {
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
    return <>{children}</>
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 transition-opacity duration-500 ${
          fadeOut ? "opacity-0" : "opacity-100"
        }`}
      >
        {/* Background decorative elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-1/4 -right-1/4 w-1/2 h-1/2 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -bottom-1/4 -left-1/4 w-1/2 h-1/2 rounded-full bg-accent/5 blur-3xl" />
        </div>

        {/* Logo with 3D flip animation */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="perspective-800 mb-6">
            <div className="relative w-40 h-40 animate-splash-logo">
              <Image
                src="/images/easyjob-logo.png"
                alt="EasyJob CM"
                fill
                className="object-contain"
                priority
              />
            </div>
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
      <div className={fadeOut ? "opacity-100" : "opacity-0"}>
        {children}
      </div>
    </>
  )
}
