import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  companyPremiumActionSchema,
  companyPremiumBodyRefusal,
  companyPremiumRefusal,
  companyPremiumStateSchema,
} from "@/lib/validations/company-premium";

/**
 * ABO-07 — plan entreprise Premium, attribué par l'équipe (aucun paiement).
 *
 * GET  : état effectif et historique, reprise des anciens plans comprise
 *        (`admin_company_premium`, les trois grades actifs, contrôle en
 *        base).
 * POST : activer, prolonger ou arrêter (`admin_manage_company_premium`,
 *        admin_ops et admin_founder actifs, contrôle en base). Auteur =
 *        session ; aucune clé service : l'audit nomme l'agent réel.
 *
 * `id` est l'identifiant de l'entreprise (company_profiles.id), comme la
 * fiche admin.
 */

type RouteContext = { params: Promise<{ id: string }> };

const idSchema = z.string().uuid();

async function context(params: RouteContext["params"]) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json(
        { error: "not_authenticated", code: "not_authenticated" },
        { status: 401 },
      ),
    } as const;
  }
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return {
      error: NextResponse.json(
        { error: "company_not_found", code: "company_not_found" },
        { status: 404 },
      ),
    } as const;
  }
  return { error: null, supabase, companyId: parsed.data } as const;
}

function refusalResponse(
  error: { message?: string },
  op: string,
  request: NextRequest,
) {
  const refusal = companyPremiumRefusal(error.message);
  if (refusal) {
    return NextResponse.json(
      { error: refusal.code, code: refusal.code },
      { status: refusal.status },
    );
  }
  return internalErrorResponse(op, error, {
    code: "company_premium_failed",
    request,
  });
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await context(params);
    if (ctx.error) return ctx.error;
    const { data, error } = await ctx.supabase.rpc("admin_company_premium", {
      p_company_id: ctx.companyId,
    });
    if (error)
      return refusalResponse(error, "admin.company_premium.read", request);
    const parsed = companyPremiumStateSchema.safeParse(data);
    if (!parsed.success) {
      return internalErrorResponse(
        "admin.company_premium.read",
        new Error("unexpected_shape"),
        { code: "company_premium_failed", request },
      );
    }
    return NextResponse.json({ premium: parsed.data });
  } catch (error) {
    return internalErrorResponse("admin.company_premium.read", error, {
      code: "company_premium_failed",
      request,
    });
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await context(params);
    if (ctx.error) return ctx.error;
    const body = await request.json().catch(() => null);
    const parsed = companyPremiumActionSchema.safeParse(body);
    if (!parsed.success) {
      const code = companyPremiumBodyRefusal(parsed.error.issues[0]?.message);
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const { data, error } = await ctx.supabase.rpc(
      "admin_manage_company_premium",
      {
        p_request_id: parsed.data.request_id,
        p_company_id: ctx.companyId,
        p_operation: parsed.data.operation,
        // null accepté par la RPC (arrêt, aucune fin lue) : types générés
        // sans nullabilité des paramètres.
        p_ends_at: parsed.data.ends_at as string,
        p_expected_until: parsed.data.expected_until as string,
        p_reason: parsed.data.reason,
      },
    );
    if (error)
      return refusalResponse(error, "admin.company_premium.manage", request);
    return NextResponse.json({
      result: Array.isArray(data) ? (data[0] ?? null) : data,
    });
  } catch (error) {
    return internalErrorResponse("admin.company_premium.manage", error, {
      code: "company_premium_failed",
      request,
    });
  }
}
