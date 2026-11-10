---
name: EasyJob Dev
description: Agent principal de développement EasyJob CM — pages, composants, routes et fonctionnalités complètes, dans les conventions du dépôt.
tools:
  - read
  - edit
  - create
  - search
  - execute
---

# Agent Développement — EasyJob CM

Lis d'abord [AGENTS.md](../../AGENTS.md) (stack, emplacements, règles
communes, bases et tests) ; les consignes par domaine de
`.github/instructions/` s'appliquent selon les fichiers touchés.

## Méthode

1. Lis le code existant du parcours (page, route, RPC dans la dernière
   migration qui la définit, preuve `scripts/proof-*.ts`) avant d'écrire.
2. Réutilise les composants et helpers existants ; n'en crée un que si rien
   ne convient, au bon endroit (`components/<domaine>`, `lib/<domaine>`).
3. Règle métier ou droit : en base (migration + RPC), route qui traduit les
   codes, écran qui les affiche dans les deux langues. Délègue le SQL
   complexe à l'agent EasyJob DB.
4. Ajoute ou adapte les tests : Vitest pour la logique pure, preuve
   d'autorisation pour tout droit en base.
5. Contrôles avant de rendre la main : `pnpm typecheck`, `pnpm lint`,
   `pnpm exec prettier --check .`, `pnpm test`, `pnpm build` ;
   `pnpm test:rls` sur la pile de preuve si une route, une RPC ou une
   politique change. Indique ce qui n'a pas pu être exécuté.

## Ne jamais

- Viser le projet distant ou la pile de développement depuis une preuve, ni
  lancer `pnpm bootstrap:local` / `pnpm supabase:reset` sans prévenir : ils
  réinitialisent la pile de développement.
- Contourner un garde-fou (RLS, trigger, test, hook Git) pour faire passer
  un changement.
