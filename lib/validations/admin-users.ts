import { z } from "zod";
import { birthDateSchema } from "./profile";

/** T8.4a — action de suspension / réactivation d'un compte.
 *  L'admin ne mute jamais les champs de vérification ici : `is_active`
 *  est un levier opérationnel (SRS §6.19), distinct de la certification. */
export const userModerateSchema = z.object({
  user_id: z.string().uuid(),
  action: z.enum(["suspend", "activate"]),
});
export type UserModerateInput = z.infer<typeof userModerateSchema>;

/** T8.4b — édition d'identité candidats (page /admin/candidates/[id]).
 *  L'admin (admin_founder uniquement) corrige prénom / nom / date de
 *  naissance. Le `date_of_birth` réutilise la même validation que le
 *  candidat (lib/validations/profile.ts) : date ≥ 18 ans, bornes 1900.
 *  Le userId est porté par la route (`/[id]`), pas par le corps. */
export const candidateIdentityEditSchema = z.object({
  first_name: z
    .string()
    .min(1, "firstNameRequired")
    .max(60, "firstNameTooLong"),
  last_name: z.string().min(1, "lastNameRequired").max(60, "lastNameTooLong"),
  date_of_birth: birthDateSchema,
});
export type CandidateIdentityEditInput = z.infer<
  typeof candidateIdentityEditSchema
>;
