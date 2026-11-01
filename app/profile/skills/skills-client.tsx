"use client";

/*
 * Page « Mes compétences » (T3) : liste des compétences du candidat avec
 * leur statut de vérification, ajout depuis un catalogue (recherche +
 * groupes), certifier par justificatif (T0), et section CV + permis
 * au-dessus de la liste. Absorbe /profile/skill-documents.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  FileText,
  Plus,
  Trash2,
  Search,
  BadgeCheck,
  Car,
  AlertCircle,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { SKILL_CATALOG, searchSkillCatalog } from "@/lib/data/skill-catalog";
import {
  SKILL_DOCUMENT_TYPES,
  GENERAL_DOC_TYPES,
  LICENSE_CATEGORIES,
  type SkillDocumentType,
} from "@/lib/validations/skill-documents";
import {
  licenseDocCovers,
  requiredLicenseCategory,
  type LicenseCategoryT31,
} from "@/lib/utils/license-requirements";

type SkillVerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected"
  | "expired";

interface SkillRow {
  id: string;
  skill_name: string;
  verification_status: string;
}

interface DocumentRow {
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
  /** T3.1 : catégorie du permis (nulle sauf permis_conduire). */
  license_category: LicenseCategoryT31 | null;
  candidate_skill_documents: { candidate_skill_id: string }[];
}

interface SkillsPageClientProps {
  /** Id du profil candidat (candidate_profiles.id) — écritures skills. */
  candidateId: string;
  initialSkills: SkillRow[];
  initialDocuments: DocumentRow[];
}

const STATUS_STYLE: Record<
  SkillVerificationStatus,
  { icon: React.ElementType; className: string }
> = {
  unverified: { icon: FileText, className: "text-muted-foreground" },
  pending: { icon: Clock, className: "text-amber-600" },
  verified: { icon: CheckCircle2, className: "text-emerald-600" },
  rejected: { icon: XCircle, className: "text-red-600" },
  expired: { icon: AlertTriangle, className: "text-orange-600" },
};

const LABEL_KEY = {
  unverified: "declared",
  pending: "pending",
  verified: "verified",
  rejected: "rejected",
  expired: "expired",
} as const;

export function SkillsPageClient({
  candidateId,
  initialSkills,
  initialDocuments,
}: SkillsPageClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const ts = t.profile.skillDocuments;
  const tsp = t.profile.skills;
  const supabase = React.useMemo(() => createClient(), []);

  const [skills, setSkills] = React.useState<SkillRow[]>(initialSkills);
  const [documents] = React.useState<DocumentRow[]>(initialDocuments);
  const [query, setQuery] = React.useState("");
  const [certifySkill, setCertifySkill] = React.useState<SkillRow | null>(null);
  const [uploadSkill, setUploadSkill] = React.useState<SkillRow | null>(null);
  const [uploadLockedType, setUploadLockedType] =
    React.useState<SkillDocumentType | null>(null);
  const [deletingDoc, setDeletingDoc] = React.useState<string | null>(null);
  const [deletingSkill, setDeletingSkill] = React.useState<SkillRow | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const refresh = () => router.refresh();

  const documentsBySkill = React.useMemo(() => {
    const map = new Map<string, DocumentRow[]>();
    for (const doc of documents) {
      for (const link of doc.candidate_skill_documents) {
        const list = map.get(link.candidate_skill_id) ?? [];
        list.push(doc);
        map.set(link.candidate_skill_id, list);
      }
    }
    return map;
  }, [documents]);

  const cvDocument = documents.find((d) => d.document_type === "cv") ?? null;
  const permitDocument =
    documents.find((d) => d.document_type === "permis_conduire") ?? null;

  const catalogNames = React.useMemo(
    () => new Set(searchSkillCatalog("").map((s) => s.name)),
    [],
  );
  const addedNames = React.useMemo(
    () => new Set(skills.map((s) => s.skill_name)),
    [skills],
  );
  /** Skills du candidat absentes du catalogue (saisies historiques). */
  const orphanSkills = React.useMemo(
    () => skills.filter((s) => !catalogNames.has(s.skill_name)),
    [skills, catalogNames],
  );

  const match = React.useMemo(
    () => (query.trim() ? searchSkillCatalog(query) : []),
    [query],
  );

  const statusBadge = (status: string) => {
    const key = (
      status in STATUS_STYLE ? status : "unverified"
    ) as SkillVerificationStatus;
    const { icon: Icon, className } = STATUS_STYLE[key];
    return (
      <span
        className={`inline-flex items-center gap-1 text-sm font-medium ${className}`}
      >
        <Icon className="h-4 w-4" />
        {ts.status[LABEL_KEY[key]]}
      </span>
    );
  };

  /** Insert la skill si elle n'existe pas, puis propulse le modal certifier.
   *  T3.1 : une compétence de conduite exige un permis vérifié de la bonne
   *  catégorie (trigger Postgres de secours) — on intercepte le refus côté
   *  client (message dédié) et l'affiche. */
  const addSkill = async (skillName: string) => {
    if (busy) return;
    const required = requiredLicenseCategory(skillName);
    if (required) {
      const permit = documents.find(
        (d) => d.document_type === "permis_conduire",
      );
      if (
        !permit ||
        !licenseDocCovers(
          skillName,
          permit.status,
          permit.license_category ?? null,
        )
      ) {
        setError(tsp.licenseRequiredError.replace("{skill}", skillName));
        return;
      }
    }
    setError("");
    if (addedNames.has(skillName)) return;
    setBusy(true);
    try {
      const { data, error: insertError } = await supabase
        .from("candidate_skills")
        .insert({
          candidate_id: candidateId,
          skill_name: skillName,
          skill_level: 3,
        })
        .select("id, skill_name, verification_status")
        .single();
      if (insertError || !data) {
        // Le trigger `trg_enforce_license_for_driving_skill` lève un message
        // avec ce préfixe stable — on l'affiche en message dédié (i18n),
        // sinon on retombe sur l'erreur générique.
        const msg = insertError?.message ?? "";
        if (msg.startsWith("EASYJOB_LICENSE_REQUIRED")) {
          setError(tsp.licenseRequiredError.replace("{skill}", skillName));
        } else {
          setError(tsp.addError);
        }
        return;
      }
      setSkills((prev) => [...prev, data as SkillRow]);
      setCertifySkill(data as SkillRow);
    } catch {
      setError(tsp.addError);
    } finally {
      setBusy(false);
    }
  };

  const removeSkill = async (skill: SkillRow) => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const { error: deleteError } = await supabase
        .from("candidate_skills")
        .delete()
        .eq("id", skill.id);
      if (deleteError) throw deleteError;
      setDeletingSkill(null);
      refresh();
    } catch {
      setError(tsp.deleteSkillError);
    } finally {
      setBusy(false);
    }
  };

  const deleteDocument = async () => {
    if (!deletingDoc || busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/profile/skill-documents/${deletingDoc}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      setDeletingDoc(null);
      refresh();
    } catch {
      setError(ts.deleteError);
    } finally {
      setBusy(false);
    }
  };

  /** Action de justification par statut (sémantique T0). */
  const skillProofAction = (status: SkillVerificationStatus) => {
    switch (status) {
      case "rejected":
        return ts.actions.resubmit;
      case "expired":
        return ts.actions.updateExpired;
      case "pending":
      case "verified":
        return null;
      default:
        return ts.actions.addProof;
    }
  };

  const openLockedUpload = (type: SkillDocumentType) => {
    setCertifySkill(null);
    setUploadSkill(null);
    setUploadLockedType(type);
  };

  /** T3.1 : la carte « Permis » affiche la catégorie du dernier document
   *  (ex : « Vérifié — Moto ») pour que le candidat sache quelle catégorie
   *  est validée et peut en ajouter une autre. */
  const permitCategorySuffix =
    permitDocument?.license_category != null
      ? tsp.licenseCategoryBadge.replace(
          "{cat}",
          tsp.licenseCategories[permitDocument.license_category],
        )
      : "";

  /** T3.1 : si la compétence de conduite n'est pas couverte par un permis
   *  vérifié de la bonne catégorie, le chip est verrouillé avec un hint. */
  const chipLockedHint = (name: string): string | undefined => {
    if (addedNames.has(name)) return undefined;
    if (
      !licenseDocCovers(
        name,
        permitDocument?.status ?? "",
        permitDocument?.license_category ?? null,
      )
    ) {
      return tsp.licenseRequiredError.replace("{skill}", name);
    }
    return undefined;
  };

  /** Carte document général (CV / permis) — statut + ajouter + supprimer. */
  const docCard = (
    doc: DocumentRow | null,
    title: string,
    hint: string,
    addLabel: string,
    type: SkillDocumentType,
    Icon: React.ElementType,
    badgeSuffix = "",
  ) => (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#7C3AED]" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{hint}</p>
          {doc && (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {statusBadge(doc.status)}
              {badgeSuffix && (
                <span className="text-sm text-muted-foreground">
                  {badgeSuffix}
                </span>
              )}
              {(doc.status === "pending" || doc.status === "rejected") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-red-600 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                  onClick={() => setDeletingDoc(doc.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {ts.actions.delete}
                </Button>
              )}
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openLockedUpload(type)}
        >
          <Plus className="mr-1 h-4 w-4" />
          {addLabel}
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6 px-4 pb-24 pt-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="rounded-full p-2 hover:bg-muted"
            aria-label={tsp.title}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">{tsp.title}</h1>
            <p className="text-sm text-muted-foreground">{tsp.subtitle}</p>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        {/* CV + permis — documents généraux, au-dessus de la liste */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          {docCard(
            cvDocument,
            ts.cvCardTitle,
            ts.cvCardHint,
            ts.addCv,
            "cv",
            FileText,
          )}
          {docCard(
            permitDocument,
            tsp.drivingLicenseTitle,
            tsp.drivingLicenseHint,
            tsp.addDrivingLicense,
            "permis_conduire",
            Car,
            permitCategorySuffix,
          )}
        </motion.div>

        {/* Mes compétences */}
        <div className="space-y-2">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
            {ts.skillsSectionTitle}
          </h2>
          {skills.length === 0 ? (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                {tsp.noSkills}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="divide-y divide-border p-0">
                {skills.map((skill) => {
                  const docs = documentsBySkill.get(skill.id) ?? [];
                  const latest = docs[0];
                  const status = (skill.verification_status ||
                    "unverified") as SkillVerificationStatus;
                  const actionLabel = skillProofAction(status);

                  return (
                    <div key={skill.id} className="space-y-2 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 font-medium">
                            <span className="truncate">{skill.skill_name}</span>
                            {status === "verified" && (
                              <BadgeCheck
                                className="h-4 w-4 shrink-0 text-emerald-600"
                                aria-label={ts.status.verified}
                              />
                            )}
                          </p>
                          {statusBadge(status)}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {actionLabel && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setCertifySkill(null);
                                setUploadSkill(skill);
                                setUploadLockedType(null);
                              }}
                            >
                              {actionLabel}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                            aria-label={tsp.deleteSkill}
                            onClick={() => setDeletingSkill(skill)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {status === "rejected" && latest?.rejection_reason && (
                        <p className="text-sm text-red-600">
                          {ts.rejectionReasonLabel} : {latest.rejection_reason}
                        </p>
                      )}
                      {status === "expired" && (
                        <p className="text-sm text-orange-600">
                          {ts.expiredNotice}
                        </p>
                      )}
                      {latest &&
                        (latest.status === "pending" ||
                          latest.status === "rejected") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-red-600 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                            onClick={() => setDeletingDoc(latest.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {ts.actions.delete}
                          </Button>
                        )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Ajouter — recherche + catalogue (T3) */}
        <div className="space-y-2">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
            {tsp.addSection}
          </h2>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tsp.searchPlaceholder}
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm"
            />
          </div>

          {query.trim() ? (
            match.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                  {tsp.noSearch}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="flex flex-wrap gap-2 p-4">
                  {match.map((s) => (
                    <SkillChip
                      key={s.name}
                      name={s.name}
                      added={addedNames.has(s.name)}
                      busy={busy}
                      locked={chipLockedHint(s.name)}
                      onAdd={() => addSkill(s.name)}
                      onRemove={() => {
                        const found = skills.find(
                          (sk) => sk.skill_name === s.name,
                        );
                        if (found) setDeletingSkill(found);
                      }}
                    />
                  ))}
                </CardContent>
              </Card>
            )
          ) : (
            <div className="space-y-3">
              {SKILL_CATALOG.map((group) => (
                <Card key={group.key}>
                  <CardContent className="space-y-2 p-4">
                    <p className="text-sm font-medium">
                      {tsp.catalog[group.key]}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {group.skills.map((name) => (
                        <SkillChip
                          key={name}
                          name={name}
                          added={addedNames.has(name)}
                          busy={busy}
                          locked={chipLockedHint(name)}
                          onAdd={() => addSkill(name)}
                          onRemove={() => {
                            const found = skills.find(
                              (sk) => sk.skill_name === name,
                            );
                            if (found) setDeletingSkill(found);
                          }}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {orphanSkills.length > 0 && (
                <Card>
                  <CardContent className="space-y-2 p-4">
                    <p className="text-sm font-medium">{tsp.otherSkills}</p>
                    <div className="flex flex-wrap gap-2">
                      {orphanSkills.map((s) => (
                        <SkillChip
                          key={s.id}
                          name={s.skill_name}
                          added
                          busy={busy}
                          onAdd={() => {}}
                          onRemove={() => setDeletingSkill(s)}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Certifier maintenant (après ajout) */}
      {certifySkill && (
        <Modal
          open
          onClose={() => setCertifySkill(null)}
          title={tsp.confirmTitle}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {tsp.confirmBody.replace("{skill}", certifySkill.skill_name)}
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setCertifySkill(null)}
              >
                {tsp.confirmLater}
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setUploadSkill(certifySkill);
                  setUploadLockedType(null);
                  setCertifySkill(null);
                }}
              >
                {tsp.confirmNow}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Upload justificatif (T0) */}
      {(uploadSkill || uploadLockedType) && (
        <UploadModal
          skills={skills}
          initialSkillId={uploadSkill?.id ?? null}
          lockedType={uploadLockedType}
          onClosed={() => {
            setUploadSkill(null);
            setUploadLockedType(null);
          }}
          onUploaded={refresh}
        />
      )}

      {/* Suppression document (T0) */}
      {deletingDoc !== null && (
        <Modal
          open
          onClose={() => {
            setDeletingDoc(null);
            setError("");
          }}
          title={ts.delete}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{ts.deleteConfirm}</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDeletingDoc(null);
                  setError("");
                }}
              >
                {ts.form.cancel}
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={deleteDocument}
              >
                {busy ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {ts.actions.delete}
                  </>
                )}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Suppression skill (T3) */}
      {deletingSkill && (
        <Modal
          open
          onClose={() => {
            setDeletingSkill(null);
            setError("");
          }}
          title={tsp.deleteSkill}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {tsp.deleteSkillConfirm.replace(
                "{skill}",
                deletingSkill.skill_name,
              )}
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDeletingSkill(null);
                  setError("");
                }}
              >
                {ts.form.cancel}
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => removeSkill(deletingSkill)}
              >
                {busy ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {ts.actions.delete}
                  </>
                )}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

/** Chip de compétence du catalogue : inactive = ajouter, active = retirer.
 *  T3.1 : `locked` = un permis vérifié de la bonne catégorie est requis
 *  (pas encore satisfaisant) ; le chip est désactivé avec un hint. */
function SkillChip({
  name,
  added,
  busy,
  onAdd,
  onRemove,
  locked,
}: {
  name: string;
  added: boolean;
  busy: boolean;
  onAdd: () => void;
  onRemove: () => void;
  /** T3.1 : le blocage permis vérifié (message affiché dans le hint). */
  locked?: string;
}) {
  const isDisabled = busy || (locked !== undefined && !added);
  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={added ? onRemove : onAdd}
      aria-pressed={added}
      title={!added && locked ? locked : undefined}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-colors ${
        added
          ? "border-primary bg-primary text-primary-foreground"
          : locked
            ? "cursor-not-allowed border-input bg-muted/40 text-muted-foreground opacity-60"
            : "border-input bg-background hover:border-primary/50"
      }`}
    >
      <span className="max-w-64 truncate">{name}</span>
      {added ? (
        <Trash2 className="h-3.5 w-3.5 shrink-0 opacity-80" />
      ) : locked ? (
        <AlertCircle className="h-3.5 w-3.5 shrink-0 opacity-80" />
      ) : (
        <Plus className="h-3.5 w-3.5 shrink-0 opacity-60" />
      )}
    </button>
  );
}

/**
 * Modal d'upload de justificatif (T0). `lockedType` verrouille le type
 * (CV, permis) ; `initialSkillId` présélectionne la skill liée. Le CV et le
 * permis sont des documents « généraux » (pas de rattachement à une skill) ;
 * les autres types exigent au moins une skill (contrainte Zod serveur).
 */
function UploadModal({
  skills,
  initialSkillId,
  lockedType,
  onClosed,
  onUploaded,
}: {
  skills: SkillRow[];
  initialSkillId: string | null;
  lockedType: SkillDocumentType | null;
  onClosed: () => void;
  onUploaded: () => void;
}) {
  const { t } = useI18n();
  const ts = t.profile.skillDocuments;
  const tf = ts.form;

  const [documentType, setDocumentType] = React.useState<SkillDocumentType>(
    lockedType ?? "diplome",
  );
  const [title, setTitle] = React.useState("");
  const [issuingOrganization, setIssuingOrganization] = React.useState("");
  const [issuedAt, setIssuedAt] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [licenseCategory, setLicenseCategory] = React.useState<
    LicenseCategoryT31 | ""
  >("");
  const [selectedSkillIds, setSelectedSkillIds] = React.useState<string[]>(
    initialSkillId ? [initialSkillId] : [],
  );
  const [file, setFile] = React.useState<File | null>(null);
  const [confirmAccurate, setConfirmAccurate] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  const isGeneral = GENERAL_DOC_TYPES.includes(documentType);
  const isPermit = documentType === "permis_conduire";
  // T3.1 : le permis a bien une date d'expiration (seul document « général »
  // qui en a une — le CV non). On collecte donc `expires_at` pour le permis
  // comme pour les documents rattachés à une compétence.
  const showExpires = !isGeneral || isPermit;

  const toggleSkill = (id: string) => {
    setSelectedSkillIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setError("");
    if (selected && selected.size > MAX_SIZE_BYTES) {
      setError(ts.tooLarge);
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const handleSubmit = async () => {
    setError("");
    if (!title.trim()) {
      setError(tf.titleRequired);
      return;
    }
    if (!file) {
      setError(ts.unsupportedType);
      return;
    }
    if (!isGeneral && selectedSkillIds.length === 0) {
      setError(ts.selectSkillRequired);
      return;
    }
    // T3.1 : la catégorie du permis est obligatoire quand document_type = permis_conduire
    if (isPermit && licenseCategory === "") {
      setError(t.profile.skills.licenseCategoryRequired);
      return;
    }
    if (!confirmAccurate) {
      setError(ts.uploadError);
      return;
    }

    setSubmitting(true);
    try {
      const body = new FormData();
      body.append("document_type", documentType);
      body.append("title", title.trim());
      body.append("issuing_organization", issuingOrganization.trim());
      body.append("issued_at", issuedAt);
      body.append("expires_at", expiresAt);
      body.append(
        "skill_ids",
        JSON.stringify(isGeneral ? [] : selectedSkillIds),
      );
      body.append("confirm_accurate", "true");
      if (isPermit && licenseCategory) {
        body.append("license_category", licenseCategory);
      }
      body.append("file", file);

      const res = await fetch("/api/profile/skill-documents", {
        method: "POST",
        body,
      });
      if (!res.ok) throw new Error("upload failed");
      onUploaded();
      onClosed();
    } catch {
      setError(ts.uploadError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClosed} title={tf.title}>
      <div className="space-y-4">
        {!lockedType && (
          <div>
            <label className="mb-1 block text-sm font-medium">
              {tf.documentType}
            </label>
            <select
              className="w-full rounded-lg border border-input bg-background p-2"
              value={documentType}
              onChange={(e) =>
                setDocumentType(e.target.value as SkillDocumentType)
              }
            >
              {SKILL_DOCUMENT_TYPES.filter((type) => type !== "cv").map(
                (type) => (
                  <option key={type} value={type}>
                    {ts.documentTypes[type]}
                  </option>
                ),
              )}
            </select>
          </div>
        )}

        {isPermit && (
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t.profile.skills.licenseCategoryLabel}
            </label>
            <select
              className="w-full rounded-lg border border-input bg-background p-2"
              value={licenseCategory}
              onChange={(e) =>
                setLicenseCategory(e.target.value as LicenseCategoryT31)
              }
            >
              <option value="" disabled>
                {t.profile.skills.licenseCategoryPlaceholder}
              </option>
              {LICENSE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {t.profile.skills.licenseCategories[cat]}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">
            {tf.documentTitle}
          </label>
          <input
            className="w-full rounded-lg border border-input bg-background p-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tf.documentTitlePlaceholder}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            {isGeneral
              ? tf.issuingOrganizationOptional
              : tf.issuingOrganization}
          </label>
          <input
            className="w-full rounded-lg border border-input bg-background p-2"
            value={issuingOrganization}
            onChange={(e) => setIssuingOrganization(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">
              {tf.issuedAt}
            </label>
            <input
              type="date"
              className="w-full rounded-lg border border-input bg-background p-2"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
            />
          </div>
          {showExpires && (
            <div>
              <label className="mb-1 block text-sm font-medium">
                {tf.expiresAt}
              </label>
              <input
                type="date"
                className="w-full rounded-lg border border-input bg-background p-2"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          )}
        </div>

        {!isGeneral && (
          <div>
            <label className="mb-1 block text-sm font-medium">
              {tf.linkedSkills}
            </label>
            <div className="flex flex-wrap gap-2">
              {skills.map((skill) => (
                <button
                  type="button"
                  key={skill.id}
                  onClick={() => toggleSkill(skill.id)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    selectedSkillIds.includes(skill.id)
                      ? "border-[#7C3AED] bg-[#7C3AED]/10 text-[#7C3AED]"
                      : "border-input text-muted-foreground"
                  }`}
                >
                  {skill.skill_name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">{tf.file}</label>
          <input
            type="file"
            accept={ACCEPTED_MIME}
            onChange={handleFile}
            className="w-full text-sm"
          />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmAccurate}
            onChange={(e) => setConfirmAccurate(e.target.checked)}
            className="mt-1"
          />
          {tf.confirmAccurate}
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClosed} disabled={submitting}>
            {tf.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <LoadingSpinner size="sm" /> : tf.submit}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Bornes identiques au route handler T0 (5 Mo, mime détecté côté serveur).
const ACCEPTED_MIME = "application/pdf,image/jpeg,image/png,image/webp";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
