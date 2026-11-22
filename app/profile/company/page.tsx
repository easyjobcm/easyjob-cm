import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  computeCompanyCriteria,
  computeCompletion,
} from "@/lib/utils/profile-completion";
import { normalizeCompanyPlan } from "@/lib/utils/company-plan";
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
      "id, company_name, sector, description, logo_url, city, address, rccm, niu, contact_name, contact_phone",
    )
    .eq("user_id", user.id)
    .single();

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

  // ABO-07 : plan effectif calculé en base (company_effective_plan, heure du
  // serveur), seule source ; aucune lecture de repli (ancienne colonne,
  // table subscriptions). Sans réponse lisible : Free, jamais un droit
  // supposé.
  const { data: accountRaw } = await supabase.rpc("my_account_state");
  const accountState = accountStateSchema.safeParse(accountRaw);
  const company = accountState.success ? accountState.data.company : null;
  const plan = normalizeCompanyPlan(company?.effective_plan);

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
        premiumUntil={company?.expires_at ?? null}
        premiumStartedAt={company?.premium_started_at ?? null}
        activeJobsCount={activeJobsCount}
        verification={verification}
      />
    </>
  );
}
