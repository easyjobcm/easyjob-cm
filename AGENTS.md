# AGENTS.md — EasyJob CM

Source unique des consignes pour les agents (Copilot dans VS Code et en CLI,
Claude Code, autres assistants) et pour les développeurs. Les fichiers
`.github/copilot-instructions.md`, `.github/instructions/*` et
`.github/agents/*` y renvoient et n'ajoutent que des règles propres à leur
domaine. En cas de doute, le code et les migrations font foi : signale
l'écart au lieu de suivre une consigne qui ne correspond plus au dépôt.

## Projet

Plateforme de missions temporaires au Cameroun (Douala, Yaoundé) : candidats,
entreprises, administration. Application web installable (manifeste
`app/manifest.ts`, aucun service worker). Aucun paiement n'est effectué par
l'application à ce jour.

Références : [README](README.md) (démarrage), [SRS](documentations/SRS_EasyJob_CM_MVP.md),
[user stories](documentations/UserStories_EasyJob_CM_MVP.md),
[audit et suivi des lots](docs/audit/AUDIT.md), [plan](docs/audit/PLAN_ACTION.md).

## Stack

Les versions sont celles de `package.json` ; ne les recopie pas ailleurs.

- Next.js App Router (`app/`), React, TypeScript `strict`, Tailwind CSS 4.
- Supabase : Postgres (RLS), Auth, Storage, Realtime. Pile locale par la CLI
  `supabase` (devDependency).
- Zod (validation), react-hook-form, SWR, framer-motion, lucide-react.
- EasyBot : Vercel AI SDK (`lib/chat/`, `docs/chatbot.md`).
- Tests : Vitest (`tests/`) et preuves d'autorisation (`scripts/proof-*.ts`).

N'existent pas dans ce dépôt (ne pas les introduire sans décision) :
next-intl, next-pwa ou service worker, Three.js, lottie, `src/`,
`app/[locale]`, `messages/*.json`.

## Où intervenir

| Besoin | Emplacement |
|---|---|
| Pages et écrans | `app/**/page.tsx` (Server Component) + `*-client.tsx` (`"use client"`) |
| Routes HTTP | `app/api/**/route.ts` ; helpers `lib/api/` |
| Composants réutilisables | `components/ui/` (base), `components/<domaine>/` |
| Textes FR/EN | `lib/i18n/fr.ts`, `lib/i18n/en.ts` |
| Clients Supabase | `lib/supabase/` ; types générés `lib/database.types.ts` |
| Validation | `lib/validations/` (schémas partagés client et serveur) |
| Temps réel | `lib/realtime/` (client), fonctions `rt_*` (SQL) |
| Journaux d'erreurs | `lib/observability/server-log.ts`, `lib/api/errors.ts` |
| Schéma, droits, règles métier en base | `supabase/migrations/` |
| Scripts locaux, seed, preuves | `scripts/` ; procédure `docs/testing/local-proofs.md` |
| Déploiement | `docs/deployment/production.md`, `.github/workflows/` |

## Règles communes

### Réutiliser avant de créer

- Cherche un composant, un hook ou un helper existant (`components/ui`,
  `components/<domaine>`, `lib/utils`, `lib/<domaine>`) avant d'en écrire un.
  Exemples : `toast()` (`hooks/use-toast.ts`), `ReputationStars`,
  `MissionPay`, `UrgentBadge`, `formatXaf`, `doualaDateTime`,
  `loginHref`/`safeInternalPath`, `isCompanyRole`, `isAdminRole`.
- Couleurs par jetons Tailwind (`primary` = violet `#7C3AED`, `muted`,
  `destructive`…, `app/globals.css`), pas de nouvelle couleur en dur.
- Mobile d'abord (375 px), sans défilement horizontal ;
  `env(safe-area-inset-bottom)` sur tout élément fixé en bas.
- framer-motion pour les animations et retours tactiles, en respectant
  `useReducedMotion`.

### Textes FR/EN

- Tout texte visible passe par `useI18n()` (`lib/i18n`) : clé ajoutée dans
  `fr.ts` **et** `en.ts` (le type de `en` dérive de `fr`). Pluriels :
  `plural()` (`lib/i18n/plural.ts`). Dates : `lib/utils/douala-time.ts`
  (fuseau `Africa/Douala`).
- Les routes renvoient des **codes** (`code: "cni_expired"`) ; l'écran les
  traduit. Ne change jamais un code existant : les écrans et les preuves en
  dépendent.
- N'annonce aucune fonction non livrée (paiement, retrait, séquestre, IA,
  essai gratuit, hors ligne…) : `tests/user-facing-claims.test.ts` échoue.

### Supabase et autorisations

- Clients typés seulement : `createClient()` de `lib/supabase/client.ts`
  (navigateur) ou de `lib/supabase/server.ts` (serveur, session de
  l'utilisateur, RLS appliquée). `createAdminClient()` (clé service) :
  serveur uniquement, pour une lecture ou écriture que la session ne peut pas
  faire, avec le contrôle de rôle **avant** l'appel et un commentaire qui
  justifie l'usage.
- La base est la frontière de sécurité : le navigateur appelle PostgREST
  directement. Une colonne qui porte un droit (rôle, statut, vérification,
  montant, réputation…) n'est jamais écrite par le client : privilèges de
  colonnes + trigger fondé sur `current_user`, et écriture par une RPC
  `SECURITY DEFINER` gardée (`is_admin_user()` et grade). Une route ne fait
  que valider (Zod), appeler la RPC et traduire ses codes.
- Un grade admin ne s'exerce que sur un compte actif : `is_admin_user()` et
  `is_ops_admin_user()` exigent `is_active is not false`, et toute lecture
  du grade de session dans une route ou une page admin filtre
  `.not("is_active", "is", false)` (`tests/admin-guard.test.ts`). Un nouveau
  contrôle de rôle en SQL passe par ces fonctions, jamais par un rôle écrit
  en dur.
- Pages `app/admin/**` : le layout ne suffit pas (il ne se réexécute pas à
  chaque navigation). Toute page qui lit en clé service appelle
  `requireAdminPage()` (`lib/auth/admin-page.ts`) avant la lecture ; les
  routes `/api/admin/*` revérifient le rôle elles-mêmes.
- Jamais d'exposition aux entreprises du téléphone, de l'email, de la CNI,
  du Mobile Money ou du domicile d'un candidat (`company_job_applicants`
  expose les colonnes autorisées). Les avis ne sont lisibles que par
  l'administration ; les tiers ne voient que les étoiles.
- Tables hors MVP, à ne pas utiliser : `wallets`, `withdrawal_requests`,
  `payment_batches`. Aucune logique de paiement côté client.
- Après une migration, régénère `lib/database.types.ts` depuis une pile
  locale (la CI compare le fichier au schéma).

### Temps réel

- Signal privé minimal puis relecture : un trigger appelle
  `rt_signal_users` / `rt_signal_admin` / `rt_signal_public_jobs` ; la charge
  utile ne contient que `{ d, r }` (domaine, ressource), jamais de données.
  Canaux `user:<uid>`, `admin`, `jobs:public`, autorisés par RLS sur
  `realtime.messages`.
- Côté écran : `useLiveRefresh` ou `<LiveRefresh keys={[…]} />`
  (`lib/realtime/provider.tsx`), qui relisent par les routes ou la session.
  Pas de `postgres_changes` sur une table sensible ; aucune émission depuis
  le client.

### Erreurs et journaux

- Réponse 500 : `internalErrorResponse(op, error, { code, request })`
  (message générique, code, identifiant de requête). Journal :
  `logServerError` / `logServerWarning`. Jamais `error.message`, `details`,
  numéro, email, code OTP, jeton ou URL signée dans une réponse ou un
  journal. Aucun `console.*` dans `app/api` ni `lib/api` (test).
- Sans session : `loginHref(chemin)` ; jamais de redirection vers une URL
  fournie par le client sans `safeInternalPath`.

### TypeScript et validation

- Jamais `any`. Validation Zod côté client **et** serveur, schémas dans
  `lib/validations/` ; la base revérifie les règles métier.

## Bases et tests

| Cible | Où | Usage |
|---|---|---|
| Pile de développement `easyjob-cm` | API `127.0.0.1:54321` | `pnpm dev`, seed, essais manuels |
| Pile de preuve `easyjob-proof` | API `127.0.0.1:54421`, hors du dépôt | `pnpm test:rls` uniquement (données effacées) |
| Projet distant | `*.supabase.co` | Production : jamais de seed, de preuve ni d'écriture de test |

`pnpm env:target` indique la base visée par `.env.local` sans afficher de clé.

Avant de proposer une modification : `pnpm typecheck`, `pnpm lint`,
`pnpm exec prettier --check .`, `pnpm test`, `pnpm build`. Si elle touche
une route, une RPC, une politique, un trigger ou une preuve :
`pnpm test:rls` sur la pile de preuve
([procédure](docs/testing/local-proofs.md)). Une preuve ne lit jamais
`.env.local` et refuse toute cible non locale ; ne la contourne pas, et
n'ajoute pas de relance automatique qui masquerait une régression.

## Git

Branche par lot depuis `main-dev`, PR vers `main-dev`, puis `main-dev` →
`main` pour une version. Ne commite jamais `.env*` (sauf `.env.example`) ni
un rapport contenant des données personnelles. N'utilise pas `--no-verify`.

## Agents du dépôt

| Agent | Fichier | Usage |
|---|---|---|
| EasyJob Dev | `.github/agents/easyjob-dev.agent.md` | Développement général |
| EasyJob DB | `.github/agents/easyjob-db.agent.md` | Migrations, RLS, RPC |
| EasyJob Design | `.github/agents/easyjob-design.agent.md` | Interface et animations |
| EasyJob Review | `.github/agents/easyjob-review.agent.md` | Revue avant merge |
