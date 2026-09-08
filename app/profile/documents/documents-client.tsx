"use client";

/*
 * Page « Mes documents » (T4, SRS §6.14.3) : liste unique et exhaustive des
 * justificatifs du candidat — statut effectif (expiré détecté au vol),
 * compétences liées, consultation Voir (modal, URL signée 60 s) et
 * Télécharger. Lecture-only côté candidat : l'ajout se fait depuis
 * « Mes compétences » (/profile/skills), le remplacement est géré côté
 * admin (T8) — l'ancien n'est supprimé que si le nouveau est validé.
 */
import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Eye,
  Download,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Loader2,
  ChevronLeft,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import type { LicenseCategoryT31 } from "@/lib/utils/license-requirements";
import {
  effectiveDocStatus,
  type EffectiveDocStatus,
} from "@/lib/utils/document-status";
import {
  SKILL_DOCUMENT_TYPES,
  type SkillDocumentType,
} from "@/lib/validations/skill-documents";
import { useRouter } from "next/navigation";

interface SkillNameRef {
  skill_name: string | null;
}
interface SkillDocLink {
  /** 1 lien → 1 compétence : PostgREST embarque `candidate_skills` en
   *  OBJET (ou tableau si l'embedded a un `limit`) — on tolère les deux. */
  candidate_skills: SkillNameRef | SkillNameRef[];
}
export interface DocumentRow {
  id: string;
  document_type: string;
  title: string;
  issuing_organization: string | null;
  issued_at: string | null;
  expires_at: string | null;
  status: string;
  rejection_reason: string | null;
  verified_at: string | null;
  created_at: string;
  storage_path: string | null;
  license_category: LicenseCategoryT31 | null;
  candidate_skill_documents: SkillDocLink[];
}

interface DocumentsPageClientProps {
  initialDocuments: DocumentRow[];
}

const STATUS_STYLE: Record<
  EffectiveDocStatus,
  { icon: React.ElementType; className: string }
> = {
  pending: { icon: Clock, className: "text-amber-600" },
  verified: { icon: CheckCircle2, className: "text-emerald-600" },
  rejected: { icon: XCircle, className: "text-red-600" },
  expired: { icon: AlertTriangle, className: "text-orange-600" },
};

/** Clé du libellé `t.profile.skillDocuments.status` pour chaque statut
 *  effectif — sous-ensemble exact des clés i18n (jamais `declared`/`missing`). */
const STATUS_LABEL_KEY: Record<
  EffectiveDocStatus,
  "pending" | "verified" | "rejected" | "expired"
> = {
  pending: "pending",
  verified: "verified",
  rejected: "rejected",
  expired: "expired",
};

/** Clé du libellé `t.profile.skillDocuments.documentTypes` pour un type DB
 *  (fallback « autre » si inconnu — garde-bouche affichage, la CHECK DB
 *  ne laisse passer que les 8 types). */
function docTypeKey(type: string): SkillDocumentType {
  return (SKILL_DOCUMENT_TYPES as readonly string[]).includes(type)
    ? (type as SkillDocumentType)
    : "autre";
}

function isPdf(path: string | null): boolean {
  return !!path && path.toLowerCase().endsWith(".pdf");
}

export function DocumentsPageClient({
  initialDocuments,
}: DocumentsPageClientProps) {
  const { t, locale } = useI18n();
  const tpd = t.profile.documentsPage;
  const tsk = t.profile.skillDocuments;
  const tsp = t.profile.skills;

  const [documents] = React.useState<DocumentRow[]>(initialDocuments);
  const [viewing, setViewing] = React.useState<DocumentRow | null>(null);
  const [viewUrl, setViewUrl] = React.useState<string | null>(null);
  const [viewLoadingId, setViewLoadingId] = React.useState<string | null>(null);
  const [downloadLoadingId, setDownloadLoadingId] = React.useState<
    string | null
  >(null);
  const [error, setError] = React.useState("");
  const router = useRouter();

  const dateFmt = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    [locale],
  );
  const fmtDate = (iso: string | null) =>
    iso ? dateFmt.format(new Date(`${iso}T12:00:00`)) : "—";

  /** Nom de fichier lisible pour le téléchargement. */
  const downloadName = (doc: DocumentRow): string => {
    const ext = doc.storage_path?.split(".").pop() ?? "pdf";
    const base = doc.title.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase();
    return `${base || "document"}.${ext}`;
  };

  /** URL signée (TTL 60 s) — générée à la demande, jamais au pré-rendu. */
  const getSignedUrl = async (id: string): Promise<string | null> => {
    const res = await fetch(`/api/profile/skill-documents/${id}/url`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { url?: string };
    return body.url ?? null;
  };

  const openView = async (doc: DocumentRow) => {
    setError("");
    setViewLoadingId(doc.id);
    const url = await getSignedUrl(doc.id);
    setViewLoadingId(null);
    if (!url) {
      setError(tpd.viewError);
      return;
    }
    setViewUrl(url);
    setViewing(doc);
  };

  const closeView = () => {
    // L'URL signée expire en 60 s : on la libère à la fermeture (le serveur
    // en régénère une nouvelle à la prochaine consultation).
    setViewing(null);
    setViewUrl(null);
  };

  const download = async (doc: DocumentRow) => {
    setError("");
    setDownloadLoadingId(doc.id);
    const url = await getSignedUrl(doc.id);
    setDownloadLoadingId(null);
    if (!url) {
      setError(tpd.downloadError);
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName(doc);
    document.body.append(a);
    a.click();
    a.remove();
  };

  /** Noms des compétences liées (embedding 1:1 = objet, ou tableau). */
  const linkedSkillNames = (doc: DocumentRow): string[] =>
    doc.candidate_skill_documents.flatMap((l) => {
      const cs = l.candidate_skills;
      const arr = Array.isArray(cs) ? cs : cs ? [cs] : [];
      return arr.map((s) => s.skill_name).filter((n): n is string => !!n);
    });

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="mb-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label={t.common.back}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition-transform active:scale-95"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                {tpd.title}
              </h1>
              <p className="text-sm text-muted-foreground">{tpd.subtitle}</p>
            </div>
          </div>
        </motion.div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* CTA ajout — l'upload de justificatif vit dans la page compétences (T3). */}
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {tpd.addTitle}
            </p>
            <p className="text-xs text-muted-foreground">{tpd.addHint}</p>
          </div>
          <Button asChild size="sm" fullWidth={false}>
            <Link href="/profile/skills" className="inline-flex items-center">
              {tpd.addCta}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        {documents.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">{tpd.empty}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {tpd.emptyHint}
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            <AnimatePresence initial={false}>
              {documents.map((doc) => {
                const status = effectiveDocStatus(doc.status, doc.expires_at);
                const S = STATUS_STYLE[status];
                const skills = linkedSkillNames(doc);
                const categoryLabel =
                  doc.document_type === "permis_conduire" &&
                  doc.license_category != null
                    ? tsp.licenseCategories[doc.license_category]
                    : null;
                return (
                  <motion.li
                    key={doc.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Card>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-input bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground">
                                {
                                  tsk.documentTypes[
                                    docTypeKey(doc.document_type)
                                  ]
                                }
                              </span>
                              <span className="font-medium text-foreground">
                                {doc.title}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {[
                                doc.issuing_organization,
                                categoryLabel &&
                                  tpd.category.replace("{cat}", categoryLabel),
                              ]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </p>
                          </div>
                          {/* Statut effectif — expiré détecté au vol (SRS §6.14). */}
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${S.className}`}
                          >
                            <S.icon className="h-4 w-4" />
                            {tsk.status[STATUS_LABEL_KEY[status]]}
                          </span>
                        </div>

                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <div>
                            <dt>{tpd.issuedAt}</dt>
                            <dd className="text-foreground">
                              {fmtDate(doc.issued_at)}
                            </dd>
                          </div>
                          <div>
                            <dt>{tpd.expiresAt}</dt>
                            <dd className="text-foreground">
                              {fmtDate(doc.expires_at)}
                            </dd>
                          </div>
                        </dl>

                        {doc.rejection_reason && (
                          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                            <span className="font-medium">
                              {tsk.rejectionReasonLabel} :{" "}
                            </span>
                            {doc.rejection_reason}
                          </p>
                        )}

                        {skills.length > 0 && (
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {tpd.linkedSkills}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {skills.map((s) => (
                                <span
                                  key={s}
                                  className="rounded-full border border-input bg-background px-2 py-0.5 text-xs text-foreground"
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2 border-t border-border pt-3">
                          <Button
                            variant="outline"
                            size="sm"
                            fullWidth
                            onClick={() => openView(doc)}
                            disabled={viewLoadingId === doc.id}
                          >
                            {viewLoadingId === doc.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Eye className="mr-1 h-3.5 w-3.5" />
                            )}
                            {tpd.view}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            fullWidth
                            onClick={() => download(doc)}
                            disabled={downloadLoadingId === doc.id}
                          >
                            {downloadLoadingId === doc.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="mr-1 h-3.5 w-3.5" />
                            )}
                            {tpd.download}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {/* Modal « Voir » — URL signée (TTL 60 s) ; PDF en <iframe>,
          images en <img>. Jamais d'URL générée au pré-rendu. */}
      <Modal
        isOpen={viewing !== null}
        onClose={closeView}
        title={viewing ? viewing.title : undefined}
      >
        {viewing && viewUrl && (
          <div className="flex justify-center">
            {isPdf(viewing.storage_path) ? (
              <iframe
                src={viewUrl}
                title={viewing.title}
                className="h-[70vh] w-full rounded-lg border border-input bg-background"
              />
            ) : (
              <img
                src={viewUrl}
                alt={viewing.title}
                className="max-h-[70vh] w-auto rounded-lg border border-input object-contain"
              />
            )}
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
