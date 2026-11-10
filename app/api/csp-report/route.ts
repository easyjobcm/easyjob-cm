import { NextRequest, NextResponse } from "next/server";
import { logCspViolation } from "@/lib/observability/server-log";
import { readBodyWithLimit } from "@/lib/chat/request";

/**
 * Réception des rapports `Content-Security-Policy-Report-Only` (lot 10,
 * F-25 ; politique : `lib/security/csp.ts`).
 *
 * Public par nature (le navigateur l'appelle sans session) : corps limité à
 * 16 Kio, 10 rapports au plus par requête, aucune écriture en base, une ligne
 * de journal par rapport avec des champs sûrs seulement. Toujours 204, pour
 * ne rien révéler au client. Formats acceptés : `report-uri`
 * (`application/csp-report`) et Reporting API (`application/reports+json`).
 */
const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTS = 10;

type RawReport = Record<string, unknown>;

function asRecord(value: unknown): RawReport | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RawReport)
    : null;
}

/** Normalise les deux formats vers les champs que le journal accepte. */
function extractReports(
  payload: unknown,
): Parameters<typeof logCspViolation>[0][] {
  const legacy = asRecord(asRecord(payload)?.["csp-report"]);
  if (legacy) {
    return [
      {
        directive:
          legacy["effective-directive"] ?? legacy["violated-directive"],
        blocked: legacy["blocked-uri"],
        page: legacy["document-uri"],
        disposition: legacy["disposition"],
      },
    ];
  }
  if (!Array.isArray(payload)) return [];
  return payload
    .map(asRecord)
    .filter((r): r is RawReport => r?.type === "csp-violation")
    .slice(0, MAX_REPORTS)
    .map((r) => asRecord(r.body) ?? {})
    .map((b) => ({
      directive: b.effectiveDirective,
      blocked: b.blockedURL,
      page: b.documentURL,
      disposition: b.disposition,
    }));
}

export async function POST(request: NextRequest) {
  // Lecture bornée (annonce et flux réel), comme EasyBot.
  const text = await readBodyWithLimit(request, MAX_BODY_BYTES).catch(
    () => null,
  );
  if (!text) return new NextResponse(null, { status: 204 });
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  for (const report of extractReports(payload)) logCspViolation(report);
  return new NextResponse(null, { status: 204 });
}
