import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { readEmailConfig } from "@/lib/email/config";
import { createClient } from "@/lib/supabase/server";
import {
  emailPreferenceRefusal,
  replacementEmailPreferenceSchema,
} from "@/lib/validations/email-preference";

/**
 * Lot 17d-4b (ANN-21, `[UV]` 2026-11-26) — préférence du candidat pour les
 * alertes de remplacement par e-mail. Session du candidat ; la base
 * (`my_replacement_email_preference`, `set_replacement_email_alerts`)
 * contrôle le rôle, le texte accepté et l'adresse confirmée, historise le
 * choix et annule, au retrait, les messages pas encore transmis.
 *
 * `deliveryActive` : l'envoi réel est configuré et marqué vérifié. Tant
 * qu'il ne l'est pas, l'écran le dit (aucune annonce d'une fonction non
 * opérationnelle). Aucune adresse n'est renvoyée.
 */
const NO_STORE = { "Cache-Control": "no-store" };

async function session() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function refusalOr500(
  op: string,
  error: { message?: string } | null,
  request: NextRequest,
) {
  const refusal = emailPreferenceRefusal(error?.message);
  if (refusal) {
    return NextResponse.json(
      { error: refusal.code, code: refusal.code },
      { status: refusal.status, headers: NO_STORE },
    );
  }
  return internalErrorResponse(op, error, {
    code: "email_preference_failed",
    request,
  });
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await session();
    if (!user) {
      return NextResponse.json(
        { error: "not_authenticated", code: "not_authenticated" },
        { status: 401, headers: NO_STORE },
      );
    }
    const { data, error } = await supabase.rpc(
      "my_replacement_email_preference",
    );
    if (error) return refusalOr500("email_preference.read", error, request);
    const row = data?.[0];
    return NextResponse.json(
      {
        enabled: row?.enabled ?? false,
        enabledAt: row?.enabled_at ?? null,
        emailConfirmed: row?.email_confirmed ?? false,
        deliveryActive: readEmailConfig().deliveryActive,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalErrorResponse("email_preference.read", error, {
      code: "email_preference_failed",
      request,
    });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { supabase, user } = await session();
    if (!user) {
      return NextResponse.json(
        { error: "not_authenticated", code: "not_authenticated" },
        { status: 401, headers: NO_STORE },
      );
    }
    const body = replacementEmailPreferenceSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!body.success) {
      return NextResponse.json(
        { error: "consent_required", code: "consent_required" },
        { status: 400, headers: NO_STORE },
      );
    }
    const { data, error } = await supabase.rpc("set_replacement_email_alerts", {
      p_enabled: body.data.enabled,
      p_consent_version: body.data.enabled ? body.data.consentVersion : "",
    });
    if (error) return refusalOr500("email_preference.write", error, request);
    const row = data?.[0];
    return NextResponse.json(
      {
        enabled: row?.enabled ?? false,
        enabledAt: row?.enabled_at ?? null,
        changed: row?.changed ?? false,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalErrorResponse("email_preference.write", error, {
      code: "email_preference_failed",
      request,
    });
  }
}
