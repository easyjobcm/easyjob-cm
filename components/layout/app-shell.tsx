"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: React.ReactNode;
  showNav?: boolean;
  hideNav?: boolean;
  className?: string;
}

// La barre de navigation basse est rendue une seule fois dans le layout racine
// (composant persistant `CandidateTabBar`). Ici on ne gère plus que l'espace
// réservé en bas pour que le contenu ne passe pas sous la barre fixe.
export function AppShell({
  children,
  showNav = true,
  hideNav = false,
  className,
}: AppShellProps) {
  const reserveNavSpace = hideNav ? false : showNav;

  return (
    <div className={cn("flex min-h-screen flex-col bg-background", className)}>
      <main
        className={cn(
          "flex-1",
          reserveNavSpace && "pb-[calc(5rem+env(safe-area-inset-bottom))]",
        )}
      >
        {children}
      </main>
    </div>
  );
}
