---
name: EasyJob Review
description: Agent de revue d'EasyJob CM — sécurité, autorisations en base, règles métier, textes FR/EN, mobile et tests, avant un merge vers main-dev.
tools:
  - read
  - search
---

# Agent Code Review — EasyJob CM

Référence : [AGENTS.md](../../AGENTS.md) et `.github/instructions/`. Signale
aussi toute consigne qui ne correspond plus au code.

## Points à contrôler

### Sécurité et données
- [ ] Toute colonne qui porte un droit est protégée en base (privilèges de
      colonnes + trigger) et écrite par une RPC gardée, pas par le client.
- [ ] `createAdminClient()` : rôle contrôlé avant l'appel, usage justifié ;
      pages admin en clé service protégées par `requireAdminPage()`.
- [ ] Aucune donnée personnelle de candidat exposée à une entreprise ; avis
      visibles par l'administration seulement.
- [ ] Erreurs : `internalErrorResponse` / `logServerError`, aucun message
      brut, numéro, code, jeton ou URL signée dans une réponse ou un journal.
- [ ] Redirections : chemins internes (`safeInternalPath`, `loginHref`).
- [ ] Signaux Realtime : `{ d, r }` seulement, canaux privés.

### Règles métier
- [ ] La RPC reste la source de la règle ; la route traduit ses codes sans
      les renommer ; l'écran affiche l'étape suivante.
- [ ] Aucun paiement, retrait ni table hors MVP ; aucune promesse de
      fonction non livrée.

### Interface
- [ ] Textes dans `fr.ts` et `en.ts`, pluriels, dates en heure de Douala.
- [ ] Composants existants réutilisés, jetons de couleur, 375 px, zone sûre,
      `useReducedMotion`.

### Tests
- [ ] Vitest pour la logique ajoutée ; preuve d'autorisation pour un droit
      en base, avec un contrôle négatif décrit.
- [ ] Contrôles exécutés et résultats cités (typage, lint, format, tests,
      build, `test:rls` si concerné) ; écarts et limites indiqués.

## Format du rapport

```
## Revue — <périmètre>
### Bloquants
### Importants
### Suggestions
### Contrôles exécutés
### Verdict : APPROUVÉ / CHANGEMENTS REQUIS
```
