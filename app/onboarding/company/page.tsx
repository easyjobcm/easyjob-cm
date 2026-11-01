import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CompanyOnboardingClient } from "./onboarding-client";

export default async function CompanyOnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?next=/onboarding/company");
  }

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (
    !userRow ||
    (userRow.role !== "company" && userRow.role !== "company_premium")
  ) {
    redirect("/");
  }

  // Valeurs déjà enregistrées : la reprise ne repart pas d'un formulaire vide.
  const { data: profile, error } = await supabase
    .from("company_profiles")
    .select(
      `company_name, sector, company_size, website, description, rccm, niu,
       documents_url, city, quartier, address`,
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    throw new Error("company_profiles indisponible", { cause: error });
  }

  return <CompanyOnboardingClient profile={profile} />;
}
