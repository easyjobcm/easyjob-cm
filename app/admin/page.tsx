import { redirect } from "next/navigation";

/**
 * T8.1 — `/admin` redirige vers le vrai dashboard `/admin/dashboard`.
 * La garde de rôle admin est assurée par `app/admin/layout.tsx`.
 */
export default function AdminPage() {
  redirect("/admin/dashboard");
}
