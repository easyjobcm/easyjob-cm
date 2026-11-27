/**
 * Lot 17d-4b — contenu de l'alerte de remplacement par e-mail (ANN-14,
 * ANN-21, `[UV]` 2026-11-26).
 *
 * Entrées : les seuls paramètres publics figés par la base à la première
 * tentative (offre, ville, journées de la portée, fermeture du cycle,
 * langue). Jamais : motif du désistement, identité du candidat désisté,
 * justificatif, coordonnées, plan, montant. Rendu déterministe : les
 * reprises renvoient exactement le même contenu (clé d'idempotence).
 *
 * Le lien ouvre l'offre : il ne porte aucun jeton et ne confirme rien.
 * L'offre relit l'état du cycle à l'ouverture (un message accepté peut
 * arriver après la fermeture).
 */
import { z } from "zod";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";
import { doualaFullDateTime, doualaTime } from "@/lib/utils/douala-time";

export const replacementRenderSchema = z.object({
  locale: z.enum(["fr", "en"]).catch("fr"),
  job_id: z.string().uuid(),
  title: z.string().min(1).max(300),
  city: z.string().max(120).nullable().optional(),
  closes_at: z.string().min(1),
  days: z
    .array(z.object({ starts_at: z.string(), ends_at: z.string() }))
    .min(1)
    .max(366),
});
export type ReplacementRender = z.infer<typeof replacementRenderSchema>;

export type RenderedEmail = { subject: string; text: string; html: string };

const MAX_DAYS_LISTED = 7;

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Une ligne d'objet ne contient ni retour à la ligne ni caractère de contrôle. */
function oneLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderReplacementAlert(
  input: ReplacementRender,
  appUrl: string,
): RenderedEmail {
  const r = replacementRenderSchema.parse(input);
  const dict = (r.locale === "en" ? en : fr).replacementEmail;
  const base = appUrl.replace(/\/+$/, "");
  const offerUrl = `${base}/jobs/${r.job_id}`;
  const manageUrl = `${base}/profile/notifications`;
  const title = oneLine(r.title);
  const city = r.city ? oneLine(r.city) : "";

  const days = [...r.days].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );
  const dayLines = days
    .slice(0, MAX_DAYS_LISTED)
    .map(
      (d) =>
        `${doualaFullDateTime(d.starts_at, r.locale)} – ${doualaTime(d.ends_at, r.locale)}`,
    );
  if (days.length > MAX_DAYS_LISTED)
    dayLines.push(
      fill(dict.moreDays, { count: String(days.length - MAX_DAYS_LISTED) }),
    );

  const subject = oneLine(fill(dict.subject, { title }));
  const intro = fill(city ? dict.intro : dict.introNoCity, { title, city });
  const closes = fill(dict.closes, {
    date: doualaFullDateTime(r.closes_at, r.locale),
  });
  const manage = fill(dict.manage, { url: manageUrl });

  const text = [
    dict.heading,
    "",
    intro,
    "",
    dict.days,
    ...dayLines.map((l) => `- ${l}`),
    "",
    closes,
    dict.action,
    "",
    `${dict.button} : ${offerUrl}`,
    "",
    dict.noGuarantee,
    "",
    "—",
    dict.why,
    manage,
  ].join("\n");

  const p = (s: string, style = "") =>
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#1f2937;${style}">${s}</p>`;
  const html = [
    `<!doctype html><html lang="${r.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:#f5f3ff;font-family:Arial,Helvetica,sans-serif;">`,
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;">`,
    `<div style="background:#ffffff;border-radius:12px;padding:24px;">`,
    `<h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${escapeHtml(dict.heading)}</h1>`,
    p(escapeHtml(intro)),
    p(`<strong>${escapeHtml(dict.days)}</strong>`, "margin-bottom:4px;"),
    `<ul style="margin:0 0 12px;padding-left:20px;font-size:15px;line-height:1.5;color:#1f2937;">${dayLines
      .map((l) => `<li>${escapeHtml(l)}</li>`)
      .join("")}</ul>`,
    p(escapeHtml(closes)),
    p(escapeHtml(dict.action)),
    `<p style="margin:20px 0;"><a href="${escapeHtml(offerUrl)}" style="display:inline-block;background:#7C3AED;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:bold;">${escapeHtml(dict.button)}</a></p>`,
    p(escapeHtml(dict.noGuarantee), "color:#4b5563;font-size:14px;"),
    `</div>`,
    `<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">${escapeHtml(dict.why)}<br><a href="${escapeHtml(manageUrl)}" style="color:#6b7280;">${escapeHtml(dict.manageLink)}</a></p>`,
    `</div></body></html>`,
  ].join("");

  return { subject, text, html };
}
