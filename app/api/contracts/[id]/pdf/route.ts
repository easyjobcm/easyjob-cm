import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { contractRefusal } from "@/lib/validations/contract";
import { internalErrorResponse } from "@/lib/api/errors";
import { contractPdf } from "@/lib/contracts/contract-pdf";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

const localeSchema = z.enum(["fr", "en"]).catch("fr");

/**
 * Contrat en PDF pour l'une de ses parties (lot 13).
 *
 * Même lecture que l'écran (`get_contract`, session de l'utilisateur) : un
 * tiers ou un lien deviné reçoit 404, comme pour un contrat inexistant. Le
 * document est produit à la volée depuis les conditions et clauses figées
 * du contrat, avec la seule mention propre au lecteur (sa signature) ;
 * aucun horodatage, IP ni état de signature de l'autre partie. Disponible
 * dès que le contrat existe, y compris après la mission.
 */
export async function GET(
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
    const locale = localeSchema.parse(
      request.nextUrl.searchParams.get("locale"),
    );

    const { data, error } = await supabase.rpc("get_contract", {
      p_contract_id: contractId.data,
    });
    if (error) {
      const refusal = contractRefusal(error.message);
      if (refusal) {
        return NextResponse.json(
          { error: refusal.code, code: refusal.code },
          { status: refusal.status },
        );
      }
      return internalErrorResponse("contracts.pdf", error, {
        code: "contract_failed",
        request,
      });
    }
    const contract = data[0];
    if (!contract) {
      return NextResponse.json(
        { error: "contract_not_found", code: "contract_not_found" },
        { status: 404 },
      );
    }

    const bytes = contractPdf(contract, locale, locale === "en" ? en : fr);
    const ref = contract.contract_id.slice(0, 8).toUpperCase();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${
          locale === "en" ? "contract" : "contrat"
        }-${ref}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return internalErrorResponse("contracts.pdf", error, {
      code: "contract_failed",
      request,
    });
  }
}
