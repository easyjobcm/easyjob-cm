/**
 * T4 — statut effectif des documents candidat (détection « expiré » au vol,
 * même règle que lib/matching/skill-document-requirements.ts). Aucune écriture
 * `expired` en DB : la page « Mes documents » affiche l'état réel en lecture.
 */
import { describe, expect, it } from "vitest";
import { effectiveDocStatus, isDocExpired } from "@/lib/utils/document-status";

/** Date locale `YYYY-MM-DD` — PAS `toISOString()` (UTC), qui décale d'un
 *  jour en fuseaux +X quand il est passé minuit. */
function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function pastDate(daysAgo = 1): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return localDate(d);
}
function futureDate(daysAhead = 30): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return localDate(d);
}
function todayDate(): string {
  return localDate(new Date());
}

describe("isDocExpired (T4 — détection au vol)", () => {
  it("null/undefined/'' → non expiré (pas de date = pas d'expiration)", () => {
    expect(isDocExpired(null)).toBe(false);
    expect(isDocExpired(undefined)).toBe(false);
    expect(isDocExpired("")).toBe(false);
  });

  it("date invalide → non expiré (pas de crash)", () => {
    expect(isDocExpired("not-a-date")).toBe(false);
  });

  it("date passée → expiré", () => {
    expect(isDocExpired(pastDate())).toBe(true);
  });

  it("date future → non expiré", () => {
    expect(isDocExpired(futureDate())).toBe(false);
  });

  it("date du jour → non expiré (pas encore dépassée à midi)", () => {
    // Un doc dont l'échéance tombe aujourd'hui reste valable aujourd'hui :
    // l'expiration n'est acquise qu'à partir du lendemain.
    expect(isDocExpired(todayDate())).toBe(false);
  });
});

describe("effectiveDocStatus (T4)", () => {
  it("verified + date future/inexistante → verified", () => {
    expect(effectiveDocStatus("verified", futureDate())).toBe("verified");
    expect(effectiveDocStatus("verified", null)).toBe("verified");
  });

  it("verified + date passée → expired (cœur de la détection au vol)", () => {
    expect(effectiveDocStatus("verified", pastDate())).toBe("expired");
  });

  it("rejected → rejected (sans regarder la date)", () => {
    expect(effectiveDocStatus("rejected", pastDate())).toBe("rejected");
    expect(effectiveDocStatus("rejected", null)).toBe("rejected");
  });

  it("pending → pending (sans date)", () => {
    expect(effectiveDocStatus("pending", futureDate())).toBe("pending");
    expect(effectiveDocStatus("pending", null)).toBe("pending");
  });

  it("un statut brut déjà expired reste expired (idempotent)", () => {
    expect(effectiveDocStatus("expired", futureDate())).toBe("expired");
  });

  it("insensible à la casse et au statut inconnu → pending (jamais de crash)", () => {
    expect(effectiveDocStatus("VERIFIED", futureDate())).toBe("verified");
    expect(effectiveDocStatus(undefined, null)).toBe("pending");
    expect(effectiveDocStatus("weird", null)).toBe("pending");
  });
});
