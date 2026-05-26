'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Header } from '@/components/layout/header'
import { useTranslation } from '@/lib/i18n'
import { LoadingSpinner } from '@/components/ui/loading'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  Building2,
  MapPin,
  FileText,
  CreditCard,
  ChevronRight,
  Check,
  Upload,
  Camera,
  Smartphone,
  Globe,
  Users,
  type LucideIcon,
} from 'lucide-react'

type Step = 'company' | 'documents' | 'momo' | 'location'

const steps: { id: Step; icon: LucideIcon; labelFr: string; labelEn: string }[] = [
  { id: 'company', icon: Building2, labelFr: 'Entreprise', labelEn: 'Company' },
  { id: 'documents', icon: FileText, labelFr: 'Documents', labelEn: 'Documents' },
  { id: 'momo', icon: Smartphone, labelFr: 'Paiement', labelEn: 'Payment' },
  { id: 'location', icon: MapPin, labelFr: 'Adresse', labelEn: 'Address' },
]

const businessTypes = [
  { id: 'restaurant', labelFr: 'Restaurant/Bar', labelEn: 'Restaurant/Bar' },
  { id: 'hotel', labelFr: 'Hotellerie', labelEn: 'Hospitality' },
  { id: 'commerce', labelFr: 'Commerce', labelEn: 'Retail' },
  { id: 'event', labelFr: 'Evenementiel', labelEn: 'Events' },
  { id: 'logistics', labelFr: 'Logistique', labelEn: 'Logistics' },
  { id: 'other', labelFr: 'Autre', labelEn: 'Other' },
]

const employeeRanges = [
  { id: '1-10', label: '1-10' },
  { id: '11-50', label: '11-50' },
  { id: '51-200', label: '51-200' },
  { id: '200+', label: '200+' },
]

export default function CompanyOnboardingPage() {
  const router = useRouter()
  const { locale } = useTranslation()
  const [currentStep, setCurrentStep] = React.useState<Step>('company')
  const [loading, setLoading] = React.useState(false)
  
  // Form data
  const [formData, setFormData] = React.useState({
    companyName: '',
    businessType: '',
    employeeRange: '',
    website: '',
    description: '',
    rcNumber: '',
    rcDocument: null as File | null,
    taxNumber: '',
    momoProvider: '' as 'mtn' | 'orange' | '',
    momoNumber: '',
    city: '',
    area: '',
    address: '',
  })

  const currentStepIndex = steps.findIndex(s => s.id === currentStep)

  const handleNext = () => {
    const nextIndex = currentStepIndex + 1
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].id)
    } else {
      handleComplete()
    }
  }

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].id)
    }
  }

  const handleComplete = async () => {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        // Create company profile
        await supabase.from('companies').insert({
          user_id: user.id,
          name: formData.companyName,
          business_type: formData.businessType,
          employee_range: formData.employeeRange,
          website: formData.website,
          description: formData.description,
          rc_number: formData.rcNumber,
          tax_number: formData.taxNumber,
          city: formData.city,
          area: formData.area,
          address: formData.address,
          is_verified: false,
        })

        // Update user as verified (pending admin approval)
        await supabase.from('users').update({
          is_verified: true,
        }).eq('id', user.id)
      }
      
      router.push('/company/dashboard')
    } catch (error) {
      console.error('[v0] Company onboarding error:', error)
    } finally {
      setLoading(false)
    }
  }

  const isStepValid = () => {
    switch (currentStep) {
      case 'company':
        return formData.companyName && formData.businessType && formData.employeeRange
      case 'documents':
        return formData.rcNumber
      case 'momo':
        return formData.momoProvider && formData.momoNumber.length === 9
      case 'location':
        return formData.city && formData.area && formData.address
      default:
        return false
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header 
        title={locale === 'fr' ? 'Inscription entreprise' : 'Company registration'}
        showBack={currentStepIndex > 0}
        onBack={handleBack}
      />

      {/* Progress */}
      <div className="px-6 pt-4">
        <div className="flex items-center justify-between mb-2">
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full transition-all',
                    index < currentStepIndex
                      ? 'bg-success text-success-foreground'
                      : index === currentStepIndex
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {index < currentStepIndex ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <step.icon className="h-5 w-5" />
                  )}
                </div>
                <span className="text-[10px] mt-1 text-muted-foreground">
                  {locale === 'fr' ? step.labelFr : step.labelEn}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-0.5 mx-2',
                    index < currentStepIndex ? 'bg-success' : 'bg-muted'
                  )}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 px-6 py-6">
        {/* Company Info Step */}
        {currentStep === 'company' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {locale === 'fr' ? 'Votre entreprise' : 'Your company'}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {locale === 'fr'
                  ? 'Parlez-nous de votre entreprise'
                  : 'Tell us about your company'}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === 'fr' ? 'Nom de l\'entreprise' : 'Company name'}
                </label>
                <Input
                  value={formData.companyName}
                  onChange={(e) => setFormData(prev => ({ ...prev, companyName: e.target.value }))}
                  placeholder="EasyJob Cameroun SARL"
                  className="mt-1.5"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-3 block">
                  {locale === 'fr' ? 'Type d\'activite' : 'Business type'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {businessTypes.map((type) => (
                    <button
                      key={type.id}
                      onClick={() => setFormData(prev => ({ ...prev, businessType: type.id }))}
                      className={cn(
                        'rounded-xl px-4 py-3 text-sm font-medium transition-all',
                        formData.businessType === type.id
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      )}
                    >
                      {locale === 'fr' ? type.labelFr : type.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-3 block">
                  {locale === 'fr' ? 'Nombre d\'employes' : 'Number of employees'}
                </label>
                <div className="flex gap-2">
                  {employeeRanges.map((range) => (
                    <button
                      key={range.id}
                      onClick={() => setFormData(prev => ({ ...prev, employeeRange: range.id }))}
                      className={cn(
                        'flex-1 flex items-center justify-center gap-1 rounded-xl px-3 py-3 text-sm font-medium transition-all',
                        formData.employeeRange === range.id
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      )}
                    >
                      <Users className="h-4 w-4" />
                      {range.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === 'fr' ? 'Site web (optionnel)' : 'Website (optional)'}
                </label>
                <div className="relative mt-1.5">
                  <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={formData.website}
                    onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
                    placeholder="https://www.example.com"
                    className="pl-10"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === 'fr' ? 'Description (optionnel)' : 'Description (optional)'}
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder={locale === 'fr' ? 'Decrivez votre entreprise...' : 'Describe your company...'}
                  className="mt-1.5 w-full min-h-[100px] rounded-xl border border-input bg-background px-4 py-3 text-foreground resize-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Documents Step */}
        {currentStep === 'documents' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {locale === 'fr' ? 'Documents legaux' : 'Legal documents'}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {locale === 'fr'
                  ? 'Ces documents sont necessaires pour verifier votre entreprise'
                  : 'These documents are required to verify your company'}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === 'fr' ? 'Numero de Registre du Commerce (RCCM)' : 'Business registration number (RCCM)'}
                </label>
                <Input
                  value={formData.rcNumber}
                  onChange={(e) => setFormData(prev => ({ ...prev, rcNumber: e.target.value }))}
                  placeholder="RC/DLA/XXXX/XXXXX"
                  className="mt-1.5"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === 'fr' ? 'Document RCCM' : 'RCCM document'}
                </label>
                <div className="mt-1.5">
                  <label className="flex flex-col items-center justify-center h-32 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors cursor-pointer">
                    <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                    <span className="text-sm text-muted-foreground">
                      {formData.rcDocument
                        ? formData.rcDocument.name
                        : locale === 'fr'
                        ? 'Cliquez pour telecharger'
                        : 'Click to upload'}
                    </span>
                    <span className="text-xs text-muted-foreground mt-1">
                      PDF, JPG, PNG
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          setFormData(prev => ({ ...prev, rcDocument: file }))
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === 'fr' ? 'Numero d\'Identification Fiscale (NIF) - optionnel' : 'Tax ID number (NIF) - optional'}
                </label>
                <Input
                  value={formData.taxNumber}
                  onChange={(e) => setFormData(prev => ({ ...prev, taxNumber: e.target.value }))}
                  placeholder="XXXXXXXXXX"
                  className="mt-1.5"
                />
              </div>

              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="p-4">
                  <p className="text-sm text-foreground">
                    {locale === 'fr'
                      ? 'Vos documents seront examines par notre equipe. Vous recevrez une notification une fois votre compte verifie.'
                      : 'Your documents will be reviewed by our team. You will receive a notification once your account is verified.'}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Mobile Money Step */}
        {currentStep === 'momo' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {locale === 'fr' ? 'Compte de paiement' : 'Payment account'}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {locale === 'fr'
                  ? 'Ce compte sera utilise pour payer les travailleurs'
                  : 'This account will be used to pay workers'}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-3 block">
                  {locale === 'fr' ? 'Operateur' : 'Provider'}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setFormData(prev => ({ ...prev, momoProvider: 'mtn' }))}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-xl p-4 border-2 transition-all',
                      formData.momoProvider === 'mtn'
                        ? 'border-[#ffcc00] bg-[#ffcc00]/10'
                        : 'border-border hover:border-[#ffcc00]/50'
                    )}
                  >
                    <div className="h-12 w-12 rounded-full bg-[#ffcc00] flex items-center justify-center">
                      <span className="text-black font-bold text-sm">MTN</span>
                    </div>
                    <span className="text-sm font-medium">MTN MoMo</span>
                  </button>
                  
                  <button
                    onClick={() => setFormData(prev => ({ ...prev, momoProvider: 'orange' }))}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-xl p-4 border-2 transition-all',
                      formData.momoProvider === 'orange'
                        ? 'border-[#ff6600] bg-[#ff6600]/10'
                        : 'border-border hover:border-[#ff6600]/50'
                    )}
                  >
                    <div className="h-12 w-12 rounded-full bg-[#ff6600] flex items-center justify-center">
                      <span className="text-white font-bold text-xs">Orange</span>
                    </div>
                    <span className="text-sm font-medium">Orange Money</span>
                  </button>
                </div>
              </div>

              {formData.momoProvider && (
                <div>
                  <label className="text-sm font-medium text-foreground">
                    {locale === 'fr' ? 'Numero Mobile Money' : 'Mobile Money number'}
                  </label>
                  <div className="flex gap-3 mt-1.5">
                    <div className="flex h-12 items-center justify-center rounded-xl bg-muted px-3 text-sm font-medium">
                      +237
                    </div>
                    <Input
                      type="tel"
                      placeholder="6XX XXX XXX"
                      value={formData.momoNumber}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 9)
                        setFormData(prev => ({ ...prev, momoNumber: value }))
                      }}
                      className="flex-1"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Location Step */}
        {currentStep === 'location' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                {locale === 'fr' ? 'Adresse de l\'entreprise' : 'Company address'}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {locale === 'fr'
                  ? 'Ou se trouve votre siege social ?'
                  : 'Where is your headquarters located?'}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === 'fr' ? 'Ville' : 'City'}
                </label>
                <select
                  value={formData.city}
                  onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                  className="mt-1.5 w-full h-12 rounded-xl border border-input bg-background px-3 text-foreground"
                >
                  <option value="">{locale === 'fr' ? 'Selectionnez une ville' : 'Select a city'}</option>
                  <option value="douala">Douala</option>
                  <option value="yaounde">Yaounde</option>
                  <option value="bafoussam">Bafoussam</option>
                  <option value="garoua">Garoua</option>
                  <option value="bamenda">Bamenda</option>
                  <option value="kribi">Kribi</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === 'fr' ? 'Quartier' : 'Area'}
                </label>
                <Input
                  value={formData.area}
                  onChange={(e) => setFormData(prev => ({ ...prev, area: e.target.value }))}
                  placeholder={locale === 'fr' ? 'Ex: Bonanjo, Akwa...' : 'Ex: Bonanjo, Akwa...'}
                  className="mt-1.5"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">
                  {locale === 'fr' ? 'Adresse complete' : 'Full address'}
                </label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                  placeholder={locale === 'fr' ? 'Rue, batiment...' : 'Street, building...'}
                  className="mt-1.5"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      <div className="sticky bottom-0 bg-background/80 backdrop-blur-xl border-t border-border p-4 safe-area-bottom">
        <Button
          onClick={handleNext}
          disabled={!isStepValid() || loading}
          className="w-full"
          size="lg"
        >
          {loading ? (
            <LoadingSpinner size="sm" />
          ) : currentStepIndex === steps.length - 1 ? (
            locale === 'fr' ? 'Creer mon compte' : 'Create my account'
          ) : (
            <>
              {locale === 'fr' ? 'Continuer' : 'Continue'}
              <ChevronRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
