"use client";

export interface ToastOptions {
  title?: string;
  description?: string;
  variant?: "default" | "destructive" | "success" | "warning";
}

export interface ToastItem {
  id: number;
  title: string;
  description: string;
  variant: NonNullable<ToastOptions["variant"]>;
}

// État partagé hors React : `toast()` est appelé depuis des gestionnaires
// d'événements, et <Toaster /> (monté une fois dans app/layout.tsx) s'y abonne.
const MAX_TOASTS = 3;
const DURATION_MS = {
  default: 5000,
  success: 5000,
  warning: 8000,
  destructive: 8000,
};

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function toast(options: ToastOptions): number {
  const item: ToastItem = {
    id: nextId++,
    title: options.title ?? "",
    description: options.description ?? "",
    variant: options.variant ?? "default",
  };
  // Les plus anciennes sont retirées au-delà de MAX_TOASTS.
  for (const old of toasts.slice(
    0,
    Math.max(0, toasts.length + 1 - MAX_TOASTS),
  ))
    dismissToast(old.id);
  toasts = [...toasts, item];
  timers.set(
    item.id,
    setTimeout(() => dismissToast(item.id), DURATION_MS[item.variant]),
  );
  emit();
  return item.id;
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): ToastItem[] {
  return toasts;
}

export function useToast() {
  return { toast, dismiss: dismissToast };
}
