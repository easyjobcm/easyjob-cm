/**
 * Accord en nombre des textes du dictionnaire (lot 9) : remplace les
 * formes « candidature(s) » par une forme au singulier et une au pluriel.
 * Règles de la langue par `Intl.PluralRules` : en français, 0 et 1 sont au
 * singulier ; en anglais, seul 1 l'est.
 */
export type PluralForms = { one: string; other: string };

export function plural(
  count: number,
  forms: PluralForms,
  locale: "fr" | "en",
): string {
  const rule = new Intl.PluralRules(locale === "en" ? "en" : "fr").select(
    count,
  );
  return (rule === "one" ? forms.one : forms.other).replaceAll(
    "{count}",
    String(count),
  );
}
