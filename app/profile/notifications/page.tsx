import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { NotificationsClient } from "./notifications-client";

export default async function NotificationsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login?next=/profile/notifications");
  }

  return <NotificationsClient />;
}
