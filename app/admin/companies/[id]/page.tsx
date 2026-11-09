import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { CompanyReputationAdminClient } from "./company-reputation-admin-client";

/**
 * Fiche entreprise (/admin/companies/[id], lot 9c) : identité courte et
 * réputation EasyJob (avis complets, impact, contestations). Lecture pour
 * les 3 grades ; décisions de contestation pour admin_ops et admin_founder
 * (revérifiées par la route et la RPC). `id` = company_profiles.id.
 */
export default async function AdminCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=/admin/companies");

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (
    !userData?.role ||
    !["admin_support", "admin_ops", "admin_founder"].includes(userData.role)
  ) {
    redirect("/");
  }

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
    />
  );
}
