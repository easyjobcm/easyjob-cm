/**
 * Catalogue de compétences fréquentes — Cameroun (Douala / Yaoundé) et
 * Afrique centrale.
 *
 * Données (pas de texte d'interface) : les noms de compétences sont stockés
 * tels quels en `candidate_skills.skill_name` (texte libre en DB), donc le
 * catalogue reste FR comme `COMMON_SKILLS` (onboarding). Les LIBELLÉS de
 * groupe sont des clés i18n (`t.profile.skills.catalog.<key>`), pas du texte
 * durci ici. La clé de chaque groupe est unionnée (`CatalogGroupKey`) pour
 * indexer ce namespace i18n sans cast.
 *
 * Invariants (vérifiés par vitest) :
 *  - aucun nom en double dans la liste aplatie ;
 *  - les 15 skills de `COMMON_SKILLS` (onboarding + seeds) figurent au moins
 *    une fois — un candidat existant retrouve ses compétences cochées.
 */

/** Clés i18n des libellés de groupe — union alignée sur `t.profile.skills.catalog`. */
export type CatalogGroupKey =
  | "services"
  | "vente"
  | "restauration"
  | "manutention"
  | "transport"
  | "artisanat"
  | "nettoyage"
  | "securite"
  | "events"
  | "bureautique"
  | "digital"
  | "beaute"
  | "soins"
  | "langues";

export interface SkillCatalogGroup {
  /** Clé i18n du libellé de groupe (t.profile.skills.catalog). */
  key: CatalogGroupKey;
  skills: string[];
}

export const SKILL_CATALOG: SkillCatalogGroup[] = [
  {
    key: "services",
    skills: [
      "Service client",
      "Hotesse accueil",
      "Service en salle",
      "Barista",
      "Room service",
      "Housekeeping",
      "Gouvernant",
      "Standardiste",
      "Réceptionniste",
      "Conciergerie",
    ],
  },
  {
    key: "vente",
    skills: [
      "Vente",
      "Caisse",
      "Vente en boutique",
      "Vente à emporter",
      "Commercial terrain",
      "Gestion de stock",
    ],
  },
  {
    key: "restauration",
    skills: [
      "Restauration",
      "Cuisine",
      "Cuisinier",
      "Cuisinière",
      "Pâtisserie",
      "Boulangerie",
      "Traiteur",
      "Catering",
    ],
  },
  {
    key: "manutention",
    skills: [
      "Manutention",
      "Emballage et conditionnement",
      "Stock et inventaire",
      "Cariste",
      "Entrepôt",
      "Logistique",
    ],
  },
  {
    key: "transport",
    skills: [
      "Conduite moto",
      "Conduite voiture",
      "Taxi moto",
      "Conduite fourgon",
      "Conduite camion",
      "Conduite bus",
      "Livraison moto",
      "Livraison voiture",
      "Livreur",
      "Livraison courses",
    ],
  },
  {
    key: "artisanat",
    skills: [
      "Maçonnerie",
      "Plomberie",
      "Menuiserie",
      "Installation électrique",
      "Serrurerie",
      "Soudage",
      "Peinture en bâtiment",
      "Carrelage",
      "Boucherie",
      "Tailleur",
      "Cordonnerie",
      "Réparateur moto",
      "Mécanicien auto",
      "Entretien génératrices",
    ],
  },
  {
    key: "nettoyage",
    skills: [
      "Nettoyage",
      "Nettoyage de locaux",
      "Nettoyage de vitres",
      "Assainissement",
      "Désinfection",
      "Jardinage",
    ],
  },
  {
    key: "securite",
    skills: [
      "Securite",
      "Gardiennage",
      "Surveillance de site",
      "Contrôle d'accès",
    ],
  },
  {
    key: "events",
    skills: [
      "Evenementiel",
      "Organisation d'événements",
      "Technicien son et lumière",
      "Animation",
    ],
  },
  {
    key: "bureautique",
    skills: [
      "Informatique",
      "Saisie de données",
      "Assistance administrative",
      "Comptabilité",
      "Gestionnaire de bureau",
      "Gestion documentaire",
    ],
  },
  {
    key: "digital",
    skills: [
      "Outils bureautiques (Word, Excel)",
      "Vente en ligne (e-commerce)",
      "Gestion de réseaux sociaux",
      "Design graphique",
      "Support technique informatique",
      "Développement web",
    ],
  },
  {
    key: "beaute",
    skills: [
      "Coiffure",
      "Coiffure homme (barbier)",
      "Esthétique (manucure et pédicure)",
      "Maquillage",
      "Massage et soins du corps",
    ],
  },
  {
    key: "soins",
    skills: [
      "Garde d'enfants",
      "Aide domestique",
      "Aide aux personnes âgées",
      "Auxiliaire de santé",
      "Cours et soutien scolaire",
    ],
  },
  {
    key: "langues",
    skills: [
      "Francais",
      "Anglais",
      "Anglais pidgin",
      "Arabe",
      "Allemand (base)",
      "Espagnol (base)",
    ],
  },
];

/** Ligne plate du catalogue (nom + clé de groupe d'appartenance). */
export interface FlatSkill {
  name: string;
  groupKey: CatalogGroupKey;
}

/** Trousseau de compétences unique, dans l'ordre du catalogue. */
export function getFlatSkillCatalog(): FlatSkill[] {
  return SKILL_CATALOG.flatMap((group) =>
    group.skills.map((name) => ({ name, groupKey: group.key })),
  );
}

/** Recherche (insensible à la casse, sous-chaîne) sur les noms du catalogue. */
export function searchSkillCatalog(query: string): FlatSkill[] {
  const q = query.trim().toLowerCase();
  const flat = getFlatSkillCatalog();
  if (q === "") return flat;
  return flat.filter((s) => s.name.toLowerCase().includes(q));
}
