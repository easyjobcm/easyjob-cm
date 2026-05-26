'use client'

import * as React from 'react'
import { BottomNav } from './bottom-nav'
import { cn } from '@/lib/utils'

type UserRole =
  | 'candidate'
  | 'candidate_premium'
  | 'company'
  | 'company_premium'
  | 'admin_support'
  | 'admin_ops'
  | 'admin_founder'

interface AppShellProps {
  children: React.ReactNode
  showNav?: boolean
  hideNav?: boolean
  className?: string
  userRole?: UserRole
}

export function AppShell({ children, showNav = true, hideNav = false, className, userRole = 'candidate' }: AppShellProps) {
  const resolvedShowNav = hideNav ? false : showNav

  return (
    <div className={cn('flex min-h-screen flex-col bg-background', className)}>
      <main className={cn('flex-1', resolvedShowNav && 'pb-20')}>
        {children}
      </main>
      {resolvedShowNav && <BottomNav userRole={userRole} />}
    </div>
  )
}
