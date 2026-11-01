"use client";

import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import {
  dismissToast,
  getToasts,
  subscribeToasts,
  type ToastItem,
} from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const VARIANT = {
  default: {
    icon: Info,
    className: "border-border",
    iconClass: "text-primary",
  },
  success: {
    icon: CheckCircle2,
    className: "border-emerald-500/40",
    iconClass: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    icon: AlertTriangle,
    className: "border-amber-500/40",
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  destructive: {
    icon: XCircle,
    className: "border-destructive/50",
    iconClass: "text-destructive",
  },
} satisfies Record<ToastItem["variant"], unknown>;

const EMPTY: ToastItem[] = [];

/**
 * Rendu des notifications de `hooks/use-toast`. Placé en haut de l'écran
 * (zone sûre incluse) pour ne jamais recouvrir la barre d'onglets du bas.
 * Les erreurs sont annoncées immédiatement (role="alert"), les autres
 * poliment (role="status") ; l'icône et le titre distinguent le type.
 */
export function Toaster() {
  const { t } = useI18n();
  const items = useSyncExternalStore(subscribeToasts, getToasts, () => EMPTY);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <AnimatePresence initial={false}>
        {items.map((item) => {
          const { icon: Icon, className, iconClass } = VARIANT[item.variant];
          const urgent =
            item.variant === "destructive" || item.variant === "warning";
          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.2 }}
              role={urgent ? "alert" : "status"}
              aria-live={urgent ? "assertive" : "polite"}
              aria-atomic="true"
              className={cn(
                "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border bg-card p-4 text-card-foreground shadow-lg",
                className,
              )}
            >
              <Icon
                className={cn("mt-0.5 h-5 w-5 shrink-0", iconClass)}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                {item.title && (
                  <p className="text-sm font-semibold">{item.title}</p>
                )}
                {item.description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {item.description}
                  </p>
                )}
              </div>
              <motion.button
                type="button"
                whileTap={{ scale: 0.9 }}
                onClick={() => dismissToast(item.id)}
                aria-label={t.common.close}
                className="-m-1 rounded-lg p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </motion.button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
