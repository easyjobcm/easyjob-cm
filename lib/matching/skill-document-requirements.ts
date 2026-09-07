import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface CandidateIdentityFields {
  cni_verified: string | null;
  cni_expires_at: string | null;
  driving_license_verified: boolean | null;
  driving_license_expires_at: string | null;
}

const SIMPLE_DOC_LABELS: Record<string, string> = {
  casier_judiciaire: "casier judiciaire",
  diplome: "diplôme",
  certificat: "certificat",
  attestation_formation: "attestation de formation",
  attestation_travail: "attestation de travail",
  autre: "document",
};

function isExpired(expiresAt: string | null) {
  return !!expiresAt && new Date(expiresAt) < new Date();
}

/**
 * Vérifie côté serveur qu'un candidat remplit les exigences documentaires
 * d'une offre (SRS §6.14, §5.4) — appelée avant toute création de candidature.
 * Le masquage du bouton côté frontend ne suffit jamais : cette fonction est
 * la seule source de vérité pour bloquer/autoriser une candidature.
 */
export async function checkJobDocumentRequirements(
  supabase: SupabaseServerClient,
  candidateId: string,
  job: { id: string; required_documents: string[] | null },
  candidateProfile: CandidateIdentityFields,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const requiredDocs = job.required_documents ?? [];

  const { data: requiredSkillDocs } = await supabase
    .from("job_required_skill_documents")
    .select("skill_name, document_type")
    .eq("job_id", job.id);

  if (requiredDocs.length === 0 && !requiredSkillDocs?.length) {
    return { ok: true };
  }

  const { data: candidateDocs } = await supabase
    .from("candidate_documents")
    .select("document_type, status, expires_at")
    .eq("candidate_id", candidateId);

  const bestDocState = (
    docs: { status: string; expires_at: string | null }[],
  ): "ok" | "expired" | "pending" | "rejected" | "missing" => {
    if (docs.some((d) => d.status === "verified" && !isExpired(d.expires_at)))
      return "ok";
    if (docs.some((d) => d.status === "verified" && isExpired(d.expires_at)))
      return "expired";
    if (docs.some((d) => d.status === "pending")) return "pending";
    if (docs.some((d) => d.status === "rejected")) return "rejected";
    return "missing";
  };

  const messageFor = (
    state: "expired" | "pending" | "rejected" | "missing",
    missingLabel: string,
  ) => {
    switch (state) {
      case "pending":
        return "Votre justificatif est encore en cours de vérification.";
      case "rejected":
        return "Votre justificatif a été refusé. Consultez votre profil pour le remplacer.";
      case "expired":
        return "Votre justificatif a expiré. Mettez-le à jour pour postuler.";
      default:
        return missingLabel;
    }
  };

  for (const docType of requiredDocs) {
    if (docType === "cni") {
      if (
        candidateProfile.cni_verified === "verified" &&
        !isExpired(candidateProfile.cni_expires_at)
      ) {
        continue;
      }
      if (isExpired(candidateProfile.cni_expires_at)) {
        return { ok: false, error: messageFor("expired", "") };
      }
      if (candidateProfile.cni_verified === "pending") {
        return { ok: false, error: messageFor("pending", "") };
      }
      if (candidateProfile.cni_verified === "rejected") {
        return { ok: false, error: messageFor("rejected", "") };
      }
      return {
        ok: false,
        error: "Cette offre exige une CNI vérifiée pour postuler.",
      };
    }

    if (docType === "driving_license") {
      if (
        candidateProfile.driving_license_verified &&
        !isExpired(candidateProfile.driving_license_expires_at)
      ) {
        continue;
      }
      if (isExpired(candidateProfile.driving_license_expires_at)) {
        return { ok: false, error: messageFor("expired", "") };
      }
      return {
        ok: false,
        error: "Cette offre exige un permis de conduire valide pour postuler.",
      };
    }

    const label = SIMPLE_DOC_LABELS[docType] ?? docType;
    const matches = (candidateDocs ?? []).filter(
      (d) => d.document_type === docType,
    );
    const state = bestDocState(matches);
    if (state === "ok") continue;
    return {
      ok: false,
      error: messageFor(
        state,
        `Cette offre exige un ${label} valide pour postuler.`,
      ),
    };
  }

  if (requiredSkillDocs && requiredSkillDocs.length > 0) {
    const { data: candidateSkills } = await supabase
      .from("candidate_skills")
      .select("id, skill_name")
      .eq("candidate_id", candidateId);

    for (const req of requiredSkillDocs) {
      const skill = (candidateSkills ?? []).find(
        (s) => s.skill_name.toLowerCase() === req.skill_name.toLowerCase(),
      );
      const missingLabel = `Cette offre exige un diplôme ou certificat valide pour la compétence « ${req.skill_name} ».`;

      if (!skill) {
        return { ok: false, error: missingLabel };
      }

      const { data: links } = await supabase
        .from("candidate_skill_documents")
        .select("candidate_documents ( document_type, status, expires_at )")
        .eq("candidate_skill_id", skill.id);

      type LinkedDoc = {
        document_type: string;
        status: string;
        expires_at: string | null;
      };
      const docs = (links ?? [])
        .map((l) => l.candidate_documents as unknown as LinkedDoc | null)
        .filter((d): d is LinkedDoc => !!d)
        .filter((d) => d.document_type === req.document_type);

      const state = bestDocState(docs);
      if (state === "ok") continue;
      return { ok: false, error: messageFor(state, missingLabel) };
    }
  }

  return { ok: true };
}
