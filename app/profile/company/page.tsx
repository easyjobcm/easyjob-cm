import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  computeCompanyCriteria,
  computeCompletion,
} from "@/lib/utils/profile-completion";
import { normalizeCompanyPlan } from "@/lib/utils/profile-status";
import { CompanyProfileClient } from "./company-profile-client";

export default async function CompanyProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login?redirect=/profile/company");
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
      "id, company_name, sector, description, logo_url, city, address, rccm, niu, contact_name, contact_phone, subscription_tier, subscription_expires_at",
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
      .in("status", ["published", "active", "pending_moderation"]);
    activeJobsCount = count ?? 0;
  }

  const planRaw =
    subscription?.plan ?? companyProfile?.subscription_tier ?? "free";
  const plan = normalizeCompanyPlan(planRaw);
  const subscriptionExpiresAt =
    subscription?.expires_at ?? companyProfile?.subscription_expires_at ?? null;

  const criteria = computeCompanyCriteria(companyProfile ?? {});
  const completionPct = computeCompletion(criteria);

  return (
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
    />
  );
}
