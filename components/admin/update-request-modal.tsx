"use client";

/**
 * T8.5 — Modal « Demander une mise à jour de profil » (composant partage
 * entre la page centralisée `/admin/update-requests` et le profil candidat
 * `/admin/candidates/[id]`).
 *
 * Le modèle T2 (SRS §5.1.1) : l'ADMIN déverrouille les champs vérifiés en
 * créant une demande `profile_update_requests` (`status='pending'`, groupe
 * `identity` et/ou `cni_documents`, motif ≥ 5) ; le candidat la reçoit en
 * Tâche + notification puis EXECUTE la mise à jour via sa page edit
 * existante — la demande se clôture automatiquement en `done` côté serveur
 * (`completePendingRequests`).
 *
 * Recherche de candidat : SWR sur `GET /api/admin/candidates?q=` (lecture
 * service_role existante T8.4a). Dans le contexte « profil candidat »,
 * le candidat est déjà connu (`initialCandidate`) : la recherche est
 * masquée et le bloc candidat n'affiche que sa ligne.
 */
import * as React from "react";
import useSWR from "swr";
import { Search, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";

const FIELD_GROUPS = ["identity", "cni_documents"] as const;
type FieldGroup = (typeof FIELD_GROUPS)[number];

interface UpdateRequestCandidate {
  id: string;
  email: string | null;
  profile_id: string | null;
  first_name: string | null;
  last_name: string | null;
}

interface UpdateRequestModalProps {
  onClose: () => void;
  /** `canModerate` du parent (admin_ops/admin_founder) — sinon le modal
   *  s'ouvre en lecture seule (admin_support). */
  canModerate: boolean;
  /** Candidat pré-sélectionné (profil candidat) : la recherche est
   *  désactivée. */
  initialCandidate?: UpdateRequestCandidate | null;
  /** Rafraîchi après création (le parent re-charge sa liste). */
  onCreated?: () => void;
}

function candidateLabel(c: UpdateRequestCandidate): string {
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email || "—";
}

async function fetchCandidates(
  q: string,
): Promise<{ candidates: UpdateRequestCandidate[] }> {
  const r = await fetch(`/api/admin/candidates?q=${encodeURIComponent(q)}`, {
    cache: "no-store",
  });
  const json: { candidates?: UpdateRequestCandidate[] } = await r.json();
  return { candidates: json.candidates ?? [] };
}

/** Les candidates utilisables : profil candidat existant (le `requested_by`
 *  de la demande pointe sur un profil, pas un compte sans profil). */
function usable(c: UpdateRequestCandidate): boolean {
  return !!c.profile_id;
}

export function UpdateRequestModal({
  onClose,
  canModerate,
  initialCandidate,
  onCreated,
}: UpdateRequestModalProps) {
  const { t } = useI18n();
  const pinned = !!initialCandidate?.profile_id;

  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialCandidate?.profile_id ?? null,
  );
  const [fields, setFields] = React.useState<FieldGroup[]>([]);
  const [reason, setReason] = React.useState("");
  const [fieldsError, setFieldsError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState("");

  // Recherche SWR : uniquement si le candidat n'est pas pré-sélectionné.
  const swrKey = pinned ? null : `/api/admin/candidates?q=${query}`;
  const { data, isLoading } = useSWR(
    swrKey,
    (k: string) => fetchCandidates(k),
    { revalidateOnFocus: false, dedupingInterval: 1000 },
  );

  // Le candidat surligné = la sélection (profil), sinon la 1re ligne utilisable.
  const highlighted: UpdateRequestCandidate | null = React.useMemo(() => {
    // Mode épinglé : le candidat est connu, pas besoin de liste SWR.
    if (pinned) return initialCandidate ?? null;
    const list = (data?.candidates ?? []).filter(usable);
    if (selectedId) {
      const found = list.find((c) => c.profile_id === selectedId);
      if (found) return found;
    }
    return list[0] ?? null;
  }, [pinned, initialCandidate, data, selectedId]);

  // Candidat effectif pour le submit : épinglé ou dérivé du résultat SWR.
  const selected = highlighted;

  const toggleField = (g: FieldGroup) => {
    setFields((prev) =>
      prev.includes(g) ? prev.filter((f) => f !== g) : [...prev, g],
    );
    setFieldsError("");
  };

  const submit = async () => {
    if (!canModerate) return;
    if (!selected?.profile_id) return;
    if (fields.length === 0) {
      setFieldsError(t.admin.updateRequests.fieldsLabelHint);
      return;
    }
    if (reason.trim().length < 5) {
      setFieldsError(t.admin.updateRequests.reasonRequired);
      return;
    }
    setSubmitting(true);
    setResult("");
    try {
      const r = await fetch("/api/admin/profile-update-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate_id: selected.profile_id,
          fields,
          reason: reason.trim(),
        }),
      });
      const json: { ok?: boolean } = await r.json();
      if (!r.ok || !json.ok) throw new Error("create failed");
      setResult(t.admin.updateRequests.created);
      // Ré-initialisation du formulaire — le résultat « créée » reste affiché
      // jusqu'à fermeture du modal (l'admin voit la confirmation).
      setFields([]);
      setReason("");
      onCreated?.();
    } catch {
      setResult(t.admin.updateRequests.actionFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const fieldLabel = (g: FieldGroup) =>
    g === "identity"
      ? t.admin.updateRequests.fieldIdentity
      : t.admin.updateRequests.fieldCniDocuments;

  return (
    <Modal open onClose={onClose} title={t.admin.updateRequests.createTitle}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t.admin.updateRequests.createHint}
        </p>

        {/* Candidat : fixe si profil candidat, sinon recherche (SWR). */}
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            {t.admin.updateRequests.candidateLabel}
          </p>
          {pinned && selected ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="font-medium">{candidateLabel(selected)}</p>
              {selected.email && (
                <p className="truncate text-sm text-muted-foreground">
                  {selected.email}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  className="w-full rounded-lg border border-input bg-background p-2 pl-8 text-sm"
                  placeholder={t.admin.updateRequests.searchPlaceholder}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-input">
                {isLoading ? (
                  <div className="p-3">
                    <LoadingSpinner size="sm" />
                  </div>
                ) : (data?.candidates ?? []).filter(usable).length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    {t.admin.updateRequests.noCandidate}
                  </p>
                ) : (
                  (data?.candidates ?? []).filter(usable).map((c) => (
                    <button
                      key={c.profile_id}
                      type="button"
                      onClick={() => setSelectedId(c.profile_id ?? null)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted ${
                        highlighted?.profile_id === c.profile_id
                          ? "bg-[#7C3AED]/5 font-medium text-[#7C3AED]"
                          : ""
                      }`}
                    >
                      <span>{candidateLabel(c)}</span>
                      <span className="truncate text-muted-foreground">
                        {c.email}
                      </span>
                    </button>
                  ))
                )}
              </div>
              {highlighted && (
                <p className="text-xs text-muted-foreground">
                  {t.admin.candidates.viewProfile} :{" "}
                  <a
                    href={`/admin/candidates/${highlighted.id}`}
                    className="text-[#7C3AED] underline"
                  >
                    {candidateLabel(highlighted)}
                  </a>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Groupes de champs à déverrouiller. */}
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            {t.admin.updateRequests.fieldsLabel}
          </p>
          <div className="space-y-1.5">
            {FIELD_GROUPS.map((g) => (
              <label
                key={g}
                className="flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm has-[:checked]:border-[#7C3AED] has-[:checked]:bg-[#7C3AED]/5"
              >
                <input
                  type="checkbox"
                  className="accent-[#7C3AED]"
                  checked={fields.includes(g)}
                  onChange={() => toggleField(g)}
                  disabled={!canModerate}
                />
                {fieldLabel(g)}
              </label>
            ))}
          </div>
        </div>

        {/* Motif. */}
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            {t.admin.updateRequests.reasonLabel}
          </p>
          <textarea
            className="w-full rounded-lg border border-input bg-background p-2 text-sm"
            placeholder={t.admin.updateRequests.reasonPlaceholder}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            disabled={!canModerate}
          />
        </div>

        {fieldsError && <p className="text-sm text-amber-600">{fieldsError}</p>}
        {result && (
          <p
            className={`flex items-center gap-1 text-sm ${
              result === t.admin.updateRequests.created
                ? "text-emerald-600"
                : "text-red-600"
            }`}
          >
            {result === t.admin.updateRequests.created && (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {result}
          </p>
        )}

        {canModerate ? (
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              {t.admin.updateRequests.cancel}
            </Button>
            <Button
              disabled={submitting || !highlighted?.profile_id}
              onClick={submit}
            >
              {submitting ? (
                <LoadingSpinner size="sm" />
              ) : (
                t.admin.updateRequests.submit
              )}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t.admin.updateRequests.readOnly}
          </p>
        )}
      </div>
    </Modal>
  );
}
