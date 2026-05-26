"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter, useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "../../../components/ui/checkbox"
import { Skeleton } from "../../../components/ui/skeleton"
import { 
  ArrowLeft,
  FileText,
  Calendar,
  Clock,
  MapPin,
  Briefcase,
  CheckCircle,
  Download,
  Pen
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface Contract {
  id: string
  status: string
  contract_template: string
  contract_data: {
    candidate_name?: string
    company_name?: string
    job_title?: string
    start_date?: string
    end_date?: string
    hourly_rate?: number
    estimated_hours?: number
    location?: string
  }
  candidate_signed_at: string | null
  company_signed_at: string | null
  job: {
    title: string
    start_date: string
    end_date: string
    start_time: string
    end_time: string
    hourly_rate: number
    city: string
    address: string
  }
  company: {
    company_name: string
    legal_name: string
    niu: string
    address: string
  }
  candidate: {
    first_name: string
    last_name: string
    cni_number: string
    address: string
  }
}

export default function ContractSignPage() {
  const router = useRouter()
  const params = useParams()
  const { toast } = useToast()
  const contractId = params.id as string
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  const [loading, setLoading] = useState(true)
  const [contract, setContract] = useState<Contract | null>(null)
  const [userRole, setUserRole] = useState<'candidate' | 'company' | null>(null)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [signing, setSigning] = useState(false)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)

  useEffect(() => {
    loadContract()
  }, [contractId])

  useEffect(() => {
    // Setup canvas for signature
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.strokeStyle = '#000'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
  }, [contract])

  async function loadContract() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      router.push('/login')
      return
    }

    // Determine user role
    const { data: candidateProfile } = await supabase
      .from('candidate_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    const { data: companyProfile } = await supabase
      .from('company_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (candidateProfile) {
      setUserRole('candidate')
    } else if (companyProfile) {
      setUserRole('company')
    }

    // Get contract with related data
    const { data: contractData } = await supabase
      .from('contracts')
      .select(`
        *,
        job:jobs(*),
        company:company_profiles(*),
        candidate:candidate_profiles(*)
      `)
      .eq('id', contractId)
      .single()

    if (contractData) {
      setContract(contractData as Contract)
    }
    
    setLoading(false)
  }

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true)
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    ctx.beginPath()
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
    ctx.stroke()
    setHasSignature(true)
  }

  const handleCanvasMouseUp = () => {
    setIsDrawing(false)
  }

  const handleCanvasTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    setIsDrawing(true)
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    const touch = e.touches[0]
    ctx.beginPath()
    ctx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top)
  }

  const handleCanvasTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (!isDrawing) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    const touch = e.touches[0]
    ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top)
    ctx.stroke()
    setHasSignature(true)
  }

  const clearSignature = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
  }

  const handleSign = async () => {
    if (!contract || !acceptedTerms || !hasSignature) return

    const canvas = canvasRef.current
    if (!canvas) return

    setSigning(true)
    const supabase = createClient()

    // Convert canvas to data URL
    const signatureDataUrl = canvas.toDataURL('image/png')

    // Update contract based on user role
    const updateData: Record<string, unknown> = {}
    
    if (userRole === 'candidate') {
      updateData.candidate_signature_url = signatureDataUrl
      updateData.candidate_signed_at = new Date().toISOString()
      updateData.status = contract.company_signed_at ? 'completed' : 'candidate_signed'
    } else if (userRole === 'company') {
      updateData.company_signature_url = signatureDataUrl
      updateData.company_signed_at = new Date().toISOString()
      updateData.status = contract.candidate_signed_at ? 'completed' : 'company_signed'
    }

    const { error } = await supabase
      .from('contracts')
      .update(updateData)
      .eq('id', contractId)

    if (error) {
      toast({
        title: "Erreur",
        description: "Impossible de signer le contrat.",
        variant: "destructive"
      })
    } else {
      toast({
        title: "Contrat signe",
        description: "Votre signature a ete enregistree."
      })
      loadContract()
    }
    
    setSigning(false)
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  }

  const formatTime = (time: string) => {
    return time?.slice(0, 5) || ''
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!contract) {
    return (
      <div className="min-h-screen bg-background p-4">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div className="text-center mt-8">
          <p className="text-muted-foreground">Contrat non trouve</p>
        </div>
      </div>
    )
  }

  const isFullySigned = contract.status === 'completed' || contract.status === 'fully_signed'
  const canSign = userRole === 'candidate' 
    ? !contract.candidate_signed_at 
    : !contract.company_signed_at

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header */}
      <div className="bg-card border-b p-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-3">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Contrat de Mission</h1>
            <p className="text-sm text-muted-foreground">
              Reference: {contract.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
          <Badge 
            className={
              isFullySigned 
                ? "bg-green-100 text-green-700" 
                : "bg-yellow-100 text-yellow-700"
            }
          >
            {isFullySigned ? "Signe" : "En attente"}
          </Badge>
        </div>
      </div>

      {/* Contract Content */}
      <div className="p-4 space-y-4">
        {/* Parties */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Parties au contrat</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Entreprise</div>
              <div className="font-medium">{contract.company?.company_name}</div>
              <div className="text-sm text-muted-foreground">
                {contract.company?.legal_name && `${contract.company.legal_name} - `}
                NIU: {contract.company?.niu || 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Candidat</div>
              <div className="font-medium">
                {contract.candidate?.first_name} {contract.candidate?.last_name}
              </div>
              <div className="text-sm text-muted-foreground">
                CNI: {contract.candidate?.cni_number || 'N/A'}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Job Details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Details de la mission</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{contract.job?.title}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>
                {formatDate(contract.job?.start_date)}
                {contract.job?.end_date && contract.job.end_date !== contract.job.start_date && 
                  ` - ${formatDate(contract.job.end_date)}`
                }
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span>
                {formatTime(contract.job?.start_time)} - {formatTime(contract.job?.end_time)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>{contract.job?.address}, {contract.job?.city}</span>
            </div>
            <div className="pt-2 border-t">
              <span className="text-lg font-bold text-violet-600">
                {contract.job?.hourly_rate?.toLocaleString()} XAF/heure
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Contract Terms */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Termes du contrat</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none text-muted-foreground">
              <p>
                Le present contrat de mission est conclu entre les parties susmentionnees 
                pour l&apos;execution de la mission decrite ci-dessus.
              </p>
              <h4 className="text-foreground font-medium mt-4">Obligations du Candidat</h4>
              <ul className="list-disc pl-4 space-y-1">
                <li>Se presenter a l&apos;heure convenue sur le lieu de travail</li>
                <li>Executer les taches confiees avec professionnalisme</li>
                <li>Respecter les regles de securite et d&apos;hygiene</li>
                <li>Utiliser le systeme de pointage EasyJob</li>
              </ul>
              <h4 className="text-foreground font-medium mt-4">Obligations de l&apos;Entreprise</h4>
              <ul className="list-disc pl-4 space-y-1">
                <li>Fournir un environnement de travail securise</li>
                <li>Valider les heures de travail effectuees</li>
                <li>Proceder au paiement dans les 48h suivant la validation</li>
              </ul>
              <h4 className="text-foreground font-medium mt-4">Remuneration</h4>
              <p>
                Le candidat sera remunere au taux horaire indique ci-dessus.
                Le paiement sera effectue via Mobile Money dans les 48 heures 
                suivant la validation de la mission par l&apos;entreprise.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Signature Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Signatures</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span>Candidat</span>
              {contract.candidate_signed_at ? (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm">Signe le {formatDate(contract.candidate_signed_at)}</span>
                </div>
              ) : (
                <Badge variant="outline">En attente</Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span>Entreprise</span>
              {contract.company_signed_at ? (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm">Signe le {formatDate(contract.company_signed_at)}</span>
                </div>
              ) : (
                <Badge variant="outline">En attente</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Signature Pad */}
        {canSign && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Pen className="h-4 w-4" />
                Votre signature
              </CardTitle>
              <CardDescription>
                Dessinez votre signature dans le cadre ci-dessous
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed rounded-lg p-2 bg-white">
                <canvas
                  ref={canvasRef}
                  width={300}
                  height={150}
                  className="w-full touch-none cursor-crosshair"
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseUp}
                  onTouchStart={handleCanvasTouchStart}
                  onTouchMove={handleCanvasTouchMove}
                  onTouchEnd={handleCanvasMouseUp}
                />
              </div>
              
              <Button variant="outline" size="sm" onClick={clearSignature}>
                Effacer
              </Button>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="terms"
                  checked={acceptedTerms}
                  onCheckedChange={(checked: boolean | 'indeterminate') => setAcceptedTerms(checked === true)}
                />
                <label htmlFor="terms" className="text-sm text-muted-foreground">
                  J&apos;ai lu et j&apos;accepte les termes du contrat. Je comprends que cette 
                  signature electronique a la meme valeur legale qu&apos;une signature manuscrite.
                </label>
              </div>

              <Button 
                className="w-full" 
                onClick={handleSign}
                disabled={signing || !acceptedTerms || !hasSignature}
              >
                {signing ? "Signature en cours..." : "Signer le contrat"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Download Button for fully signed contracts */}
        {isFullySigned && (
          <Button className="w-full" variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Telecharger le contrat (PDF)
          </Button>
        )}
      </div>
    </div>
  )
}
