import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LiveRefresh } from "@/lib/realtime/provider";
import { CompanyOnboardingClient } from "./onboarding-client";
import { parseMyCompanyVerification } from "@/lib/utils/company-verification";

export default async function CompanyOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
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
  // Lot 11 : état du dossier et motif d'une correction demandée.
  const { data: profile, error } = await supabase
    .from("company_profiles")
    .select(
      `company_name, sector, company_size, website, description, rccm, niu,
       documents_url, city, quartier, address, verification_status,
       verification_submitted_at, niu_document_path, representative_name,
       representative_title, representative_authority,
       representative_id_document_path, representative_mandate_path`,
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    throw new Error("company_profiles indisponible", { cause: error });
  }

  const { step } = await searchParams;
  const { data: verificationRaw } = await supabase.rpc(
    "my_company_verification",
  );

  // Les chemins des pièces ne sont pas transmis au navigateur : seulement
  // leur présence.
  const saved = profile
    ? {
        company_name: profile.company_name,
        sector: profile.sector,
        company_size: profile.company_size,
        website: profile.website,
        description: profile.description,
        rccm: profile.rccm,
        niu: profile.niu,
        city: profile.city,
        quartier: profile.quartier,
        address: profile.address,
        verification_status: profile.verification_status,
        verification_submitted_at: profile.verification_submitted_at,
        representative_name: profile.representative_name,
        representative_title: profile.representative_title,
        representative_authority: profile.representative_authority,
        documents: {
          rccm: (profile.documents_url ?? []).length > 0,
          niu: !!profile.niu_document_path,
          representative_id: !!profile.representative_id_document_path,
          mandate: !!profile.representative_mandate_path,
        },
      }
    : null;

  return (
    <>
      {/* Lot 11 : une décision admin s'affiche sans rechargement. */}
      <LiveRefresh keys={["profile", "account"]} />
      <CompanyOnboardingClient
        profile={saved}
        verification={parseMyCompanyVerification(verificationRaw)}
        initialStep={step === "documents" ? "documents" : "company"}
      />
    </>
  );
}
