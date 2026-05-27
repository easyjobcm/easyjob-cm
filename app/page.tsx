'use client'

import * as React from 'react'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence, useInView } from 'framer-motion'
import {
  Briefcase,
  Users,
  Shield,
  Star,
  Zap,
  ChevronRight,
  Smartphone,
  Building2,
  BadgeCheck,
  CheckCircle,
  Banknote,
  FileText,
  Globe,
  MapPin,
  ArrowRight,
  Download,
  Menu,
  X as XIcon,
  Moon,
  Sun,
} from 'lucide-react'
import { useTranslation } from '@/lib/i18n'
import { CookieBanner } from '@/components/shared/cookie-banner'
import { Chatbot } from '@/components/chatbot/chatbot'

// ─── PWA install event type ────────────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

// ─── Inline SVG social icons ───────────────────────────────────────────────────

function TwitterXIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}
function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}
function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  )
}
function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  )
}

// ─── Animated background orb ──────────────────────────────────────────────────

function Orb({ size, color, top, bottom, left, right, delay = 0 }: {
  size: number; color: string
  top?: string; bottom?: string; left?: string; right?: string
  delay?: number
}) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{ width: size, height: size, background: color, filter: 'blur(90px)', opacity: 0.22, top, bottom, left, right }}
      animate={{ x: [0, 25, -18, 0], y: [0, -35, 18, 0], scale: [1, 1.08, 0.94, 1] }}
      transition={{ duration: 14 + delay * 2, repeat: Infinity, ease: 'easeInOut', delay }}
    />
  )
}

// ─── 3D animated sandbox sticker ─────────────────────────────────────────────

function SandboxSticker({ icon, color, delay = 0 }: { icon: string; color: string; delay?: number }) {
  return (
    <motion.div
      className="relative w-16 h-16 mx-auto mb-3 flex items-center justify-center"
      animate={{ y: [0, -8, 0], rotateZ: [0, 4, -4, 0] }}
      transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay }}
      style={{ transformStyle: 'preserve-3d' }}
    >
      <div className="absolute inset-0 rounded-2xl blur-xl" style={{ background: color, opacity: 0.55 }} />
      <div
        className="relative w-full h-full rounded-2xl flex items-center justify-center text-3xl"
        style={{
          background: `linear-gradient(145deg, ${color}35, ${color}12)`,
          border: `1.5px solid ${color}55`,
          boxShadow: `0 6px 28px ${color}35, inset 0 1px 0 rgba(255,255,255,0.18)`,
        }}
      >
        {icon}
      </div>
    </motion.div>
  )
}

// ─── 3D tilt card ─────────────────────────────────────────────────────────────

function TiltCard({ children, className = '', cardStyle }: {
  children: React.ReactNode; className?: string; cardStyle?: React.CSSProperties
}) {
  return (
    <motion.div
      whileHover={{ rotateX: 4, rotateY: -4, scale: 1.025, transition: { duration: 0.2 } }}
      whileTap={{ scale: 0.98 }}
      style={{ transformStyle: 'preserve-3d', perspective: 1000, ...cardStyle }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ─── Animation variants ───────────────────────────────────────────────────────

const stagger     = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } }
const staggerFast = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }
const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.25, 0.1, 0.25, 1] as number[] } },
}
const fadeIn = {
  hidden: { opacity: 0, scale: 0.95 },
  show:   { opacity: 1, scale: 1, transition: { duration: 0.26, ease: 'easeOut' } },
}

function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  return (
    <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'show' : 'hidden'} className={className}>
      {children}
    </motion.div>
  )
}

// ─── Config ───────────────────────────────────────────────────────────────────

const sandboxLevels = [
  { color: '#9CA3AF', glow: '#9CA3AF', icon: '🌱' },
  { color: '#3B82F6', glow: '#3B82F6', icon: '⭐' },
  { color: '#7C3AED', glow: '#7C3AED', icon: '🔥' },
  { color: '#D97706', glow: '#D97706', icon: '🏆' },
]

const featureConfig = [
  { key: 'f1', Icon: Banknote,  color: '#7C3AED', glow: 'rgba(124,58,237,0.22)' },
  { key: 'f2', Icon: FileText,  color: '#06B6D4', glow: 'rgba(6,182,212,0.18)'  },
  { key: 'f3', Icon: Shield,    color: '#059669', glow: 'rgba(5,150,105,0.18)'  },
  { key: 'f4', Icon: Zap,       color: '#F59E0B', glow: 'rgba(245,158,11,0.18)' },
]

interface FooterLink { label: string; href?: string; onClick?: () => void }

function resetCookies() {
  try { localStorage.removeItem('ej_cookie_consent') } catch { /* ignore */ }
  document.cookie = 'ej_consent=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  window.location.reload()
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WelcomePage() {
  const router = useRouter()
  const { t, locale, setLocale } = useTranslation()
  const [activeTab,       setActiveTab]       = useState<'candidate' | 'company'>('candidate')
  const [scrolled,        setScrolled]        = useState(false)
  const [mobileMenuOpen,  setMobileMenuOpen]  = useState(false)
  const [installPrompt,   setInstallPrompt]   = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled,     setIsInstalled]     = useState(() => typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches)
  const [showInstallGuide,setShowInstallGuide]= useState(false)
  const [isDark,           setIsDark]          = useState(false)

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', h, { passive: true })
    return () => window.removeEventListener('scroll', h)
  }, [])

  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstallPrompt(e as BeforeInstallPromptEvent) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])


  async function handleInstall() {
    if (installPrompt) {
      await installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      if (outcome === 'accepted') { setInstallPrompt(null); setIsInstalled(true) }
    } else {
      setShowInstallGuide(true)
    }
  }

  const candidateSteps = [
    { step: t('home.how.step1'), title: t('home.how.cStep1Title'), desc: t('home.how.cStep1Desc'), icon: BadgeCheck },
    { step: t('home.how.step2'), title: t('home.how.cStep2Title'), desc: t('home.how.cStep2Desc'), icon: Briefcase  },
    { step: t('home.how.step3'), title: t('home.how.cStep3Title'), desc: t('home.how.cStep3Desc'), icon: Banknote   },
  ]
  const companySteps = [
    { step: t('home.how.step1'), title: t('home.how.eStep1Title'), desc: t('home.how.eStep1Desc'), icon: Zap          },
    { step: t('home.how.step2'), title: t('home.how.eStep2Title'), desc: t('home.how.eStep2Desc'), icon: Users         },
    { step: t('home.how.step3'), title: t('home.how.eStep3Title'), desc: t('home.how.eStep3Desc'), icon: CheckCircle   },
  ]
  const activeSteps   = activeTab === 'candidate' ? candidateSteps : companySteps
  const sandboxNames  = [t('home.sandbox.l0Name'), t('home.sandbox.l1Name'), t('home.sandbox.l2Name'), t('home.sandbox.l3Name')]
  const sandboxDescs  = [t('home.sandbox.l0Desc'), t('home.sandbox.l1Desc'), t('home.sandbox.l2Desc'), t('home.sandbox.l3Desc')]

  const fr = locale === 'fr'
  const navLinks = [
    { label: t('landing.nav.features'),    href: '#features' },
    { label: t('landing.nav.howItWorks'),  href: '#how'      },
    { label: t('landing.nav.about'),       href: '/about'    },
  ]



  const footerCols: { title: string; links: FooterLink[] }[] = [
    {
      title: t('landing.footer.product'),
      links: [
        { label: t('landing.nav.howItWorks'), href: '#how'      },
        { label: t('landing.nav.features'),   href: '#features' },
        { label: t('landing.nav.sandbox'),    href: '#sandbox'  },
        { label: t('landing.footer.pricing'), href: '/pricing'  },
      ],
    },
    {
      title: t('landing.footer.company'),
      links: [
        { label: t('landing.footer.about'),   href: '/about'   },
        { label: t('landing.footer.blog'),    href: '/blog'    },
        { label: t('landing.footer.press'),   href: '/press'   },
        { label: t('landing.footer.contact'), href: '/contact' },
      ],
    },
    {
      title: t('landing.footer.support'),
      links: [
        { label: t('landing.footer.faq'),        href: '/faq'    },
        { label: t('landing.footer.helpCenter'), href: '/help'   },
        { label: t('landing.footer.reportBug'),  href: '/report' },
        { label: t('landing.footer.status'),     href: '/status' },
      ],
    },
    {
      title: t('landing.footer.legal'),
      links: [
        { label: t('auth.terms'),             href: '/legal/terms'  },
        { label: t('auth.privacy'),           href: '/legal/privacy' },
        { label: t('landing.footer.cookies'), onClick: resetCookies  },
        { label: t('landing.footer.gdpr'),    href: '/legal/gdpr'   },
      ],
    },
  ]

  // ── Gradient text helpers (inline style) ─────────────────────────────────────
  const gradTitleLight: React.CSSProperties = {
    backgroundImage: 'linear-gradient(135deg, #1E1B4B 0%, #5B21B6 55%, #7C3AED 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  }
  const gradTitle: React.CSSProperties = {
    backgroundImage: 'linear-gradient(135deg, #fff 0%, #DDD6FE 45%, #A78BFA 80%, #7C3AED 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  }

  return (
    <div className={`flex min-h-screen flex-col ${isDark ? 'bg-[#0D0618]' : 'bg-white'} overflow-x-hidden transition-colors duration-300`}>
      <Chatbot darkMode={isDark} />
      <CookieBanner />

      {/* ═══════════════════════════════ HEADER ════════════════════════════════ */}
      <header
        className={`fixed top-0 left-0 right-0 z-30 transition-all duration-300 ${
          scrolled
            ? (isDark
              ? 'bg-[#0D0618]/95 backdrop-blur-xl border-b border-[#7C3AED]/20 shadow-[0_2px_24px_rgba(124,58,237,0.2)]'
              : 'bg-white/95 backdrop-blur-xl border-b border-[#E5E7EB] shadow-[0_2px_16px_rgba(0,0,0,0.06)]')
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <motion.div
              whileHover={{ scale: 1.05, rotate: -3 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
              className="relative w-10 h-10"
            >
              {/* Violet halo */}
              <div className="absolute inset-0 rounded-xl bg-[#7C3AED] blur-md opacity-50 group-hover:opacity-80 transition-opacity" />
              {/* PWA maskable icon tile */}
              <div
                className="relative w-full h-full rounded-xl overflow-hidden"
                style={{
                  boxShadow:
                    '0 4px 16px rgba(124,58,237,0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
                }}
              >
                <Image
                  src="/icons/manifest-icon-192.maskable.png"
                  alt="EasyJob CM"
                  fill
                  sizes="40px"
                  className="object-cover"
                  priority
                />
              </div>
            </motion.div>
            <span className="font-bold text-[16px]" style={scrolled && !isDark
              ? { color: '#7C3AED' }
              : { backgroundImage: 'linear-gradient(135deg,#fff,#A78BFA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }
            }>
              EasyJob CM
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-7">
            {navLinks.map(l => (
              <Link key={l.href} href={l.href} className={`text-[13px] font-medium transition-colors ${scrolled && !isDark ? 'text-[#6B7280] hover:text-[#111827]' : 'text-white/50 hover:text-white'}`}>
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <motion.button whileTap={{ scale: 0.96 }}
              onClick={() => setLocale(fr ? 'en' : 'fr')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] font-semibold transition-colors ${scrolled && !isDark ? 'border-[#E5E7EB] text-[#6B7280] hover:border-[#7C3AED] hover:text-[#7C3AED]' : 'border-white/10 text-white/50 hover:border-[#7C3AED]/40 hover:text-white/80'}`}
            >
              <Globe className="w-3 h-3" />{locale.toUpperCase()}
            </motion.button>

            <motion.button whileTap={{ scale: 0.95 }}
              onClick={() => setIsDark(!isDark)}
              className={`flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${scrolled && !isDark ? 'border-[#E5E7EB] text-[#6B7280] hover:border-[#7C3AED] hover:text-[#7C3AED]' : 'border-white/10 text-white/60 hover:border-white/30 hover:text-white'}`}
              title={isDark ? t('landing.theme.lightMode') : t('landing.theme.darkMode')}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </motion.button>

            <motion.button whileTap={{ scale: 0.97 }}
              onClick={() => router.push('/auth/login')}
              className={`hidden sm:flex h-9 px-4 rounded-full border text-[13px] font-semibold transition-colors pt-2 ${scrolled && !isDark ? 'border-[#DDD6FE] text-[#7C3AED] hover:bg-[#EDE9FE]' : 'border-white/12 text-white/70 hover:border-[#7C3AED]/40 hover:text-white'}`}
            >
              {t('auth.signIn')}
            </motion.button>

            <motion.button whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.02 }}
              onClick={() => router.push('/auth/signup')}
              className="h-9 px-4 rounded-full text-[13px] font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', boxShadow: '0 0 20px rgba(124,58,237,0.5),0 4px 12px rgba(124,58,237,0.3)' }}
            >
              {t('auth.signUp')}
            </motion.button>

            <motion.button whileTap={{ scale: 0.95 }}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={`lg:hidden w-9 h-9 flex items-center justify-center rounded-full border transition-colors ${scrolled && !isDark ? 'border-[#E5E7EB] text-[#6B7280]' : 'border-white/10 text-white/60'}`}
            >
              {mobileMenuOpen ? <XIcon className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </motion.button>
          </div>
        </div>

        {/* Mobile drawer */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="lg:hidden border-t border-[#E5E7EB] bg-white backdrop-blur-xl"
            >
              <div className="px-4 py-4 space-y-1">
                {navLinks.map(l => (
                  <Link key={l.href} href={l.href} onClick={() => setMobileMenuOpen(false)}
                    className="block py-3 text-[14px] font-medium text-[#6B7280] hover:text-[#111827] border-b border-[#F3F4F6] last:border-0 transition-colors"
                  >
                    {l.label}
                  </Link>
                ))}
                <div className="pt-3 space-y-2">
                  <button onClick={() => { router.push('/auth/login'); setMobileMenuOpen(false) }}
                    className="w-full h-11 rounded-full border border-[#DDD6FE] text-[#7C3AED] text-[14px] font-semibold hover:bg-[#EDE9FE] transition-colors"
                  >{t('auth.signIn')}</button>
                  <button onClick={() => { router.push('/auth/signup'); setMobileMenuOpen(false) }}
                    className="w-full h-11 rounded-full text-white text-[14px] font-bold"
                    style={{ background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', boxShadow: '0 0 20px rgba(124,58,237,0.4)' }}
                  >{t('auth.signUp')}</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ═══════════════════════════════ HERO ══════════════════════════════════ */}
      <section className="relative overflow-hidden pt-16 min-h-screen flex flex-col justify-center bg-[#0D0618]">
        <Orb size={520} color="#7C3AED" top="-120px" right="-120px" delay={0} />
        <Orb size={380} color="#4C1D95" bottom="-60px" left="-80px" delay={2} />
        <Orb size={280} color="#1D4ED8" top="40%" left="15%" delay={4} />
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

        <div className="relative max-w-6xl mx-auto px-4 py-24 w-full lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center">
          {/* Left */}
          <motion.div initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }} className="mb-14 lg:mb-0">
            {/* Badge */}
            <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6 border text-[11px] font-bold uppercase tracking-widest text-[#A78BFA]"
              style={{ background: 'rgba(124,58,237,0.12)', borderColor: 'rgba(124,58,237,0.35)', backdropFilter: 'blur(8px)' }}
            >
              <motion.span className="w-1.5 h-1.5 rounded-full bg-[#A78BFA]" animate={{ scale: [1, 1.5, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
              <MapPin className="w-3 h-3" />
              {t('home.badge')}
            </motion.div>

            {/* Headline */}
            <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22, duration: 0.5 }}
              className="text-[34px] sm:text-[44px] lg:text-[52px] font-extrabold leading-[1.1] mb-5"
              style={gradTitle}
            >
              {t('home.hero.title')}
            </motion.h1>

            <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32, duration: 0.4 }}
              className="text-[15px] sm:text-[17px] text-white/50 leading-relaxed mb-8 max-w-md"
            >
              {t('home.hero.subtitle')}
            </motion.p>

            {/* CTAs */}
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.42 }} className="flex flex-col sm:flex-row gap-3 mb-8">
              <motion.button whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.02 }}
                onClick={() => router.push('/auth/signup?role=candidate')}
                className="h-14 px-7 rounded-full text-[15px] font-bold text-white flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', boxShadow: '0 0 32px rgba(124,58,237,0.55),0 8px 24px rgba(124,58,237,0.3)' }}
              >
                <Smartphone className="w-5 h-5" />{t('home.hero.ctaCandidate')}<ChevronRight className="w-4 h-4" />
              </motion.button>

              <motion.button whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.02 }}
                onClick={() => router.push('/auth/signup?role=company')}
                className="h-14 px-7 rounded-full text-[15px] font-bold text-white/80 flex items-center justify-center gap-2 border border-white/12"
                style={{ backdropFilter: 'blur(8px)', background: 'rgba(255,255,255,0.04)' }}
              >
                <Building2 className="w-5 h-5" />{t('home.hero.ctaCompany')}
              </motion.button>
            </motion.div>

            {/* Trust */}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="flex flex-wrap gap-4">
              {[
                t('landing.trust.signup'),
                t('landing.trust.momo'),
                t('landing.trust.contract'),
              ].map(label => (
                <span key={label} className="flex items-center gap-1.5 text-[12px] text-white/35">
                  <span className="text-[#7C3AED] font-bold">✓</span>{label}
                </span>
              ))}
            </motion.div>
          </motion.div>

          {/* Right: phone mockup */}
          <motion.div initial={{ opacity: 0, x: 40, scale: 0.92 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ delay: 0.28, duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
            className="relative flex items-center justify-center lg:justify-end"
          >
            {/* Ambient glow */}
            <div className="absolute w-72 h-72 rounded-full opacity-25" style={{ background: 'radial-gradient(circle, #7C3AED 0%, transparent 70%)' }} />

            <div className="relative w-63.75 sm:w-71.25">
              {/* Phone shell */}
              <div className="relative rounded-[36px] p-3.5 border" style={{ background: 'linear-gradient(145deg,#1A0A2E,#0D0618)', borderColor: 'rgba(124,58,237,0.28)', boxShadow: '0 32px 80px rgba(0,0,0,0.65),0 0 0 1px rgba(124,58,237,0.12),inset 0 1px 0 rgba(255,255,255,0.04)' }}>
                <div className="rounded-[26px] overflow-hidden">
                  {/* App header */}
                  <div style={{ background: 'linear-gradient(135deg,#7C3AED,#5B21B6)' }} className="px-4 pt-3 pb-5">
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 relative"><Image src="/icons/manifest-icon-192.maskable.png" alt="" fill className="object-contain" /></div>
                        <span className="text-white text-[13px] font-bold">EasyJob CM</span>
                      </div>
                      <div className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center"><div className="w-3 h-3 rounded-full bg-white/70" /></div>
                    </div>
                    <p className="text-white/55 text-[10px]">{t('landing.mockup.jobsNear')}</p>
                    <p className="text-white text-[13px] font-bold mt-0.5">{t('landing.mockup.doualaCount')}</p>
                  </div>

                  {/* Cards list */}
                  <div className="px-3 py-3 space-y-2 bg-[#F5F3FF]">
                    {[
                      { role: 'Caissier·ère', pay: '5 000', cat: 'Commerce',     rating: '4.8', urgent: true  },
                      { role: "Agent d'accueil", pay: '4 500', cat: 'Événementiel', rating: '4.6', urgent: false },
                    ].map((job, i) => (
                      <div key={i} className="bg-white rounded-[14px] p-3 shadow-sm">
                        <div className="flex items-start justify-between mb-1.5">
                          <div>
                            <p className="text-[11px] font-bold text-[#111827]">{job.role}</p>
                            <p className="text-[9px] text-[#6B7280]">{job.cat}</p>
                          </div>
                          {job.urgent && <span className="text-[8px] font-bold text-[#7C3AED] bg-[#EDE9FE] px-1.5 py-0.5 rounded-full">URGENT</span>}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-[#7C3AED]">{job.pay} FCFA/j</span>
                          <div className="flex items-center gap-0.5">
                            <Star className="w-2.5 h-2.5 text-[#D97706] fill-[#D97706]" />
                            <span className="text-[9px] font-semibold text-[#374151]">{job.rating}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="rounded-xl py-2.5 text-center" style={{ background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', boxShadow: '0 4px 12px rgba(124,58,237,0.35)' }}>
                      <span className="text-white text-[11px] font-bold">✓ {t('landing.mockup.applyOneClick')}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Badge: payment received */}
              <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute -top-5 -right-6 rounded-2xl px-3 py-2.5 border"
                style={{ background: 'rgba(13,6,24,0.88)', backdropFilter: 'blur(12px)', borderColor: 'rgba(52,211,153,0.35)', boxShadow: '0 4px 20px rgba(52,211,153,0.18),inset 0 1px 0 rgba(255,255,255,0.04)' }}
              >
                <p className="text-[9px] text-white/45 mb-0.5">{t('landing.mockup.paymentReceived')} 🎉</p>
                <p className="text-[15px] font-bold text-[#34D399]">+5 000 FCFA</p>
              </motion.div>

              {/* Badge: rating */}
              <motion.div animate={{ y: [0, 7, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
                className="absolute -bottom-5 -left-6 rounded-2xl px-3 py-2.5 border"
                style={{ background: 'rgba(13,6,24,0.88)', backdropFilter: 'blur(12px)', borderColor: 'rgba(124,58,237,0.38)', boxShadow: '0 4px 20px rgba(124,58,237,0.2),inset 0 1px 0 rgba(255,255,255,0.04)' }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#7C3AED]/20 flex items-center justify-center">
                    <BadgeCheck className="w-3.5 h-3.5 text-[#A78BFA]" />
                  </div>
                  <div>
                    <p className="text-[9px] text-white/45">{t('landing.mockup.missionConfirmed')}</p>
                    <div className="flex gap-0.5 mt-0.5">{[1,2,3,4,5].map(s => <Star key={s} className="w-2 h-2 text-[#D97706] fill-[#D97706]" />)}</div>
                  </div>
                </div>
              </motion.div>

              {/* Badge: sandbox expert */}
              <motion.div animate={{ x: [0, 5, 0], y: [0, -4, 0] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
                className="absolute top-1/2 -right-16 hidden sm:flex items-center gap-2 rounded-[14px] px-3 py-2 border"
                style={{ background: 'rgba(13,6,24,0.88)', backdropFilter: 'blur(12px)', borderColor: 'rgba(217,119,6,0.35)', boxShadow: '0 4px 16px rgba(217,119,6,0.15)' }}
              >
                <span className="text-xl">🏆</span>
                <div><p className="text-[9px] text-[#D97706] font-bold">{t('landing.mockup.expert')}</p><p className="text-[8px] text-white/35">4.9 ★</p></div>
              </motion.div>
            </div>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1"
        >
          <motion.div animate={{ y: [0, 7, 0] }} transition={{ duration: 1.6, repeat: Infinity }}
            className="w-5 h-8 rounded-full border border-white/15 flex items-start justify-center pt-1.5"
          >
            <div className="w-1 h-2 bg-white/35 rounded-full" />
          </motion.div>
        </motion.div>
      </section>

      {/* ═══════════════════════════════ STATS ═════════════════════════════════ */}
      <section className={`relative ${isDark ? 'bg-[#0F0A1E] border-[#7C3AED]/10' : 'bg-[#F5F3FF] border-[#DDD6FE]'} border-y overflow-hidden transition-colors duration-300`}>
        <Section>
          <div className="max-w-4xl mx-auto px-4 py-12 grid grid-cols-2 sm:grid-cols-4 gap-8 text-center relative">
            {[
              { value: '1 500+', label: t('home.stats.missions'),   icon: Briefcase,  color: '#7C3AED' },
              { value: '200+',   label: t('home.stats.companies'),  icon: Building2,  color: '#3B82F6' },
              { value: '5 000+', label: t('home.stats.candidates'), icon: Users,      color: '#059669' },
              { value: '2',      label: t('home.stats.cities'),     icon: MapPin,     color: '#D97706' },
            ].map(({ value, label, icon: Icon, color }) => (
              <motion.div key={label} variants={fadeUp} className="flex flex-col items-center gap-1.5">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-1"
                  style={{ background: `${color}18`, border: `1px solid ${color}28`, boxShadow: `0 4px 16px ${color}18` }}
                >
                  <Icon className="w-5 h-5" style={{ color }} />
                </div>
                <span className="text-[30px] font-extrabold" style={isDark ? { background: `linear-gradient(135deg,#fff,${color})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' } : { color }}>{value}</span>
                <span className={`text-[12px] font-medium ${isDark ? 'text-white/50' : 'text-[#6B7280]'}`}>{label}</span>
              </motion.div>
            ))}
          </div>
        </Section>
      </section>

      {/* ═══════════════════════════════ HOW IT WORKS ══════════════════════════ */}
      <section id="how" className={`relative py-24 px-4 ${isDark ? 'bg-[#0D0618]' : 'bg-white'} overflow-hidden transition-colors duration-300`}>
        <Section className="max-w-4xl mx-auto">
          <motion.div variants={fadeUp} className="text-center mb-10">
            <span className="text-[11px] font-bold uppercase tracking-[2px] text-[#7C3AED] block mb-3">{t('home.how.title')}</span>
            <h2 className="text-[28px] sm:text-[38px] font-extrabold" style={isDark ? gradTitle : gradTitleLight}>
              {t('landing.simpleFastSecure')}
            </h2>
          </motion.div>

          {/* Tab pill */}
          <motion.div variants={fadeUp} className="flex justify-center mb-10">
            <div className={`relative inline-flex rounded-full p-1 ${isDark ? 'bg-[#1A0A2E]' : 'bg-[#F3F4F6]'}`}>
              {(['candidate', 'company'] as const).map(tab => (
                <motion.button key={tab} whileTap={{ scale: 0.97 }} onClick={() => setActiveTab(tab)}
                  className="relative px-6 py-2.5 rounded-full text-[13px] font-semibold z-10 transition-colors"
                  style={{ color: activeTab === tab ? '#fff' : (isDark ? 'rgba(255,255,255,0.45)' : '#6B7280') }}
                >
                  {activeTab === tab && (
                    <motion.div layoutId="tab-active" className="absolute inset-0 rounded-full"
                      style={{ background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', boxShadow: '0 0 20px rgba(124,58,237,0.4)' }}
                      transition={{ type: 'spring', damping: 24, stiffness: 300 }}
                    />
                  )}
                  <span className="relative z-10">{tab === 'candidate' ? t('home.how.candidate') : t('home.how.company')}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>

          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.22 }}
              className="grid grid-cols-1 sm:grid-cols-3 gap-4"
            >
              {activeSteps.map(({ step, title, desc, icon: Icon }, i) => (
                <TiltCard key={i} className="rounded-3xl p-5 relative"
                  cardStyle={isDark ? { background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.2)', boxShadow: '0 8px 32px rgba(124,58,237,0.1)' } : { background: '#fff', border: '1px solid #E5E7EB', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}
                >
                  {i < 2 && <div className="hidden sm:block absolute top-9 right-0 w-4 h-px bg-[#DDD6FE] translate-x-full" />}
                  <div className="w-11 h-11 rounded-[14px] flex items-center justify-center mb-4"
                    style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}
                  >
                    <Icon className="w-5 h-5 text-[#7C3AED]" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#7C3AED] block mb-1.5">{step}</span>
                  <h3 className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-[#111827]'} mb-2`}>{title}</h3>
                  <p className={`text-[13px] ${isDark ? 'text-white/45' : 'text-[#6B7280]'} leading-relaxed`}>{desc}</p>
                </TiltCard>
              ))}
            </motion.div>
          </AnimatePresence>
        </Section>
      </section>

      {/* ═══════════════════════════════ FEATURES ══════════════════════════════ */}
      <section id="features" className={`relative py-24 px-4 ${isDark ? 'bg-[#0F0A1E]' : 'bg-[#FAFAFA]'} overflow-hidden transition-colors duration-300`}>
        <Section className="max-w-4xl mx-auto">
          <motion.div variants={fadeUp} className="text-center mb-12">
            <span className="text-[11px] font-bold uppercase tracking-[2px] text-[#7C3AED] block mb-3">{t('landing.featuresLabel')}</span>
            <h2 className="text-[28px] sm:text-[38px] font-extrabold" style={isDark ? gradTitle : gradTitleLight}>{t('home.features.title')}</h2>
          </motion.div>

          <motion.div variants={staggerFast} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {featureConfig.map(({ key, Icon, color, glow }) => (
              <TiltCard key={key} className="rounded-3xl p-6 flex gap-4 items-start"
                cardStyle={isDark ? { background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}22`, boxShadow: `0 8px 32px ${glow}` } : { background: '#fff', border: `1px solid ${color}22`, boxShadow: `0 4px 16px ${glow}` }}
              >
                <motion.div variants={fadeIn}>
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                    style={{ background: `${color}12`, border: `1px solid ${color}25` }}
                  >
                    <Icon className="w-6 h-6" style={{ color }} />
                  </div>
                </motion.div>
                <motion.div variants={fadeUp}>
                  <h3 className={`text-[15px] font-bold ${isDark ? 'text-white' : 'text-[#111827]'} mb-1.5`}>{t(`home.features.${key}Title`)}</h3>
                  <p className={`text-[13px] ${isDark ? 'text-white/45' : 'text-[#6B7280]'} leading-relaxed`}>{t(`home.features.${key}Desc`)}</p>
                </motion.div>
              </TiltCard>
            ))}
          </motion.div>
        </Section>
      </section>

      {/* ═══════════════════════════════ SANDBOX ═══════════════════════════════ */}
      <section id="sandbox" className={`relative py-24 px-4 ${isDark ? 'bg-[#0D0618]' : 'bg-white'} overflow-hidden transition-colors duration-300`}>
        <Section className="max-w-4xl mx-auto">
          <motion.div variants={fadeUp} className="text-center mb-12">
            <span className="text-[11px] font-bold uppercase tracking-[2px] text-[#7C3AED] block mb-3">Sandbox</span>
            <h2 className="text-[28px] sm:text-[38px] font-extrabold mb-3" style={isDark ? gradTitle : gradTitleLight}>{t('home.sandbox.title')}</h2>
            <p className={`text-[14px] ${isDark ? 'text-white/50' : 'text-[#6B7280]'} max-w-md mx-auto`}>{t('home.sandbox.subtitle')}</p>
          </motion.div>

          <motion.div variants={staggerFast} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {sandboxLevels.map((level, i) => (
              <motion.div key={i} variants={fadeUp}
                whileHover={{ scale: 1.05, transition: { duration: 0.18 } }}
                className="rounded-3xl p-5 text-center cursor-pointer relative overflow-hidden"
                style={{ background: `${level.glow}10`, border: `1px solid ${level.glow}30`, boxShadow: `0 8px 32px ${level.glow}12,inset 0 1px 0 rgba(255,255,255,0.04)` }}
              >
                <div className="absolute inset-0 rounded-3xl" style={{ background: `radial-gradient(circle at 50% 20%, ${level.glow}18, transparent 60%)` }} />
                <SandboxSticker icon={level.icon} color={level.glow} delay={i * 0.4} />
                <p className="text-[13px] font-bold mb-1 relative" style={{ color: level.color }}>{sandboxNames[i]}</p>
                <p className={`text-[11px] ${isDark ? 'text-white/42' : 'text-[#6B7280]'} relative`}>{sandboxDescs[i]}</p>
                <div className="mt-3 flex justify-center gap-1.5 relative">
                  {[0,1,2,3].map(dot => (
                    <div key={dot} className="rounded-full transition-all" style={{
                      width: dot <= i ? 8 : 6, height: dot <= i ? 8 : 6,
                      background: dot <= i ? level.color : (isDark ? 'rgba(255,255,255,0.08)' : '#E5E7EB'),
                      boxShadow: dot <= i ? `0 0 8px ${level.glow}` : 'none',
                    }} />
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </Section>
      </section>

      {/* ══════════════════════════════ PWA DOWNLOAD ════════════════════════════ */}
      <section className={`relative py-24 px-4 overflow-hidden ${isDark ? 'bg-[#0D0618]' : 'bg-[#F5F3FF]'} transition-colors duration-300`}>
        <Section className="max-w-4xl mx-auto">
          <motion.div variants={fadeUp}
            className={`rounded-[28px] p-8 sm:p-10 relative overflow-hidden ${isDark ? '' : 'bg-white'}`}
            style={isDark ? { background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.2)', boxShadow: '0 16px 64px rgba(124,58,237,0.2)' } : { border: '1px solid #DDD6FE', boxShadow: '0 8px 40px rgba(124,58,237,0.12)' }}
          >
            <div className="flex flex-col lg:flex-row items-center gap-8">
              {/* Icon */}
              <div className="relative shrink-0">
                <div className="absolute inset-0 rounded-3xl blur-xl bg-[#7C3AED] opacity-50" />
                <div className="relative w-24 h-24 rounded-3xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(145deg,#7C3AED,#4C1D95)', boxShadow: '0 12px 40px rgba(124,58,237,0.5),inset 0 1px 0 rgba(255,255,255,0.18)' }}
                >
                  <div className="w-14 h-14 relative"><Image src="/icons/manifest-icon-192.maskable.png" alt="" fill className="object-contain" /></div>
                </div>
              </div>

              {/* Text */}
              <div className="flex-1 text-center lg:text-left">
                <h3 className={`text-[22px] font-extrabold ${isDark ? 'text-white' : 'text-[#111827]'} mb-2`}>
                  {t('landing.pwa.title')}
                </h3>
                <p className={`text-[14px] ${isDark ? 'text-white/50' : 'text-[#6B7280]'} mb-4`}>
                  {t('landing.pwa.desc')}
                </p>
                <div className="flex flex-wrap justify-center lg:justify-start gap-2">
                  {[{ label: 'Android', icon: '🤖' }, { label: 'iOS / Safari', icon: '🍎' }, { label: 'Desktop', icon: '💻' }].map(({ label, icon }) => (
                    <span key={label} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium text-[#7C3AED] border ${isDark ? 'border-[#7C3AED]/25 bg-[#7C3AED]/10' : 'border-[#DDD6FE] bg-[#EDE9FE]/40'}`}>
                      {icon} {label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Install button */}
              <div className="flex flex-col items-center gap-3 shrink-0">
                {isInstalled ? (
                  <div className="flex items-center gap-2 text-[#34D399] font-semibold">
                    <CheckCircle className="w-5 h-5" />
                    <span>{t('landing.pwa.installed')}</span>
                  </div>
                ) : (
                  <>
                    <motion.button whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.03 }}
                      onClick={handleInstall}
                      className="h-14 px-8 rounded-full text-[15px] font-bold text-white flex items-center gap-2.5 whitespace-nowrap"
                      style={{ background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', boxShadow: '0 0 30px rgba(124,58,237,0.5),0 8px 24px rgba(124,58,237,0.3)' }}
                    >
                      <Download className="w-5 h-5" />
                      {t('landing.pwa.install')}
                    </motion.button>
                    <p className={`text-[11px] ${isDark ? 'text-white/35' : 'text-[#9CA3AF]'}`}>{t('landing.pwa.free')}</p>
                  </>
                )}
              </div>
            </div>
          </motion.div>

          {/* Install guide fallback */}
          <AnimatePresence>
            {showInstallGuide && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                className={`mt-4 rounded-[20px] p-5 border ${isDark ? 'border-[#7C3AED]/25 bg-[#7C3AED]/08' : 'border-[#DDD6FE] bg-[#F5F3FF]'}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <p className="text-[14px] font-bold text-[#111827]">{t('landing.pwa.guideTitle')}</p>
                  <button onClick={() => setShowInstallGuide(false)} className="text-[#9CA3AF] hover:text-[#6B7280]"><XIcon className="w-4 h-4" /></button>
                </div>
                <div className="space-y-1.5 text-[13px] text-[#6B7280]">
                  <p>🍎 <strong className="text-[#374151]">iOS Safari :</strong> {t('landing.pwa.iosSafari')}</p>
                  <p>🤖 <strong className="text-[#374151]">Android Chrome :</strong> {t('landing.pwa.android')}</p>
                  <p>💻 <strong className="text-[#374151]">Desktop :</strong> {t('landing.pwa.desktop')}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>
      </section>

      {/* ══════════════════════════════ FINAL CTA ═══════════════════════════════ */}
      <section className="relative py-28 px-4 bg-[#080412] overflow-hidden">
        <Orb size={550} color="#7C3AED" top="40%" left="40%" delay={0} />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />

        <Section className="relative max-w-2xl mx-auto text-center">
          <motion.p variants={fadeUp} className="text-[11px] font-bold uppercase tracking-[2.5px] text-[#7C3AED] mb-4">EasyJob CM</motion.p>
          <motion.h2 variants={fadeUp} className="text-[32px] sm:text-[46px] font-extrabold mb-4 leading-[1.1]" style={gradTitle}>
            {t('home.cta.title')}
          </motion.h2>
          <motion.p variants={fadeUp} className="text-[15px] text-white/38 mb-10 max-w-md mx-auto">{t('home.cta.subtitle')}</motion.p>

          <motion.div variants={fadeUp}>
            <motion.button whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.03 }}
              onClick={() => router.push('/auth/signup')}
              className="h-16 px-10 rounded-full text-[17px] font-bold text-white inline-flex items-center gap-3"
              style={{ background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', boxShadow: '0 0 48px rgba(124,58,237,0.65),0 12px 32px rgba(124,58,237,0.3)' }}
            >
              {t('home.cta.btn')}<ArrowRight className="w-5 h-5" />
            </motion.button>
          </motion.div>

          <motion.button variants={fadeUp} whileTap={{ scale: 0.97 }}
            onClick={() => router.push('/auth/login')}
            className="mt-5 text-[13px] text-white/28 hover:text-white/60 transition-colors underline underline-offset-4"
          >
            {t('home.cta.login')}
          </motion.button>
        </Section>
      </section>

      {/* ════════════════════════════════ FOOTER ════════════════════════════════ */}
      <footer className="bg-[#060310] border-t border-white/5 px-4 py-12">
        <div className="max-w-5xl mx-auto">
          {/* Top: logo + socials */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 mb-10">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 relative">
                <div className="absolute inset-0 rounded-[10px] blur-md bg-[#7C3AED] opacity-45" />
                <div className="relative w-full h-full rounded-[10px] overflow-hidden">
                  <Image src="/icons/manifest-icon-192.maskable.png" alt="EasyJob CM" fill sizes="36px" className="object-cover" />
                </div>
              </div>
              <div>
                <p className="font-bold text-[15px]" style={{ backgroundImage: 'linear-gradient(135deg,#fff,#A78BFA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>EasyJob CM</p>
                <p className="text-[10px] text-white/28">Douala · Yaoundé 🇨🇲</p>
              </div>
            </div>

            {/* Social icons */}
            <div className="flex items-center gap-2">
              {[
                { Ic: TwitterXIcon,  label: 'Twitter/X',  href: 'https://twitter.com/'           },
                { Ic: LinkedInIcon,  label: 'LinkedIn',   href: 'https://www.linkedin.com/company/easyjob-cameroun/'  },
                { Ic: InstagramIcon, label: 'Instagram',  href: 'https://www.instagram.com/easyjobcameroun/'         },
                { Ic: FacebookIcon,  label: 'Facebook',   href: 'https://www.facebook.com/easyjobcameroun/'          },
                { Ic: WhatsAppIcon,  label: 'WhatsApp',   href: 'https://wa.me/'              },
              ].map(({ Ic, label, href }) => (
                <motion.a key={label} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}
                  whileHover={{ scale: 1.18, y: -2 }} whileTap={{ scale: 0.92 }}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white/35 hover:text-[#A78BFA] transition-colors border border-white/7 hover:border-[#7C3AED]/35"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                >
                  <Ic />
                </motion.a>
              ))}
            </div>
          </div>

          {/* Links grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-10 pb-10 border-b border-white/5">
            {footerCols.map(col => (
              <div key={col.title}>
                <h4 className="text-[11px] font-bold uppercase tracking-[1.5px] text-[#7C3AED] mb-3">{col.title}</h4>
                <ul className="space-y-2">
                  {col.links.map(link => (
                    <li key={link.label}>
                      {link.onClick ? (
                        <button onClick={link.onClick} className="text-[12px] text-white/30 hover:text-white/65 transition-colors text-left">
                          {link.label}
                        </button>
                      ) : (
                        <Link href={link.href ?? '#'} className="text-[12px] text-white/30 hover:text-white/65 transition-colors">
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-white/18">
            <span>© {new Date().getFullYear()} EasyJob CM · {t('landing.footer.madeFor')}</span>
            <motion.button whileTap={{ scale: 0.96 }}
              onClick={() => setLocale(fr ? 'en' : 'fr')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/7 text-white/28 hover:text-white/55 hover:border-white/12 transition-colors"
            >
              <Globe className="w-3 h-3" />{fr ? t('landing.language.french') : t('landing.language.english')}
            </motion.button>
          </div>
        </div>
      </footer>
    </div>
  )
}


