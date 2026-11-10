---
applyTo: "app/api/**,lib/actions/**,lib/api/**,lib/supabase/**,lib/auth/**"
---

# Routes et code serveur — EasyJob CM

Règles communes : [AGENTS.md](../../AGENTS.md). Spécifique aux routes :

1. Session : `const supabase = await createClient()` (`@/lib/supabase/server`)
   puis `supabase.auth.getUser()` ; sans utilisateur, 401 avec un `code`.
2. Entrée : schéma Zod de `lib/validations/` (`safeParse`), 400 avec un code
   stable ; corps borné quand il peut être gros (`readBodyWithLimit`).
3. Règle métier : appel de la RPC qui l'applique en base ; traduction de ses
   codes (`jobRefusal`, `contractRefusal`, `missionRefusal`…) en statut HTTP.
   Pas de contrôle métier dupliqué en TypeScript qui contredirait la RPC.
4. Lecture du résultat réel (ligne renvoyée par la RPC) avant d'annoncer un
   succès ; un résultat incohérent est un 500
   (`internalErrorResponse(op, null, { code, request, reason: "result_mismatch" })`).
5. Erreur inattendue : `return internalErrorResponse("domaine.action", error, { code, request })`.
6. `createAdminClient()` seulement après le contrôle de rôle, avec un
   commentaire qui dit pourquoi la session ne suffit pas (RPC `*_observed`
   qui enregistre l'IP, lecture admin agrégée, URL signée d'un bucket privé).
   Les mutations admin passent de préférence par une RPC en session, pour que
   `audit_logs` enregistre l'administrateur réel.
7. Rôles : `isAdminRole`, `isCompanyRole`, relus dans `public.users`, jamais
   dans `user_metadata`. Grade admin : lecture filtrée par
   `.not("is_active", "is", false)` (un admin suspendu n'a plus de grade).

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", code: "not_authenticated" },
      { status: 401 },
    );
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", code: "invalid" }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("ma_rpc", { p_id: parsed.data.id });
  if (error) {
    const refusal = maRefusal(error.message); // codes métier de la RPC
    if (refusal) return NextResponse.json(refusal, { status: refusal.status });
    return internalErrorResponse("domaine.action", error, { code: "action_failed", request });
  }
  return NextResponse.json({ result: data });
}
```
