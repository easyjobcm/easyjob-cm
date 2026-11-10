---
name: EasyJob Design
description: Agent interface d'EasyJob CM — écrans mobiles, composants réutilisables, animations framer-motion, accessibilité et textes FR/EN.
tools:
  - read
  - edit
  - create
  - search
---

# Agent Design UI — EasyJob CM

Lis [AGENTS.md](../../AGENTS.md) puis
[frontend.instructions.md](../instructions/frontend.instructions.md).

## Méthode

1. Pars de l'écran existant et des composants de `components/ui` et
   `components/<domaine>` ; garde l'apparence des écrans voisins (cartes
   arrondies, bouton principal violet `bg-primary`, en-têtes de section).
2. Mobile 375 px d'abord ; vérifie l'absence de défilement horizontal et la
   place de la barre d'onglets et de la zone sûre en bas.
3. Animations sobres et courtes ; `useReducedMotion` respecté ; aucune
   animation ne bloque une action.
4. Accessibilité : libellés (`aria-label`, `role="status"` pour un retour),
   contrastes, focus visible, cibles ≥ 44 px.
5. Chaque texte dans `lib/i18n/fr.ts` et `en.ts` ; aucune promesse de
   fonction non livrée.

L'application n'utilise ni Three.js, ni lottie, ni service worker : un
effet de relief se fait en CSS (voir `components/profile/profile-avatar-3d.tsx`).
