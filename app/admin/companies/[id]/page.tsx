import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/auth/admin-page";
import { CompanyReputationAdminClient } from "./company-reputation-admin-client";
import { CompanyVerificationAdminPanel } from "./company-verification-admin-client";

/**
 * Fiche entreprise (/admin/companies/[id], lot 9c) : identité courte et
 * réputation EasyJob (avis complets, impact, contestations). Lecture pour
 * les 3 grades ; décisions de contestation pour admin_ops et admin_founder
 * (revérifiées par la route et la RPC). `id` = company_profiles.id.
 * Lot 11 : revue du dossier (RCCM) en tête de fiche, lue et décidée par
 * `/api/admin/companies/[id]/verification` (grade revérifié par la route
 * et par la RPC `admin_review_company`).
 */
export default async function AdminCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  await requireAdminPage(`/admin/companies/${id}`);

  // Lecture en clé service : company_profiles n'a pas de policy admin.
  const admin = createAdminClient();
  const { data: company } = await admin
    .from("company_profiles")
    .select("id, company_name, city, sector, verification_status")
    .eq("id", id)
    .maybeSingle();
  if (!company) notFound();

  return (
    <CompanyReputationAdminClient
      company={{
        id: company.id,
        name: company.company_name,
        city: company.city,
        sector: company.sector,
        verification: company.verification_status,
      }}
      backLink={
        <Link href="/admin/companies" className="text-sm text-primary">
          ←
        </Link>
      }
    >
      <CompanyVerificationAdminPanel companyId={company.id} />
    </CompanyReputationAdminClient>
  );
}
