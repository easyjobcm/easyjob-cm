import { NextRequest, NextResponse } from "next/server";
import { adminIncidentContext } from "@/lib/api/admin-incident-route";
import { incidentRpcError, readJson } from "@/lib/api/incident-route";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  incidentBodyRefusal,
  incidentContactSchema,
} from "@/lib/validations/incident";

/**
 * Contact du support avec l'entreprise (lot 15, RPC
 * `admin_record_incident_contact`) : demande ou réponse obtenue, date,
 * canal, résultat, référence privée et note interne. Tout admin actif
 * (grade revérifié en base) ; append-only, tracé dans `audit_logs` sans la
 * référence ni la note.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await adminIncidentContext(params);
    if (ctx.error) return ctx.error;
    const parsed = incidentContactSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const code = incidentBodyRefusal(parsed.error.issues[0]?.message);
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const { data, error } = await ctx.supabase.rpc(
      "admin_record_incident_contact",
      {
        p_incident_id: ctx.incidentId,
        p_entry_type: parsed.data.entry_type,
        p_channel: parsed.data.channel,
        p_occurred_at: parsed.data.occurred_at,
        p_result: parsed.data.result,
        ...(parsed.data.reference
          ? { p_reference: parsed.data.reference }
          : {}),
        ...(parsed.data.note ? { p_note: parsed.data.note } : {}),
      },
    );
    if (error)
      return incidentRpcError(
        error,
        "admin.incidents.contact",
        "contact_failed",
        request,
      );
    return NextResponse.json({ contact: data[0] ?? null });
  } catch (error) {
    return internalErrorResponse("admin.incidents.contact", error, {
      code: "contact_failed",
      request,
    });
  }
}
