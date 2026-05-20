'use client'

import * as React from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { Avatar } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/client'
import { 
  User, 
  Settings, 
  HelpCircle, 
  Info, 
  ChevronRight,
  Bell,
  LogOut,
  Edit2,
  Calendar
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

const weekDays = [
  { id: 'mon', label: 'Lu', labelEn: 'Mo' },
  { id: 'tue', label: 'Ma', labelEn: 'Tu' },
  { id: 'wed', label: 'Me', labelEn: 'We' },
  { id: 'thu', label: 'Je', labelEn: 'Th' },
  { id: 'fri', label: 'Ve', labelEn: 'Fr' },
  { id: 'sat', label: 'Sa', labelEn: 'Sa' },
  { id: 'sun', label: 'Di', labelEn: 'Su' },
]

export default function ProfilePage() {
  const router = useRouter()
  const { locale, setLocale } = useTranslation()
  const [user, setUser] = React.useState<any>(null)
  const [availability, setAvailability] = React.useState<string[]>([])

  React.useEffect(() => {
    const fetchUser = async () => {
      const supabase = createClient()
      const { data: { user: authUser } } = await supabase.auth.getUser()
      
      if (authUser) {
        const { data: userData } = await supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .single()
        
        setUser({ ...authUser, ...userData })
      }
    }
    
    fetchUser()
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  const menuSections = [
    {
      title: locale === 'fr' ? 'MON COMPTE' : 'MY ACCOUNT',
      items: [
        {
          icon: User,
          label: locale === 'fr' ? 'Donnees personnelles' : 'Personal data',
          href: '/profile/edit',
          badge: null,
        },
        {
          icon: Bell,
          label: locale === 'fr' ? 'Notifications' : 'Notifications',
          href: '/profile/notifications',
          badge: '3',
        },
        {
          icon: Settings,
          label: locale === 'fr' ? 'Parametres' : 'Settings',
          href: '/profile/settings',
          badge: null,
        },
      ],
    },
    {
      title: 'SUPPORT',
      items: [
        {
          icon: HelpCircle,
          label: locale === 'fr' ? 'Aide & Support' : 'Help & Support',
          href: '/support',
          badge: null,
        },
        {
          icon: Info,
          label: locale === 'fr' ? 'A propos d\'EasyJob' : 'About EasyJob',
          href: '/about',
          badge: null,
        },
      ],
    },
  ]

  return (
    <AppShell>
      <div className="px-4 py-6">
        <h1 className="text-2xl font-bold text-primary mb-6">
          {locale === 'fr' ? 'Profil' : 'Profile'}
        </h1>

        {/* User info card */}
        <Card className="mb-6 overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Avatar
                src={user?.avatar_url}
                fallback={user?.email || 'U'}
                size="xl"
              />
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-foreground truncate">
                  {user?.user_metadata?.first_name 
                    ? `${user.user_metadata.first_name} ${user.user_metadata.last_name || ''}`
                    : user?.email?.split('@')[0] || (locale === 'fr' ? 'Utilisateur' : 'User')}
                </h2>
                <p className="text-sm text-muted-foreground truncate">
                  {user?.email || user?.phone}
                </p>
              </div>
              <Link 
                href="/profile/edit"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted hover:bg-muted/80 transition-colors"
              >
                <Edit2 className="h-4 w-4 text-muted-foreground" />
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Availability section */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-wider">
              {locale === 'fr' ? 'MA DISPONIBILITE' : 'MY AVAILABILITY'}
            </h3>
            <Link 
              href="/profile/availability"
              className="text-xs font-medium text-foreground hover:underline"
            >
              {locale === 'fr' ? 'Modifier' : 'Edit'}
            </Link>
          </div>
          
          <div className="flex gap-2">
            {weekDays.map((day) => (
              <button
                key={day.id}
                onClick={() => {
                  setAvailability(prev => 
                    prev.includes(day.id)
                      ? prev.filter(d => d !== day.id)
                      : [...prev, day.id]
                  )
                }}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1 rounded-2xl py-3 transition-all',
                  availability.includes(day.id)
                    ? 'bg-primary/10 border-2 border-primary'
                    : 'bg-muted/50 border-2 border-transparent'
                )}
              >
                <span className="text-xs font-medium text-muted-foreground">
                  {locale === 'fr' ? day.label : day.labelEn}
                </span>
                <div className={cn(
                  'h-8 w-2 rounded-full transition-colors',
                  availability.includes(day.id)
                    ? 'bg-primary'
                    : 'bg-muted'
                )} />
              </button>
            ))}
          </div>
        </div>

        {/* Menu sections */}
        {menuSections.map((section) => (
          <div key={section.title} className="mb-6">
            <h3 className="text-xs font-semibold text-primary uppercase tracking-wider mb-3">
              {section.title}
            </h3>
            <Card>
              <CardContent className="p-0 divide-y divide-border">
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <item.icon className="h-5 w-5 text-muted-foreground" />
                    <span className="flex-1 text-foreground">{item.label}</span>
                    {item.badge && (
                      <Badge variant="destructive" className="rounded-full h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                        {item.badge}
                      </Badge>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>
        ))}

        {/* Language toggle */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-foreground">
                {locale === 'fr' ? 'Langue' : 'Language'}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setLocale('fr')}
                  className={cn(
                    'px-3 py-1 rounded-full text-sm font-medium transition-all',
                    locale === 'fr'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  FR
                </button>
                <button
                  onClick={() => setLocale('en')}
                  className={cn(
                    'px-3 py-1 rounded-full text-sm font-medium transition-all',
                    locale === 'en'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  EN
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Logout button */}
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-destructive/10 py-3 text-destructive font-medium hover:bg-destructive/20 transition-colors"
        >
          <LogOut className="h-5 w-5" />
          {locale === 'fr' ? 'Deconnexion' : 'Logout'}
        </button>

        {/* Version */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          EasyJob CM v1.0.0
        </p>
      </div>
    </AppShell>
  )
}
