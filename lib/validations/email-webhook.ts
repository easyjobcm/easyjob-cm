import { z } from "zod";

/**
 * Lot 17d-4b — événement Resend (documentation lue le 2026-11-26) :
 * `type`, `created_at`, `data` (`email_id`, `tags` en objet clé → valeur…).
 * Seuls les champs utiles sont lus ; adresses, objet et en-têtes du message
 * sont ignorés et jamais conservés.
 */
export const resendWebhookSchema = z.object({
  type: z.string().regex(/^[a-z_.]{1,64}$/),
  created_at: z.string().datetime({ offset: true }),
  data: z
    .object({
      email_id: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,128}$/)
        .optional(),
      tags: z.record(z.string(), z.string()).optional(),
    })
    .passthrough(),
});
export type ResendWebhook = z.infer<typeof resendWebhookSchema>;

const UUID = z.string().uuid();

/** Identifiant de ligne porté par l'étiquette `outbox_id`, s'il est valide. */
export function outboxIdFromTags(
  tags: Record<string, string> | undefined,
): string | null {
  const v = tags?.outbox_id;
  return v && UUID.safeParse(v).success ? v : null;
}
