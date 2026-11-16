import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jobRefusal } from "@/lib/validations/job";
import {
  selectionSignSchema,
  signBodyRefusal,
} from "@/lib/validations/contract";
import { observedClientIp } from "@/lib/utils/observed-ip";
import { internalErrorResponse } from "@/lib/api/errors";

/**
 * « Signer et sélectionner » (RPC `sign_and_select_observed`, lot 13).
 *
 * L'entreprise est celle de la session, vérifiée par `auth.getUser()` ; le
 * corps ne porte que l'empreinte de l'aperçu lu et le consentement. La base
 * reverrouille et revérifie tout (dossier, candidature, échéance, places,
 * conflits), compare l'empreinte aux conditions courantes, puis crée la
 * sélection, la mission, ses codes, le contrat, la signature de l'entreprise
 * et la notification dans une seule transaction. Une relance sur une
 * candidature déjà sélectionnée renvoie les mêmes liens sans écriture
 * (`already_selected`).
 *
 * Clé service : seule `sign_and_select_observed` enregistre l'IP observée
 * par l'infrastructure (`observedClientIp`, absente hors Vercel), comme la
 * signature du lot 7b ; elle n'est accessible qu'au rôle service et reçoit
 * l'utilisateur vérifié ci-dessus. L'IP n'est jamais journalisée.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
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

    const applicationId = z.string().uuid().safeParse(id);
    if (!applicationId.success) {
      return NextResponse.json(
        { error: "application_not_found", code: "application_not_found" },
        { status: 404 },
      );
    }

    const parsed = selectionSignSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      const code = signBodyRefusal(parsed.error.issues[0]?.message);
      return NextResponse.json({ error: code, code }, { status: 400 });
    }

    const ip = observedClientIp(request.headers);
    const { data, error } = await createAdminClient().rpc(
      "sign_and_select_observed",
      {
        p_user_id: user.id,
        p_application_id: applicationId.data,
        p_terms_hash: parsed.data.terms_hash.toLowerCase(),
        p_observed_ip: ip ?? undefined,
      },
    );
    if (error) {
      const refusal = jobRefusal(error.message);
      if (refusal) {
        return NextResponse.json(
          { error: refusal.code, code: refusal.code },
          { status: refusal.status },
        );
      }
      return internalErrorResponse("applications.select", error, {
        code: "selection_failed",
        request,
      });
    }

    const selection = data[0];
    if (
      !selection ||
      selection.status !== "selected" ||
      !selection.mission_id ||
      !selection.contract_id
    ) {
      return internalErrorResponse("applications.select", null, {
        code: "selection_failed",
        request,
        reason: "result_mismatch",
      });
    }

    return NextResponse.json({ selection });
  } catch (error) {
    return internalErrorResponse("applications.select", error, {
      code: "selection_failed",
      request,
    });
  }
}
