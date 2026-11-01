import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PaymentClient } from "./payment-client";

export default async function PaymentPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login?next=/profile/payment");
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !userData ||
    (userData.role !== "candidate" && userData.role !== "candidate_premium")
  ) {
    redirect("/profile");
  }

  const { data: candidateProfile } = await supabase
    .from("candidate_profiles")
    .select(
      "momo_provider, momo_number, momo_account_name, momo_verified, momo_reject_reason",
    )
    .eq("user_id", user.id)
    .single();

  return (
    <PaymentClient
      momoProvider={candidateProfile?.momo_provider ?? null}
      momoNumber={candidateProfile?.momo_number ?? null}
      momoAccountName={candidateProfile?.momo_account_name ?? null}
      momoVerified={candidateProfile?.momo_verified ?? false}
      momoRejectReason={candidateProfile?.momo_reject_reason ?? null}
    />
  );
}
