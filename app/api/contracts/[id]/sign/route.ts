import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  contractRefusal,
  contractSignSchema,
} from "@/lib/validations/contract";
import { observedClientIp } from "@/lib/utils/observed-ip";

/**
 * Signature d'un contrat par l'une de ses parties
 * (RPC `sign_contract_observed`, rôle service uniquement).
 *
 * L'utilisateur est celui de la session, vérifiée par `auth.getUser()` ;
 * aucune identité ni IP n'est lue dans le corps. L'IP n'est enregistrée que
 * si l'infrastructure en fournit une fiable (`observedClientIp`), sinon elle
 * reste absente. La base déduit la partie du contrat, compare l'empreinte
 * présentée à l'empreinte enregistrée, horodate et calcule le statut. Une
 * relance après une signature déjà enregistrée renvoie la signature
 * d'origine (`already_signed`). L'IP n'est jamais journalisée ici.
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
      const code = parsed.error.issues[0]?.message ?? "invalid_request";
      return NextResponse.json(
        {
          error: code,
          code:
            code === "consent_required" || code === "terms_hash_invalid"
              ? code
              : "invalid_request",
        },
        { status: 400 },
      );
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
      console.error("Contract signing error:", error.code);
      return NextResponse.json(
        { error: "Internal server error", code: "signing_failed" },
        { status: 500 },
      );
    }

    const signature = data[0];
    const signedAt =
      signature?.signed_party === "candidate"
        ? signature.candidate_signed_at
        : signature?.company_signed_at;
    if (!signature || !signedAt) {
      console.error("Contract signing mismatch");
      return NextResponse.json(
        { error: "Internal server error", code: "signing_failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ signature });
  } catch (error) {
    console.error("Contract signing error:", (error as Error).message);
    return NextResponse.json(
      { error: "Internal server error", code: "signing_failed" },
      { status: 500 },
    );
  }
}
