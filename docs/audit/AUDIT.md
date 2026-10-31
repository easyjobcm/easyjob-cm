# Audit technique — EasyJob CM

| Élément | Valeur |
|---|---|
| Date | 2026-10-31 |
| Branche | `feat/admin-design-parity` |
| Commit | `801b696e13aa0805aa8754ff1e7816a857406324` (« chore: retirer le fichier message de commit temporaire ») |
| État de travail | Non versionnés : `.qwen/` (scripts et extraits SQL d'un test d'intrusion local), `security-report-2026-09-12.md`. Un stash `lint-staged automatic backup` existe. Rien n'a été modifié. |
| Méthode | Lecture ciblée du dépôt, des migrations et de la configuration, puis exécution locale des contrôles sûrs. Aucune base, aucun service distant ni aucun fournisseur (SMS, email, paiement, LLM) n'a été sollicité. |
| Audit antérieur | `security-report-2026-09-12.md` (non versionné). Ses constats F1 à F8 ont été **revérifiés statiquement** dans les migrations et le code. Ses preuves dynamiques n'ont **pas** été rejouées. |

Légende du statut de chaque constat : **Confirmé** (vérifié dans le code ou le SQL du dépôt), **À vérifier** (hypothèse plausible, non démontrée), **Bloqué** (impossible à vérifier depuis le dépôt).

---

## 1. Synthèse

Le dépôt est sérieux sur plusieurs points : RLS activée sur les 32 tables, uploads contrôlés (octets magiques, taille, bucket privé, URL signées de 60 s), RPC admin `SECURITY DEFINER` avec garde interne et `audit_logs`, triggers qui protègent les statuts CNI/MoMo/compétences, quotas SMS/email, migrations commentées avec instructions de rollback, CI qui rejoue les migrations et vérifie les types générés. Le typage, le lint, le format, les 125 tests unitaires et le build passent.

En revanche, **la frontière de sécurité réelle est la RLS Supabase**, parce que le navigateur écrit directement en base sur la plupart des parcours. Or plusieurs politiques « propriétaire » autorisent la modification de **toutes les colonnes**, y compris celles qui portent des droits. Principaux risques :

1. **Tout compte authentifié peut devenir administrateur** (`users.role` modifiable par l'utilisateur, insertion libre dans `users`, et `finalizeSignup` qui reprend `user_metadata.role`). Il obtient alors l'accès aux CNI, numéros MoMo et données de tous les candidats.
2. **Les contrôles métier sont contournables** : un candidat peut s'attribuer `sandbox_level`, le premium, le permis vérifié, insérer une candidature sans passer par l'API, ou passer sa candidature à `selected`. Une partie peut aussi modifier librement un contrat ou une mission.
3. **Plusieurs parcours essentiels ne fonctionnent pas de bout en bout** : la modération des offres est sans effet, aucune mission ni aucun contrat n'est créé après la sélection, le pointage candidat est refusé silencieusement par la RLS, et le paiement n'est pas implémenté.
4. **Next.js 16.2.6 est concerné par des avis critiques publiés** (RCE dans l'Image Optimizer, contournement du Proxy). La mise à jour est peu coûteuse.
5. **Les erreurs restent invisibles** : la fonction `toast` ne fait qu'écrire dans la console, les erreurs Supabase sont ignorées et aucun outil d'observabilité n'est en place.

Ces constats ne permettent pas de déclarer l'application prête pour un usage public tant que les lots 0 à 2 du plan d'action ne sont pas traités.

---

## 2. Inventaire technique (constaté)

| Domaine | Constat | Preuve |
|---|---|---|
| Architecture | Application Next.js monolithique (App Router), sans monorepo. Pages sous `app/`, 30 route handlers sous `app/api/`, une server action (`lib/actions/auth.ts`), un Proxy (middleware) `proxy.ts`. | `app/`, `proxy.ts`, sortie du build |
| Langage / framework | TypeScript 5 (`strict: true`), Next.js **16.2.6** (Turbopack), React 19.2.4 | `package.json`, `tsconfig.json`, `node_modules/*/package.json` |
| Gestionnaire / runtime | pnpm (lockfile v9, pnpm 11.1.3 en local, 10 en CI), Node 22 (`engines: 22.x`, local 22.17.1) | `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/workflows/ci.yml` |
| UI | Tailwind 4, composants maison de type shadcn (`components/ui`), framer-motion 11.18, lucide-react | `package.json`, `components/ui/` |
| i18n | **Contexte React maison** (`lib/i18n/index.tsx`, `fr.ts`/`en.ts`, environ 1 650 lignes chacun). `next-intl` est installé mais **jamais importé**. | `grep next-intl` : aucun import |
| Validation | Zod 4.4.3 (`lib/validations/*`), react-hook-form | `lib/validations/` |
| Données | Supabase Postgres + Auth (GoTrue) + Storage + Realtime. Accès via `@supabase/ssr` 0.10.3. **Clients non typés** (pas de générique `Database`). | `lib/supabase/*.ts` |
| Schéma / migrations | 22 migrations SQL, dont une baseline de 2 400 lignes extraite de la production (`20260526130000_remote_baseline.sql`) et un dossier `_archive`. Types générés dans `lib/database.types.ts`, **avec un doublon obsolète** `database.types.ts` à la racine. | `supabase/migrations/` |
| Stockage fichiers | Bucket privé `candidate-documents` (limite de taille et types MIME), politiques par préfixe `user_id` | `20260902100000_candidate_documents_storage.sql`, `20260903100000_*` |
| Auth / rôles | Email + mot de passe, OTP email, OTP SMS (`phone_change`), Google OAuth optionnel. Rôles `candidate(_premium)`, `company(_premium)`, `admin_support/ops/founder`, portés par `public.users.role` et copiés dans `app_metadata.role`. Pas de multi-organisation (une entreprise = un utilisateur). | `lib/actions/auth.ts`, `lib/supabase/middleware.ts`, `is_admin_user()` |
| Temps réel / async | Realtime sur `candidate_profiles` (`lib/hooks/use-realtime-sync.ts`). pg_cron `cleanup-unconfirmed-signups` toutes les 15 min s'il est disponible. Aucun job applicatif ni file d'attente. | migrations `20260605…`, `20260529100000…` |
| Notifications | Table `notifications`, écrite par les RPC et routes admin, lue par `/api/notifications`. Ni push ni SMS métier. | `app/api/notifications/` |
| Intégrations | Twilio (SMS Auth, configuré côté Supabase), SMTP Supabase. **LLM via Vercel AI SDK** (`/api/chat`, modèle `openai/gpt-5-mini` via la passerelle IA). Mobile Money : code présent mais **non utilisé** (`lib/payments/mobile-money.ts`, importé nulle part). | `.env.example`, `app/api/chat/route.ts` |
| Tests | Vitest 3 : 7 fichiers, 125 tests de fonctions pures. Scripts `scripts/proof-*.ts` : preuves d'intégration manuelles contre Supabase local, **absentes de la CI**. | `tests/`, `scripts/`, `ci.yml` |
| Qualité | ESLint 9 (`next/core-web-vitals` + `typescript`), Prettier 3.6.2, Husky (pre-commit : lint-staged ; pre-push : tsc, eslint, prettier) | `.husky/`, `eslint.config.mjs` |
| CI/CD | GitHub Actions : `ci.yml` (types, lint, format, reset des migrations et diff des types, build), `release.yml` (bump et tag avec un PAT), `deploy.yml` (`supabase db push` puis Vercel) | `.github/workflows/` |
| Hébergement | Vercel (prod), Supabase cloud. Aucun conteneur applicatif (Docker sert seulement à Supabase local). | `deploy.yml`, `README.md` |
| PWA | `app/manifest.ts` et `public/manifest.json` (doublon), icônes générées. **Pas de service worker** (`next-pwa` absent). | `app/manifest.ts`, `public/` |
| Observabilité | Aucune (pas de Sentry ni d'équivalent). Uniquement `console.*`. | recherche `sentry|posthog|…` : rien |
| Outils IA | `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/*`, `.github/agents/*` (4 agents), `.agents/skills/supabase` | fichiers cités |

**Outils mentionnés dans la documentation mais absents du code** : Next.js 14, Three.js / @react-three/fiber, lottie-react, next-pwa, next-intl (installé mais inutilisé), arborescence `src/app/[locale]`, `messages/*.json`, `DESIGN_REFERENCE.md`, `COPILOT_INSTRUCTIONS.md`.
**Code configuré mais inutilisé** : `lib/payments/mobile-money.ts`, `_ensureUserAndProfile`, fonction SQL `handle_new_user()` (non rattachée à un trigger), `database.types.ts` (racine), `/api/payments/withdraw` (répond toujours 410).

---

## 3. Couverture de l'audit

| Zone | Niveau |
|---|---|
| Politiques RLS, grants, triggers, fonctions `SECURITY DEFINER` (migrations) | **Inspecté** (recherche exhaustive des `CREATE POLICY` et `TRIGGER`, lecture des politiques critiques) |
| Auth (server actions, callback OAuth, middleware, admin layout) | **Inspecté** |
| Parcours candidature, sélection, mission, contrat, avis, publication et modération d'offre | **Inspecté** (`apply`, `company/jobs/*`, `missions/[id]`, `contracts/[id]`, `api/jobs`, `api/admin/jobs`) |
| Routes admin (`app/api/admin/*`) | **Échantillonné** (`moderate`, garde de rôle commune) ; le reste s'appuie sur le rapport antérieur et sur le motif `isAdminRole`, observé de façon cohérente |
| Uploads documents (`api/profile/documents`, `skill-documents`) | **Échantillonné** (validations repérées par recherche, non lues ligne à ligne) |
| UI / textes / i18n | **Échantillonné** (`toast`, pages mission, contrat et entreprise, promesses dans `lib/i18n/fr.ts`) |
| CI/CD, scripts, configuration | **Inspecté** |
| Profils candidat (édition, compétences, disponibilités), matching, notifications, earnings, tasks | **Échantillonné** (cartographie des accès en base uniquement) |
| État réel de la base de production (politiques, pg_cron, comptes admin), réglages Vercel/Supabase distants, protection de branches GitHub | **Bloqué** : non vérifiable depuis le dépôt |
| Tests navigateur, accessibilité, performances réelles sur mobile ou réseau lent, Lighthouse | **Non réalisé** : aucun navigateur piloté, pas d'application lancée |
| Scripts `proof-*` (intégration RLS) | **Non exécutés** : ils écrivent des données et exigent Supabase local, qui n'a pas été démarré pour ne pas appliquer de migrations |

---

## 4. Contrôles exécutés

Tous les contrôles ont été lancés localement le 2026-10-31, sans réseau sauf pour `pnpm audit` (registre npm, lecture seule).

| Commande | Résultat | Interprétation / limite |
|---|---|---|
| `pnpm exec tsc --noEmit` | ✅ 0 erreur | Limite forte : les clients Supabase ne sont pas typés, donc `tsc` ne détecte ni les tables ni les colonnes inexistantes (exemple : `.from("companies")`, voir F-14). |
| `pnpm exec eslint . --max-warnings=0` | ❌ 24 erreurs et 5 avertissements, **tous dans `.qwen/`** (non versionné) | Avec `--ignore-pattern '.qwen/**'` : ✅ 0 problème. La CI, qui n'a pas `.qwen/`, passerait. |
| `pnpm exec prettier --check .` | ❌ erreurs uniquement dans `.qwen/` | Avec `'!.qwen/**'` : ✅. |
| `pnpm exec vitest run` | ✅ 7 fichiers, 125 tests | Fonctions pures uniquement : aucune autorisation, RLS ou route n'est testée. |
| `pnpm build` avec des variables Supabase **factices pointant vers 127.0.0.1:59999** (comme en CI) | ✅ build réussi, 69 pages | `.env.local` vise un projet **non local** : il a été neutralisé par les variables du processus. Le build a régénéré `.next/` (artefact ignoré par Git). La police Google est téléchargée pendant le build. |
| `pnpm audit --json` | ⚠️ 7 critiques, 50 hautes, 44 modérées, 10 basses | Voir §5, F-08 et F-24. La plupart concernent des outils de développement (`pwa-asset-generator`, `eslint`). Les dépendances d'exécution concernées sont `next` (critique ou haute) et `zod` (haute). |
| Recherche de motifs de secrets (JWT, `sb_secret_`, clés AWS) dans les fichiers versionnés, l'historique Git et `.qwen/` | ✅ aucune correspondance | Recherche par motifs seulement. `.env` et `.env.local` sont bien ignorés par Git et n'ont jamais été commités. Leurs valeurs n'ont pas été lues. |
| Contrôle RLS : tables `public` sans `ENABLE ROW LEVEL SECURITY` | ✅ aucune sur 32 | Le problème se situe dans le **contenu** des politiques, pas dans leur absence. |

---

## 5. Constats confirmés

Les numéros de ligne renvoient au commit audité. « baseline » désigne `supabase/migrations/20260526130000_remote_baseline.sql`.

### P0 — Urgence (compromission possible par tout compte)

> **Suivi** : F-01, F-02 et F-03 sont **corrigés et vérifiés localement** sur la branche `fix/lot-01-account-security` (non commités, **non déployés**). Voir §9.

| ID | Prio | Constat | Preuve fichier | Impact | Correction minimale | Validation attendue |
|---|---|---|---|---|---|---|
| F-01 | P0 | `users` : la politique UPDATE « Users can update own profile » ne restreint aucune colonne. Seul `is_verified` est protégé par trigger. `role`, `is_active`, `phone_verified`, `no_show_count`, `ban_*` sont modifiables par l'utilisateur lui-même. | baseline:2017 ; `20260911120000_cni_verification_flow.sql:186-207` ; `is_admin_user` baseline:307 | Un `PATCH /rest/v1/users {role:"admin_founder"}` suffit pour devenir admin et lire CNI, MoMo et identité de tous les candidats (RLS `is_admin_user`). Un compte suspendu peut aussi se réactiver et le contrôle téléphone du middleware (`phone_verified`) peut être contourné. PoC réalisé en local par le rapport du 2026-09-12. | Trigger `BEFORE UPDATE` qui fige ces colonnes hors `easyjob.system_update`, sur le modèle de `protect_user_is_verified`. | Un test d'intégration (session candidate) qui modifie `role`, `is_active` et `phone_verified` voit ces colonnes inchangées ; les RPC admin continuent de fonctionner. |
| F-02 | P0 | `users` : la politique INSERT « Service role can insert users » a `WITH CHECK (true)` **sans clause `TO`**, et `anon`/`authenticated` ont `GRANT ALL`. | baseline:1992, 2330-2342 (grants) | Un utilisateur inscrit directement via GoTrue (`enable_signup = true`) n'a pas encore de ligne `users`. Il peut l'insérer lui-même avec `role = admin_founder`. | Supprimer la politique (`service_role` contourne déjà la RLS) ou la limiter `TO service_role`. | Un INSERT `users` en session `authenticated` ou `anon` est refusé (42501). |
| F-03 | P0 | `finalizeSignup` recopie `user_metadata.role` (modifiable par le client via `auth.updateUser({data})`) dans `users.role` **et** `app_metadata.role` avec la clé service. | `lib/actions/auth.ts:521-545` | Escalade en admin après une vérification SMS réelle, même si F-01 et F-02 sont corrigés. | Accepter uniquement `candidate` ou `company` (liste blanche), sinon `candidate`. Ne jamais écraser un rôle existant. | Test unitaire de la fonction de normalisation ; un signup avec `data.role = "admin_founder"` donne `candidate`. |

### P1 — Risque majeur ou parcours essentiel bloqué

| ID | Prio | Constat | Preuve fichier | Impact | Correction minimale | Validation attendue |
|---|---|---|---|---|---|---|
| F-04 | P1 | `candidate_profiles` : UPDATE sans restriction de colonnes. `sandbox_level`, `premium_until`, `driving_license_verified`, `profile_completion_pct`, `onboarding_status`, `reliability_score`, `completed_missions` sont modifiables par le candidat. | baseline:1902 ; contrôles qui lisent ces colonnes : `app/api/jobs/[id]/apply/route.ts` | Contournement de tous les contrôles de candidature (niveau, 60 %, permis) et premium gratuit. Le score de fiabilité affiché aux entreprises devient falsifiable. | Trigger qui fige ces colonnes (même motif que CNI/MoMo). Le calcul du pourcentage passe côté serveur ou SQL. | Test d'intégration en session candidate : colonnes inchangées. |
| F-05 | P1 | `job_applications` : le candidat peut **insérer directement** (politique INSERT sur `candidate_id` seulement) et **mettre à jour** n'importe quelle colonne de sa candidature (`status = 'selected'`, `match_score`…). | baseline:1861, 1896 | Les contrôles de `/api/jobs/[id]/apply` (vérifié, suspendu, niveau, documents, places) ne servent à rien : un appel PostgREST les contourne. | Retirer l'INSERT direct (création via une RPC `SECURITY DEFINER` qui applique les contrôles) ; limiter l'UPDATE candidat au passage `pending → withdrawn`. | Insertion directe refusée ; passage à `selected` par le candidat refusé ; la route `apply` reste fonctionnelle. |
| F-06 | P1 | `subscriptions` : un utilisateur peut insérer son propre abonnement (`plan`, `price`, `expires_at` libres). | baseline:2167 | Premium entreprise ou candidat sans paiement (`lib/utils/profile-status.ts` et `company-plan.ts` lisent cette table). | `WITH CHECK (is_admin_user(auth.uid()))`, ou création par le serveur seulement. | INSERT en session non admin refusé. |
| F-07 | P1 | `contracts` et `missions` : les politiques UPDATE des parties ne restreignent pas les colonnes. Le statut du contrat est calculé dans le navigateur et la signature est stockée en data-URL. L'entreprise peut modifier `payment_status`, `platform_fee`, `actual_*_time`, `validated_at` de ses missions. | baseline:2005 (contracts), 1949 (missions) ; `app/contracts/[id]/page.tsx:229-262` | Un candidat peut passer un contrat à `completed` sans signature de l'entreprise, ou modifier `contract_data`. Une entreprise peut modifier les heures ou les statuts de paiement. Le contrat n'a aucune valeur probante (pas d'horodatage serveur, d'IP ni d'empreinte). | RPC `sign_contract` (horodatage, IP et rôle côté serveur, transition contrôlée) et RPC de validation des heures. Retirer l'UPDATE direct ou le limiter par trigger. | Tests de transition : signature unilatérale → `candidate_signed` seulement ; modification de `contract_data` par une partie refusée. |
| F-08 | P1 | Next.js **16.2.6** : avis critiques publiés (RCE dans l'Image Optimizer pour SVG/AVIF, RCE `use cache`, RCE `next/og`) et hauts (contournement Proxy/middleware avec Turbopack, SSRF, DoS Server Actions). | `pnpm audit` ; `package.json` | Applicabilité non démontrée : l'application n'utilise pas `next/image`, `next/og` ni `use cache`, mais l'endpoint `/_next/image` existe par défaut, et le Proxy est utilisé pour l'authentification. Mise à jour peu coûteuse. | Monter `next` et `eslint-config-next` sur la dernière version 16.x qui corrige tous les avis listés (> 16.4.0 selon l'audit), puis relancer `pnpm audit`. | `pnpm audit --prod` sans avis `next` critique ou haut ; build, lint et tests verts. |
| F-09 | P1 | Publication d'offre bloquée. (a) L'UI insère l'offre directement (`status: "pending_review"`) en contournant `/api/jobs` POST, qui contrôle la vérification de l'entreprise et le statut `is_active`. (b) Aucune politique ne permet à l'admin de **lire** ou de **modifier** une offre non `active` : le tableau de bord admin et la route `moderate` (session admin) agissent sur 0 ligne et renvoient pourtant un succès. (c) L'entreprise peut aussi passer elle-même son offre à `active` (politique FOR ALL). | `app/company/jobs/new/page.tsx:134-155` ; `app/api/jobs/route.ts:193` ; politiques jobs baseline:1932 et `20260908120000_*:38` ; `app/api/admin/jobs/[id]/moderate/route.ts:46-55` ; `app/admin/dashboard/page.tsx:16-23` | Le parcours honnête bloque : l'offre n'est jamais publiée. Le parcours malveillant contourne la modération. | Un seul chemin de création (route serveur), une RPC `moderate_job` admin avec audit, un trigger qui interdit à l'entreprise de modifier `status` hors brouillon, et un statut unique (`pending_moderation` **ou** `pending_review`). | Test bout en bout : création → visible dans la file admin → approbation → visible par les candidats ; passage direct à `active` par l'entreprise refusé. |
| F-10 | P1 | Cycle mission incomplet. Aucun code ne crée de `missions`, `contracts` ni `payments` après la sélection. Le pointage candidat fait un `UPDATE missions` alors qu'**aucune politique UPDATE candidat** n'existe : 0 ligne modifiée, pas d'erreur, l'UI affiche « Pointage enregistré ». Les erreurs d'insertion de `mission_check_ins` sont ignorées. La distance (500 m) est contrôlée seulement dans le navigateur. `positions_filled` est incrémenté en lecture puis écriture (perte en cas de concurrence). La notification de sélection annoncée n'est pas envoyée. | `app/company/jobs/[id]/page.tsx:140-185` ; `app/missions/[id]/page.tsx:159-275` ; absence de politique : liste des politiques baseline | Le parcours central de la plateforme (sélection → mission → pointage → validation → paiement) ne fonctionne pas, et ce qui existe se falsifie facilement. | RPC transactionnelles `select_candidate` (crée mission et contrat, incrémente de façon atomique avec verrou, notifie), `check_in` et `check_out` (distance calculée côté serveur, idempotence par type). Voir le plan, lot 5. | Test d'intégration du parcours complet, plus un test de concurrence sur la dernière place. |

### P2 — Fiabilité, sécurité secondaire, maintenance

| ID | Prio | Constat | Preuve fichier | Impact | Correction minimale | Validation attendue |
|---|---|---|---|---|---|---|
| F-11 | P2 | `otp_codes` (table héritée, inutilisée par l'app) : SELECT `USING (true)`, INSERT et UPDATE `true`, `GRANT ALL` à `anon`. | baseline:1845, 1849, 2030, 2330 | Lecture et réécriture des codes stockés par n'importe quel appelant. | Supprimer la table si elle est vide et inutile, sinon révoquer `anon` et `authenticated`. | `GET /rest/v1/otp_codes` refusé. |
| F-12 | P2 | Le code OTP SMS et le numéro sont **journalisés en clair** (`console.log … token`). | `lib/actions/auth.ts:476-479` | Toute personne qui a accès aux logs Vercel peut valider le téléphone d'un tiers pendant la validité du code. Données personnelles dans les logs. | Supprimer le log ou masquer le numéro et le code. | Recherche : aucun `token` journalisé. |
| F-13 | P2 | Callback OAuth : `next` n'est pas validé (`${origin}${next}`). Une valeur `next=@domaine-tiers` produit une redirection ouverte. Si `next` contient `/signup/company`, l'`upsert` **écrase le rôle** d'un compte existant. | `app/auth/callback/route.ts:13-52` | Hameçonnage après connexion. Un candidat peut se changer en entreprise, ou un admin être rétrogradé, en se reconnectant par OAuth avec ce paramètre. | N'accepter que des chemins relatifs commençant par `/` et pas par `//` ni `/\`. N'upserter le rôle que si la ligne n'existe pas. Créer la page `/auth/error`, qui n'existe pas. | Tests unitaires du filtre `next` ; un utilisateur existant garde son rôle. |
| F-14 | P2 | Clients Supabase **non typés**, donc des erreurs de schéma passent `tsc`. Exemple : l'onboarding entreprise écrit dans une table inexistante `companies` et tente `users.is_verified = true` (neutralisé par trigger), erreurs ignorées. | `lib/supabase/client.ts`, `server.ts` ; `app/onboarding/company/page.tsx:112-134` | Les informations d'onboarding entreprise sont perdues sans message. D'autres décalages de schéma sont probables mais non mesurés. | `createBrowserClient<Database>` et `createServerClient<Database>`, puis corriger les erreurs révélées. | `tsc` vert avec clients typés. |
| F-15 | P2 | `/api/chat` : public (le middleware laisse passer `/api/*`), sans authentification, quota, limite de taille ni validation Zod. Appelle un LLM payant. Le prompt système promet des **retraits Mobile Money avec 2 % de frais et un paiement sous 48 h**, alors que le MVP l'interdit. | `app/api/chat/route.ts` ; `lib/supabase/middleware.ts:5` | Abus de coût, et informations fausses données aux utilisateurs. La variable de la passerelle IA n'est pas documentée dans `.env.example`. | Authentification, quota par utilisateur et par IP, limite de messages et de taille, prompt aligné sur les règles réelles. Ou retirer le chatbot du MVP. | Requête anonyme → 401 ; requête trop grosse → 413. |
| F-16 | P2 | Politique « Companies can view candidate summaries » posée sur **`company_profiles`** : toute entreprise lit tous les profils d'entreprise (NIU, email de contact…). À l'inverse, aucune politique ne permet à une entreprise de voir le nom ou la photo de ses candidats : la liste des candidatures s'affiche sans identité. | baseline:1963 ; `app/company/jobs/[id]/page.tsx:115-131` | Fuite de données entre concurrents, et fonction de sélection inutilisable. | Remplacer par une vue ou une RPC qui expose les colonnes autorisées des candidats ayant postulé aux offres de l'entreprise (jamais téléphone, email, CNI, MoMo). Supprimer la politique erronée. | Une entreprise A ne lit pas l'entreprise B ; elle voit prénom, initiale et photo de ses candidats seulement. |
| F-17 | P2 | Annulation de candidature : aucune politique DELETE sur `job_applications`. La route renvoie `success` sans rien supprimer. | `app/api/jobs/[id]/apply/route.ts:200-215` ; politiques baseline | L'utilisateur croit avoir annulé. | Passer en `status = 'withdrawn'` (UPDATE contrôlé) et vérifier le nombre de lignes modifiées. | Après annulation, le statut vaut `withdrawn`. |
| F-18 | P2 | Le retour utilisateur est factice : `toast()` ne fait que `console.info`. Les pages mission, contrat et offres entreprise, ainsi que l'onboarding, ne montrent jamais les erreurs. Les liens `/login` et `/auth/error` mènent à des 404. | `hooks/use-toast.ts` ; `app/missions/[id]/page.tsx:93` ; `app/contracts/[id]/page.tsx:111` ; `app/company/jobs/[id]/page.tsx:101` | Échecs silencieux sur les parcours critiques et utilisateurs bloqués. | Un vrai composant de notification accessible (`role="status"`), routes corrigées. | Test de composant ; vérification manuelle sur mobile. |
| F-19 | P2 | Les textes promettent des fonctions **absentes du code** : paiement 100 % en 48 h ou 50/50, « montant bloqué » et remboursements, « remplacement garanti », « l'IA sélectionne pour vous », « essai gratuit 7 jours ». Aucun paiement, séquestre ni IA de sélection n'est implémenté (`lib/matching/ai-matching.ts` est heuristique). | `lib/i18n/fr.ts:1151-1189, 1310, 1353-1371` ; `lib/payments/mobile-money.ts` non importé | Promesses commerciales non tenues, avec un risque de confiance et un risque juridique (droit de la consommation et règles de communication commerciale à faire valider). | Retirer ou marquer « bientôt » ce qui n'existe pas. | Relecture produit : chaque promesse correspond à une fonction livrée. |
| F-20 | P2 | CI et déploiement : Vitest **n'est pas exécuté en CI**. Le build ne dépend pas de `test-migrations`. `deploy.yml` utilise `supabase` et `vercel` en version `latest`. Aucune sauvegarde ou vérification n'est faite avant `db push` en production. Un « rollback » par tag redéploie l'application sans revenir sur la base. Le `db push` passe par le pooler 6543 (mode transaction), à vérifier. | `.github/workflows/ci.yml`, `deploy.yml` | Régressions non détectées, déploiements non reproductibles, migration destructive sans filet. | Ajouter `pnpm test`, figer les versions des CLI, faire dépendre le build de `test-migrations`, documenter la procédure de restauration (PITR ou sauvegarde) et l'utiliser avant `db push`. | La CI échoue si un test échoue ; versions figées. |
| F-21 | P2 | Aucun test d'autorisation automatisé. Les scripts `scripts/proof-*.ts` couvrent une partie de la RLS mais restent manuels et hors CI. Aucune preuve n'existe pour `users.role`, `job_applications`, `contracts` et `missions`. | `scripts/`, `tests/`, `ci.yml` | Les failles F-01 à F-07 auraient été détectées par une suite RLS négative. | Suite RLS « accès interdits » exécutée en CI sur la pile Supabase locale, qui existe déjà dans `test-migrations`. | Job CI `rls-tests` vert, et rouge si une politique est relâchée. |
| F-22 | P2 | Consignes IA obsolètes : `AGENTS.md` et les instructions Copilot imposent Next 14, next-intl, next-pwa, Three.js, lottie, `src/app/[locale]`, `messages/*.json`, et renvoient à `DESIGN_REFERENCE.md` et `COPILOT_INSTRUCTIONS.md`, qui n'existent pas. | `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/*` | Les agents génèrent du code incohérent avec le dépôt. | Aligner ces documents sur la stack réelle et sur les règles de sécurité de ce rapport (« jamais d'écriture directe sur une colonne porteuse de droits »). | Relecture : chaque outil cité existe. |
| F-23 | P2 | Aucune observabilité : ni capture d'erreurs, ni journalisation structurée. Préfixes de log `[v0]` hérités. `error.message` Postgres renvoyé au client. | recherche négative ; `app/api/jobs/route.ts:81, 200` | Les incidents de production restent invisibles et des détails de schéma sont exposés. | Messages d'erreur génériques côté client. Un outil de capture d'erreurs léger, ou au minimum des logs structurés exploitables dans Vercel. | Une erreur serveur provoquée en préproduction est visible avec son contexte. |
| F-24 | P2 | `zod` 4.4.3 : avis haut (épuisement mémoire sur collections volumineuses). Validation utilisée côté serveur. | `pnpm audit` | Déni de service ciblé possible sur les routes qui valident des tableaux. | Passer `zod` à ≥ 4.6.6. | `pnpm audit` sans avis `zod`. |

### P3 — Améliorations secondaires

| ID | Prio | Constat | Preuve fichier | Correction minimale |
|---|---|---|---|---|
| F-25 | P3 | Pas de `Content-Security-Policy` (les autres en-têtes sont présents). | `next.config.ts` | CSP d'abord en `Report-Only`, puis appliquée. |
| F-26 | P3 | `enforce_salary_lock` s'appuie sur `auth.jwt()->>'role'`, qui ne vaut jamais `admin_founder` : le verrou bloque aussi les admins (échec sans faille). | `20260604120000_srs_v12_plans_alignment.sql:213` | Utiliser `is_admin_user()` et le grade. |
| F-27 | P3 | Code mort ou dupliqué : `database.types.ts` racine (1 893 lignes contre 2 463), `lib/types.ts` et `lib/types/index.ts`, `lib/payments/mobile-money.ts`, `_ensureUserAndProfile`, `handle_new_user()` (accordé à `anon`), `public/manifest.json` en plus de `app/manifest.ts`, `next-intl` installé sans être utilisé, `/api/payments/withdraw`. | fichiers cités | Supprimer après vérification par recherche. |
| F-28 | P3 | i18n incohérente : chaînes françaises en dur et sans accents dans les pages mission, contrat et offres entreprise, alors qu'un dictionnaire existe. | `app/missions/[id]/page.tsx`, `app/contracts/[id]/page.tsx`, `app/company/jobs/*` | Migrer ces pages vers le dictionnaire au fil des lots fonctionnels. |
| F-29 | P3 | `.qwen/` (scripts d'intrusion, extraits du catalogue et des politiques SQL) n'est ni versionné ni ignoré. Un `git add .` le commiterait. Le rapport non versionné contient un email et un téléphone réels. | `git status` | **Traité le 2026-10-31** : `.qwen/` supprimé (aucune référence dans le projet). Reste à décider du sort du rapport non versionné. |
| F-30 | P3 | Fuseau horaire : aucune référence à `Africa/Douala`. Dates formatées avec `new Date()` ou `toLocaleDateString` côté serveur (UTC sur Vercel) et côté client. | recherche `timeZone` : aucun résultat | Formater avec `timeZone: "Africa/Douala"` et stocker en `timestamptz`. À traiter avec le lot pointage. |
| F-31 | P3 | Le layout admin sert de seule garde aux pages `app/admin/**`. Le risque est faible tant que ces pages utilisent la session (RLS) et non `createAdminClient`, ce qui est le cas aujourd'hui. | `app/admin/layout.tsx` | Garder la règle « pas de service_role dans les pages admin » ; recontrôler le rôle dans toute page qui en aurait besoin. |

---

## 6. Hypothèses à vérifier (non démontrées)

| ID | Prio provisoire | Hypothèse | Pourquoi | Comment vérifier sans risque |
|---|---|---|---|---|
| H-01 | P0 si confirmée | La base de **production** contient les mêmes politiques que la baseline (F-01 à F-07, F-11). | La baseline a été extraite de la production (« remote_baseline »), mais l'état actuel n'est pas visible depuis le dépôt. | Requête en **lecture seule** sur `pg_policies` et `pg_trigger` en production (Studio, avec un rôle en lecture). |
| H-02 | P1 | Des comptes ont déjà exploité F-01 à F-06 (rôles admin inattendus, `sandbox_level` ou `premium_until` incohérents, abonnements à prix 0). | Les failles sont exploitables par tout compte. | Requêtes de comptage en lecture seule : `users` par rôle ; `candidate_profiles` avec `sandbox_level > 0` sans mission terminée ; `subscriptions` avec `price = 0`. |
| H-03 | P2 | Le cron `cleanup_unconfirmed_signups` supprime tout compte à l'email confirmé et **sans téléphone** au bout de 30 minutes. `scripts/create-admin.ts` crée des admins sans téléphone. Avec `ON DELETE CASCADE` (baseline:1841), un admin créé ainsi disparaît. | Code et SQL lus ; pg_cron en production non vérifié. | Vérifier en production `cron.job` et la présence d'un téléphone sur les comptes admin (lecture seule). |
| H-04 | P2 | Le repli de `verifyPhoneOtpAction` (`freshUser.phone === e164` après une erreur SDK) peut valider un numéro sans code correct dans certains cas limites. | `lib/actions/auth.ts:483-497` | Test local : un code erroné ne doit jamais aboutir à `finalizeSignup`. |
| H-05 | P2 | `supabase db push` via le pooler 6543 (mode transaction) peut échouer ou appliquer partiellement des migrations à plusieurs instructions. | `deploy.yml` | Consulter l'historique des exécutions du workflow ; préférer la connexion directe (5432). |
| H-06 | P3 | Un compte réel de la base locale utiliserait l'un des numéros de test de `DEV_TEST_PHONES` (`lib/actions/auth.ts`), ce qui peut gêner les tests ou la production si `test_otp` y est actif. | Rapport du 2026-09-12 (non versionné) ; `supabase/config.toml` (local seulement) | Vérifier les réglages Auth du projet distant. |

---

## 7. Notes sur les points complexes

**Pourquoi la RLS est la vraie frontière.** Les pages client (`missions`, `contracts`, `company/jobs`, `onboarding`, `profile/skills`) appellent PostgREST directement avec le jeton de l'utilisateur. Toute colonne qu'une politique UPDATE laisse modifiable l'est donc **pour n'importe quel appel HTTP**, quels que soient les contrôles des routes `/api/*`. Le projet a déjà adopté le bon motif pour CNI et MoMo : trigger de protection, RPC `SECURITY DEFINER` et drapeau `easyjob.system_update`. La correction consiste à l'étendre aux autres colonnes porteuses de droits, pas à réécrire l'architecture.

**Données personnelles (questions réglementaires).** La plateforme traite des CNI (recto, verso, selfie), des numéros Mobile Money, la géolocalisation du domicile et la position de pointage. Il faut faire valider par une personne compétente : la base légale et la durée de conservation de ces données, la déclaration ou l'autorisation éventuelle auprès de l'autorité camerounaise compétente (loi n° 2024/017 sur la protection des données personnelles), l'information des personnes (les pages `privacy` et `terms` font 37 lignes) et la procédure de suppression de compte. Rien dans le code ne permet de conclure à une conformité. Aucun mécanisme de suppression ou d'export de compte n'a été repéré.

**Sauvegarde et restauration.** Rien dans le dépôt ne décrit la sauvegarde, la restauration ou le PITR Supabase. C'est un réglage distant (**Bloqué**), à documenter.

---

## 8. Reprise

Étapes non réalisées, à reprendre si besoin :

1. Lancer Supabase local et exécuter `scripts/proof-*.ts` pour mesurer la couverture RLS existante (écrit dans la base **locale** uniquement).
2. Rejouer en local les preuves dynamiques de F-01 à F-07 après chaque lot.
3. Faire un passage navigateur (Android et iOS, 375 px, réseau lent 3G) sur les parcours candidat et entreprise, avec un audit d'accessibilité.
4. Lire ligne à ligne les routes admin restantes et `api/profile/*`, seulement échantillonnées ici.

---

## 9. Suivi — Lot 1 : rôles et comptes (2026-10-31)

**Statut : corrigé et vérifié localement. Non commité, non déployé.** Aucune conclusion sur la production : H-01 (état réel des politiques et triggers en production) reste ouverte.

Branche `fix/lot-01-account-security`, créée depuis `origin/main-dev` (08af5df, merge de la PR #47, arbre identique à 801b696). Aucune dépendance vers un autre lot.

### Constats complémentaires trouvés pendant le lot

| ID | Constat | Traitement |
|---|---|---|
| F-02 (précision) | Avant correction, l'INSERT dans `users` était aussi possible en **`anon`**, pas seulement en session (prouvé lors du contrôle négatif). | Corrigé. |
| F-03b | `handle_new_user()` (`SECURITY DEFINER`) copiait `raw_user_meta_data->>'role'` sans liste blanche, avec `EXECUTE` accordé à `anon` et `authenticated`. La fonction n'est rattachée à aucun trigger dans les migrations, mais un trigger sur `auth.users` n'apparaîtrait pas dans la baseline, qui ne contient que le schéma `public`. | Neutralisé : liste blanche `candidate` / `company` et `EXECUTE` révoqué. La présence d'un trigger en production reste à vérifier (lot 0). |
| F-03c | Le callback OAuth faisait un `upsert` de `users.role` sur un compte existant. | Corrigé : insertion seule (`ignoreDuplicates`). La redirection ouverte (F-13) reste pour le lot 8. |
| F-03d | `_ensureUserAndProfile` (code mort) réécrivait le rôle par `upsert`. `create-admin.ts` écrivait le rôle dans `user_metadata`. | Fonction supprimée ; `user_metadata.role` retiré du script. |
| F-32 (P2, nouveau) | Les scripts `scripts/proof-*.ts` chargent `.env.local`, qui vise un projet **distant**. Lancés sans précaution, ils créent et suppriment des comptes sur ce projet. `pnpm seed`, lancé seul, avait le même défaut. `proof-license-gate` passait en plus par `supabase db query --local`, qui vise la pile de **développement** quel que soit l'environnement. | **Corrigé (finalisation du lot 1)** : `scripts/lib/local-supabase.ts` est appliqué aux 15 preuves et au seed (détails ci-dessous). |
| F-33 (P2, nouveau) | `proof-admin-cni.ts` : 9 assertions sur 24 échouent **avant comme après** ce lot (D1 `documents_not_submitted` puis des échecs en cascade). Le script semble antérieur à la purge immédiate des fichiers rejetés (commit 9524956). `proof-essentials-gate.ts` exige une entreprise déjà présente en base. | Non traité (hors lot). À corriger avant d'intégrer ces scripts en CI (lot 4). |

### Finalisation du lot 1 — garde-fou des scripts de preuve

- `scripts/lib/local-supabase.ts` :
  - `readLocalProofEnv()` lit seulement `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` et `NEXT_APP_URL`, jamais `.env.local` ni les variables `NEXT_PUBLIC_*`. Il refuse tout hôte autre que `localhost`, `127.0.0.1` ou `[::1]`, en analysant l'URL avec `URL` (`localhost.evil.com`, `localhost@evil.com` et `127.0.0.1.nip.io` sont refusés).
  - `readLocalDbUrl()` fait la même vérification pour `DB_URL` (`postgres(ql)://`).
  - Aucun contournement distant.
  - Le garde-fou garantit une **cible locale**, pas la **pile dédiée** : une adresse locale peut être celle de la pile de développement (port 54321). L'usage de la pile `easyjob-proof` repose sur la procédure. De même, vérifier `NEXT_APP_URL` ne dit pas quelle base le serveur Next utilise.
- Appliqué aux 14 preuves existantes et à `proof-account-security`. La vérification s'exécute au chargement du module, avant la création des clients, donc avant toute fixture ou tout nettoyage.
- `proof-license-gate` : `supabase db query --db-url <DB_URL vérifié>` remplace `--local`.
  **Incident observé pendant le premier rejeu (avant cette correction)** : `--local` a visé la pile de développement `easyjob-cm`, que Docker avait redémarrée. Deux requêtes y ont été envoyées, chacune avec un `candidate_id` qui n'existait que dans la pile dédiée :
  1. contrôle G1 : `INSERT INTO candidate_skills (…, 'Conduite moto', 3)` sans drapeau, refusé par le trigger de permis (`EASYJOB_LICENSE_REQUIRED`) ;
  2. contrôle G2 : bloc `DO` qui active `easyjob.system_update` puis refait le même `INSERT`, refusé par la contrainte `candidate_skills_candidate_id_fkey`.

  Chaque requête a échoué dans sa propre transaction. Une requête en lecture seule sur la pile de développement confirme 0 ligne `Conduite moto` et 0 utilisateur créés dans les 3 heures précédentes.
- `seed-test-data.ts` : simple vérification d'hôte. Le chargement de `.env.local` est conservé, car `bootstrap:local` y écrit les valeurs locales avant le seed.
- `scripts/init-proof-stack.ts` prépare une pile dédiée (`project_id` `easyjob-proof`, ports +100, Twilio, Google, Studio, Analytics et Edge désactivés). Procédure unique : `docs/testing/local-proofs.md`, référencée dans le README.
- Tests : `tests/local-supabase-guard.test.ts` (30 cas, dont les domaines trompeurs et la non-divulgation des clés dans les messages).

### Écritures applicatives sur `public.users` (inventaire vérifié)

| Chemin | Rôle d'exécution | Colonnes | Statut après le lot |
|---|---|---|---|
| Session utilisateur : `UPDATE users (locale)` | `authenticated` | `locale` | Autorisé. Aucun écran ne l'utilise aujourd'hui (la langue est gérée côté client). |
| Inscription et vérification téléphone : `finalizeSignup` (`verifyPhoneOtpAction`, y compris le contournement de développement et le repli SDK) | `service_role` | insertion si absente, puis `phone` et `phone_verified` | Fonctionne (preuves 5, 6, 7 et 10) |
| OAuth : `app/auth/callback/route.ts` | `service_role` | insertion si absente (`role` d'inscription, `email`, `locale`) | Fonctionne ; n'écrase plus un rôle existant. Non testé avec Google réel. |
| Admin : RPC `admin_set_user_active` | `SECURITY DEFINER` (propriétaire `postgres`) | `is_active` | Fonctionne (preuves 9 et `proof-admin-centralization` 24/24) |
| Vérification : RPC `recompute_user_verification` (appelée par `moderate_cni` et `apply_momo_verification`) | `SECURITY DEFINER` | `is_verified` (valeur dérivée) | Fonctionne (preuves 10, `proof-admin-momo-review`, `proof-profile-momo`) |
| `handle_new_user()` | trigger `SECURITY DEFINER` (absent en local) | insertion | Liste blanche ; non appelable par l'API |
| Outils d'exploitation `create-admin.ts` et `seed-test-data.ts` | `service_role` | toutes | Inchangés (le seed est désormais limité au local) |
| `app/onboarding/company/page.tsx` : `UPDATE users SET is_verified = true` en session | `authenticated` | `is_verified` | **Déjà neutralisé avant le lot** : le trigger `trg_protect_user_is_verified` annulait silencieusement la valeur. **Le refus (42501) est nouveau**, mais la page ignore l'erreur : l'effet visible et la valeur persistée sont identiques. La page était déjà défectueuse (insertion dans une table `companies` inexistante) ; sa réparation reste au lot 5 (F-14). |

L'édition du profil (`/api/profile/*`, `profile/candidate/edit`) n'écrit pas dans `users`. Elle passe par `candidate_profiles`, les RPC CNI/MoMo et `profile_update_requests`, que les preuves `profile-*` et `admin-*` vérifient sans régression. **Aucune régression d'écriture légitime n'a été constatée** et aucun droit n'a été rouvert.

### Revue ciblée du mécanisme (vérifiée sur la base locale)

- **Rôle d'exécution vu par le trigger** : `protect_user_account_columns` est `SECURITY INVOKER`, donc `current_user` est le rôle qui exécute l'instruction. Via PostgREST, c'est `authenticated` ou `anon`. Dans une fonction `SECURITY DEFINER`, c'est son propriétaire. Preuve dynamique : `admin_set_user_active` réussit, alors que le même changement par `PATCH` direct, même par un admin, est refusé (preuves 9).
- **Fonctions qui écrivent dans `users`** (catalogue `pg_proc`) : seulement `admin_set_user_active`, `recompute_user_verification` et `handle_new_user`. Toutes appartiennent à `postgres` et sont en `SECURITY DEFINER`, avec un `search_path` fixé (`public`, ou `''` pour `handle_new_user`). L'`EXECUTE` de `handle_new_user` est révoqué.
  - `admin_set_user_active` vérifie `is_admin_user(auth.uid())` et un grade ops/founder. Il refuse un compte admin et l'appelant lui-même.
  - `recompute_user_verification` est appelable par tout utilisateur et pour tout identifiant, mais n'écrit qu'une valeur **dérivée** de colonnes protégées (`cni_verified` et `momo_verified` par leurs triggers ; `users.phone` désormais), ainsi que du nom et de la date de naissance. Un utilisateur ne peut pas obtenir `is_verified = true` sans validation CNI et MoMo par un admin.
- **Gardes indirectes** : `is_admin_user` (`SECURITY INVOKER`) lit `users.role`, désormais non modifiable par le client. Le drapeau `easyjob.system_update` n'est activé que par 7 fonctions `SECURITY DEFINER` à garde interne ; `set_config` n'est pas exposé (404). Aucun trigger n'existe sur `auth.users` en local.
- **Créations répétées ou concurrentes** : `INSERT … ON CONFLICT DO NOTHING`, sans lecture préalable. Le rôle est relu depuis la base (preuves 6 et 7 : 6 finalisations concurrentes donnent 1 ligne et 1 profil, et le rôle admin est préservé).
- **Échec de synchronisation `app_metadata`** : l'échec reste non bloquant, par décision. La source de vérité est `public.users`, déjà à jour à ce stade, et le middleware relit `phone_verified` et le rôle en base quand `app_metadata` est absent. `app_metadata` n'est écrit qu'avec le rôle relu en base, jamais avec `user_metadata`. Il n'y a donc pas de faux privilège : au pire, `app_metadata` garde une ancienne valeur écrite par le serveur. Comme `finalizeSignup` est idempotent, un nouvel appel resynchronise. Ce cas est testé par la preuve 11 de `proof-account-security` : l'API Auth est mise en échec simulé et les écritures en base visent la vraie pile locale. Le résultat est `ok` ; `users.role` vaut `candidate` malgré `user_metadata.role = admin_founder` ; `app_metadata.role` reste absent pour un nouveau compte, ou garde l'ancienne valeur serveur pour un compte existant.

### Mécanisme retenu

Migration `supabase/migrations/20261031120000_lock_users_privileged_columns.sql` :

1. **Privilèges de colonnes**, la frontière principale. `anon` et `authenticated` perdent `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` et `TRIGGER` sur `users`. `authenticated` ne garde que `UPDATE (locale)`. Le refus est explicite (42501), y compris pour un appel PostgREST ou GraphQL direct. `SELECT` est conservé, car d'autres politiques et `is_admin_user` (`SECURITY INVOKER`) lisent `users`.
2. **Trigger `trg_protect_user_account_columns`**, en défense en profondeur. Il refuse toute écriture faite avec `current_user ∈ {anon, authenticated}` qui modifie autre chose que `locale` ou `updated_at`, ainsi que toute insertion. Les colonnes ajoutées plus tard sont protégées par défaut. Il ne dépend pas du drapeau `easyjob.system_update` : les écritures de confiance s'identifient par le rôle d'exécution (`service_role`, ou propriétaire d'une fonction `SECURITY DEFINER`), que le client ne peut pas changer.
3. Suppression de la politique « Service role can insert users ».
4. Réécriture de `handle_new_user()` avec une liste blanche du rôle, et `EXECUTE` révoqué.

Côté application :
- `lib/auth/finalize-signup.ts` (module serveur, volontairement hors `"use server"`) : `INSERT … ON CONFLICT DO NOTHING` avec le rôle normalisé, puis `UPDATE` limité à `phone` et `phone_verified`. `app_metadata.role` est recopié depuis la ligne en base. Un rôle existant n'est jamais réécrit, même en cas de finalisations concurrentes.
- `lib/auth/signup-role.ts` : `normalizeSignupRole` (`company`, sinon `candidate`) et `normalizeSignupLocale`.

**Sur le drapeau `easyjob.system_update`** : les 7 fonctions qui l'activent (`admin_edit_candidate_identity`, `apply_momo_verification`, `candidate_update_cni`, `candidate_update_momo`, `moderate_cni`, `recompute_skill_verification_status`, `recompute_user_verification`) sont toutes `SECURITY DEFINER`, avec `search_path = public` et une garde interne. `set_config` n'est pas exposé par PostgREST (HTTP 404 vérifié). Les gardes admin reposent sur `users.role`, désormais protégé.

### Fichiers

Nouveaux : la migration ci-dessus, `lib/auth/finalize-signup.ts`, `lib/auth/signup-role.ts`, `tests/signup-role.test.ts`, `scripts/proof-account-security.ts`.
Modifiés : `lib/actions/auth.ts`, `app/auth/callback/route.ts`, `scripts/create-admin.ts`, `scripts/proof-admin-cni.ts` (assertion E6 adaptée au refus explicite), `.github/instructions/database.instructions.md`.

Finalisation : `scripts/lib/local-supabase.ts`, `scripts/init-proof-stack.ts`, `tests/local-supabase-guard.test.ts` et `docs/testing/local-proofs.md` (nouveaux) ; les 14 `scripts/proof-*.ts` existants, `scripts/seed-test-data.ts` et `README.md` (§9, renvoi vers la procédure).

### Contrôles exécutés

Pile Supabase locale **isolée et jetable** (`project_id` `easyjob-lot1-test`, ports 544xx, fournisseurs Twilio et Google désactivés), avec toutes les migrations appliquées sur une base neuve. La pile de développement `easyjob-cm` n'a pas été touchée. La pile a été supprimée après les tests (`supabase stop --no-backup`).

| Commande | Résultat |
|---|---|
| `supabase start --workdir <pile>` (22 migrations, dont la nouvelle) | ✅ appliquées sans erreur |
| `supabase gen types … --local` comparé à `lib/database.types.ts` | ✅ identique (le contrôle de types de la CI reste vert) |
| `tsx scripts/proof-account-security.ts` (sessions réelles `anon`/`authenticated`) | ✅ 34/34 (cas 1 à 10 de la demande) |
| Contrôle négatif : état d'avant la migration recréé sur la pile jetable | ✅ 20 FAIL détectés, ce qui confirme F-01 et F-02 dynamiquement en local, y compris l'INSERT en `anon` |
| Contrôle « grants régressés » (`GRANT ALL` avec le trigger seul) | ✅ 34/34 : le trigger tient seul |
| `handle_new_user` attaché temporairement à `auth.users` dans une transaction annulée | ✅ `admin_founder` → `candidate`, `company_premium` → `candidate`, `company` → `company` ; `EXECUTE` refusé à `anon` et `authenticated` |
| `POST /rest/v1/rpc/set_config` | ✅ 404 (non exposé) |
| `vitest run` | ✅ 8 fichiers, 139 tests (dont 14 nouveaux) |
| `tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .` | ✅ |
| `pnpm build` (variables factices locales) | ✅ |
| Preuves existantes avec `next dev` pointé sur la pile jetable : `proof-profile-lock` 9/9, `proof-admin-centralization` 24/24, `proof-admin-momo-review` 7/7, `proof-admin-candidate-profile` 11/11, `proof-profile-momo` 11/11 | ✅ aucune régression |
| `proof-admin-cni` | ⚠️ 15/24 avant **et** après le lot (F-33). E6 montre désormais le refus explicite. |
| `proof-essentials-gate` | ⛔ fixture manquante (entreprise préexistante), sans lien avec le lot (F-33) |
| **Finalisation** — `vitest run tests/local-supabase-guard.test.ts` | ✅ 30/30 |
| Procédure `docs/testing/local-proofs.md` déroulée telle quelle (PowerShell) : préparation, démarrage, chargement des variables | ✅ ; sans variables → refus « manquants » ; `API_URL=https://localhost.evil.com` → refus avant toute requête |
| Rejeu des 15 preuves sur la pile dédiée avec `next dev` connecté à cette pile | ✅ account-security 34/34 (36/36 après ajout de la preuve 11, échec de synchronisation `app_metadata`), admin-candidate-profile 11/11, admin-centralization 24/24, admin-momo-review 7/7, admin-t84c-reviews 19/19, admin-update-requests 38/38, jobs-rls-select 4/4, license-gate 16/16 (après passage à `--db-url`), profile-documents 12/12, profile-location 15/15, profile-lock 9/9, profile-momo 11/11, profile-skills 7/7 ; ⚠️ admin-cni 15/24 et ⛔ essentials-gate (préexistants, F-33) |
| Lecture seule sur la base de développement après l'incident `--local` | ✅ 0 ligne `Conduite moto` et 0 utilisateur créés dans les 3 dernières heures |
| `tsc --noEmit`, `eslint scripts tests --max-warnings=0`, `prettier --check` sur les fichiers modifiés | ✅ |

### Non exécuté

- Aucun test sur la production ni sur un environnement distant.
- Parcours SMS réel (`phone_change` via Twilio) : la finalisation a été testée directement en `service_role`, comme le fait le contournement de développement.
- Parcours OAuth Google réel (fournisseur désactivé localement) : seule la modification `ignoreDuplicates` est vérifiée par le typage et le build.

### Risques résiduels

- **H-01 et H-02 restent ouvertes** : il faut vérifier en production, en lecture seule, l'absence de comptes déjà élevés (`users.role` admin inattendu) et la présence éventuelle d'un trigger `handle_new_user` sur `auth.users`. La migration corrige l'avenir, pas les élévations passées.
- `app_metadata.role` des comptes déjà élevés illégitimement n'est pas recalculé par la migration. À traiter avec H-02.
- `create-admin.ts` ne retire pas un `user_metadata.role` déjà présent sur un compte existant. Ce n'est pas exploitable, car cette valeur n'est plus lue.
- `TRUNCATE` reste accordé à `anon`/`authenticated` sur les autres tables (non exposé par PostgREST). À traiter au lot 2.
- Les fonctions `SECURITY DEFINER` utilisent `search_path = public` et non `''`. C'est acceptable (pas de création d'objets temporaires possible via PostgREST), à harmoniser au lot 2.
- L'onboarding entreprise (`users.is_verified = true` en session) reçoit maintenant une erreur explicite au lieu d'un no-op silencieux. La page ignore cette erreur (F-14, lot 5).

## 10. Suivi — Lot 2 : colonnes et tables porteuses de droits (2026-10-31)

**Statut : corrigé et vérifié localement, finalisé (F-35 et critère CNI inclus). Non commité, non déployé.** Aucune conclusion sur la production : H-01 et H-02 restent ouvertes.

Branche `fix/lot-02-business-permissions`, créée depuis `origin/main-dev` (faf91fc, merge de la PR #49 qui contient le lot 1). Constats traités : F-04, F-05, F-06, F-11, F-17, puis F-34 et F-35 trouvés pendant le lot.

### Constats vérifiés dans le code courant

Tous ont été confirmés dynamiquement avant correction. Contrôles négatifs de `proof-business-permissions` sur la pile dédiée :
- sans la migration : 68 échecs sur 75 assertions (sections A à D) ;
- avec la première version de la migration, sans la finalisation : 21 échecs sur 120 (sections F et G).

- **F-04** : `GRANT ALL` et policy UPDATE sans liste de colonnes. Toutes les colonnes de droits étaient modifiables en session. Les triggers CNI et MoMo ne protégeaient que l'UPDATE : un INSERT pouvait créer un profil déjà `momo_verified = true` ou `cni_verified = 'verified'`.
- **F-05** : INSERT direct accepté, y compris avec `status = 'selected'`, et UPDATE libre de sa propre candidature. Côté entreprise, la policy UPDATE n'avait ni `WITH CHECK` ni liste de colonnes. L'entreprise pouvait ainsi changer `candidate_id` ou `match_score`, passer une candidature à `withdrawn` ou `pending`, et renseigner `selected_by` avec un autre compte.
- **F-06** : un utilisateur pouvait s'attribuer un abonnement en session, y compris par `upsert`. Un `admin_support` pouvait aussi en créer et en modifier.
- **F-11** : `anon` pouvait lire, insérer et modifier `otp_codes`. Chemin indirect : `cleanup_expired_otp()` (`SECURITY DEFINER`, sans `search_path`) était exécutable par `anon`.
- **F-17** : aucune policy DELETE ; la route répondait `success` sans effet.

### Constats complémentaires (F-34 à F-37)

| ID | Constat | Statut | Bloquant ? |
|---|---|---|---|
| F-34 (P1) | `profile_completion_pct` n'était écrit par **aucun** flux applicatif, seulement par les fixtures et le seed. Le gate « ≥ 60 % » de `/apply` lisait donc une colonne restée à 0 : tout vrai candidat était refusé (`profile_incomplete`), sauf écriture hors dépôt. Par ailleurs, le critère CNI (15 points) exigeait les trois photos, que T8.4 supprime après approbation : un candidat vérifié perdait ces points. | **Corrigé localement.** Calcul en base, reprise des profils dont la valeur diffère, et critère CNI satisfait par `cni_verified = 'verified'`, sinon par les trois photos (SQL et TypeScript alignés). | Non. Le seuil de 60 % devient effectif : à annoncer avant le déploiement. |
| F-35 (P1) | Le verrou de l'identité vérifiée (`evaluateProfileLock`) et la réinitialisation MoMo (`candidate_update_momo`) n'existaient que dans les routes. Un PATCH direct pouvait modifier nom, prénom, date de naissance ou photos CNI d'une CNI vérifiée sans repasser en revue. Il pouvait aussi rétrograder le statut puis modifier librement, ou changer numéro, opérateur ou nom du compte MoMo en gardant `momo_verified`. Enfin, `users.is_verified` (gate de candidature) n'était recalculé que par les RPC admin : il restait `true` après une réinitialisation MoMo ou une re-vérification CNI. | **Corrigé localement** (mécanisme 8). | Non. |
| F-36 (P3) | `updateReliabilityScore` (`lib/matching/ai-matching.ts`) écrit `average_rating` avec le client de session. La fonction n'est appelée nulle part ; cette écriture serait désormais refusée. | Non traité : code mort à supprimer (lot 10), ou à réécrire côté serveur avec le lot 7. | Non. |
| F-37 (P3) | `job_applications.selected_by` référence `users` sans `ON DELETE`. Un compte entreprise qui a sélectionné un candidat ne peut donc pas être supprimé. Il en va de même pour `profile_update_requests.requested_by` et un compte admin. Constaté au nettoyage des preuves. | Non traité (lot 7 ou politique de suppression des comptes). La preuve supprime ces lignes avant les comptes. | Non. |

### Défauts préexistants constatés pendant la vérification navigateur

Ces défauts sont hors périmètre et non corrigés. Ils ne viennent pas du lot 2 : le code concerné n'est pas modifié par la branche.

| ID | Constat | Bloquant ? |
|---|---|---|
| F-38 (P1) | La page `/jobs/[id]` plante au rendu pour **toute** offre (« This page couldn't load »). `formatTime(job.start_time)` (`lib/utils.ts`) fait `new Date("09:00:00")` sur une colonne `time`, d'où `RangeError: Invalid time value` dans `job-detail-client.tsx`. Le bouton « Postuler » est donc inaccessible dans l'interface ; la route `/api/jobs/[id]/apply` fonctionne. | Corrigé localement au lot 2b (§11). |
| F-39 (P2) | Aucun `<Toaster />` n'est monté : les `toast()` (`hooks/use-toast`) ne s'affichent nulle part. Sur `app/company/jobs/[id]`, une sélection ou un rejet refusé par la base (candidature retirée entre-temps) ne donne aucun retour visible ; la liste n'est pas rechargée. | Corrigé localement au lot 2b (§11). |
| F-40 (P3) | Onboarding : laisser la date de naissance vide envoie `date_of_birth: ""`, refusé par Postgres (22007). Le message affiché est générique : « Une erreur est survenue ». | Corrigé localement au lot 2b (§11). |
| — | `/my-jobs` ne liste plus une candidature retirée et affiche « Vous n'avez pas encore postulé » s'il n'y en a pas d'autre. Le refus `profile_incomplete` reste en anglais (`alert`, message existant). Aucun écran n'appelle encore le retrait. | Non (lot 9). |

### Mécanisme retenu

Migration `supabase/migrations/20261031130000_lock_business_permissions.sql`, même principe qu'au lot 1. Elle n'est ni intégrée ni appliquée à un environnement partagé : elle a été complétée sur place, sans nouvelle migration. Règles de travail : `.github/instructions/database.instructions.md`, section « lot 2 ».

1. **Privilèges de colonnes** (frontière principale, refus 42501) :
   - `candidate_profiles` : `INSERT` et `UPDATE` limités aux colonnes ordinaires écrites par les flux existants (onboarding, `/api/profile/identity`, `/documents`, `/availability`). `cni_number` et `address` sont exclus. `momo_provider`, `momo_number` et `momo_account_name` le sont aussi : la déclaration MoMo passe uniquement par `candidate_update_momo` (F-35).
   - `job_applications` : aucune écriture pour le candidat. L'entreprise garde `UPDATE (status, selected_at, selected_by, rejection_reason)`.
   - `subscriptions` : `SELECT` seul pour `authenticated`, rien pour `anon`.
   - `otp_codes` : aucun privilège pour `anon` ni `authenticated`.
   - `TRUNCATE`, `REFERENCES` et `TRIGGER` sont retirés sur ces quatre tables. C'était un résidu du lot 1, traité ici pour ce périmètre seulement.
2. **Triggers de défense en profondeur**, fondés sur `current_user`, jamais sur `easyjob.system_update` :
   - `trg_protect_candidate_profile_columns` refuse toute modification hors liste. À la création, il refuse toute valeur protégée différente de son défaut, y compris les valeurs dérivées et la déclaration MoMo.
   - `trg_protect_job_application_writes` refuse en session : INSERT et DELETE, toute colonne hors décision, toute écriture du candidat sur sa propre candidature, toute décision sur une candidature retirée, tout statut autre que `shortlisted`, `selected` ou `rejected`, et tout `selected_by` différent de l'appelant.
3. **RLS** : suppression des policies d'écriture devenues sans objet. Il s'agit des policies INSERT et UPDATE du candidat sur `job_applications`, des policies INSERT et UPDATE de `subscriptions` et des trois policies de `otp_codes`. Les policies restantes ont un `WITH CHECK` explicite et visent `TO authenticated`.
4. **Valeurs dérivées** :
   - `profile_completion_pct` est toujours recalculé par `sync_candidate_profile_derived` (trigger BEFORE, à chaque écriture du profil, quel que soit l'auteur). Le calcul s'appuie sur `candidate_profile_completion_pct`, traduction SQL de `computeCandidateCriteria` ; toute modification des critères se fait dans les deux.
   - Critère CNI : `cni_verified = 'verified'`, sinon les trois photos soumises. C'est la même règle que `recompute_user_verification` (« la certification, pas la présence des photos »). Une CNI `rejected` avec photos garde donc les points, comme avant.
   - Table liée : l'ajout, le retrait ou le déplacement d'une compétence relance le calcul (`refresh_candidate_profile_completion`, `SECURITY DEFINER`, sans paramètre fourni par l'appelant). Le profil n'est réécrit que si la valeur change. Aucune autre table n'entre dans le calcul ; `momo_verified` et `cni_verified` sont des colonnes du profil.
   - `onboarding_status`, pour une écriture candidat, ne passe à `completed` que si les règles de l'assistant sont réunies : prénom, nom, ville, au moins 2 compétences, opérateur et numéro MoMo, étape > 4. Sinon, il vaut `in_progress` et l'étape revient à 4.
   - Un profil `completed` ou `rejected` ne change plus par écriture candidat. Les rôles de confiance gardent la valeur qu'ils écrivent.
   - Aucune progression automatique de niveau n'a été ajoutée.
5. **Candidature et retrait** par RPC `SECURITY DEFINER` : `search_path = ''`, propriétaire `postgres`, `EXECUTE` accordé à `authenticated` seulement, candidat déduit de `auth.uid()`.
   - `apply_to_job(job_id)` reprend les règles de la route, dans le même ordre :
     - profil existant ;
     - onboarding terminé ;
     - complétude ≥ 60 % ;
     - compte actif ;
     - `users.is_verified` ;
     - offre existante et `active` (verrou `FOR SHARE`) ;
     - niveau Sandbox ;
     - places restantes ;
     - documents exigés par l'offre, puis justificatifs de compétence (états `expired`, `pending`, `rejected` ou `missing`). L'expiration tombe à minuit UTC, comme `new Date('YYYY-MM-DD')`.
   - La création passe par `INSERT … ON CONFLICT DO NOTHING` sur la contrainte unique existante : en cas de double soumission concurrente, la seconde reçoit `already_applied`.
   - **Aucune place n'est consommée** : `positions_filled` ne change qu'à la sélection.
   - `withdraw_job_application(job_id)` fait passer la candidature de `pending` à `withdrawn` sous `FOR UPDATE`. Un retrait répété renvoie la ligne sans la réécrire. Tout autre statut donne `application_not_withdrawable` ; une candidature absente donne `application_not_found`.
   - **La recandidature après retrait est refusée** (`already_applied`), selon une règle explicite du SRS §6.6 : « Un candidat ne peut postuler qu'une seule fois à la même offre ».
6. **Abonnements** : écriture par `service_role` uniquement, sans exception pour les grades admin. Aucun système de paiement n'a été ajouté.
7. **`otp_codes`** : la table et ses données sont conservées. L'`EXECUTE` de `cleanup_expired_otp` est retiré et son `search_path` vaut `''`. Les OTP de Supabase Auth ne sont pas concernés.
8. **Données vérifiées (F-35)**. Les règles existantes sont reprises telles quelles ; aucune nouvelle règle métier n'est ajoutée.
   - **Verrou CNI** (`trg_protect_verified_candidate_data`, écritures candidat). Sur une CNI vérifiée, une modification de l'identité (prénom, nom, date de naissance) ou des photos CNI exige une demande admin `pending` couvrant le groupe (`identity` ou `cni_documents`). Sinon : refus `field_locked` (42501, groupes en DETAIL).
     - Avec demande, dans la **même écriture** : la CNI repasse `pending`, le motif est effacé et les demandes couvrant le groupe sont clôturées en `done` (verrou `FOR UPDATE` sur les demandes). La clôture était auparavant faite par les routes, avant l'écriture et sans atomicité ; `completePendingRequests` est supprimée.
     - Sans modification verrouillée, le statut et le motif d'une CNI vérifiée ne changent pas par écriture candidat. Cela ferme le chemin « rétrograder puis modifier librement ».
     - Une CNI non vérifiée reste librement modifiable (règle existante).
   - **MoMo** : seule `candidate_update_momo` (existante, inchangée) écrit la déclaration. Elle réinitialise les cinq colonnes de vérification dans le même `UPDATE`. L'écriture directe est refusée par les privilèges et par le trigger.
     - La règle existante est conservée : la réinitialisation se fait à chaque déclaration, même pour un simple changement du nom de compte, que l'admin confronte au nom CNI.
     - L'onboarding passe désormais par la route `/api/profile/payment` (Zod serveur et RPC), seulement si la déclaration a changé.
   - **Synthèse `users.is_verified`** (`trg_sync_user_verification_from_profile`, AFTER UPDATE, tout auteur). Tout changement de `cni_verified`, `momo_verified`, prénom, nom ou date de naissance relance `recompute_user_verification` dans la même transaction.
     - Le GUC `easyjob.system_update`, remis à `off` par cette fonction, est restauré pour ne pas couper une RPC appelante (`moderate_cni`, `apply_momo_verification`…).
     - Une notification « Profil vérifié » n'est émise qu'au passage de faux à vrai, une seule fois par transaction (mécanisme existant).
   - **Corrections d'administration préservées** : `admin_edit_candidate_identity` (`admin_founder`), `moderate_cni`, `apply_momo_verification` et la purge des photos (`service_role`) s'exécutent en propriétaire. Elles écrivent comme avant, avec leur `audit_logs`. La création des demandes de mise à jour reste réservée à `admin_ops` et `admin_founder`.

Côté application :
- `app/api/jobs/[id]/apply/route.ts` valide l'identifiant avec Zod, appelle les RPC et traduit leurs codes en réponses HTTP inchangées (statuts, messages et `code` existants). `DELETE` renvoie désormais 404 ou 409 au lieu d'un faux succès, et vérifie que la ligne est réellement `withdrawn`.
- `lib/matching/skill-document-requirements.ts` ne fait plus que traduire le détail `document_requirement` en messages, identiques aux précédents (test unitaire `tests/document-requirement-message.test.ts`).
- `/api/profile/identity` et `/api/profile/documents` gardent leur contrôle préalable (403 `field_locked` avant toute écriture). Elles ne clôturent plus les demandes elles-mêmes, et traduisent un refus `field_locked` de la base, en cas de course, en 403. `documents` supprime alors le fichier téléversé.
- L'onboarding candidat n'écrit plus `onboarding_status` ni la déclaration MoMo. Il vérifie le statut persisté avant de quitter l'assistant (message i18n `errors.onboardingIncomplete`) et signale l'échec d'insertion des compétences.
- `computeCandidateCriteria` applique le même critère CNI que le SQL. `/auth/login` lit `cni_verified` pour son calcul de repli.

### Recalcul à l'application de la migration

Ce qui se produit réellement, d'après la migration et sa relecture sur la pile dédiée :

- Une seule instruction `UPDATE` recalcule `profile_completion_pct` avec les règles finales, **uniquement pour les profils dont la valeur stockée diffère** (`WHERE … IS DISTINCT FROM …`). Les profils déjà corrects ne sont pas réécrits.
- Pour chaque ligne réécrite :
  - `updated_at` prend l'heure de la migration (`on_candidate_profiles_updated`) ;
  - les triggers de protection s'exécutent en propriétaire et ne modifient rien ;
  - `onboarding_status` n'est pas touché (dérivation réservée aux écritures candidat) ;
  - aucune colonne surveillée par la synthèse `is_verified` n'est écrite : `users.is_verified` et les notifications ne bougent pas.
- **Realtime** : d'après les migrations du dépôt, `candidate_profiles` n'est pas dans la publication `supabase_realtime`, qui ne contient que `missions` et `job_applications`. La publication locale le confirme. Aucun événement n'est donc attendu, sauf si la table a été ajoutée hors dépôt. À vérifier en lecture seule avant le déploiement : `select tablename from pg_publication_tables where pubname = 'supabase_realtime';`. L'affirmation de la première version de ce suivi (« émet des événements Realtime ») était erronée.
- Aucune protection n'est désactivée pendant le recalcul : ni `session_replication_role`, ni `DISABLE TRIGGER`.
- Les valeurs suspectes existantes ne sont **pas** corrigées :
  - `is_verified` resté `true` après un changement MoMo ou CNI antérieur ;
  - `momo_verified` conservé après un changement de numéro ;
  - identité modifiée sur une CNI vérifiée ;
  - `sandbox_level`, `premium_until`…

  Leur origine n'est pas prouvée. Le lot 0 doit les rechercher en lecture seule (H-01, H-02). Exemple : profils `momo_verified = true` dont `momo_verified_at` est antérieur au dernier `updated_at`, à croiser avec `audit_logs`.
- Effet métier : le seuil de 60 % devient réellement appliqué (F-34). Les candidats sous 60 % sont refusés avec le message existant. Le nombre de profils réécrits n'est pas connu sans accès à la production ; il peut se compter en lecture seule après application sur une copie.

### Contrôles exécutés

Pile dédiée `easyjob-proof` (API sur le port 54421), selon la procédure de `docs/testing/local-proofs.md`. Les migrations ont été rejouées par `supabase db reset --workdir`. `next dev -p 3100` a été lancé avec `NEXT_PUBLIC_SUPABASE_URL = http://127.0.0.1:54421`, valeur contrôlée avant le lancement. Les preuves E1 et H, ainsi que le parcours navigateur, relisent en base les écritures faites par l'application.

| Commande | Résultat |
|---|---|
| Contrôle négatif : `proof-business-permissions --skip-route` sans la migration | ✅ 68 FAIL / 75 : failles confirmées |
| Contrôle négatif de la finalisation (sections F et G, migration non finalisée) | ✅ 21 FAIL / 120 : contournements F-35 et perte des points CNI confirmés ; chemins admin (F6, F7) et CNI non vérifiée (F8) déjà corrects |
| `proof-business-permissions` (A à H, routes incluses) | ✅ 135/135 |
| Contrôle « grants régressés » sur la pile jetable : `GRANT ALL` rouvert sur `candidate_profiles`, `job_applications` et `subscriptions` | ✅ 120/120 (A à D, F, G) : les triggers tiennent seuls. Pile réinitialisée ensuite. |
| Preuves directement concernées : account-security 36/36, admin-candidate-profile 11/11, admin-centralization 24/24, admin-momo-review 7/7, admin-t84c-reviews 19/19, admin-update-requests 38/38, profile-documents 12/12, profile-lock 9/9, profile-momo 11/11 | ✅ aucune régression |
| `proof-admin-cni` | ⚠️ 15/24, mêmes 9 échecs qu'avant le lot (F-33) |
| `proof-essentials-gate` | ⛔ Échec préexistant (F-33), non rejoué : la fixture manque et la preuve attend `essentials_incomplete`, remplacé par `profile_not_verified` depuis T8.3. Couvert par B3, E7 et le parcours navigateur 3d. |
| `supabase gen types --schema public` (CLI 2.117.0) depuis la pile dédiée | ✅ identique à `lib/database.types.ts` (les nouvelles fonctions de trigger ne sont pas exposées) |
| `vitest run` | ✅ 10 fichiers, 194 tests (dont les cas CNI et de seuil de `tests/profile-completion.test.ts`) |
| `tsc --noEmit`, `eslint . --max-warnings=0`, `prettier` sur les fichiers modifiés | ✅ |
| `pnpm build` sur l'état final (variables locales factices pointant vers `127.0.0.1`, télémétrie désactivée) | ✅ compilation et 69 pages générées ; aucun fichier suivi modifié |

Nouvelles sections de la preuve :
- **F** : PATCH directs refusés sur identité, photos et statut CNI vérifiés et sur la déclaration MoMo, avec valeurs et `is_verified` inchangés. Elle couvre aussi :
  - l'atomicité (une écriture refusée ne consomme pas la demande) ;
  - le déverrouillage par demande `identity` ou `cni_documents`, et le refus d'un groupe non couvert ;
  - `candidate_update_momo` (réinitialisation et `is_verified` à faux) ;
  - `apply_momo_verification`, avec audit et `is_verified` à vrai ;
  - `admin_edit_candidate_identity`, avec audit ;
  - la CNI non vérifiée, librement modifiable.
- **G** : complétude, comparée à la base et au TypeScript.
  - Photos avant approbation, puis approbation par `moderate_cni` et purge des photos : les points restent.
  - CNI `pending` sans photos : pas de points. CNI `rejected` avec photos : points accordés.
  - Passage de vérifiée à `pending` : −15 points.
  - Seuil via `apply_to_job` : refus à 55 %, candidature créée à 60 %.
  - Table liée : une compétence sans effet ne réécrit pas le profil ; le retrait de toutes les compétences relance le calcul.
- **H** : routes `/api/profile/identity` (403 puis 200 après une demande créée par la route admin), `/api/profile/payment` et `/api/profile/documents` (téléversement réel dans le stockage local).

### Vérification navigateur

Chrome 64 bits local, piloté en mode headless par `playwright-core` 1.62.1 (déjà présent en cache, rien téléchargé). Fenêtre mobile 390 × 844. Application reliée à la pile dédiée. Script et captures hors dépôt. Résultat : **15 contrôles sur 15**.

Portée de ce résultat : l'onboarding, l'affichage de la complétude et l'écran entreprise sont vérifiés dans l'interface. Pour la candidature et le retrait, ce sont les **routes** qui sont vérifiées, appelées depuis la session du navigateur. Le parcours de candidature **par l'interface reste bloqué par F-38** : ces 15 contrôles ne valident pas ce parcours.

| Parcours | Résultat |
|---|---|
| Onboarding : étapes 1 et 2 enregistrées, rechargement, reprise à l'étape 3, compétences, MoMo et fin d'onboarding | ✅ `completed`, MoMo enregistré via la route et non vérifié |
| Complétude affichée sur `/profile/candidate` | ✅ 45 % (nouveau candidat) et 65 % (CNI vérifiée, photos purgées, critère CNI coché) : égal à la base |
| Candidature autorisée et refus | ⚠️ La page `/jobs/[id]` plante (F-38, préexistant). L'appel exact du bouton (`POST /api/jobs/[id]/apply`) est exécuté dans la session du navigateur : 200 et ligne `pending` à 65 % ; refus `profile_incomplete` à 50 % et 45 % ; 403 `profile_not_verified` avec la liste `missing` à 60 % sans MoMo vérifié. **L'interface de candidature elle-même n'est pas validée.** |
| Retrait | ✅ `DELETE` depuis la session du navigateur : 200 et ligne `withdrawn`. Aucun bouton de retrait n'existe dans l'interface. |
| Entreprise `app/company/jobs/[id]` | ✅ Rejet sur un écran resté ouvert après le retrait : PATCH refusé par la base, ligne toujours `withdrawn`, mais aucun message visible (F-39). Après rechargement, plus d'action sur la candidature retirée. Sélection légitime : `selected`, `selected_by` = l'entreprise. Les noms des candidats s'affichent « ? » (RLS, comportement existant). |

### Non exécuté

- Aucun test sur la production ni sur un environnement distant.
- Interface du bouton « Postuler » : bloquée par F-38.
- `proof-essentials-gate` et les preuves sans lien avec les fichiers modifiés (jobs-rls-select, license-gate, profile-location, profile-skills) n'ont pas été rejouées lors de la finalisation. Elles passaient lors de la première validation du lot ; les tables qu'elles touchent n'ont pas changé depuis.

### Risques résiduels et points ouverts

- **H-01 / H-02** : la migration ne corrige pas les falsifications passées éventuelles (`sandbox_level`, `premium_until`, `driving_license_verified`, `reliability_score`, abonnements à prix 0, candidatures `selected` auto-attribuées, `onboarding_status` forcé, identité ou MoMo modifiés après vérification, `is_verified` resté vrai). Les requêtes de comptage en lecture seule restent à faire au lot 0.
- **Seuil de 60 %** désormais effectif (F-34) : à annoncer.
- **Identité et MoMo** : une modification d'identité sur demande admin repasse la CNI en revue, mais garde la vérification MoMo, comme avant (aucune règle ne les lie). `is_verified` tombe malgré tout, puisque la CNI n'est plus vérifiée. Règle conservée sans changement à la clôture du lot (2026-10-31).
- **Changement de numéro de téléphone** (`users.phone`, lot 1) : il ne relance pas `recompute_user_verification`. Comportement inchangé.
- L'ordre des refus est conservé : un compte suspendu dont le profil est sous 60 % reçoit `profile_incomplete`, pas `account_suspended`.
- Les autres fonctions `SECURITY DEFINER` gardent `search_path = public`. Seules les nouvelles fonctions et `cleanup_expired_otp` utilisent `''`.
- `TRUNCATE`, `REFERENCES` et `TRIGGER` restent accordés sur les tables hors périmètre (lot 4).
- La sélection reste non atomique (places, mission, contrat) : lot 7.

### Avant déploiement

Revue, puis PR vers `main-dev` : la CI `test-migrations` applique la migration et compare les types. Ensuite, en lecture seule et avant la production :
- exécuter le lot 0 ;
- vérifier la publication Realtime ;
- traiter F-38, F-39 et F-40 dans un prochain lot dédié (hors lot 2).

## 11. Suivi — Lot 2b : parcours candidat (F-38, F-39, F-40) (2026-10-31)

**Statut : corrigé et vérifié localement. Non commité, non déployé.**

Branche `fix/lot-02b-candidate-user-flows`, créée depuis `origin/main-dev` (643576f, qui contient le lot 2). Aucun changement de permissions, de seuil de complétude ni de règle MoMo.

| ID | Correction | Statut |
|---|---|---|
| F-38 | `formatTime` (`lib/utils.ts`) distingue une heure SQL `time` (`HH:MM`, `HH:MM:SS[.µs]`), formatée telle quelle sans date ni fuseau, d'un instant (`Date`, ISO), qui suit comme avant le fuseau local. Une valeur absente, invalide ou hors bornes (y compris `24:00:00`) affiche `--:--` au lieu de planter ou d'afficher une heure trompeuse. Les trois consommateurs (détail d'offre, `JobCard`, tableau de bord) passent la locale de l'interface (`09:00` en français, `09:00 AM` en anglais). La page rendue de nouveau, deux défauts jusque-là masqués sont apparus. Le bouton « Postuler » était recouvert par la barre d'onglets candidat : il est désormais placé au-dessus. Un candidat bloqué par les essentiels ne voyait qu'un bouton « Compléter » : l'explication existante (`essential.bannerBody`) est maintenant affichée. Un refus est notifié avec le message i18n existant (`profile.completion.required60` pour `profile_incomplete`) au lieu d'un `alert` en anglais. La route `/apply` ajoute le champ `code` à ses refus (ajout sans rupture). | Corrigé localement |
| F-39 | `hooks/use-toast.ts` ne faisait qu'un `console.info`. Il devient un état partagé, avec les mêmes signatures `toast()` et `useToast()`. Le nouveau rendu `components/ui/toaster.tsx` est monté une seule fois dans `app/layout.tsx`. Les notifications s'affichent en haut de l'écran, zone sûre comprise, sans masquer la barre d'onglets du bas. Une erreur ou un avertissement est annoncé avec `role="alert"` ; les autres messages utilisent `role="status"`. Le type se distingue par l'icône et le titre, pas seulement par la couleur. Le bouton « Fermer » (i18n `common.close`) est utilisable au clavier. Au plus trois notifications sont empilées, et elles se ferment seules (5 s, 8 s pour les erreurs). Les écritures qui déclenchent un toast de succès vérifient désormais qu'une ligne a bien été modifiée (`.select("id")`), sans quoi elles affichent l'erreur. C'est le cas des décisions entreprise, de la suppression d'offre, de la signature de contrat et du pointage ou de la fin de mission. En cas d'échec d'une décision, l'écran entreprise se recharge. | Corrigé localement |
| F-40 | La date de naissance est facultative à l'étape 1 de l'onboarding : le libellé n'a pas d'astérisque, et elle n'entre pas dans les conditions de fin. Laissée vide, elle est envoyée en `null`, jamais en `""`. Une date saisie est validée par `birthDateSchema` (règles d'âge inchangées). En cas d'erreur, le message existant (`profile.edit.ageInvalid` / `birthDateInvalid`) s'affiche sous le champ (`aria-invalid`, `aria-describedby`) et l'étape est bloquée. Les verrous d'identité du lot 2 ne sont pas touchés. | Corrigé localement |

**F-18 / lot 9.** Ce lot traite la partie « notifications réelles et accessibles » de F-18. Les erreurs des parcours mission, contrat et offres entreprise sont désormais visibles. Restent ouverts dans le lot 9 :
- les liens `/login` et `/auth/error` ;
- les textes des toasts existants, codés en dur en français et sans accents (« Candidat selectionne »), à passer dans le dictionnaire i18n ;
- les autres refus de `/apply`, encore en anglais (`already_applied`, `no_positions`…) ;
- les promesses non livrées (F-19, F-28) ;
- le libellé `withdrawn` et l'état vide trompeur de `/my-jobs` ;
- le contrôle sur des appareils Android et iOS réels.

### Contrôles exécutés

| Contrôle | Résultat |
|---|---|
| `vitest run` (nouveaux tests `tests/format-time.test.ts` et `tests/toast.test.ts`) | ✅ 12 fichiers, 216 tests |
| `tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .` | ✅ |
| `pnpm build` (variables locales factices, télémétrie désactivée) | ✅ 69 pages |
| `proof-business-permissions` (A à H), rejouée car la route `/apply` a changé | ✅ 135/135 |
| Parcours navigateur, avec de vrais clics (Chrome headless, `playwright-core` local, 375 × 812, pile `easyjob-proof`, `next dev` relié à la pile, fixtures déterministes, script et captures hors dépôt) | ✅ 19/19 |

Parcours vérifiés dans le navigateur :
- page d'offre rendue avec les horaires SQL (`09:00 - 13:30`), sans défilement horizontal, et liste des offres (`JobCard`) ;
- clic sur « Postuler » puis double clic sur « Confirmer » : confirmation visible et une seule candidature. Après rechargement, plus de bouton. Une nouvelle tentative par la route est refusée ;
- profil sous 60 % : notification d'erreur « 60% requis pour postuler » (`role="alert"`), fermée au clavier ;
- profil à 60 % ou plus mais non vérifié : pas de bouton « Postuler », explication affichée ;
- écran entreprise ouvert avant un retrait (retrait préparé par la route locale existante) : rejet refusé, notification d'erreur visible, aucun faux succès, écran rechargé. Sélection légitime : notification de succès (`role="status"`) en haut de l'écran ;
- date de naissance : vide (enregistrée `null`), mineur et 1899 (erreur liée au champ, soumission bloquée), valide (enregistrée). Reprise après rechargement, puis retour à l'étape 1 avec la date conservée ;
- page d'offre en anglais : `09:00 AM - 01:30 PM`.

### Limites

- Pas de test sur un appareil Android ou iOS réel : seule la largeur 375 px a été simulée.
- Le tableau de bord redirige les candidats vers `/jobs` : son affichage des heures n'est couvert que par les tests unitaires.
- `24:00:00`, valeur acceptée par Postgres mais non produite par les formulaires, s'affiche `--:--`.
- Aucun bouton de retrait n'existe dans l'interface (hors lot).
