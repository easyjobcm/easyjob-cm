import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  computeCompanyCriteria,
  computeCompletion,
} from "@/lib/utils/profile-completion";
import { normalizeCompanyPlan } from "@/lib/utils/profile-status";
import { accountStateSchema } from "@/lib/realtime/signals";
import { CompanyProfileClient } from "./company-profile-client";
import { LiveRefresh } from "@/lib/realtime/provider";
import { loginHref } from "@/lib/auth/safe-redirect";
import { parseMyCompanyVerification } from "@/lib/utils/company-verification";

export default async function CompanyProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect(loginHref("/profile/company"));
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role, phone, email")
    .eq("id", user.id)
    .single();

  if (
    !userData ||
    (userData.role !== "company" && userData.role !== "company_premium")
  ) {
    redirect("/profile");
  }

  const { data: companyProfile } = await supabase
    .from("company_profiles")
    .select(
      "id, company_name, sector, description, logo_url, city, address, rccm, niu, contact_name, contact_phone, subscription_tier, subscription_plan, subscription_expires_at, trial_ends_at",
    )
    .eq("user_id", user.id)
    .single();

  // Abonnement actif pour les détails de plan
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan, expires_at, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Comptage offres actives (utilisé pour le compteur côté standard)
  let activeJobsCount = 0;
  if (companyProfile?.id) {
    const { count } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyProfile.id)
      .in("status", ["active", "pending_review"]);
    activeJobsCount = count ?? 0;
  }

  // SRS v1.2 : source de vérité = company_profiles.subscription_plan
  const planRaw =
    companyProfile?.subscription_plan ??
    subscription?.plan ??
    companyProfile?.subscription_tier ??
    "free";
  // Lot 7d : échéance appliquée (même règle que company_effective_plan).
  const subscriptionExpiresAt =
    companyProfile?.subscription_expires_at ?? subscription?.expires_at ?? null;
  // Plan effectif calculé en base (heure du serveur), comme update_job.
  const { data: accountRaw } = await supabase.rpc("my_account_state");
  const accountState = accountStateSchema.safeParse(accountRaw);
  const plan =
    accountState.success && accountState.data.company
      ? normalizeCompanyPlan(accountState.data.company.effective_plan)
      : normalizeCompanyPlan(planRaw);

  // SRS v1.2 : l'essai est consommé dès que trial_ends_at est défini en DB
  const hasUsedTrial = !!companyProfile?.trial_ends_at;

  // Lot 11 : état des contrôles et pièces manquantes (jamais la note interne).
  const { data: verificationRaw } = await supabase.rpc(
    "my_company_verification",
  );
  const verification = parseMyCompanyVerification(verificationRaw);

  const criteria = computeCompanyCriteria(companyProfile ?? {});
  const completionPct = computeCompletion(criteria);

  return (
    <>
      <LiveRefresh
        keys={["profile", "subscription", "account", "jobs", "reputation"]}
      />
      <CompanyProfileClient
        user={{
          role: userData.role,
          phone: userData.phone ?? null,
          email: userData.email ?? null,
        }}
        profile={
          companyProfile
            ? {
                company_name: companyProfile.company_name,
                city: companyProfile.city,
                sector: companyProfile.sector,
                logo_url: companyProfile.logo_url,
              }
            : null
        }
        completionPct={completionPct}
        criteria={criteria}
        plan={plan}
        activeJobsCount={activeJobsCount}
        subscriptionExpiresAt={subscriptionExpiresAt}
        hasUsedTrial={hasUsedTrial}
        verification={verification}
      />
    </>
  );
}
