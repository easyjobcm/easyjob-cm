/**
 * Normalisation des choix d'inscription lus dans `user_metadata`.
 *
 * `user_metadata` (raw_user_meta_data) est modifiable par le client via
 * `auth.updateUser({ data })` ou un appel direct à GoTrue : il ne peut
 * porter qu'un CHOIX public d'inscription, jamais un droit. Toute valeur
 * autre que `company` (admin_*, *_premium, absente, invalide) devient
 * `candidate`. Même règle que `public.handle_new_user()` côté base.
 */
export type SignupRole = "candidate" | "company";

export function normalizeSignupRole(value: unknown): SignupRole {
  return value === "company" ? "company" : "candidate";
}

export function normalizeSignupLocale(value: unknown): "fr" | "en" {
  return value === "en" ? "en" : "fr";
}
