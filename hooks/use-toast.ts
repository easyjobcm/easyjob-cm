'use client'

export interface ToastOptions {
  title?: string
  description?: string
  variant?: 'default' | 'destructive' | 'success' | 'warning'
}

export function toast(options: ToastOptions) {
  const title = options.title ?? 'Notification'
  const description = options.description ?? ''
  console.info(`[toast] ${title}${description ? ` - ${description}` : ''}`)
}

export function useToast() {
  return { toast }
}
