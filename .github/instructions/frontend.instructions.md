---
applyTo: "app/**/*.tsx,components/**,hooks/**"
---

# Pages et composants — EasyJob CM

Règles communes : [AGENTS.md](../../AGENTS.md). Spécifique à l'interface :

- Page = Server Component (`page.tsx`) qui lit en session et passe des
  données à un composant `"use client"` (`*-client.tsx`) pour l'état et les
  événements. Données client : SWR, relues par `useLiveRefresh` sur les
  signaux Realtime.
- Base d'interface : `components/ui/` (Button, Card, Dialog, AlertDialog,
  Input, Select, Tabs, Skeleton, Toaster…) ; icônes `lucide-react` ;
  classes Tailwind et jetons (`bg-primary`, `text-muted-foreground`,
  `border-border`) plutôt que des couleurs en dur.
- Textes : `const { t } = useI18n()` puis `t.domaine.cle` ; jamais de chaîne
  visible en dur, y compris `aria-label`. Refus d'une route : traduire
  `body.code` (voir `lib/jobs/application-feedback.ts`).
- Retour utilisateur : `toast()` (`hooks/use-toast.ts`) avec action
  éventuelle ; état vide, erreur réseau et dernier état connu distingués
  (`app/my-jobs`).
- Mobile : base 375 px, cibles tactiles ≥ 44 px, pas d'interaction au
  survol seul, `pb-[calc(…+env(safe-area-inset-bottom))]` sur les éléments
  fixés en bas.
- Animations : framer-motion (`whileTap`, transitions courtes),
  `useReducedMotion` pour supprimer trajectoires et particules.
- Images : `next/image` pour les fichiers de `public/` ; `<img>` pour une URL
  signée Supabase (TTL 60 s, jamais générée au pré-rendu).
- Dates et heures : `lib/utils/douala-time.ts`, montants `formatXaf`.
- `TypeScript` strict : props typées, aucun `any`.
