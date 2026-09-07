// Utilitaire dev local : crée (ou met à jour) un compte admin de test.
// Usage : npx tsx scripts/create-admin.ts [email] [password] [role]
// role par défaut : admin_ops (admin_founder | admin_support aussi acceptés).
import { createClient } from "@supabase/supabase-js";

if (typeof process.loadEnvFile === "function") {
  process.loadEnvFile(".env.local");
}

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.",
  );
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const email = process.argv[2] ?? "admin.ops@easyjob.test";
const password = process.argv[3] ?? "AdminTest123!";
const role = process.argv[4] ?? "admin_ops";

async function main() {
  const { data: usersPage, error: listError } =
    await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;

  const existing = usersPage.users.find((u) => u.email === email);

  const metadata = { app_metadata: { role }, user_metadata: { role } };

  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      ...metadata,
    });
    if (error) throw error;
    await supabase
      .from("users")
      .upsert(
        { id: existing.id, email, role, locale: "fr" },
        { onConflict: "id" },
      );
    console.log(`Compte admin mis à jour : ${email} (id=${existing.id})`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      ...metadata,
    });
    if (error) throw error;
    // La création automatique de public.users dépend de l'action de signup
    // applicative (finalizeSignup), jamais déclenchée ici : on la reproduit.
    await supabase
      .from("users")
      .upsert(
        { id: data.user!.id, email, role, locale: "fr" },
        { onConflict: "id" },
      );
    console.log(`Compte admin créé : ${email} (id=${data.user?.id})`);
  }

  console.log(`Rôle : ${role}`);
  console.log(`Mot de passe : ${password}`);
  console.log("Connecte-toi sur /auth/login avec ces identifiants.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
