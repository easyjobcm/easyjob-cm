'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Header } from '@/components/layout/header'
import { useTranslation } from '@/lib/i18n'
import { LoadingSpinner } from '@/components/ui/loading'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Sparkles } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()
  const [phone, setPhone] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  const formatPhone = (value: string) => {
    const cleaned = value.replace(/\D/g, '')
    if (cleaned.length <= 3) return cleaned
    if (cleaned.length <= 6) return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)}`
  }

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 9)
    setPhone(value)
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (phone.length !== 9) {
      setError(locale === 'fr' ? 'Numero de telephone invalide' : 'Invalid phone number')
      return
    }

    if (password.length < 8) {
      setError(locale === 'fr' ? 'Mot de passe invalide' : 'Invalid password')
      return
    }

    setLoading(true)
    setError('')

    try {
      const supabase = createClient()
      
      // Use phone-based email for login
      const email = `${phone}@easyjob.cm`
      
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (loginError) throw loginError

      if (data.user) {
        // Check if user has completed onboarding
        const { data: userData } = await supabase
          .from('users')
          .select('is_verified, role')
          .eq('id', data.user.id)
          .single()

        if (userData?.is_verified) {
          router.push('/jobs')
        } else {
          router.push('/onboarding')
        }
      }
    } catch (err: any) {
      if (err.message?.includes('Invalid login')) {
        setError(locale === 'fr' 
          ? 'Numero ou mot de passe incorrect' 
          : 'Invalid phone number or password')
      } else {
        setError(err.message || (locale === 'fr' ? 'Erreur de connexion' : 'Login error'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header title={t('auth.login')} showBack onBack={() => router.push('/')} />

      {/* Decorative background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-40 -left-20 h-60 w-60 rounded-full bg-accent/20 blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-1 flex-col px-6 py-8">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-primary shadow-glow mb-3">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            {locale === 'fr' ? 'Bon retour !' : 'Welcome back!'}
          </h1>
          <p className="text-muted-foreground text-sm">
            {locale === 'fr' 
              ? 'Connectez-vous pour continuer' 
              : 'Sign in to continue'}
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="text-sm font-medium text-foreground">
              {t('auth.phone')}
            </label>
            <div className="flex gap-3 mt-1.5">
              <div className="flex h-12 items-center justify-center rounded-xl bg-muted px-3 text-sm font-medium">
                +237
              </div>
              <Input
                type="tel"
                placeholder="6XX XXX XXX"
                value={formatPhone(phone)}
                onChange={handlePhoneChange}
                className="flex-1 text-lg"
                required
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">
                {t('auth.password')}
              </label>
              <Link 
                href="/auth/forgot-password" 
                className="text-xs text-primary hover:underline"
              >
                {t('auth.forgotPassword')}
              </Link>
            </div>
            <div className="relative mt-1.5">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <Button
            type="submit"
            disabled={loading || phone.length !== 9 || password.length < 8}
            className="w-full"
            size="lg"
          >
            {loading ? <LoadingSpinner size="sm" /> : t('auth.login')}
          </Button>
        </form>

        {/* Signup link */}
        <div className="mt-auto pt-8 text-center">
          <p className="text-sm text-muted-foreground">
            {locale === 'fr' ? 'Pas encore de compte ?' : "Don't have an account?"}{' '}
            <Link href="/auth/signup" className="font-medium text-primary hover:underline">
              {t('auth.createAccount')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
