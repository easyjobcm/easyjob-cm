'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'
import { Home, ClipboardList, Briefcase, User, LayoutDashboard, Users, Plus, Settings } from 'lucide-react'

type UserRole =
  | 'candidate'
  | 'candidate_premium'
  | 'company'
  | 'company_premium'
  | 'admin'
  | 'admin_support'
  | 'admin_ops'
  | 'admin_founder'

type NormalizedUserRole = 'candidate' | 'company' | 'admin'

interface NavItem {
  href: string
  label: string
  labelEn: string
  icon: React.ComponentType<{ className?: string }>
}

const candidateNavItems: NavItem[] = [
  { href: '/jobs', label: 'Offres', labelEn: 'Jobs', icon: Home },
  { href: '/tasks', label: 'Taches', labelEn: 'Tasks', icon: ClipboardList },
  { href: '/my-jobs', label: 'Mes Jobs', labelEn: 'My Jobs', icon: Briefcase },
  { href: '/profile', label: 'Profil', labelEn: 'Profile', icon: User },
]

const companyNavItems: NavItem[] = [
  { href: '/company/dashboard', label: 'Accueil', labelEn: 'Home', icon: LayoutDashboard },
  { href: '/company/jobs/new', label: 'Publier', labelEn: 'Post', icon: Plus },
  { href: '/company/applications', label: 'Candidats', labelEn: 'Candidates', icon: Users },
  { href: '/company/profile', label: 'Profil', labelEn: 'Profile', icon: Settings },
]

const adminNavItems: NavItem[] = [
  { href: '/admin/dashboard', label: 'Dashboard', labelEn: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Utilisateurs', labelEn: 'Users', icon: Users },
  { href: '/admin/jobs', label: 'Offres', labelEn: 'Jobs', icon: Briefcase },
  { href: '/admin/settings', label: 'Config', labelEn: 'Settings', icon: Settings },
]

interface BottomNavProps {
  userRole?: UserRole
}

export function BottomNav({ userRole = 'candidate' }: BottomNavProps) {
  const pathname = usePathname()
  const { locale } = useTranslation()

  const normalizedRole: NormalizedUserRole = React.useMemo(() => {
    if (userRole === 'company' || userRole === 'company_premium') return 'company'
    if (userRole === 'admin_support' || userRole === 'admin_ops' || userRole === 'admin_founder' || userRole === 'admin') return 'admin'
    return 'candidate'
  }, [userRole])

  const navItems = React.useMemo(() => {
    switch (normalizedRole) {
      case 'company':
        return companyNavItems
      case 'admin':
        return adminNavItems
      default:
        return candidateNavItems
    }
  }, [normalizedRole])

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/50 bg-card/80 backdrop-blur-xl safe-area-bottom">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`)
          const Icon = item.icon
          
          // Special styling for the "Post" button in company nav
          const isPostButton = item.href === '/company/jobs/new'
          
          if (isPostButton) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-1 flex-col items-center justify-center"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-primary shadow-glow text-white transition-all active:scale-95">
                  <Icon className="h-6 w-6" />
                </div>
              </Link>
            )
          }
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-all',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-300',
                  isActive 
                    ? 'bg-primary/10 scale-110' 
                    : 'group-hover:bg-muted group-active:scale-95'
                )}
              >
                <Icon className={cn('h-5 w-5 transition-transform', isActive && 'scale-110')} />
              </div>
              <span className={cn(
                'text-[10px] font-medium transition-colors',
                isActive && 'text-primary'
              )}>
                {locale === 'fr' ? item.label : item.labelEn}
              </span>
              {isActive && (
                <div className="absolute bottom-1 h-1 w-1 rounded-full bg-primary animate-in zoom-in-50" />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
