import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * T8.4b — API admin « Profil candidat » (page /admin/candidates/[id]).
 *
 * GET : profil complet d'UN candidat, en lecture seule pour les 3 grades.
 *       - `candidate_profiles` + `users` → identité, contact, statuts ;
 *       - `candidate_skills` (statuts de vérification) ;
 *       - `candidate_documents` (statuts, jamais de chemin raw) ;
 *       - `missions` (historique) — titres d'offres + noms d'entreprises
 *         résolus par des requêtes séparées + merge côté serveur (pattern
 *         maison T8.4a : PostgREST refuse/embrouille les embeds profonds,
 *         on fait du 1:N en JS sur le lot).
 *       Lecture en `service_role` (createAdminClient) : `users` et
 *       `missions`/`jobs`/`company_profiles` n'ont pas de policy SELECT
 *       admin — la session admin ne verrait que 0 ligne. Jamais de chemin
 *       de fichier renvoyé (photo en booléen ; l'URL signée du profil
 *       passe par /api/admin/profiles/[profileId]/photo-url).
 */

type RouteContext = { params: Promise<{ id: string }> };

function isAdminRole(role: string | null | undefined): boolean {
  return (
    role === "admin_support" || role === "admin_ops" || role === "admin_founder"
  );
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!isAdminRole(userData?.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("candidate_profiles")
    .select(
      `id, user_id, first_name, last_name, gender, date_of_birth,
       profile_photo_url, address, city, quartier, bio,
       cni_number, cni_verified, cni_expires_at, cni_rejection_reason,
       momo_provider, momo_number, momo_account_name, momo_verified,
       momo_reject_reason, momo_verified_at,
       total_missions, completed_missions, no_show_count,
       reliability_score, average_rating, sandbox_level,
       premium_until, onboarding_status,
       created_at, updated_at`,
    )
    .eq("user_id", id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: userRow } = await admin
    .from("users")
    .select("id, email, phone, is_active, is_verified, role, locale")
    .eq("id", id)
    .maybeSingle();

  const { data: skills } = await admin
    .from("candidate_skills")
    .select("id, skill_name, skill_level, verification_status, created_at")
    .eq("candidate_id", profile.id)
    .order("created_at", { ascending: false });

  const { data: documents } = await admin
    .from("candidate_documents")
    .select(
      `id, document_type, title, issuing_organization, reference_number,
       issued_at, expires_at, license_category, status, rejection_reason,
       verified_at, created_at`,
    )
    .eq("candidate_id", profile.id)
    .order("created_at", { ascending: false });

  const { data: missionRows } = await admin
    .from("missions")
    .select(
      "id, job_id, status, scheduled_date, contract_type, payment_status, created_at",
    )
    .eq("candidate_id", id)
    .order("created_at", { ascending: false })
    .limit(100);

  // Titres d'offres + noms d'entreprises (requêtes séparées + merge).
  const jobIds = [
    ...new Set(
      (missionRows ?? [])
        .map((m) => m.job_id)
        .filter((v): v is string => typeof v === "string"),
    ),
  ];
  const jobsById = new Map<
    string,
    {
      id: string;
      title: string | null;
      city: string | null;
      company_id: string | null;
    }
  >();
  if (jobIds.length > 0) {
    const { data: jobRows } = await admin
      .from("jobs")
      .select("id, title, city, company_id")
      .in("id", jobIds);
    for (const j of (jobRows ?? []) as {
      id: string;
      title: string | null;
      city: string | null;
      company_id: string | null;
    }[]) {
      jobsById.set(j.id, j);
    }
  }
  const companyIds = [
    ...new Set(
      [...jobsById.values()]
        .map((j) => j.company_id)
        .filter((v): v is string => typeof v === "string"),
    ),
  ];
  const companyNameById = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companyRows } = await admin
      .from("company_profiles")
      .select("id, company_name")
      .in("id", companyIds);
    for (const c of (companyRows ?? []) as {
      id: string;
      company_name: string;
    }[]) {
      companyNameById.set(c.id, c.company_name);
    }
  }

  return NextResponse.json({
    candidate: {
      id: userRow?.id ?? id,
      email: userRow?.email ?? null,
      phone: userRow?.phone ?? null,
      is_active: userRow?.is_active ?? true,
      is_verified: userRow?.is_verified ?? false,
      role: userRow?.role ?? null,
      locale: userRow?.locale ?? null,
      profile_id: profile.id,
      has_photo: !!profile.profile_photo_url,
      identity: {
        first_name: profile.first_name ?? null,
        last_name: profile.last_name ?? null,
        gender: profile.gender ?? null,
        date_of_birth: profile.date_of_birth ?? null,
        bio: profile.bio ?? null,
      },
      location: {
        address: profile.address ?? null,
        city: profile.city ?? null,
        quartier: profile.quartier ?? null,
      },
      cni: {
        number: profile.cni_number ?? null,
        status: profile.cni_verified ?? null,
        expires_at: profile.cni_expires_at ?? null,
        rejection_reason: profile.cni_rejection_reason ?? null,
      },
      momo: {
        provider: profile.momo_provider ?? null,
        number: profile.momo_number ?? null,
        account_name: profile.momo_account_name ?? null,
        verified: profile.momo_verified ?? false,
        reject_reason: profile.momo_reject_reason ?? null,
        verified_at: profile.momo_verified_at ?? null,
      },
      stats: {
        total_missions: profile.total_missions ?? 0,
        completed_missions: profile.completed_missions ?? 0,
        no_show_count: profile.no_show_count ?? 0,
        reliability_score: profile.reliability_score ?? 0,
        average_rating: profile.average_rating ?? 0,
        sandbox_level: profile.sandbox_level ?? 0,
        premium_until: profile.premium_until ?? null,
        onboarding_status: profile.onboarding_status ?? null,
        created_at: profile.created_at ?? null,
        updated_at: profile.updated_at ?? null,
      },
    },
    skills: (skills ?? []).map((s) => ({
      id: s.id,
      skill_name: s.skill_name,
      skill_level: s.skill_level,
      verification_status: s.verification_status,
    })),
    documents: (documents ?? []).map((d) => ({
      id: d.id,
      document_type: d.document_type,
      title: d.title,
      issuing_organization: d.issuing_organization,
      reference_number: d.reference_number,
      issued_at: d.issued_at,
      expires_at: d.expires_at,
      license_category: d.license_category,
      status: d.status,
      rejection_reason: d.rejection_reason,
      verified_at: d.verified_at,
    })),
    missions: (missionRows ?? []).map((m) => {
      const job = m.job_id ? jobsById.get(m.job_id) : undefined;
      return {
        id: m.id,
        status: m.status,
        scheduled_date: m.scheduled_date,
        contract_type: m.contract_type,
        payment_status: m.payment_status,
        created_at: m.created_at,
        job_title: job?.title ?? null,
        job_city: job?.city ?? null,
        company_name:
          job?.company_id != null
            ? (companyNameById.get(job.company_id) ?? null)
            : null,
      };
    }),
  });
}
