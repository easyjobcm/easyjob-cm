import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  contractRefusal,
  contractSignSchema,
  signBodyRefusal,
} from "@/lib/validations/contract";
import { observedClientIp } from "@/lib/utils/observed-ip";
import { internalErrorResponse } from "@/lib/api/errors";

/**
 * Signature d'un contrat par l'une de ses parties
 * (RPC `sign_contract_observed`, rôle service uniquement).
 *
 * L'utilisateur est celui de la session, vérifiée par `auth.getUser()` ;
 * aucune identité ni IP n'est lue dans le corps. L'IP n'est enregistrée que
 * si l'infrastructure en fournit une fiable (`observedClientIp`), sinon elle
 * reste absente. La base déduit la partie du contrat, compare l'empreinte
 * présentée à l'empreinte enregistrée, horodate et calcule le statut. Une
 * relance après une signature déjà enregistrée ne réécrit rien
 * (`already_signed`). L'IP n'est jamais journalisée ici.
 *
 * Lot 13 : la réponse ne contient que la partie signataire, jamais l'état ni
 * l'heure de la signature de l'autre partie (détail réservé au support).
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

    const contractId = z.string().uuid().safeParse(id);
    if (!contractId.success) {
      return NextResponse.json(
        { error: "contract_not_found", code: "contract_not_found" },
        { status: 404 },
      );
    }

    const parsed = contractSignSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      const code = signBodyRefusal(parsed.error.issues[0]?.message);
      return NextResponse.json({ error: code, code }, { status: 400 });
    }

    const ip = observedClientIp(request.headers);
    const { data, error } = await createAdminClient().rpc(
      "sign_contract_observed",
      {
        p_user_id: user.id,
        p_contract_id: contractId.data,
        p_terms_hash: parsed.data.terms_hash.toLowerCase(),
        p_observed_ip: ip ?? undefined,
      },
    );
    if (error) {
      const refusal = contractRefusal(error.message);
      if (refusal) {
        return NextResponse.json(
          { error: refusal.code, code: refusal.code },
          { status: refusal.status },
        );
      }
      return internalErrorResponse("contracts.sign", error, {
        code: "signing_failed",
        request,
      });
    }

    const signature = data[0];
    if (!signature || !signature.signed_party) {
      return internalErrorResponse("contracts.sign", null, {
        code: "signing_failed",
        request,
        reason: "result_mismatch",
      });
    }

    return NextResponse.json({ signature });
  } catch (error) {
    return internalErrorResponse("contracts.sign", error, {
      code: "signing_failed",
      request,
    });
  }
}
