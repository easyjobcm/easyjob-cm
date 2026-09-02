import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SecurityClient } from "./security-client";

export default async function SecurityPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !user.email) {
    redirect("/auth/login?next=/profile/security");
  }

  return <SecurityClient email={user.email} />;
}
