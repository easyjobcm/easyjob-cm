import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  computeCompanyCriteria,
  computeCompletion,
} from "@/lib/utils/profile-completion";
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
    .select("*")
    .eq("user_id", user.id)
    .single();

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
              average_rating: companyProfile.average_rating,
              city: companyProfile.city,
              sector: companyProfile.sector,
              logo_url: companyProfile.logo_url,
            }
          : null
      }
      completionPct={completionPct}
      criteria={criteria}
      totalMissionsPosted={companyProfile?.total_missions_posted ?? 0}
    />
  );
}
