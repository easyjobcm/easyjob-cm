import { z } from "zod";

/** T8.4a — action de suspension / réactivation d'un compte.
 *  L'admin ne mute jamais les champs de vérification ici : `is_active`
 *  est un levier opérationnel (SRS §6.19), distinct de la certification. */
export const userModerateSchema = z.object({
  user_id: z.string().uuid(),
  action: z.enum(["suspend", "activate"]),
});
export type UserModerateInput = z.infer<typeof userModerateSchema>;
