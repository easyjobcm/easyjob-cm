'use client'

import * as React from 'react'
import { BottomNav } from './bottom-nav'
import { cn } from '@/lib/utils'

type UserRole = 'candidate' | 'company' | 'admin'

interface AppShellProps {
  children: React.ReactNode
  showNav?: boolean
  className?: string
  userRole?: UserRole
}

export function AppShell({ children, showNav = true, className, userRole = 'candidate' }: AppShellProps) {
  return (
    <div className={cn('flex min-h-screen flex-col bg-background', className)}>
      <main className={cn('flex-1', showNav && 'pb-20')}>
        {children}
      </main>
      {showNav && <BottomNav userRole={userRole} />}
    </div>
  )
}
