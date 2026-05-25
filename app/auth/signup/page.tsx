'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Header } from '@/components/layout/header'
import { useTranslation } from '@/lib/i18n'
import { LoadingSpinner } from '@/components/ui/loading'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Briefcase, Building2, ChevronRight, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

type UserRole = 'candidate' | 'company'

export default function SignupPage() {
  const router = useRouter()
  const { t, locale } = useTranslation()
  const [step, setStep] = React.useState<'role' | 'phone' | 'otp' | 'password'>('role')
  const [role, setRole] = React.useState<UserRole>('candidate')
  const [phone, setPhone] = React.useState('')
  const [otp, setOtp] = React.useState(['', '', '', '', '', ''])
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  
  const otpRefs = React.useRef<(HTMLInputElement | null)[]>([])

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

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) value = value.slice(-1)
    if (!/^\d*$/.test(value)) return

    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus()
    }
  }

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  const handleSendOtp = async () => {
    if (phone.length !== 9) {
      setError(locale === 'fr' ? 'Numero de telephone invalide' : 'Invalid phone number')
      return
    }
    
    setLoading(true)
    setError('')
    
    try {
      // TODO: Integrate Twilio OTP
      // For now, simulate OTP sending
      await new Promise(resolve => setTimeout(resolve, 1000))
      setStep('otp')
    } catch {
      setError(locale === 'fr' ? 'Erreur lors de l\'envoi du code' : 'Error sending code')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async () => {
    const otpCode = otp.join('')
    if (otpCode.length !== 6) {
      setError(locale === 'fr' ? 'Code incomplet' : 'Incomplete code')
      return
    }

    setLoading(true)
    setError('')

    try {
      // TODO: Verify OTP with Twilio
      // For now, accept any 6-digit code
      await new Promise(resolve => setTimeout(resolve, 1000))
      setStep('password')
    } catch {
      setError(locale === 'fr' ? 'Code invalide' : 'Invalid code')
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async () => {
    if (password.length < 8) {
      setError(locale === 'fr' ? 'Le mot de passe doit contenir au moins 8 caracteres' : 'Password must be at least 8 characters')
      return
    }

    setLoading(true)
    setError('')

    try {
      const supabase = createClient()
      const fullPhone = `+237${phone}`
      
      const { data, error: signupError } = await supabase.auth.signUp({
        email: email || `${phone}@easyjob.cm`,
        password,
        options: {
          emailRedirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? 
            `${window.location.origin}/auth/callback`,
          data: {
            role,
            phone: fullPhone,
            locale,
          },
        },
      })

      if (signupError) throw signupError

      if (data.user) {
        router.push('/onboarding')
      }
    } catch (err: any) {
      setError(err.message || (locale === 'fr' ? 'Erreur lors de l\'inscription' : 'Signup error'))
    } finally {
      setLoading(false)
    }
  }

  const roleOptions = [
    {
      value: 'candidate' as const,
      icon: Briefcase,
      title: locale === 'fr' ? 'Je cherche des missions' : 'I\'m looking for jobs',
      description: locale === 'fr' 
        ? 'Trouvez des opportunites flexibles pres de chez vous'
        : 'Find flexible opportunities near you',
    },
    {
      value: 'company' as const,
      icon: Building2,
      title: locale === 'fr' ? 'Je recrute' : 'I\'m hiring',
      description: locale === 'fr'
        ? 'Publiez des offres et trouvez des travailleurs qualifies'
        : 'Post jobs and find qualified workers',
    },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header 
        title={t('auth.createAccount')} 
        showBack 
        onBack={() => {
          if (step === 'role') router.push('/')
          else if (step === 'phone') setStep('role')
          else if (step === 'otp') setStep('phone')
          else if (step === 'password') setStep('otp')
        }}
      />

      {/* Progress indicator */}
      <div className="px-6 pt-4">
        <div className="flex gap-2">
          {['role', 'phone', 'otp', 'password'].map((s, i) => (
            <div
              key={s}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                ['role', 'phone', 'otp', 'password'].indexOf(step) >= i
                  ? 'bg-primary'
                  : 'bg-muted'
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col px-6 py-8">
        {/* Step: Role Selection */}
        {step === 'role' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-foreground">
                {locale === 'fr' ? 'Qui etes-vous ?' : 'Who are you?'}
              </h2>
              <p className="text-muted-foreground mt-1">
                {locale === 'fr' 
                  ? 'Selectionnez votre profil pour commencer'
                  : 'Select your profile to get started'}
              </p>
            </div>

            <div className="space-y-3">
              {roleOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setRole(option.value)}
                  className={cn(
                    'w-full flex items-start gap-4 rounded-2xl border-2 p-4 text-left transition-all',
                    role === option.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  )}
                >
                  <div className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
                    role === option.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}>
                    <option.icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground">{option.title}</h3>
                    <p className="text-sm text-muted-foreground">{option.description}</p>
                  </div>
                  {role === option.value && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-4 w-4" />
                    </div>
                  )}
                </button>
              ))}
            </div>

            <Button
              onClick={() => setStep('phone')}
              className="w-full"
              size="lg"
            >
              {t('common.continue')}
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Step: Phone Number */}
        {step === 'phone' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-foreground">
                {locale === 'fr' ? 'Votre numero de telephone' : 'Your phone number'}
              </h2>
              <p className="text-muted-foreground mt-1">
                {locale === 'fr'
                  ? 'Nous vous enverrons un code de verification'
                  : 'We\'ll send you a verification code'}
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="flex h-12 items-center justify-center rounded-xl bg-muted px-3 text-sm font-medium">
                  +237
                </div>
                <Input
                  type="tel"
                  placeholder="6XX XXX XXX"
                  value={formatPhone(phone)}
                  onChange={handlePhoneChange}
                  className="flex-1 text-lg"
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <Button
                onClick={handleSendOtp}
                disabled={phone.length !== 9 || loading}
                className="w-full"
                size="lg"
              >
                {loading ? <LoadingSpinner size="sm" /> : t('auth.sendCode')}
              </Button>
            </div>
          </div>
        )}

        {/* Step: OTP Verification */}
        {step === 'otp' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-foreground">
                {locale === 'fr' ? 'Verifiez votre numero' : 'Verify your number'}
              </h2>
              <p className="text-muted-foreground mt-1">
                {locale === 'fr'
                  ? `Entrez le code envoye au +237 ${formatPhone(phone)}`
                  : `Enter the code sent to +237 ${formatPhone(phone)}`}
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-center gap-2">
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => { otpRefs.current[index] = el }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    className={cn(
                      'h-14 w-12 rounded-xl border-2 text-center text-2xl font-bold transition-all',
                      'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
                      digit ? 'border-primary bg-primary/5' : 'border-border bg-background'
                    )}
                  />
                ))}
              </div>

              {error && (
                <p className="text-center text-sm text-destructive">{error}</p>
              )}

              <Button
                onClick={handleVerifyOtp}
                disabled={otp.join('').length !== 6 || loading}
                className="w-full"
                size="lg"
              >
                {loading ? <LoadingSpinner size="sm" /> : t('auth.verify')}
              </Button>

              <button
                onClick={handleSendOtp}
                disabled={loading}
                className="w-full text-center text-sm text-primary hover:underline"
              >
                {locale === 'fr' ? 'Renvoyer le code' : 'Resend code'}
              </button>
            </div>
          </div>
        )}

        {/* Step: Create Password */}
        {step === 'password' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-foreground">
                {locale === 'fr' ? 'Creez votre mot de passe' : 'Create your password'}
              </h2>
              <p className="text-muted-foreground mt-1">
                {locale === 'fr'
                  ? 'Choisissez un mot de passe securise'
                  : 'Choose a secure password'}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === 'fr' ? 'Email (optionnel)' : 'Email (optional)'}
                </label>
                <Input
                  type="email"
                  placeholder="votre@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {t('auth.password')}
                </label>
                <div className="relative mt-1.5">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {locale === 'fr' ? 'Minimum 8 caracteres' : 'Minimum 8 characters'}
                </p>
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <Button
                onClick={handleSignup}
                disabled={password.length < 8 || loading}
                className="w-full"
                size="lg"
              >
                {loading ? <LoadingSpinner size="sm" /> : t('auth.createAccount')}
              </Button>
            </div>
          </div>
        )}

        {/* Login link */}
        <div className="mt-auto pt-8 text-center">
          <p className="text-sm text-muted-foreground">
            {locale === 'fr' ? 'Deja un compte ?' : 'Already have an account?'}{' '}
            <Link href="/auth/login" className="font-medium text-primary hover:underline">
              {t('auth.login')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
