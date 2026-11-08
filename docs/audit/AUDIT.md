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
| Temps réel / async | ~~Realtime sur `candidate_profiles` (`lib/hooks/use-realtime-sync.ts`).~~ Depuis le lot 7d (§22) : signaux Realtime Broadcast privés émis par trigger, fournisseur client `lib/realtime/provider.tsx`. pg_cron `cleanup-unconfirmed-signups` toutes les 15 min s'il est disponible. Aucun job applicatif ni file d'attente. | migrations `20260605…`, `20261107150000…`, `20260529100000…` |
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
| F-07 | P1 | **Corrigé et vérifié localement : contrats (lot 7b, §19) et missions (lot 7c, §20).** Constat d'origine : `contracts` et `missions` : les politiques UPDATE des parties ne restreignent pas les colonnes. Le statut du contrat est calculé dans le navigateur et la signature est stockée en data-URL. L'entreprise peut modifier `payment_status`, `platform_fee`, `actual_*_time`, `validated_at` de ses missions. | baseline:2005 (contracts), 1949 (missions) ; `app/contracts/[id]/page.tsx:229-262` | Un candidat peut passer un contrat à `completed` sans signature de l'entreprise, ou modifier `contract_data`. Une entreprise peut modifier les heures ou les statuts de paiement. Le contrat n'a aucune valeur probante (pas d'horodatage serveur, d'IP ni d'empreinte). | RPC `sign_contract` (horodatage, IP et rôle côté serveur, transition contrôlée) et RPC de validation des heures. Retirer l'UPDATE direct ou le limiter par trigger. | Tests de transition : signature unilatérale → `candidate_signed` seulement ; modification de `contract_data` par une partie refusée. |
| F-08 | P1 | **Corrigé localement (lot 3, §12) : `next` 16.4.3.** Constat d'origine, rectifié au §12 : Next.js **16.2.6** : avis critiques publiés (RCE dans l'Image Optimizer pour SVG/AVIF, RCE `use cache`, RCE `next/og`) et hauts (contournement Proxy/middleware avec Turbopack, SSRF, DoS Server Actions). | `pnpm audit` ; `package.json` | Applicabilité non démontrée : l'application n'utilise pas `next/image`, `next/og` ni `use cache`, mais l'endpoint `/_next/image` existe par défaut, et le Proxy est utilisé pour l'authentification. Mise à jour peu coûteuse. | Monter `next` et `eslint-config-next` sur la dernière version 16.x qui corrige tous les avis listés (> 16.4.0 selon l'audit), puis relancer `pnpm audit`. | `pnpm audit --prod` sans avis `next` critique ou haut ; build, lint et tests verts. |
| F-09 | P1 | **Corrigé et vérifié localement (lot 6, §17).** Constat d'origine : publication d'offre bloquée. (a) L'UI insère l'offre directement (`status: "pending_review"`) en contournant `/api/jobs` POST, qui contrôle la vérification de l'entreprise et le statut `is_active`. (b) Aucune politique ne permet à l'admin de **lire** ou de **modifier** une offre non `active` : le tableau de bord admin et la route `moderate` (session admin) agissent sur 0 ligne et renvoient pourtant un succès. (c) L'entreprise peut aussi passer elle-même son offre à `active` (politique FOR ALL). | `app/company/jobs/new/page.tsx:134-155` ; `app/api/jobs/route.ts:193` ; politiques jobs baseline:1932 et `20260908120000_*:38` ; `app/api/admin/jobs/[id]/moderate/route.ts:46-55` ; `app/admin/dashboard/page.tsx:16-23` | Le parcours honnête bloque : l'offre n'est jamais publiée. Le parcours malveillant contourne la modération. | Un seul chemin de création (route serveur), une RPC `moderate_job` admin avec audit, un trigger qui interdit à l'entreprise de modifier `status` hors brouillon, et un statut unique (`pending_moderation` **ou** `pending_review`). | Test bout en bout : création → visible dans la file admin → approbation → visible par les candidats ; passage direct à `active` par l'entreprise refusé. |
| F-10 | P1 | **Sélection (lot 7a, §18), contrat (7b, §19), début et confirmation par code (7c, §20) corrigés et vérifiés localement ; temps réel (7d, §22) corrigé et vérifié localement ; paiement ouvert (lot distinct).** Constat d'origine : cycle mission incomplet. Aucun code ne crée de `missions`, `contracts` ni `payments` après la sélection. Le pointage candidat fait un `UPDATE missions` alors qu'**aucune politique UPDATE candidat** n'existe : 0 ligne modifiée, pas d'erreur, l'UI affiche « Pointage enregistré ». Les erreurs d'insertion de `mission_check_ins` sont ignorées. La distance (500 m) est contrôlée seulement dans le navigateur. `positions_filled` est incrémenté en lecture puis écriture (perte en cas de concurrence). La notification de sélection annoncée n'est pas envoyée. | `app/company/jobs/[id]/page.tsx:140-185` ; `app/missions/[id]/page.tsx:159-275` ; absence de politique : liste des politiques baseline | Le parcours central de la plateforme (sélection → mission → pointage → validation → paiement) ne fonctionne pas, et ce qui existe se falsifie facilement. | RPC transactionnelles `select_candidate` (crée mission et contrat, incrémente de façon atomique avec verrou, notifie), `check_in` et `check_out` (distance calculée côté serveur, idempotence par type). Voir le plan, lot 5. | Test d'intégration du parcours complet, plus un test de concurrence sur la dernière place. |

### P2 — Fiabilité, sécurité secondaire, maintenance

| ID | Prio | Constat | Preuve fichier | Impact | Correction minimale | Validation attendue |
|---|---|---|---|---|---|---|
| F-11 | P2 | `otp_codes` (table héritée, inutilisée par l'app) : SELECT `USING (true)`, INSERT et UPDATE `true`, `GRANT ALL` à `anon`. | baseline:1845, 1849, 2030, 2330 | Lecture et réécriture des codes stockés par n'importe quel appelant. | Supprimer la table si elle est vide et inutile, sinon révoquer `anon` et `authenticated`. | `GET /rest/v1/otp_codes` refusé. |
| F-12 | P2 | Le code OTP SMS et le numéro sont **journalisés en clair** (`console.log … token`). | `lib/actions/auth.ts:476-479` | Toute personne qui a accès aux logs Vercel peut valider le téléphone d'un tiers pendant la validité du code. Données personnelles dans les logs. | Supprimer le log ou masquer le numéro et le code. | Recherche : aucun `token` journalisé. |
| F-13 | P2 | Callback OAuth : `next` n'est pas validé (`${origin}${next}`). Une valeur `next=@domaine-tiers` produit une redirection ouverte. Si `next` contient `/signup/company`, l'`upsert` **écrase le rôle** d'un compte existant. | `app/auth/callback/route.ts:13-52` | Hameçonnage après connexion. Un candidat peut se changer en entreprise, ou un admin être rétrogradé, en se reconnectant par OAuth avec ce paramètre. | N'accepter que des chemins relatifs commençant par `/` et pas par `//` ni `/\`. N'upserter le rôle que si la ligne n'existe pas. Créer la page `/auth/error`, qui n'existe pas. | Tests unitaires du filtre `next` ; un utilisateur existant garde son rôle. |
| F-14 | P2 | **Corrigé et vérifié localement (lot 5, §15).** Constat d'origine : clients Supabase **non typés**, donc des erreurs de schéma passent `tsc`. Exemple : l'onboarding entreprise écrit dans une table inexistante `companies` et tente `users.is_verified = true` (neutralisé par trigger), erreurs ignorées. | `lib/supabase/client.ts`, `server.ts` ; `app/onboarding/company/page.tsx:112-134` | Les informations d'onboarding entreprise sont perdues sans message. D'autres décalages de schéma sont probables mais non mesurés. | `createBrowserClient<Database>` et `createServerClient<Database>`, puis corriger les erreurs révélées. | `tsc` vert avec clients typés. |
| F-15 | P2 | `/api/chat` : public (le middleware laisse passer `/api/*`), sans authentification, quota, limite de taille ni validation Zod. Appelle un LLM payant. Le prompt système promet des **retraits Mobile Money avec 2 % de frais et un paiement sous 48 h**, alors que le MVP l'interdit. | `app/api/chat/route.ts` ; `lib/supabase/middleware.ts:5` | Abus de coût, et informations fausses données aux utilisateurs. La variable de la passerelle IA n'est pas documentée dans `.env.example`. | Authentification, quota par utilisateur et par IP, limite de messages et de taille, prompt aligné sur les règles réelles. Ou retirer le chatbot du MVP. | Requête anonyme → 401 ; requête trop grosse → 413. |
| F-16 | P2 | **Corrigé et vérifié localement (lot 7a, §18).** Constat d'origine : politique « Companies can view candidate summaries » posée sur **`company_profiles`** : toute entreprise lit tous les profils d'entreprise (NIU, email de contact…). À l'inverse, aucune politique ne permet à une entreprise de voir le nom ou la photo de ses candidats : la liste des candidatures s'affiche sans identité. | baseline:1963 ; `app/company/jobs/[id]/page.tsx:115-131` | Fuite de données entre concurrents, et fonction de sélection inutilisable. | Remplacer par une vue ou une RPC qui expose les colonnes autorisées des candidats ayant postulé aux offres de l'entreprise (jamais téléphone, email, CNI, MoMo). Supprimer la politique erronée. | Une entreprise A ne lit pas l'entreprise B ; elle voit prénom, initiale et photo de ses candidats seulement. |
| F-17 | P2 | Annulation de candidature : aucune politique DELETE sur `job_applications`. La route renvoie `success` sans rien supprimer. | `app/api/jobs/[id]/apply/route.ts:200-215` ; politiques baseline | L'utilisateur croit avoir annulé. | Passer en `status = 'withdrawn'` (UPDATE contrôlé) et vérifier le nombre de lignes modifiées. | Après annulation, le statut vaut `withdrawn`. |
| F-18 | P2 | Le retour utilisateur est factice : `toast()` ne fait que `console.info`. Les pages mission, contrat et offres entreprise, ainsi que l'onboarding, ne montrent jamais les erreurs. Les liens `/login` et `/auth/error` mènent à des 404. | `hooks/use-toast.ts` ; `app/missions/[id]/page.tsx:93` ; `app/contracts/[id]/page.tsx:111` ; `app/company/jobs/[id]/page.tsx:101` | Échecs silencieux sur les parcours critiques et utilisateurs bloqués. | Un vrai composant de notification accessible (`role="status"`), routes corrigées. | Test de composant ; vérification manuelle sur mobile. |
| F-19 | P2 | Les textes promettent des fonctions **absentes du code** : paiement 100 % en 48 h ou 50/50, « montant bloqué » et remboursements, « remplacement garanti », « l'IA sélectionne pour vous », « essai gratuit 7 jours ». Aucun paiement, séquestre ni IA de sélection n'est implémenté (`lib/matching/ai-matching.ts` est heuristique). | `lib/i18n/fr.ts:1151-1189, 1310, 1353-1371` ; `lib/payments/mobile-money.ts` non importé | Promesses commerciales non tenues, avec un risque de confiance et un risque juridique (droit de la consommation et règles de communication commerciale à faire valider). | Retirer ou marquer « bientôt » ce qui n'existe pas. | Relecture produit : chaque promesse correspond à une fonction livrée. |
| F-20 | P2 | **Partie CI corrigée localement (lot 4, §13). Partie déploiement : configuration préparée et vérifiée localement (lot 4b, §14), non validée à distance ; sauvegarde reportée au point de contrôle avant les premiers utilisateurs.** Constat d'origine : CI et déploiement : Vitest **n'est pas exécuté en CI**. Le build ne dépend pas de `test-migrations`. `deploy.yml` utilise `supabase` et `vercel` en version `latest`. Aucune sauvegarde ou vérification n'est faite avant `db push` en production. Un « rollback » par tag redéploie l'application sans revenir sur la base. Le `db push` passe par le pooler 6543 (mode transaction), à vérifier. | `.github/workflows/ci.yml`, `deploy.yml` | Régressions non détectées, déploiements non reproductibles, migration destructive sans filet. | Ajouter `pnpm test`, figer les versions des CLI, faire dépendre le build de `test-migrations`, documenter la procédure de restauration (PITR ou sauvegarde) et l'utiliser avant `db push`. | La CI échoue si un test échoue ; versions figées. |
| F-21 | P2 | **Corrigé localement (lot 4, §13) ; `contracts` couvert au lot 7b (§19), `missions`, `mission_check_ins`, `mission_completion_codes` et `reviews` au lot 7c (§20).** Constat d'origine : aucun test d'autorisation automatisé. Les scripts `scripts/proof-*.ts` couvrent une partie de la RLS mais restent manuels et hors CI. Aucune preuve n'existe pour `users.role`, `job_applications`, `contracts` et `missions`. | `scripts/`, `tests/`, `ci.yml` | Les failles F-01 à F-07 auraient été détectées par une suite RLS négative. | Suite RLS « accès interdits » exécutée en CI sur la pile Supabase locale, qui existe déjà dans `test-migrations`. | Job CI `rls-tests` vert, et rouge si une politique est relâchée. |
| F-22 | P2 | Consignes IA obsolètes : `AGENTS.md` et les instructions Copilot imposent Next 14, next-intl, next-pwa, Three.js, lottie, `src/app/[locale]`, `messages/*.json`, et renvoient à `DESIGN_REFERENCE.md` et `COPILOT_INSTRUCTIONS.md`, qui n'existent pas. | `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/*` | Les agents génèrent du code incohérent avec le dépôt. | Aligner ces documents sur la stack réelle et sur les règles de sécurité de ce rapport (« jamais d'écriture directe sur une colonne porteuse de droits »). | Relecture : chaque outil cité existe. |
| F-23 | P2 | Aucune observabilité : ni capture d'erreurs, ni journalisation structurée. Préfixes de log `[v0]` hérités. `error.message` Postgres renvoyé au client. | recherche négative ; `app/api/jobs/route.ts:81, 200` | Les incidents de production restent invisibles et des détails de schéma sont exposés. | Messages d'erreur génériques côté client. Un outil de capture d'erreurs léger, ou au minimum des logs structurés exploitables dans Vercel. | Une erreur serveur provoquée en préproduction est visible avec son contexte. |
| F-24 | P2 | **Corrigé localement (lot 3, §12) : `zod` 4.6.7.** Constat d'origine : `zod` 4.4.3 : avis haut (épuisement mémoire sur collections volumineuses). Validation utilisée côté serveur. | `pnpm audit` | Déni de service ciblé possible sur les routes qui valident des tableaux. | Passer `zod` à ≥ 4.6.6. | `pnpm audit` sans avis `zod`. |

### P3 — Améliorations secondaires

| ID | Prio | Constat | Preuve fichier | Correction minimale |
|---|---|---|---|---|
| F-25 | P3 | Pas de `Content-Security-Policy` (les autres en-têtes sont présents). | `next.config.ts` | CSP d'abord en `Report-Only`, puis appliquée. |
| F-26 | P3 | `enforce_salary_lock` s'appuie sur `auth.jwt()->>'role'`, qui ne vaut jamais `admin_founder` : le verrou bloque aussi les admins (échec sans faille). | `20260604120000_srs_v12_plans_alignment.sql:213` | Utiliser `is_admin_user()` et le grade. |
| F-27 | P3 | Code mort ou dupliqué : `database.types.ts` racine (1 893 lignes contre 2 463), `lib/types.ts` et `lib/types/index.ts`, `lib/payments/mobile-money.ts`, `_ensureUserAndProfile`, `handle_new_user()` (accordé à `anon`), `public/manifest.json` en plus de `app/manifest.ts`, `next-intl` installé sans être utilisé, `/api/payments/withdraw`. | fichiers cités | Supprimer après vérification par recherche. |
| F-28 | P3 | i18n incohérente : chaînes françaises en dur et sans accents dans les pages mission, contrat et offres entreprise, alors qu'un dictionnaire existe. | `app/missions/[id]/page.tsx`, `app/contracts/[id]/page.tsx`, `app/company/jobs/*` | Migrer ces pages vers le dictionnaire au fil des lots fonctionnels. |
| F-29 | P3 | `.qwen/` (scripts d'intrusion, extraits du catalogue et des politiques SQL) n'est ni versionné ni ignoré. Un `git add .` le commiterait. Le rapport non versionné contient un email et un téléphone réels. | `git status` | **Traité le 2026-10-31** : `.qwen/` supprimé (aucune référence dans le projet). Reste à décider du sort du rapport non versionné. |
| F-30 | P3 | **Partie mission corrigée localement (lot 7c, §20) : horaires prévus, début H−15, rappels et affichage en `Africa/Douala` ; autres écrans ouverts.** Constat d'origine : fuseau horaire : aucune référence à `Africa/Douala`. Dates formatées avec `new Date()` ou `toLocaleDateString` côté serveur (UTC sur Vercel) et côté client. | recherche `timeZone` : aucun résultat | Formater avec `timeZone: "Africa/Douala"` et stocker en `timestamptz`. À traiter avec le lot pointage. |
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
| F-33 (P2, nouveau) | `proof-admin-cni.ts` : 9 assertions sur 24 échouent **avant comme après** ce lot (D1 `documents_not_submitted` puis des échecs en cascade). Le script semble antérieur à la purge immédiate des fichiers rejetés (commit 9524956). `proof-essentials-gate.ts` exige une entreprise déjà présente en base. | **Corrigé (lot 4, §13)** : tests obsolètes, aucun défaut applicatif. |

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

---

## 12. Suivi — Lot 3 : dépendances vulnérables (F-08, F-24) (2026-10-31)

**Statut : corrigé et vérifié localement. Non commité, non déployé.**

Branche `fix/lot-03-dependency-security`, créée depuis `origin/main-dev` (347344a, qui contient le lot 2b). Avis vérifiés dans la base GitHub Advisory (référence liée par le registre) et dans les notes de version des mainteneurs. Versions : voir `package.json` et `pnpm-lock.yaml`.

### Mises à jour

| Paquet | Avant → après | Type | Avis corrigés |
|---|---|---|---|
| `next` | 16.2.6 → 16.4.3 | direct, exécution | 20 avis, dont 5 critiques. Les correctifs les plus tardifs datent de 16.4.1 (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r). 16.4.2 et 16.4.3 sont des correctifs LTS (le second concerne `proxy.ts`). |
| `eslint-config-next` | 16.2.6 → 16.4.3 | direct, dev | Alignement avec `next` |
| `zod` | ^4.4.3 → ^4.6.7 (résolu 4.6.7) | direct, exécution | GHSA-mrhx-c7xc-m3w5 (CVE-2023-54404), corrigé en 4.6.6 par le commit `a0ebf97` (« check array, set and map size bounds before parsing elements ») |
| `sharp` 0.34.5 → 0.35.5, `postcss` 8.4.31 → 8.5.23, `nanoid` 3.3.12 → 3.3.20 | via `next` | transitif, build et exécution | GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w ; quatre avis `postcss` ; deux avis `nanoid` |
| `source-map-js` 1.2.2, `browserslist` 4.29.5, `baseline-browser-mapping` 2.11.34, `@babel/core` 7.29.7 | `pnpm update` dans les plages déclarées | transitif (`next` → `postcss` / `styled-jsx`), build | GHSA-68fv-2mgg-jv7q, GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g, GHSA-w5vr-8v7q-w6rv, GHSA-4x5r-pxfx-6jf8 |
| `undici` 7.30.1, `js-yaml` 4.3.2, `esbuild` 0.28.2, `vite` 7.3.7, `postcss` 8.5.32, `ip-address` 10.7.5, `brace-expansion` 1.1.21 / 2.1.7 / 5.0.12 | `pnpm update` dans les plages déclarées | transitif, outillage de dev | Tous les avis de ces paquets |

Aucun override, aucun `audit fix --force`, aucun changement de `package.json` hors des trois lignes ci-dessus. React reste en 19.2.4 (plage de pairs de `next` 16.4.3 : `^19.0.0`).

### Constats de l'audit initial

- **RCE Next.js** : avis confirmés (publiés par `vercel/next.js`). L'audit initial affirmait que l'application n'utilise pas `next/image` : **c'est inexact**. `next/image` est utilisé dans `app/page.tsx`, `app/auth/verify-phone/page.tsx`, `components/ui/logo-spinner.tsx` et `components/ui/splash-screen.tsx`, donc l'Image Optimizer est sollicité.
  - GHSA-2464-fhr4-w9xw (SVG, `sharp` < 0.35.5, Linux glibc) et GHSA-2xp9-vwfh-vxw4 (AVIF) : applicabilité **possible**. Elle dépend de l'optimiseur réellement exécuté en production, non établi ici.
  - GHSA-p293-qw3h-jr36 (serveur Windows) : non applicable à un hébergement Vercel (Linux), mais concerne le `next dev` local sous Windows.
  - GHSA-673q-mjm6-r5xr (`use cache`) et GHSA-vcvr-r3jv-pc5j (`next/og`) : **non applicables**, aucun usage.
- **Contournement du Proxy** (GHSA-6gpp-xcg3-4w24) : il exige une seule entrée dans `config.i18n.locales`. `next.config.ts` n'a pas de bloc `i18n`, donc l'avis est **non applicable**.
- **DoS Server Actions** (GHSA-m99w-x7hq-7vfj, GHSA-p3m5-59mp-jv5r) : **précondition remplie**, car `lib/actions/auth.ts` expose des Server Actions.
- **« > 16.4.0 »** : **confirmé**. La première version corrigeant tous les avis est 16.4.1. La branche 16.2.x (dernière : 16.2.12) ne corrige pas les avis critiques.
- **« Zod ≥ 4.6.6 »** : **confirmé**. Pour l'applicabilité, l'audit visait les routes qui valident des tableaux. Les schémas serveur ont tous une borne (`days: .max(7)`, `skill_ids: .max(20)`), mais avant 4.6.6 la borne n'était contrôlée qu'après la validation de chaque élément. Mesure : 5 000 éléments invalides produisent 5 001 issues en 4.4.3, contre 1 en 4.6.7. L'exposition était donc **possible** sur `PATCH /api/profile/availability` et `POST /api/profile/skill-documents`, dans la limite de la taille de corps acceptée.
- Non mentionnés dans l'audit initial : `sharp`, `postcss`, `nanoid` et `@ai-sdk/provider-utils` figuraient aussi dans l'arbre de production.
- Les notes de la release Zod 4.6.6 signalent des commits malveillants poussés sur `main` puis retirés, jamais publiés sur npm. 4.6.7 est publiée avec une attestation de provenance npm (SLSA v1).

### Contrôles exécutés

| Contrôle | Résultat |
|---|---|
| `pnpm audit --prod` | 36 avis (5 critiques, 17 hauts) → **1 bas** (`@ai-sdk/provider-utils`, voir plus bas). Comparaison par identifiant : 35 corrigés, 0 nouveau. |
| `pnpm audit` (complet) | 111 → 12 (2 critiques, 4 hauts, 5 modérés, 1 bas). 102 entrées (avis × version) corrigées, 0 nouvelle. |
| `pnpm install --frozen-lockfile` | ✅ |
| `tsc --noEmit`, `eslint`, `prettier --check` | ✅ |
| `vitest run` (nouveau `tests/server-validation.test.ts` : cas valides et invalides des schémas serveur ; tableau surdimensionné rejeté sur sa borne, avec une seule issue) | ✅ 13 fichiers, 226 tests |
| `pnpm build` | ✅ 69 pages, Next.js 16.4.3 (Turbopack), aucun avertissement |
| Parcours navigateur (Chrome headless, `playwright-core` hors dépôt, 375 × 812, pile `easyjob-proof`, `next build` + `next start` reliés à la pile, fixtures sur le modèle du lot 2, script et captures hors dépôt) | ✅ 14/14 |

Parcours vérifiés dans le navigateur :
- sans session, `/jobs/[id]` et `/admin` redirigent vers `/auth/login?next=…` ;
- inscription avec un mot de passe sans chiffre : la Server Action refuse via Zod, le message « Ajoutez au moins un chiffre. » s'affiche, et aucun `auth.signUp` n'est appelé ;
- connexion candidat vers `/jobs`, `/admin` redirigé vers `/` ;
- offre affichée (titre, `09:00 - 13:30`), « Postuler maintenant » puis « Confirmer » : « Candidature envoyée ! » s'affiche et l'état est conservé après rechargement. Une seconde tentative par la route est refusée (HTTP 400) ;
- déconnexion depuis le profil vers `/auth/login`, puis page protégée de nouveau refusée ;
- connexion admin vers `/admin`.

`next dev` n'a pas pu servir de cible : Next 16 refuse un second serveur de développement dans le même répertoire, et celui du port 3000 n'a pas été arrêté. Les preuves RLS n'ont pas été rejouées, car aucune migration ni route n'a changé.

### Alertes restantes

| Paquet | Avis | Exposition | Action proposée |
|---|---|---|---|
| `@ai-sdk/provider-utils` 4.0.27 (via `ai` 6.0.185 et `@ai-sdk/react`) | GHSA-866g-f22w-33x8 (bas) | Exécution (`/api/chat`). Exige une réponse surdimensionnée du fournisseur LLM, donc un fournisseur compromis ou malveillant. | Monter `ai` à ≥ 6.0.220 et `@ai-sdk/react` en conséquence au lot 8 (chatbot), avec un test du chatbot. |
| `tinypool` 1.1.1 (via `vitest` 3) | GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr (critiques) | Tests uniquement. Exige une pollution préalable de `Object.prototype` dans le processus de test. | **Corrigé au lot 4** (`vitest` 4.1.12, §13). |
| `vitest` / `@vitest/mocker` 3.2.7 | GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8 (modérés) | Seulement si le serveur de dev Vitest est joignable (`vitest run` n'en ouvre pas). | **Corrigé au lot 4** (§13). |
| `extract-zip` 2.0.1, `basic-ftp` 5.3.1, `zod` 3.25.76 (via `pwa-asset-generator` → `puppeteer`) | GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3 (aucune version corrigée publiée) ; GHSA-c475-qrg2-pj4r (correctif en 6.x) ; GHSA-mrhx-c7xc-m3w5 (pas de correctif 3.x) | Script manuel `pnpm pwa:*`, sur des entrées locales de confiance. Absent du build et de l'exécution. | Surveiller `pwa-asset-generator`, ou le retirer s'il n'est plus utilisé (lot 10). |
| `minimatch` 3.1.5 / 9.0.9 / 10.2.5, `glob` 10.5.0 (via `eslint` et ses plugins) | GHSA-g3hv-75wg-m249, GHSA-3g3m-2fjr-6pw4 (modérés) | Lint local et CI, sur des motifs de confiance. | Correctifs uniquement en majeure (`minimatch` 11, `glob` 14) : attendre les paquets parents. |

Un audit de dépendances vert ne dit rien des failles applicatives (RLS, routes, logique métier) : les lots 4 et suivants restent nécessaires.

---

## 13. Suivi — Lot 4 : tests d'autorisation en CI (F-20, F-21, F-33) (2026-10-31)

**Statut : corrigé et vérifié localement. Non commité, non poussé : la CI distante reste à observer.**

Branche `ci/lot-04-rls-and-deployment`, créée depuis `origin/main-dev` (3464565, qui contient le lot 3). Procédure, fixtures et nettoyage : `docs/testing/local-proofs.md`.

### Suite d'autorisation

`pnpm test:rls` (`scripts/run-security-proofs.ts`) exécute séquentiellement les 16 preuves existantes. Il n'introduit aucun nouveau cadre de test et réutilise `scripts/lib/local-supabase.ts` et `scripts/init-proof-stack.ts`. Avant toute écriture, il refuse une `API_URL` ou une `DB_URL` non locale, ainsi qu'une application injoignable. Il échoue si une preuve échoue.

| Domaine | Preuves | Assertions |
|---|---|---|
| Comptes et rôles (F-01 à F-03) | `account-security` | 36 |
| Droits métier, candidatures, abonnements, verrous (F-04 à F-06, F-11, F-17, F-34, F-35) | `business-permissions` | 135 |
| Offres et gate de candidature | `jobs-rls-select`, `essentials-gate`, `license-gate` | 4 + 6 + 16 |
| Profil candidat | `profile-lock`, `profile-location`, `profile-momo`, `profile-skills`, `profile-documents` | 9 + 15 + 11 + 7 + 12 |
| Opérations admin | `admin-centralization`, `admin-candidate-profile`, `admin-cni`, `admin-momo-review`, `admin-t84c-reviews`, `admin-update-requests` | 24 + 11 + 25 + 7 + 19 + 38 |

Total : 375 assertions, 16/16 preuves réussies, environ 1 min 45 d'exécution.

Corrections apportées aux preuves elles-mêmes :
- Les 11 preuves qui dépendent de l'application se terminaient en succès (« preuve ignorée ») si elle était injoignable. Elles échouent désormais.
- `proof-essentials-gate` se terminait avec le code 0 malgré une assertion en échec. Corrigé.
- `proof-admin-momo-review` affichait le jeton d'une URL signée de stockage. Il est masqué.

### F-33 : preuves préexistantes en échec

- **`proof-admin-cni` (15/24 → 25/25) : test obsolète.** Depuis T8.4c (9524956), un verdict CNI purge les photos et vide les URL, et la RPC refuse d'approuver un dossier sans les trois photos (`cni documents not submitted`). La preuve rejetait puis approuvait le même dossier sans nouvelle soumission. Les 9 échecs découlaient tous de D1. Ajout de D0 : le candidat soumet de nouveau ses trois photos par sa vraie session via `POST /api/profile/documents` (200 ×3, `cni_verified='pending'`, URL posées). Aucune assertion n'a été retirée. D3 (photos purgées après approbation) devient significatif : il passait jusque-là trivialement.
- **`proof-essentials-gate` (bloquée → 6/6) : test obsolète.** Trois causes :
  - le code `essentials_incomplete` est remplacé depuis T8.3 par `profile_not_verified` (gate `users.is_verified` dans `apply_to_job`), et la route y joint toujours la liste `missing` ;
  - la preuve exigeait une entreprise préexistante : elle crée maintenant la sienne ;
  - la fixture forçait `is_verified = true` pour les deux candidats : il est désormais dérivé de l'état par `recompute_user_verification`, et une assertion le vérifie.

  L'attente sur A est renforcée : 200 et candidature persistée en `pending`, au lieu de « 200, 400 ou 404 », car l'incohérence de lecture des offres est corrigée (`proof-jobs-rls-select`). Le contrôle « aucune candidature » porte désormais sur B seul. La preuve est conservée, et non remplacée par E7 de `business-permissions`, car E7 ne vérifie pas le contenu de `missing`.

Aucun défaut applicatif n'a été découvert, et la logique métier n'a pas été modifiée.

### CI (`.github/workflows/ci.yml`)

- **`lint-and-types` :** ajout de `pnpm test` (Vitest, non interactif).
- **`test-migrations` :** une seule pile jetable, préparée par `init-proof-stack` (fournisseurs externes coupés). Le job enchaîne les migrations au démarrage, la comparaison des types générés, le build de l'application reliée à la pile, `next start` et `pnpm test:rls`. Les clés de la pile locale sont masquées dans les logs.
- **CLI Supabase :** `supabase/setup-cli` est remplacé par `pnpm exec supabase`, version 2.117.0 figée par `package.json` : la même version génère les types et sert à `proof-license-gate`.
- **`build` :** il dépend désormais de `lint-and-types` **et** de `test-migrations`. Il ne peut pas être vert si les tests unitaires, les migrations ou les preuves échouent.
- **Déclencheurs :** ajout du push sur `main-dev`. Toutes les PR (y compris vers `main-dev`) passent par `pull_request`, sans secret ni jeton en écriture.
- **Sécurité du workflow :**
  - permissions réduites à `contents: read` ;
  - `persist-credentials: false` au checkout ;
  - `github.head_ref` passé par variable d'environnement au lieu d'être interpolé dans le script.
- **Outils :** pnpm passe de 10 à 11.1.3, la version qui produit le lockfile. Node reste en 22 (`engines`).
- **Caches et annulation :** cache du store pnpm conservé, ainsi que l'annulation des exécutions obsolètes.
- **Audit des dépendances :** aucun contrôle bloquant ajouté. Les alertes restantes sont connues et hors périmètre (§12).

### Outillage de test

`vitest` passe de 3.2.7 à 4.1.12, avec `@vitest/mocker` 4.1.12. Vitest 4 n'utilise plus `tinypool`.

| Avis | Paquet (avant) | Exposition avant | Statut |
|---|---|---|---|
| GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr (critiques) | `tinypool` 1.1.1 | Exige une pollution préalable de `Object.prototype` dans le processus de test | **Corrigés** (paquet retiré) |
| GHSA-82fw-gwwq-j7x9 (modéré) | `vitest`, `@vitest/mocker` 3.2.7 | Serveur WebSocket de Vite/Vitest joignable (mode watch, UI, navigateur). `vitest run`, en local comme en CI, n'en ouvre pas : non exposé | **Corrigé** (≥ 4.1.11) |
| GHSA-qxg6-89mg-rqv8 (modéré) | `@vitest/mocker` 3.2.7 | Idem | **Corrigé** (≥ 4.1.12) |

Le guide de migration v4 a été consulté (exclusions simplifiées, mocks, pools, API retirées). Aucun point ne concerne la configuration du dépôt (`include: tests/**`, environnement `node`, ni coverage, ni pool, ni workspace) : aucune adaptation, 226/226 tests. Vitest 5 n'était pas nécessaire. `pnpm audit` passe de 12 à 7 entrées, avec 5 corrigées et 0 nouvelle. Les alertes restantes sont celles de §12, hors outillage de test.

### Validation

| Contrôle | Résultat |
|---|---|
| Rejeu local des étapes `run:` des trois jobs de `ci.yml`, depuis une pile neuve (Git Bash, `GITHUB_ENV` émulé, port 3100) | ✅ `lint-and-types`, `test-migrations` (16/16 preuves), `build` |
| `tsc`, `eslint . --max-warnings=0`, `prettier --check .`, `vitest run` | ✅ 226 tests |
| `pnpm install --frozen-lockfile` | ✅ |
| Refus préalables de `test:rls` (application injoignable, `API_URL` distante, `DB_URL` distante) | ✅ code 1, aucune écriture |
| Contrôle négatif 1 : `grant update (role)` seul sur `users` | 36/36, code 0. Le trigger compense : protection effective, résultat attendu |
| Contrôle négatif 2 : privilège et trigger `trg_protect_user_account_columns` désactivé (reproduit F-01) | ❌ 9 échecs détectés (auto-promotion admin, premium…), code 1 propagé par `test:rls` |
| Restauration (`db reset` de la pile dédiée), vérification du catalogue, puis rejeu | Privilège absent, trigger actif, 16/16 |

La CI GitHub n'a pas été exécutée : elle est à observer après le push. Points à surveiller :
- pnpm 11 via `pnpm/action-setup` ;
- le binaire Supabase installé par pnpm sous Linux ;
- la durée du job `test-migrations` (environ 5 min en local, timeout de 30 min).

### Restant (F-20 déploiement, hors lot 4 sur décision)

`deploy.yml` et `release.yml` n'ont pas été modifiés. Décisions à prendre :
1. **Versions des CLI de déploiement :** `supabase/setup-cli` en `latest` et `vercel@latest`. Proposition : `supabase` 2.117.0, comme la CI, et une version Vercel figée. Ces versions sont à choisir.
2. **pnpm :** `deploy.yml` installe encore pnpm 10, alors que le lockfile est produit par pnpm 11.1.3.
3. **Sauvegarde avant `db push` :** PITR ou `supabase db dump` (stockage, rétention, accès), avec une étape `db push --dry-run` préalable.
4. **Restauration :** le rollback par tag redéploie l'application sans revenir sur la base. Il manque une procédure documentée, soit de restauration, soit de migrations compensatoires.
5. **Connexion du `db push` :** il passe par le pooler 6543 (mode transaction). Un port 5432 ou une connexion directe est à confirmer.
6. **Protections de branche :** rendre obligatoires les checks `lint-and-types`, `test-migrations` et `build` sur `main-dev` et `main`.

### Limites

- Pas de preuve d'autorisation sur `contracts` et `missions` (lot 7).
- Les actions GitHub sont référencées par tag majeur (`@v4`), pas par SHA.
- Les nettoyages préalables de certaines preuves visent les restes de la même preuve sur la pile jetable : ce sont des comptes créés par une exécution antérieure, et non par l'exécution en cours.

---

## 14. Suivi — Lot 4b : fiabilité du déploiement (F-20) (2026-10-31)

**Statut : configuration préparée et validée localement (workflows, filtres, `vercel.json`). Non commitée, non poussée, aucun déploiement : le comportement à distance n'est pas confirmé.**

Branche `ci/lot-04b-deployment-reliability`, créée depuis `origin/main-dev` (b6891f3, qui contient le lot 4). Procédure, secrets et reprise : `docs/deployment/production.md`.

### Réponses aux décisions ouvertes du §13

| # | Point | Décision |
|---|---|---|
| 1 | Versions des CLI | Supabase 2.117.0 via `pnpm exec`, comme en CI (plus de `setup-cli@latest`). Vercel figée en 64.5.0 (justification : production.md §2). |
| 2 | pnpm | `packageManager: pnpm@11.1.3` et `engines.node` dans `package.json`, seule source pour CI, release et deploy. |
| 3 | Sauvegarde avant `db push` | Non ajoutée : Supabase Free, aucune donnée. Reportée au point de contrôle avant les premiers utilisateurs (production.md §7). Le dry-run est ajouté, sans être présenté comme une garantie. |
| 4 | Restauration | Procédures documentées pour quatre cas : échec avant, pendant et après les migrations, retour à une version précédente (production.md §5). Aucun rollback SQL automatique. |
| 5 | Connexion | `supabase link` puis `db push --linked` : connexion directe si IPv6, sinon pooler en mode session (5432). Le mode transaction (6543) n'est plus utilisé. Le secret `SUPABASE_DB_HOST` n'est plus lu. |
| 6 | Protections de branche | Recommandation fondée sur les déclencheurs et les noms de jobs réels (production.md §9). Rien n'est activé à distance. |

### Changements

- **`deploy.yml` :**
  - nouveau job `resolve-release` : tag vers SHA unique, refus d'un tag déplacé ou hors de `main`, attente de la CI (push) réussie sur ce SHA ;
  - les jobs de déploiement extraient ce SHA ;
  - concurrence `queue: max`, sans annulation ;
  - `persist-credentials: false` ;
  - secrets passés par l'environnement, jamais interpolés dans les scripts.
- **`ci.yml` :** les runs de push ne sont plus annulés (groupe par SHA). Seuls les runs de PR le sont encore. pnpm et Node sont lus depuis `package.json`.
- **`release.yml` (option A, 2026-11-01) :**
  - il ne pousse plus de commit de version sur `main`. Déclenché par `workflow_run` après une CI réussie (push, `main`), il lit la version `X.Y.Z` dans le `package.json` du commit testé ;
  - il pose le tag `vX.Y.Z` sur ce SHA, par un `git push` sans force avec `GH_PAT`. La reprise est idempotente, et un tag présent sur un autre commit fait échouer la release ;
  - la GitHub Release est créée avec `GITHUB_TOKEN`, et seulement sur un tag vérifié ;
  - entrées `bump`/`prerelease`, garde anti-boucle, pnpm et Node supprimés : le job n'exécute aucun code du dépôt.

### Constats

- `db push --dry-run` ne lit pas le SQL des migrations. Il détecte les erreurs de connexion et les divergences d'historique, mais pas les erreurs d'exécution.
- La CLI applique chaque fichier en un lot, sans transaction globale. Les fichiers avec `begin;`/`commit;` explicites (`20260526120000_srs_v11_enum_hardening.sql`) ou des instructions `CONCURRENTLY` perdent l'atomicité.
- Redéployer un ancien tag après de nouvelles migrations échoue au dry-run (`ErrMissingLocal`), avant Vercel. C'est le comportement voulu.
- Avant ce lot, la CI d'un commit tagué pouvait être annulée par le push suivant, et rien ne la vérifiait avant le déploiement.

### Validation

| Contrôle | Résultat |
|---|---|
| Analyse YAML des trois workflows, références `needs`/`outputs`, absence de `latest`, de version dupliquée et de secret ou d'entrée interpolés dans `run:` | ✅ |
| `bash -n` sur toutes les étapes `run:` de `deploy.yml` | ✅ |
| Simulation de `resolve-release` avec un faux `gh` : tag annoté, tag léger, entrée non-tag, tag déplacé, commit hors de `main`, tag absent, CI en échec, CI en cours puis réussie | ✅ 2 acceptations, 6 refus attendus |
| Options `link`, `db push` (CLI 2.117.0 locale) ; `pull`, `build --prod`, `deploy --prebuilt --prod` (CLI Vercel 64.5.0 installée hors dépôt) | ✅ |
| `pnpm install --frozen-lockfile` (pnpm 11.1.3), `prettier --check` | ✅ |
| Absence de secret dans le diff | ✅ noms de secrets uniquement |

Complément du 2026-11-01 (finalisation, outils officiels hors du dépôt) :
- **actionlint 1.7.12 avec shellcheck 0.11.0 :** aucun problème, sauf `unexpected key "queue"`. Ce message est un faux positif d'un validateur en retard (actionlint#657) : `queue: max` est documenté par GitHub depuis le 2026-05-07, et l'option est conservée. Les avertissements shellcheck de `release.yml` (`$GITHUB_OUTPUT` sans guillemets) sont corrigés.
- **Filtres `--jq` :** testés avec gojq 0.12.19, la version embarquée par `gh` 2.103.3.
- **`resolve-release` :** rejoué de bout en bout avec un faux `gh` qui renvoie du JSON réaliste. Résultat : 2 acceptations et 13 refus attendus.
- **Sélection du run CI :** elle ne dépend plus de l'ordre, non documenté, de l'API. Elle filtre sur `branch=main`, retient le run le plus récent et échoue après 10 minutes sans run.
- **`vercel.json` :** conforme au schéma officiel.
- **`release.yml` (option A) :** testé avec un vrai `git` contre un dépôt nu local : création, reprise, conflit, courses forcées et réelles, version invalide ou inférieure, push refusé, dépôt injoignable. Le tag reste sur le SHA de l'événement alors que `main` a avancé. Défaut trouvé et corrigé : sans motif `^{}` explicite, `git ls-remote` ne renvoyait pas le commit d'un tag annoté, et la reprise était refusée à tort.

Détail des contrôles et points à confirmer à distance : production.md §10.

### Restant

- **Intégration Git de Vercel (confirmée, `main` en production) :** `vercel.json` désactive le déploiement Git automatique de `main` seulement. Rien ne garantit que la règle s'applique dès le premier merge : une commande d'Ignored Build Step temporaire, limitée à `main`, est à poser avant ce merge (production.md §1). Le comportement réel reste à confirmer à distance.
- **Release (option A appliquée) :** `main` peut exiger une PR sans contournement. Avant le premier merge, il faut intégrer `main` (0.1.10) dans `main-dev`, puis préparer une version supérieure (production.md §9). La chaîne `workflow_run` → tag → `deploy.yml` reste à confirmer à distance.
- Base visée par les previews Vercel : à identifier (production.md §8).
- Point de contrôle sauvegarde et restauration avant les premiers utilisateurs (production.md §7).
- Actions GitHub toujours référencées par tag majeur, et non par SHA.

---

## 15. Suivi — Lot 5 : clients Supabase typés (F-14) (2026-11-01)

**Statut : corrigé et vérifié localement. Non commité, non poussé : la CI distante reste à observer.**

Branche `refactor/lot-05-supabase-types`, créée depuis `origin/main-dev` (de4ea66, qui contient le lot 4b). Les preuves ont tourné sur la pile dédiée `easyjob-proof` (API 54421, procédure `docs/testing/local-proofs.md`), avec l'application construite contre cette pile. La pile de développement n'a pas été touchée.

### Clients et source des types

- **Clients typés `Database` :**
  - `createClient` navigateur (`lib/supabase/client.ts`) ;
  - `createClient` et `createAdminClient` serveur (`lib/supabase/server.ts`) ;
  - client du proxy (`lib/supabase/middleware.ts`).

  Aucun autre client n'est créé dans l'application.
- **Source unique :** `lib/database.types.ts`, généré par `supabase gen types` (CLI 2.117.0). Il est identique au schéma issu des migrations, y compris après la nouvelle migration, qui ne touche que le stockage. La CI le compare toujours (`test-migrations`). Il n'a été ni régénéré ni retouché à la main.
- **`database.types.ts` (racine) supprimé :** version ancienne (1 902 lignes contre 2 538), importée nulle part.
- `lib/types.ts` reste la couche de types métier. Il s'appuie déjà sur les `Tables`/`Enums` générés.

### Incohérences révélées et corrigées

Le typage a fait apparaître 40 erreurs dans 19 fichiers. Les défauts réels :

| Fichier | Défaut | Correction |
|---|---|---|
| `app/onboarding/company/page.tsx` | Écriture dans `companies` (table inexistante), tentative `users.is_verified = true`, erreurs ignorées. Le tableau de bord renvoyait vers l'onboarding tant que `onboarding_status` ≠ `completed` : boucle sans issue. | Voir « Onboarding entreprise » ci-dessous. |
| `app/api/admin/jobs/[id]/moderate/route.ts` | Colonne `moderated_by` inexistante (`moderation_by`) : la route échouait toujours. | Nom de colonne corrigé. Le blocage RLS de l'admin (F-09b) reste au lot 6. |
| `app/company/jobs/new/page.tsx` | `job_type` `one_time`/`temporary` et `urgency` `high`, hors énumérations : toute création d'offre par l'interface échouait. `jobs.city`, obligatoire, était alimenté par une ville nullable. | Valeurs de l'énumération. Sans ville, renvoi vers l'onboarding. **Effet :** l'insertion directe fonctionne désormais. Elle contourne toujours le contrôle « entreprise vérifiée » de `POST /api/jobs` (F-09a, lot 6). Aucune capacité nouvelle pour un attaquant, qui peut déjà écrire directement. |
| `app/api/jobs/route.ts` | `job_type` acceptait n'importe quelle chaîne ; `recurring_days` et `required_skills` étaient en `unknown`. | Zod fondé sur les `Constants` générés et sur des tableaux typés. |
| `lib/matching/ai-matching.ts` | `reviews.rating` n'existe pas (`overall_rating`) : la moyenne n'était jamais recalculée (fonction sans appelant). `is_available` était testé mais jamais sélectionné : un jour indisponible comptait comme disponible. | Colonne corrigée et erreurs propagées. `is_available` ajouté à la projection. |
| `app/company/jobs/[id]/page.tsx` | Affichage de `candidate_note`, colonne inexistante. | Bloc mort retiré ; type dérivé de la requête (`QueryData`). |
| `lib/utils.ts` | `formatCurrency(x, null)` : la valeur par défaut ne s'applique pas à `null`, et `Intl` lève `RangeError`. La devise est nullable en base. | Repli sur XAF pour `null`. |
| `app/my-jobs`, `app/jobs/[id]`, `app/company/*`, `app/admin/dashboard` | Interfaces locales ignorant la nullabilité (`status`, `positions_*`, `currency`, `created_at`…). Une date nulle s'affichait « 1970 ». | Types dérivés de `Tables` ou des requêtes. Valeurs nulles traitées, avec les défauts SQL pour `positions_*`. |
| `app/admin/momo`, `app/profile/{documents,skills,candidate/edit}`, `app/tasks` | Chaînes en base élargies par assertion implicite en unions (`mtn`/`orange`, catégories de permis, groupes verrouillables). | Restriction par les schémas et listes existants (`paymentSchema`, `licenseCategorySchema`, `isProfileLockGroup`). |

**Assertions supprimées :** cinq `as unknown as` sur des résultats Supabase (`app/my-jobs`, `app/tasks`, `app/api/admin/skill-documents/[id]`). La relation `candidate_documents → candidate_profiles` est plusieurs-vers-un : elle renvoie un objet, non nul avec `!inner`.

**Assertions conservées, sur une limite démontrée du générateur :** les arguments de fonction générés sont toujours non nullables, alors que ces fonctions traitent explicitement `NULL` :
- `check_email_send_quota` et `check_sms_send_quota` (`p_ip IS NULL`) ;
- `moderate_cni` (`coalesce(p_expires_at, …)`, motif nul à l'approbation).

Chaque cas passe par une conversion unique et commentée (`lib/actions/auth.ts`, `app/api/admin/cni/route.ts`).

### Onboarding entreprise

Parcours : formulaire (`app/onboarding/company/onboarding-client.tsx`) → Zod partagé (`lib/validations/company.ts`) → `PUT /api/company/onboarding` → `company_profiles` de l'entreprise connectée (session, RLS) → rechargement.

- **Page serveur :** session et rôle (`company`, `company_premium`) vérifiés, profil chargé pour la reprise.
- **Correspondance des champs** (décisions du 2026-11-01) :

  | Formulaire | Colonne |
  |---|---|
  | Nom | `company_name` (règles de l'inscription) |
  | Type d'activité | `sector` |
  | Taille : TPE, PME, ETI, Grande entreprise | `company_size` (énumération, sans tranche chiffrée) |
  | Site web, description (facultatifs) | `website` (http(s) uniquement), `description` ; vide = `null` |
  | RCCM | `rccm` |
  | Document RCCM (PDF/JPG/PNG/WebP, 5 Mo) | `documents_url`, bucket privé `company-documents` |
  | Ville, quartier, adresse | `city` (`CAMEROON_CITIES`, comme les candidats), `quartier`, `address` |
  | NIU | affiché en lecture seule, jamais écrit |
  | Étape « Paiement » | retirée : aucune colonne ne la porte (à concevoir avec F-19) |

- **Pas d'auto-validation :** ni `users.is_verified`, ni `verification_status`, `niu`, `niu_verified` ou l'abonnement ne sont écrits. Seul `onboarding_status = completed` est posé, ce qui n'est pas une validation administrative.
- **Reprise :**
  - les valeurs enregistrées sont pré-remplies ;
  - sans nouveau fichier, le document est conservé ;
  - un nouveau fichier remplace l'ancien, supprimé après l'enregistrement.
- **Échecs :** le message FR/EN s'affiche au-dessus du bouton, sans redirection. Le succès n'est annoncé qu'après relecture de la ligne mise à jour. Un fichier déjà envoyé est supprimé si l'écriture échoue.
- **Migration `20261101120000_company_documents_storage.sql` :** bucket privé sur le modèle de `candidate-documents`, un dossier par `auth.uid()`, lecture admin pour la revue. Aucune migration existante modifiée. Aucune interface admin ne consulte encore ces documents.
- `detectDocumentMime`, qui contrôle les octets réels du fichier, devient un utilitaire partagé (`lib/utils/file-type.ts`), réutilisé par les justificatifs candidat.

### Nouveau constat F-41 (P1) — auto-validation d'une entreprise

> **Corrigé et vérifié localement (lot 5b, §16), non déployé.**

`company_profiles` n'a qu'une politique UPDATE « `user_id = auth.uid()` », sans restriction de colonnes ni trigger de protection. Reproduit sur la pile dédiée avec une **vraie session** entreprise : `update({ verification_status: "verified", niu_verified: true, subscription_plan: "business" })` réussit.

L'entreprise contourne ainsi :
- la revue admin ;
- le contrôle « entreprise vérifiée » de `POST /api/jobs` ;
- son plan d'abonnement.

Hors périmètre du lot 5, car l'onboarding n'écrit pas ces colonnes. À corriger comme au lot 2 (privilèges de colonnes et trigger), avec une preuve négative.

### Autres points relevés, non corrigés

- `/company/dashboard` refuse le rôle `company_premium`.
- Neuf redirections visent `/login`, qui n'existe pas (la page est `/auth/login`). La nouvelle page utilise `/auth/login`.

### Validation

| Contrôle | Résultat |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ lockfile inchangé |
| Types générés depuis la pile dédiée, comparés à `lib/database.types.ts` (avant et après la migration) | ✅ identiques |
| `tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .` | ✅ |
| `vitest run` | ✅ 245 tests, dont 19 nouveaux (schéma d'onboarding, `detectDocumentMime`, `formatCurrency`, `isProfileLockGroup`) |
| `pnpm build` contre la pile dédiée, cible vérifiée (`NEXT_PUBLIC_SUPABASE_URL` = 54421, aucune URL distante dans le bundle) | ✅ |
| `pnpm test:rls` | ✅ 17/17 preuves. Nouvelle preuve `company-onboarding`, 19 assertions : enregistrement, persistance, reprise, refus, absence d'auto-validation, isolation entre entreprises en base et en stockage, 401/403/404 sans fichier orphelin. |
| Contrôle négatif : politique d'insertion du bucket relâchée sur la pile dédiée | ❌ détecté (E2), puis `db reset` et politique vérifiée |
| Navigateur : Chrome headless, vrais clics, fenêtre 390×844 tactile | ✅ 28 vérifications : onboarding FR complet ; refus de `javascript:` ; persistance ; reprise après rechargement ; échec réel affiché, sans redirection et visible sans défilement ; textes EN ; pas de défilement horizontal ; connexion candidat, candidature confirmée puis persistée. |

### Limites

- CI distante non observée.
- Tests navigateur exécutés par un script local hors dépôt (Puppeteer et Chrome installé), non intégrés à la CI. `puppeteer-core` vient de `pwa-asset-generator` ; aucune dépendance ajoutée.

---

## 16. Suivi — Lot 5b : droits d'écriture des entreprises (F-41) (2026-11-01)

Branche `fix/lot-05b-company-permissions`, base `origin/main-dev` (759f751, lot 5 intégré par la PR #53). **Corrigé et vérifié localement, non commité, non déployé.** Migration : `supabase/migrations/20261101130000_lock_company_profile_permissions.sql`.

### État avant correction (schéma final des migrations)

- `GRANT ALL` de la baseline à `anon` et `authenticated` sur les 37 colonnes.
- Politique INSERT sans clause `TO` ; politique UPDATE sans `WITH CHECK` ; aucune politique DELETE (refus silencieux).
- Un seul trigger (`updated_at`). Aucune fonction de la base n'écrit `company_profiles`.
- Chemins d'écriture applicatifs : `finalizeSignup` (création, clé service) et `PUT /api/company/onboarding` (session). Aucune route admin, aucun script d'exploitation n'écrit la table ; les preuves l'écrivent en clé service pour leurs fixtures.

### Champs sensibles, d'après leurs usages

| Champ | Usage qui en fait un droit |
|---|---|
| `verification_status` | Contrôle « entreprise vérifiée » de `POST /api/jobs` ; sections admin *En attente* / *Validées* |
| `verification_rejection_reason` | Motif affiché par l'admin |
| `niu`, `niu_verified` | Identité fiscale vérifiée par `admin_ops` (SRS §11.6) ; `niu` unique |
| `subscription_plan` | Source de vérité du plan (`lib/utils/company-plan.ts`, `/profile/company`) |
| `subscription_tier`, `subscription_expires_at`, `trial_ends_at` | Repli du plan, échéance affichée, essai consommé |
| `trust_score`, `average_rating`, `total_missions_posted`, `late_cancellation_count` | Réputation et pénalités |
| `user_id`, `id`, `is_active`, `device_fingerprint`, `created_at`, `legal_name`, `contact_*`, `logo_url`, coordonnées | Propriétaire et champs internes, écrits par aucun parcours en session |

Sources de référence : la vérification d'une entreprise est `company_profiles.verification_status` (et non `users.is_verified`, calculé pour les candidats seulement) ; le plan est `subscription_plan`. `users.role` (`company_premium`) est protégé par le lot 1, l'INSERT `subscriptions` réservé aux admins par le lot 2.

### Protections

Mêmes principes qu'aux lots 1 et 2 :

- **Privilèges de colonnes**, frontière principale. `authenticated` ne garde que `UPDATE` sur les 12 colonnes écrites par l'onboarding : `company_name`, `sector`, `company_size`, `website`, `description`, `rccm`, `city`, `quartier`, `address`, `documents_url`, `onboarding_status`, `onboarding_step`. Plus d'INSERT, de DELETE ni de TRUNCATE en session. Toute autre écriture est refusée explicitement (42501).
- **Trigger de défense en profondeur** `trg_protect_company_profile_columns`, fondé sur `current_user`. Il ne dépend pas de `easyjob.system_update`. Il refuse :
  - toute création ou suppression en session ;
  - toute colonne hors liste, y compris les colonnes ajoutées plus tard ;
  - un `documents_url` hors du dossier `<auth.uid()>/` du bucket `company-documents`.
- **RLS** : politique INSERT supprimée, politique UPDATE limitée à `authenticated`, avec `WITH CHECK`.
- **Création et recréation** : le profil n'est créé que par `finalizeSignup` (clé service). L'UPSERT exige l'INSERT et il est donc refusé. La suppression n'existe qu'avec le compte, en cascade exécutée en propriétaire. Une suppression suivie d'une recréation est impossible en session.
- **Contexte d'exécution** : aucune fonction `SECURITY DEFINER` exposée n'écrit la table ni n'exécute de SQL dynamique, et la fonction du trigger n'est pas exécutable. La preuve le vérifie dans le catalogue. Les écritures de confiance passent par `service_role`.

### Données vérifiées (décision produit du 2026-11-01 : nouvelle revue)

- Si une entreprise **vérifiée** modifie son nom (`company_name`), son RCCM ou son document RCCM, la modification est enregistrée. Dans la même écriture, `verification_status` repasse à `pending` et le motif est effacé. L'entreprise ne peut plus publier jusqu'à une nouvelle validation.
- Les autres champs (secteur, taille, site, description, adresse) ne déclenchent pas de revue.
- Le NIU n'est jamais modifiable en session, donc `niu_verified` est conservé.
- Une entreprise **refusée** qui corrige ses informations reste `rejected` : seul l'admin lève le refus.
- L'onboarding prévient l'entreprise vérifiée avant l'envoi (`companyOnboarding.verifiedNotice`, FR/EN).
- Les corrections faites par un chemin de confiance (clé service) ne déclenchent pas de revue.

### Opérations réservées aux chemins de confiance

- Validation, refus et motif ; `niu` et `niu_verified` ; plan, échéances et essai ; statistiques ; changement de propriétaire ; création et suppression du profil.
- Il n'existe aujourd'hui **ni RPC ni interface admin** pour valider une entreprise : ces opérations passent par la clé service (Studio ou script d'exploitation), sans trace dans `audit_logs`. Aucune RPC n'a été ajoutée : la revue RCCM et la validation tracée sont à concevoir dans un lot dédié.
- La suspension (`admin_set_user_active`, grades `admin_ops` et `admin_founder`) est inchangée et tracée.

### Valeurs existantes

Non corrigées par la migration. À vérifier séparément, en lecture seule, sur la production (lot 0) :

```sql
select cp.id, cp.user_id, cp.verification_status, cp.niu_verified,
       cp.subscription_plan, cp.subscription_tier, cp.subscription_expires_at,
       cp.trial_ends_at, cp.trust_score, cp.updated_at
from public.company_profiles cp
where cp.verification_status = 'verified'
   or cp.niu_verified
   or coalesce(cp.subscription_plan, 'free') <> 'free'
   or coalesce(cp.subscription_tier, 'free') <> 'free'
   or cp.subscription_expires_at is not null
   or cp.trust_score is distinct from 5.00
order by cp.updated_at desc;
```

Chaque ligne doit correspondre à une validation ou à un abonnement connus de l'équipe : aucune trace n'existe en base pour les distinguer d'une auto-attribution.

### Validation

| Contrôle | Résultat |
|---|---|
| Nouvelle preuve `pnpm test:rls company-permissions` | ✅ 46 assertions, vraies sessions ; état relu ligne entière en clé service. Elle couvre l'auto-validation, `niu_verified`, le NIU, le plan, l'essai et les statistiques ; l'écriture partielle ; l'INSERT, l'UPSERT et le DELETE ; le propriétaire ; l'isolation ; un document hors dossier ; l'anonyme ; le catalogue et les RPC exposées ; l'édition et l'onboarding légitimes ; la lecture du RCCM ; la validation de confiance puis `POST /api/jobs` 201 ; `admin_support` refusé, `admin_ops` tracé ; la nouvelle revue. |
| `POST /api/jobs` après tentative d'auto-validation | ✅ 403. Ce n'est **pas** une correction de F-09 : les autres chemins de création et de modération des offres restent au lot 6. |
| Contrôle négatif sur la pile dédiée (privilèges rouverts, trigger désactivé, politique INSERT recréée) | ❌ détecté : 32 échecs, code de sortie 1. Restauration par `db reset`, vérification des privilèges et du trigger, puis preuve rejouée verte. |
| `pnpm test:rls` complet | ✅ 18/18 preuves, dont `company-onboarding` et les preuves admin. Premier passage en CI : `company-permissions` en échec. Lancée hors agent IA, `supabase db query` rend un tableau texte et non du JSON. Corrigé par `--output-format json`, puis suite rejouée sans les variables d'agent : 18/18. |
| Navigateur : Chrome headless, vrais clics, 390×844 tactile | ✅ 11 vérifications : connexion, onboarding complet avec RCCM, reprise, avertissement FR puis EN, nouvelle revue après changement de nom, refus affiché sans redirection ni écriture, pas de défilement horizontal |
| `tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .`, `vitest run` (245 tests) | ✅ |
| `pnpm build` contre la pile dédiée (54421) | ✅ |
| Types générés depuis la pile dédiée comparés à `lib/database.types.ts` | ✅ identiques, pas de régénération |

### Limites restantes

- **F-09 (lot 6)** : traité au §17.
- **F-16 (lot 7a)** : la politique SELECT « Companies can view candidate summaries » laisse toujours une entreprise lire tous les profils entreprise. Elle n'est pas modifiée ici.
- Validation et revue des entreprises sans RPC ni trace d'audit (voir ci-dessus).
- `/company/dashboard` refuse toujours `company_premium`, et les redirections `/login` restent à corriger (constats du §15, hors lot).
- CI distante non observée. Script navigateur local, hors dépôt.

## 17. Suivi — Lot 6 : création, modération et publication des offres (F-09) (2026-11-01)

Branche `fix/lot-06-job-moderation`, base `origin/main-dev` (737d02c, lot 5b intégré par la PR #54). **Corrigé et vérifié localement, non commité, non déployé.** Migration : `supabase/migrations/20261101140000_job_moderation.sql`.

### État avant correction

- Deux chemins de création : `company/jobs/new` (INSERT direct, sans contrôle de vérification) et `POST /api/jobs` (contrôles dans la route seulement, statut `pending_moderation`).
- Politique `FOR ALL` de l'entreprise sur ses offres et `GRANT ALL` de la baseline : publication directe (`status = 'active'`), champs de modération, compteurs et propriétaire modifiables en session.
- Aucune politique admin sur `jobs` : file de modération vide, route `moderate` en succès sur 0 ligne, sans audit ni notification.
- Deux valeurs d'attente (`pending_review`, `pending_moderation`) et de publication (`active`, `published`) mélangées dans les requêtes. Une offre approuvée n'apparaissait dans aucun onglet de l'entreprise.
- Lien « Modifier » vers une page inexistante.

### Chemins d'écriture retenus

| Opération | Chemin | Règles appliquées en base |
|---|---|---|
| Création | `JobForm` → `POST /api/jobs` → RPC `create_job` | Session, rôle `company`/`company_premium`, compte et profil actifs, `verification_status = 'verified'`, contenu validé, propriétaire déduit de `auth.uid()`, statut `pending_review` imposé |
| Correction | `JobForm` (`/company/jobs/[id]/edit`) → `PATCH /api/jobs/[id]` → RPC `update_job` | Mêmes contrôles, offre de l'entreprise verrouillée `FOR UPDATE`, transition selon le tableau ci-dessous |
| Modération | file admin → `POST /api/admin/jobs/[id]/moderate` → RPC `moderate_job` | Grade `admin_ops`/`admin_founder` actif, action et motif validés, statut courant vérifié sous verrou ; champs de modération, notification et `audit_logs` dans la même transaction |
| Suppression | `/company/jobs` → `DELETE /api/jobs/[id]` → RPC `delete_job` | Mêmes contrôles de compte ; offre de l'entreprise ; refus `job_has_commitments` (409) si l'offre ou une sous-offre a une candidature `selected` ou `no_show`, une mission, un contrat ou une pénalité d'annulation |
| Compteur `positions_filled` | trigger `trg_sync_job_positions_filled` sur `job_applications` | Incrément ou décrément lors d'une sélection ou de son annulation |

La validation Zod (`lib/validations/job.ts`) est partagée par le formulaire et les routes. `job_apply_content` applique les mêmes règles en SQL pour un appel direct aux RPC. Aucune limite de nombre d'offres n'est appliquée : `getPlanLimits` et le SRS v1.2 donnent des offres illimitées à tous les plans.

### Transitions

| Acteur | De | Vers | Condition |
|---|---|---|---|
| Entreprise | — | `pending_review` | Création |
| Entreprise | `draft`, `pending_review` | `pending_review` | Modification |
| Entreprise | `rejected` | `pending_review` | Correction ; motif et champs de modération effacés, l'historique reste dans `audit_logs` |
| Entreprise | `active` | `pending_review` | Plan Pro ou Business (`directEdit`) et aucun candidat sélectionné ; sinon `job_locked_plan` ou `job_has_selected_candidates` |
| Entreprise | `filled`, `expired`, `cancelled` | — | Refus `job_not_editable` |
| `admin_ops`, `admin_founder` | `pending_review` | `active` | Entreprise toujours vérifiée et active ; `published_at` posé |
| `admin_ops`, `admin_founder` | `pending_review` | `rejected` | Motif de 3 à 500 caractères |

`pending_review` et `active` sont les valeurs canoniques de l'attente et de la publication ; seuls leurs synonymes `pending_moderation` et `published` sont interdits. `draft`, `rejected`, `filled`, `expired` et `cancelled` restent des statuts valides. Aucun parcours de ce lot n'écrit `filled`, `expired` ni `cancelled` : ils relèvent du cycle de vie de l'offre (lot 7).

**Modification d'une offre active — sources** :
- Pro et Business ont la « modification directe des offres actives » : SRS §6.11 (tableau des plans entreprise), repris par `getPlanLimits().directEdit` et les textes `editOn`/`editOff` du profil entreprise (« Modification limitée — contactez le support » pour Free et Starter).
- Le retour en modération après modification n'est écrit ni dans le SRS ni dans le code. C'est la réponse du produit, le 2026-11-01, à la question posée pendant ce lot ; il n'en existe pas d'autre trace.
- **Écart avec le SRS §5.4** : toute entreprise peut modifier ou supprimer une offre jusqu'à 12 h avant le début si le nombre de candidats requis n'est pas atteint ; le service client n'est requis qu'au-delà, sauf pour les comptes premium. Le verrouillage Free/Starter appliqué ici suit l'interface (`editOff`), plus stricte que ce texte. La règle des 12 h n'est appliquée nulle part. À arbitrer par le produit.

La matrice des grades suit le SRS §6.12 et `moderate_cni` : `admin_support` lit la file sans décider.

**Suppression** : la règle « jusqu'à 12 h avant, si le nombre requis n'est pas atteint » (§5.4) n'est pas appliquée. Seul l'engagement bloque. Une offre engagée n'est pas annulée automatiquement : l'annulation (pénalités, notification des candidats) relève du lot 7. Ordre des verrous : `delete_job` verrouille les candidatures puis l'offre, comme la sélection (candidature, puis offre via le trigger de compteur). Une sélection concurrente est soit vue par le contrôle, soit bloquée jusqu'à la suppression, puis sans effet.

### Protections

- **Privilèges** : ni INSERT, ni UPDATE, ni DELETE pour `anon` et `authenticated`.
- **Trigger** `trg_protect_job_writes`, fondé sur `current_user` : toute écriture ou suppression en session est refusée (42501), même si un privilège était rouvert. Les cascades déclenchées par `delete_job` s'exécutent en propriétaire.
- **RLS** : politique `FOR ALL` supprimée, aucune politique d'écriture ; nouvelle `Admins can view all jobs` (trois grades) ; lecture publique inchangée (`active`, ou ses propres offres).
- **Contrainte** `jobs_status_canonical_chk` : synonymes `pending_moderation` et `published` interdits ; les lignes existantes sont reprises par la migration.
- **Concurrence** : une seconde décision reçoit `job_not_pending` (409) ; une décision prise sur une version modifiée entre-temps reçoit `job_changed` (409). Ni seconde notification ni seconde trace. L'écran admin bloque aussi le double clic.
- **Atomicité** : publication, notification et audit sont écrits par une seule fonction ; une erreur annule l'ensemble.
- **Noms d'entreprise dans la file admin** : `company_profiles` n'a pas de politique admin. Le nom seul est lu en clé service, pour les offres que la session a pu lire, comme `/api/admin/companies`. Aucune écriture ne passe par la clé service.
- Une note d'approbation ne va que dans `audit_logs` : une offre active est lisible par tous.

### Écrans

- `components/company/job-form.tsx` : formulaire existant rendu réutilisable en création et en correction ; validation Zod avant envoi ; explication d'erreur visible (alerte et toast) ; succès seulement si la base renvoie `pending_review`.
- `/company/jobs` : statuts traduits FR/EN, motif de refus, offre refusée dans « Actives », « Modifier » seulement si la règle le permet, explication du verrouillage.
- File admin : refus avec motif obligatoire, toasts de résultat, rafraîchissement après conflit. Le champ motif perdait la saisie : `Modal` reprend le focus quand `onClose` change d'identité. Corrigé par un `onClose` stable dans cet écran.
- Statuts alignés sur `active` et `pending_review` : tableaux de bord entreprise et admin, compteur du profil entreprise, suggestions de `/api/matching`.

### Validation

| Contrôle | Résultat |
|---|---|
| Nouvelle preuve `pnpm test:rls job-moderation` | ✅ 62 assertions, vraies sessions, état relu en clé service. Création autorisée et refusée (non vérifiée, suspendue, candidat, admin, anonyme), champs forgés, données invalides ; INSERT, UPDATE, UPSERT, publication, modération et compteurs directs ; catalogue ; lectures croisées ; grades ; motif ; version périmée ; audit et notification ; répétition ; double clic et décisions concurrentes ; refus puis correction ; Free verrouillé, Pro remis en modération, candidat sélectionné ; sélection et compteur ; entreprise inéligible ; panne provoquée dans la transaction ; suppression (section I, ci-dessous) |
| Suppression (section I) | ✅ DELETE direct refusé ; autre entreprise et anonyme refusés ; offre sans engagement supprimée par la route et par la RPC, candidature en attente effacée ; candidat sélectionné, mission, contrat → 409, offre et données liées conservées ; 4 courses libres sélection/suppression cohérentes ; deux ordres forcés par un ralentissement temporaire (suppression d'abord → offre supprimée, sélection sans effet ; sélection d'abord → 409, sélection conservée), sans verrou mortel |
| Contrôle négatif (INSERT/UPDATE rouverts, trigger désactivé, politique d'écriture recréée) | ❌ détecté : 18 échecs, dont B2 (publication directe), code de sortie 1. Restauration par `db reset`, catalogue revérifié, preuve rejouée verte |
| Contrôle négatif suppression (DELETE rouvert, trigger désactivé, politique DELETE recréée) | ❌ détecté : 4 échecs, dont I1 (suppression directe), code de sortie 1. Le `db reset` a laissé la pile sans base ; pile recréée (arrêt sans sauvegarde, démarrage), protections revérifiées |
| `pnpm test:rls` complet | ✅ 19/19 preuves. Le contrôle E2 de `company-permissions` vise désormais l'écriture de `company_profiles` par une fonction exposée, et non sa simple lecture par les RPC d'offres |
| Navigateur : Chrome headless, vrais clics, 390×844 tactile, application reliée à la pile dédiée | ✅ 21 vérifications : création, statut en attente, offre introuvable pour le candidat, file admin et approbation, badge et notification de l'entreprise, candidature, refus motivé, motif affiché, correction préremplie et nouvelle soumission, verrouillage expliqué, entreprise non vérifiée, écrans FR et EN, pas de défilement horizontal, double clic sur « Approuver » |
| Navigateur, suppression (mêmes conditions) | ✅ 5 vérifications : offre engagée → refus expliqué (FR, EN), offre et sélection conservées ; offre sans engagement supprimée avec confirmation (FR) ; pas de défilement horizontal |
| `tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .`, `vitest run` (251 tests) | ✅ |
| `pnpm build` contre la pile dédiée (54421) | ✅ |
| Types générés depuis la pile dédiée | Régénérés (nouvelles RPC), identiques au schéma final |

La vérification des entreprises des fixtures est posée en clé service. Elle ne valide pas un parcours de vérification d'entreprise, qui n'existe pas encore.

### Limites restantes

- Validation administrative des entreprises : toujours sans RPC, interface ni trace (§16).
- **F-16 (lot 7a)** : lecture de tous les profils entreprise par une entreprise, inchangée.
- Sélection → mission → contrat (lot 7) : la sélection reste un UPDATE de `job_applications` sans contrôle des places ; seul le compteur est tenu par la base. Une offre engagée ne peut plus être supprimée, mais elle ne peut pas non plus être annulée : le cycle d'annulation reste à cadrer. Toute future création de mission ou de contrat devra verrouiller l'offre comme `delete_job`.
- Écart avec le SRS §5.4 (règle des 12 h, verrouillage Free/Starter) : à arbitrer, voir « Transitions ».
- Non implémentés : paiement bloqué avant soumission (SRS §6.4), décomposition multi-jours, délai de modération (§11.10), demande de correction distincte du refus.
- Catégorie, heures par semaine et avantages du formulaire ne sont pas enregistrés (préexistant) : ils sont à ressaisir lors d'une correction.
- `moderation_by` d'une offre active reste lisible en lecture directe (identifiant de l'admin). Une restriction de colonnes est à étudier avec les autres projections publiques.
- Écran de connexion : sous automatisation, le premier clic sur « Se connecter » juste après la saisie est perdu ; le parcours s'est connecté avec la touche Entrée. Préexistant, hors lot.
- CI distante non observée. Script navigateur local, hors dépôt.

## 18. Suivi — Lot 7a : sélection atomique et visibilité des candidats (F-10 partie sélection, F-16) (2026-11-06)

Branche `fix/lot-07a-candidate-selection`, base `origin/main-dev` (92dfe16, lot 6 finalisé avec `delete_job`). **Corrigé et vérifié localement, non commité, non déployé.** Migration : `supabase/migrations/20261106120000_candidate_selection.sql`.

### État avant correction

- La sélection était un UPDATE direct de `job_applications` (`app/company/jobs/[id]`), autorisé par le trigger du lot 2 : ni contrôle des places, ni mission, ni contrat, ni notification. Le compteur était tenu par le trigger du lot 6.
- L'entreprise pouvait repasser une candidature sélectionnée en `rejected` ou `shortlisted` et libérer la place.
- `missions` et `contracts` héritaient du `GRANT ALL` ; aucune politique n'autorisait l'INSERT ou le DELETE.
- F-16 : toute entreprise lisait tous les profils entreprise. Aucune lecture n'exposait aux entreprises leurs candidats : la liste s'affichait sans identité. Les candidats ne lisaient jamais le nom de l'entreprise d'une offre.

### Sélection

`app/company/jobs/[id]` → `POST /api/applications/[id]/select` → RPC `select_candidate`, dans une transaction :

1. Entreprise déduite de `auth.uid()` (rôle entreprise, compte et profil actifs).
2. Verrou de la candidature, puis de l'offre (`FOR UPDATE`), même ordre que `delete_job` et que le trigger de compteur. Une candidature d'une autre entreprise reçoit la même réponse qu'une candidature inexistante.
3. Contrôles : candidature `pending` ou `shortlisted`, offre `active`, place disponible, compte du candidat actif.
4. Candidature `selected` ; `positions_filled` incrémenté par `trg_sync_job_positions_filled` (lot 6).
5. Mission `pending` (date, horaires, pause de l'offre) et contrat `pending`. Le format suit le SRS §6.7 : simple sous 3 jours, formalisé au-delà. `contract_data` fige les conditions de l'offre.
6. Notification `application_update` au candidat, dans sa langue, avec les identifiants de la mission et du contrat.

Index uniques `missions.application_id` et `contracts.application_id`. Une relance (double clic, réponse perdue) sur une candidature déjà sélectionnée renvoie les mêmes liens (`already_selected`), sans nouvelle écriture. La route ne confirme le succès que si le statut, la mission et le contrat sont présents ; l'écran relit ensuite l'état en base.

| Code | HTTP | Cas |
|---|---|---|
| `application_not_found` | 404 | Candidature inexistante, d'une autre entreprise ou supprimée avec l'offre |
| `application_not_selectable` | 409 | Candidature retirée, refusée ou absente (`no_show`) |
| `job_not_available` | 409 | Offre non publiée |
| `no_positions` | 409 | Offre complète |
| `candidate_unavailable` | 409 | Compte du candidat suspendu |
| `selection_incomplete` | 409 | Candidature déjà `selected` sans mission ou contrat |

**Sélections antérieures** : une candidature passée à `selected` par l'ancien UPDATE direct n'a ni mission ni contrat. Elle reste en l'état ; une relance renvoie `selection_incomplete` et n'annonce pas de succès. Réparation : correction par le support, à cadrer. Requête de contrôle, en lecture seule (lot 0) :

```sql
select a.id, a.job_id, a.selected_at
from public.job_applications a
where a.status = 'selected'
  and (not exists (select 1 from public.missions m where m.application_id = a.id)
       or not exists (select 1 from public.contracts c where c.application_id = a.id));
```

Avant déploiement, vérifier aussi qu'aucune candidature n'a plusieurs missions ou contrats : les index uniques échoueraient.

### Écritures en session

- `protect_job_application_writes` (remplacée) : l'entreprise ne peut plus écrire `selected`, ni `selected_at` ou `selected_by`, ni modifier une candidature `selected` ou `no_show`. La présélection et le refus des candidatures `pending` ou `shortlisted` restent possibles. La candidature et le retrait passent toujours par `apply_to_job` et `withdraw_job_application` (retrait limité à `pending`).
- `missions` et `contracts` : plus d'INSERT, de DELETE ni de TRUNCATE en session. Les UPDATE existants (pointage, signature) relèvent des lots 7b et 7c.
- L'annulation d'une sélection n'a pas de chemin applicatif. Une correction de confiance (clé service) décrémente le compteur par le trigger, mais laisse mission et contrat : c'est le cycle d'annulation, à cadrer.

### Visibilité (F-16)

- Politique `Companies can view candidate summaries` supprimée : une entreprise ne lit plus que son propre profil.
- `company_job_applicants(job_id)`, RPC SECURITY DEFINER : vérifie que l'offre appartient à l'appelant et renvoie, pour chaque candidature, le prénom, l'initiale du nom, la présence d'une photo, le niveau Sandbox, la fiabilité, le nombre de missions et les compétences (profil partiel du SRS §6.6). Jamais email, téléphone, CNI, MoMo, adresse, coordonnées, documents ni identifiant du candidat. La ville n'est plus affichée : la distance la remplace.
- `GET /api/jobs/[id]/applications` relaie cette RPC. La photo est servie par `GET /api/jobs/[id]/applications/[applicationId]/photo`, après le même contrôle. La clé service ne lit que cet objet du bucket privé ; ni chemin ni URL signée (qui contiendrait le chemin) n'atteignent le navigateur.
- Vue `company_public_profiles` (nom, logo, ville, secteur, description) : entreprises ayant une offre active, entreprises des offres auxquelles l'appelant a postulé, et son propre profil. Elle remplace l'embed `company_profiles` sur les offres publiques, les suggestions et « Mes jobs ». Les candidats voient désormais le nom de l'entreprise ; NIU, contacts et RCCM restent inaccessibles. La vue est en lecture seule.
- Restent sur l'embed `company_profiles` : `contracts/[id]`, `missions`, `missions/[id]` et `earnings`. Sans ligne visible, ils n'affichent pas le nom de l'entreprise côté candidat. À traiter avec 7b et 7c.

### Validation

| Contrôle | Résultat |
|---|---|
| Nouvelle preuve `pnpm test:rls candidate-selection` | ✅ 33 assertions, vraies sessions, candidatures créées par `apply_to_job`, état relu en clé service |
| Sélection (S1-S9) | Mission, contrat et notification liés aux parties ; place consommée ; relance et double clic sans doublon ; dernière place disputée : une sélection, une mission, un contrat, une notification ; offre complète ; panne provoquée à l'écriture de la notification : rien n'est écrit, puis la relance réussit une seule fois ; contrat formalisé à partir de 3 jours |
| Refus (R1-R13) | Sélection directe et écriture seule de `selected_at` ; remise en refus ou en présélection d'une sélection ; INSERT direct de mission ou de contrat, suppression d'une mission ; autre entreprise, candidat, anonyme ; candidature retirée ou refusée ; offre repassée en modération ; sélection antérieure sans mission. Présélection et refus légitimes préservés |
| Concurrence (C1-C4, ordres forcés par un ralentissement temporaire) | Sélection puis retrait : sélection conservée. Retrait puis sélection : retirée, rien créé. Sélection puis suppression : 409, engagements conservés. Suppression puis sélection : 404, aucune mission orpheline |
| Visibilité (F1-F9) | Profil d'une autre entreprise et profils candidats illisibles en direct ; colonnes autorisées seules ; réponse sans donnée sensible ni identifiant interne ; photo servie à l'entreprise de l'offre seulement (autre entreprise 404, anonyme 401) ; isolation entre entreprises ; vitrine publique limitée et en lecture seule ; nom d'entreprise affiché sur l'offre publique |
| Contrôle négatif (trigger des candidatures désactivé, politique F-16 recréée) | ❌ détecté : 6 échecs (R1-R4, R6-R8, F1), code de sortie 1. Pile recréée (arrêt sans sauvegarde, démarrage), protections revérifiées |
| Preuves existantes adaptées | `business-permissions` B8 et `job-moderation` G1, F3, I5, I8-I10 sélectionnaient par UPDATE direct : elles passent par `select_candidate`, et B8 vérifie le refus de la sélection directe et de la remise en cause d'une sélection |
| `pnpm test:rls` complet | ✅ 20/20 preuves |
| Navigateur : Chrome headless, vrais taps, 390×844 tactile, deux sessions | ✅ 9 vérifications : prénom et initiale, réponse sans donnée sensible, sélection avec toast, statut et places relus de la base, offre complète expliquée puis refusée, notification du candidat et mission réservée (nom de l'entreprise) retrouvées après rechargement, écran entreprise en EN, pas de défilement horizontal |
| `tsc --noEmit`, `eslint . --max-warnings=0`, `prettier --check .`, `vitest run` (251 tests) | ✅ |
| `pnpm build` contre la pile dédiée (54421) | ✅ |
| Types générés depuis la pile dédiée | Régénérés (RPC, vue), identiques au schéma final |

### Limites restantes

- F-10, hors sélection : signature du contrat (7b), pointage et validation des heures (7c), paiement (lot distinct). Les politiques UPDATE de `missions` et `contracts` restent ouvertes jusqu'à ces lots.
- Annulation d'une sélection et réparation d'une sélection sans mission : sans chemin applicatif (support, pénalités).
- Notification enregistrée en base seulement : ni push ni SMS (SRS §6.6). ~~Pas de temps réel : lot 7d.~~ Temps réel : §22.
- Sélection multi-jours par sous-offre journalière : non implémentée (décomposition absente).
- `app/company/jobs/[id]` : boutons « Contacter » et « Contrat » sans action (préexistants) ; onglets serrés à 390 px (mise en page existante en quatre colonnes) ; avatar sans initiales quand il n'y a pas de photo (composant existant).
- Validation administrative des entreprises : toujours absente (§16).
- CI distante non observée. Script navigateur local, hors dépôt.

## 19. Suivi — Lot 7b : signature contrôlée des contrats (F-07 partie contrat) (2026-11-06)

Branche `fix/lot-07b-contract-signing`, base `origin/main-dev` (b2f330a, lot 7a intégré : `select_candidate` crée le contrat `pending` avec ses conditions figées). **Corrigé et vérifié localement, non commité, non déployé.** Migration : `supabase/migrations/20261106130000_contract_signing.sql`.

### État avant correction

- Politique `Users can update own contracts` : chaque partie modifiait toutes les colonnes de son contrat (statut, `contract_data`, parties, signature de l'autre).
- `app/contracts/[id]` calculait l'heure et le statut dans le navigateur (`completed` dès que l'autre date existait) et stockait la signature dessinée en data-URL dans la ligne.
- SELECT de toutes les colonnes par les deux parties : l'entreprise lisait l'IP du candidat. La page lisait `candidate_profiles(*)` (CNI) et `company_profiles(*)`, illisibles depuis F-16.
- Bouton « Contrat » de l'écran entreprise sans action ; aucun accès au contrat côté candidat.

### Mode de signature retenu

SRS §6.7, §11.1, §11.8 et US-CONT-02 : consentement électronique explicite (« Signer et accepter » après lecture, case cochée, confirmation), horodatage serveur et adresse IP quand l'infrastructure en observe une fiable, pour les contrats simples comme formalisés au MVP. **Aucune signature dessinée** : plus d'image, donc ni stockage, ni reprise de fichier, ni URL signée. Les colonnes `*_signature_url` ne sont plus écrites ; leurs valeurs existantes sont conservées et jamais exposées. Le SRS n'impose aucun ordre : chaque partie peut signer en premier.

### Droits

| | Candidat du contrat | Entreprise du contrat | Autre utilisateur, anonyme |
|---|---|---|---|
| Lire (`GET /api/contracts/[id]` → `get_contract`) | Conditions figées, entreprise, son nom complet, état des signatures | Idem, candidat en prénom + initiale (F-16) | 404 (tiers) / 401 |
| SELECT direct | Colonnes non sensibles uniquement | Idem | Aucune ligne (RLS) |
| Signer par l'application (`POST /api/contracts/[id]/sign` → `sign_contract_observed`, clé service côté serveur) | Sa propre signature | Sa propre signature | 404 / 401 |
| Signer par appel direct (`sign_contract`, session) | Sa propre signature, sans IP | Sa propre signature, sans IP | 404 / refusé |
| `sign_contract_observed`, `contract_sign_core` en session | Refusé | Refusé | Refusé |
| Lire `contract_clause_versions` | Non (texte servi par le contrat) | Non | Non |
| INSERT, UPDATE, DELETE directs | Refusés | Refusés | Refusés |

Colonnes illisibles en session : `candidate_ip`, `company_ip`, `*_signed_by`, `*_signature_url`.

### Mécanisme

- **Empreinte** `terms_hash` : SHA-256 hex de `{v: 1, contract_id, application_id, job_id, candidate_id, company_id, template, terms: contract_data}` en jsonb canonique. Elle couvre les parties, le format, les conditions figées par `select_candidate` (intitulé, entreprise, dates, horaires, pause, adresse, ville, montant par candidat, devise, nature forfaitaire, mission ; le taux horaire est remplacé au lot 7c-bis, §21) et `contract_data.clauses`. Elle ne couvre pas l'identité civile des parties. Calculée par trigger à l'insertion, jamais fournie par un client.
- **Texte accepté** : la case « J'accepte » couvre exactement ce que l'empreinte couvre. Ce sont les conditions de la mission (carte « Conditions enregistrées »), les clauses générales (carte « Engagements des parties ») et la phrase de consentement elle-même, en FR et en EN, sous l'identifiant de version (`simple-v1`, `formal-v1`). Ce texte est copié à l'insertion depuis `contract_clause_versions` (dernière version du format, jamais une valeur fournie par l'appelant), comme les conditions du lot 7a. L'écran l'affiche depuis le contrat, dans la langue de l'utilisateur, avec le numéro de version. Il ne lit plus les clauses dans les dictionnaires : une mise à jour des textes de l'application ne change pas un contrat existant. Les autres textes de l'écran (titres, aide, boutons) ne font pas partie de l'accord. Les deux langues sont couvertes quelle que soit la langue affichée ; la langue affichée au moment de la signature n'est pas enregistrée.
- **Versions des clauses** : `contract_clause_versions` est immuable, pour tous les rôles. Une version ne peut être supprimée tant qu'un contrat la cite. Faire évoluer les clauses revient à insérer une nouvelle version par migration : les nouveaux contrats la reçoivent, les contrats existants gardent la leur. La version initiale reprend le texte affiché avant ce lot. La phrase de consentement ne promet plus l'IP, qui peut être absente. Le contrat formalisé reprend le même texte en attendant la validation juridique.
- **Signature** : noyau commun `contract_sign_core`, jamais exposé. Utilisateur = `auth.uid()` (`sign_contract`) ou utilisateur de la session vérifiée par la route (`auth.getUser()`, transmis à `sign_contract_observed`) ; partie déduite du contrat (aucun paramètre ne la désigne) ; verrou de la ligne ; l'empreinte présentée doit égaler l'empreinte enregistrée (`terms_mismatch` sinon) ; heure `now()` ; enregistrement de l'heure, du signataire, de l'IP et de l'empreinte acceptée ; statut calculé ; notification `mission_update` de l'autre partie, dans sa langue.
- **Relance** (double clic, réponse perdue) : une signature déjà enregistrée est renvoyée telle quelle (`already_signed`, horodatage d'origine), sans écriture ni notification. L'écran relit toujours l'état après une tentative.
- **Trigger `protect_contract_writes`**, pour tous les rôles (clé service et fonctions SECURITY DEFINER comprises) : aucune écriture en session ; parties, format, conditions et empreinte immuables ; une signature enregistrée ne change plus ; une nouvelle signature doit être complète et porter l'empreinte courante ; le statut suit les signatures ; `completed` est définitif.
- **IP observée** : parcours réel = navigateur → Vercel → route Next → `sign_contract_observed` (clé service, côté serveur). Seule cette fonction, réservée au rôle service, enregistre une IP. `sign_contract`, ouverte aux sessions, n'a plus de paramètre IP et l'enregistre absente. La route lit l'adresse avec `observedClientIp` (`lib/utils/observed-ip.ts`), et uniquement sur Vercel (`VERCEL=1`) : Vercel écrase `x-forwarded-for` contre l'usurpation et pose `x-vercel-forwarded-for`, que ne réécrit pas un proxy placé devant (documentation Vercel, « Request headers »). Ailleurs (`next start` local, autre hébergeur), aucune source fiable : l'IP reste absente. Le corps de la requête n'est jamais lu pour l'IP ni pour l'identité. L'adresse est validée par la base (valeur invalide → null) et n'est jamais journalisée. **À vérifier au premier déploiement de prévisualisation**, en lecture seule : une signature y enregistre l'IP du poste, et un `x-forwarded-for` forgé n'y est pas repris.

### Transitions

| Depuis | Événement | Vers |
|---|---|---|
| `pending` | signature du candidat | `candidate_signed` |
| `pending` | signature de l'entreprise | `company_signed` |
| `candidate_signed` | signature de l'entreprise | `completed` |
| `company_signed` | signature du candidat | `completed` |
| tout statut | relance d'une partie déjà signataire | inchangé (`already_signed`) |
| `rejected`, `expired` | signature | refus `contract_not_signable` (aucun chemin ne les produit encore) |

`completed` signifie « signé par les deux parties » (valeur SRS v1.1 de l'ancien `fully_signed`). Il ne dit rien de l'exécution de la mission (`missions.status`, lot 7c).

| Code | HTTP | Cas |
|---|---|---|
| `not_authenticated` | 401 | Pas de session |
| `account_suspended` | 403 | Compte ou profil entreprise suspendu |
| `contract_not_found` | 404 | Contrat inexistant ou d'un tiers |
| `contract_not_signable` | 409 | Statut `rejected`/`expired`, ou candidature plus `selected` |
| `contract_needs_review` | 409 | Contrat ancien ou incohérent (voir ci-dessous) |
| `terms_mismatch` | 409 | Empreinte présentée différente de l'empreinte enregistrée |
| `consent_required` | 400 | Case d'acceptation non cochée (validation Zod de la route) |

### Contrats existants

Aucune signature n'est déduite d'un statut. L'empreinte des contrats existants est calculée sur leur contenu actuel, qui a pu être modifié par une partie avant cette migration. Une signature antérieure (date présente, empreinte absente) ou un statut incohérent avec les signatures est conservé, signalé par `get_contract` (`needs_review`) et bloque la seconde signature (`contract_needs_review`). Clauses : un contrat sans aucune signature reçoit la version courante de son propre format à la migration (`simple-v1` ou `formal-v1`) ; un format non reconnu ne reçoit rien et est signalé (personne n'a encore consenti), et son empreinte est recalculée. Un contrat déjà signé, en tout ou partie, sans clauses figées garde ses preuves (horodatage, signataire, empreinte acceptée) ; aucun texte ne lui est attribué. L'écran indique que les clauses n'ont pas été enregistrées, `needs_review` est vrai et la seconde signature est refusée. Aucun code ne créait de contrat avant 7a : toute ligne antérieure au déploiement de 7a est à examiner. La requête de contrôle, en lecture seule (lot 0), figure dans l'en-tête de la migration (signatures sans empreinte, statut incohérent, data-URL, signature sans clauses figées).

### Écrans

- Candidat : « Mes jobs » → onglet « Réservées » → mission → carte « Voir le contrat » (avec le statut de signature).
- Entreprise : candidature sélectionnée → bouton « Contrat » (réparé) et badge d'état de signature.
- `app/contracts/[id]` réécrit : conditions enregistrées, nom de l'entreprise figé, état et horodatages (fuseau `Africa/Douala`) des deux signatures, début de l'empreinte, case de consentement, dialogue de confirmation, relecture après signature, erreur visible (`role="alert"`) avec « Réessayer », toaster. Textes FR/EN (`contract.*`). Le bouton PDF sans fonction est retiré.

### Signature, pointage et paiement

Trois étapes distinctes. Ce lot ne bloque ni le pointage ni le paiement, et n'écrit pas `missions`. **Décision produit pour le lot 7c** : le SRS §6.7 (« les deux parties doivent signer avant que la mission ne démarre officiellement ») et US-CONT-02 (mission `confirmed` après double signature) suggèrent de conditionner le démarrage à la double signature. À trancher : blocage du pointage ou simple alerte, et traitement d'une mission déjà effectuée sans contrat signé (jamais de blocage automatique du paiement dans ce cas).

### Validation

| Contrôle | Résultat |
|---|---|
| Nouvelle preuve `pnpm test:rls contract-signing` | ✅ 42 assertions, vraies sessions, contrats créés par la route de sélection du lot 7a, état relu en clé service |
| Lecture (L1-L6) | Conditions, entreprise et empreinte ; prénom + initiale côté entreprise, sans nom, CNI, MoMo, adresse, IP ni signataire ; tiers 404, anonyme 401 ; colonnes sensibles refusées en SELECT direct ; offre modifiée après sélection : conditions et empreinte inchangées |
| Signatures (S1-S10) | Candidat puis entreprise : `candidate_signed` puis `completed`, horodatages serveur, signataires, empreintes acceptées ; relances (route et RPC, même avec une empreinte périmée) : horodatage d'origine, aucune notification de plus ; le candidat ne peut ni signer pour l'entreprise ni forger `completed` ; relecture identique par les deux parties ; notifications de l'autre partie ; mission et candidature inchangées |
| Refus (R1-R6) | UPDATE direct du statut, des signatures, des conditions et des parties ; INSERT et DELETE ; empreinte périmée (409), consentement absent (400) ; contrat tiers et anonyme ; en clé service : conditions, empreinte, signature déjà donnée, retour depuis `completed`, statut sans signature, signature incomplète |
| Concurrence (D1-D2) | Cinq soumissions simultanées : une écriture, un horodatage, une notification ; signatures simultanées des deux parties (RPC directe) : `completed`, les deux conservées, IP absente |
| Provenance de l'IP (I1-I4) | Route avec `x-forwarded-for`, `x-real-ip` et `x-vercel-forwarded-for` forgés et champs `ip`, `user_id` dans le corps : signataire = session, IP absente ; RPC `sign_contract` avec un paramètre IP : inexistante (PGRST202) ; `sign_contract_observed` et `contract_sign_core` refusés en session et en anonyme ; signature directe : identité de la session, IP absente ; canal de la route en clé service : utilisateur non partie refusé, IP valide enregistrée, invalide ignorée |
| Texte accepté (CL1-CL10) | Clauses FR/EN et consentement de `simple-v1` figés ; le candidat signe ; une nouvelle version est publiée ; l'entreprise relit `simple-v1` avec la même empreinte et signe la version du candidat ; un contrat créé ensuite reçoit la nouvelle version (empreinte différente) ; empreinte de l'autre version refusée (409) dans les deux sens ; relance du candidat après l'évolution : horodatage d'origine ; versions immuables, non supprimables tant que citées, illisibles en session ; contrat formalisé (3 jours) : `formal-v1`, texte et empreinte cohérents |
| Contrat ancien (H1-H4) | Signature sans empreinte et statut `completed` simulés (trigger désactivé le temps d'une écriture) : signalé, seconde signature 409, rien n'est déduit ; protection rétablie ; contrat signé sans clauses figées : preuves conservées, aucun texte attribué, signalé, seconde signature 409 ; type non reconnu sans clauses : signalé, signature 409 |
| Reprise de la migration (fichier réel rejoué dans une transaction annulée, deux contrats fictifs sans clauses) | ✅ contrat non signé : `simple-v1` ajouté, empreinte recalculée ; contrat signé : inchangé, sans clauses, empreinte d'origine ; trigger recréé ; migration rejouable |
| Reprise sur un état réel du lot 7a (pile dédiée sans la migration 7b ; contrats créés par `apply_to_job` et `select_candidate` ; migration réelle appliquée en une transaction ; pile ensuite réinitialisée avec toutes les migrations) | ✅ **simple non signé** : type `simple` conservé, `simple-v1`, texte FR/EN de `get_contract` identique à la version, empreinte recalculée et cohérente, signable puis signé. **Formalisé non signé** (3 jours) : type `formal` conservé, `formal-v1` (jamais `simple-v1`), même vérifications. **Signé par l'ancien écran** (UPDATE direct : date, image data-URL, IP, `candidate_signed`) : aucune clause attribuée, date, image, IP et statut conservés, `candidate_terms_hash` et signataire laissés vides, empreinte calculée sur le contenu existant (cohérente), signalé, non signable. **Type ancien non reconnu** (`standard`) : aucune clause par défaut, signalé, signature refusée (`contract_needs_review`). Conditions du lot 7a inchangées dans les quatre cas. Aucun correctif nécessaire |
| Contrôle négatif (UPDATE rouvert, trigger désactivé, ancienne politique recréée) | ❌ détecté : 19 échecs (dont R1, S4, R5), code de sortie 1. Restauration par `db reset` de la pile dédiée ; privilèges et trigger revérifiés |
| Contrôle négatif IP (`sign_contract_observed` ouverte aux sessions) | ❌ détecté : 2 échecs (I2, I3), code de sortie 1. Privilège retiré, revérifié, preuve à nouveau verte |
| `pnpm test:rls` complet | ✅ 21/21 preuves |
| Navigateur : Chrome headless, vrais clics, candidat en 375×812 tactile et entreprise en 1280×900, deux sessions | ✅ 21 vérifications : sélection par l'écran, candidat Mes jobs → mission → contrat, conditions et entreprise affichées, coupure réseau provoquée → erreur visible puis réussite au nouvel essai, nouvelle version des clauses publiée après la signature du candidat, l'entreprise affiche les mêmes clauses (`simple-v1`) que le candidat, retrouve la première signature et signe, mêmes statut, horodatages et empreinte des deux côtés après rechargement, plus de formulaire, pas de défilement horizontal |
| `tsc --noEmit`, `eslint`, `prettier --check .`, `vitest run` (256 tests, dont `observedClientIp` : hors Vercel, en-têtes forgés ignorés ; sur Vercel, `x-vercel-forwarded-for` prioritaire ; valeur invalide rejetée) | ✅ |
| `pnpm build` contre la pile dédiée | ✅ |
| Types générés depuis la pile dédiée | Régénérés (colonnes, `contract_clause_versions`, `get_contract`, `sign_contract`, `sign_contract_observed`), identiques au schéma final |

Pile dédiée : sur ce poste, Windows réserve les ports 54268-54667 (Hyper-V). Les ports de la copie temporaire ont été décalés en 554xx (API 55421) ; le dépôt n'est pas modifié.

### Limites restantes

- F-07 reste ouvert pour `missions` (pointage, validation des heures, champs de paiement) : lot 7c.
- Contenu du contrat : la durée effective, la rémunération nette, les conditions d'annulation et l'identité civile ne sont pas dans `contract_data` (SRS §6.7). Les clauses `simple-v1` et `formal-v1` reprennent le texte existant, sans validation juridique (§11.1). PDF non implémenté.
- Langue affichée au moment de la signature non enregistrée (les deux langues sont couvertes par l'empreinte).
- Rappel à 24 h, annulation et remboursement à 48 h sans signature (US-CONT-02) : non implémentés ; aucun chemin ne produit `rejected` ou `expired`.
- Notification en base seulement ; ~~pas de temps réel (lot 7d)~~ temps réel : §22.
- IP : enregistrée seulement sur Vercel. Non vérifié sur un déploiement réel ; absente en local et sur tout autre hébergeur. Derrière un proxy d'entreprise, Vercel n'en transmet pas l'adresse d'origine. Une signature faite par appel direct à `sign_contract` n'a jamais d'IP.
- Composant `Dialog` partagé sans `role="dialog"` : ajouté au seul dialogue du contrat.
- Page mission : nom de l'entreprise toujours lu par l'embed `company_profiles` (illisible pour le candidat, §18) : lot 7c. **Corrigé au lot 7c (§20).**
- CI distante non observée. Script navigateur local, hors dépôt.

## 20. Suivi — Lot 7c : début de mission, code de fin et évaluations (F-07 partie missions, F-10 partie suivi, F-30) (2026-11-07)

Branche `fix/lot-07c-mission-time-tracking`, base `origin/main-dev` (89c5466, lot 7b intégré). **Corrigé et vérifié localement, non commité, non déployé.** Migration : `supabase/migrations/20261106140000_mission_time_tracking.sql`. Une première version de ce lot (pointage GPS, heures retenues, validation des heures par l'entreprise), restée locale, a été remplacée avant tout commit.

### État avant correction

- `missions` : policy `Companies can update their job missions` sans restriction de colonnes. L'entreprise modifiait heures réelles, `validated_at`, `payment_status`, `platform_fee`, tranches de paiement et statut.
- `mission_check_ins` : policy `Candidates can create check-ins`. Le candidat insérait un pointage avec l'heure et la position de son choix ; l'UPDATE de la mission échouait en silence.
- `reviews` : policy INSERT ouverte aux deux parties, sans limite de nombre ni contrôle de la partie évaluée (`reviewed_id` libre). Aucun calcul des étoiles en base (`updateReliabilityScore` jamais appelé, et bloqué par le verrou des profils du lot 1).
- Tâches : liens vers des pages de pointage inexistantes ; heures dans le fuseau du navigateur ; nom de l'entreprise illisible pour le candidat (F-16).

### Décisions produit

- **2026-11-06** : un candidat sélectionné travaille même si le contrat n'est pas signé ; sa propre signature sera exigée au paiement (SRS §5.1, §6.7).
- **2026-11-07** :
  - mission rémunérée à la tâche : le montant convenu ne dépend pas de la durée ; plus de validation des heures par l'entreprise ;
  - fin de mission confirmée par un code de six chiffres que l'entreprise remet au candidat ;
  - aucune géolocalisation ;
  - note de l'entreprise obligatoire pour le candidat, note du candidat facultative pour l'entreprise.

  SRS §5.1, §6.8 et §6.10 amendés.

### Parcours

| Étape | Qui | Règle (en base) |
|---|---|---|
| Sélection (`select_candidate`, lot 7a) | Entreprise | Le trigger `trg_create_mission_completion_code` génère, dans la même transaction, un code à six chiffres (pgcrypto, texte, zéros initiaux conservés), unique par offre. Une relance de la sélection ne crée pas de mission : même code. |
| Code visible (`GET /api/jobs/[id]/missions` → `company_job_missions`) | Entreprise propriétaire | Code affiché en regard du bon candidat tant qu'il n'est pas utilisé, avec la consigne (le communiquer à chaque candidat présent ayant effectué le travail : seule action demandée) et le lien « Contacter le support » (Centre d'aide `/help`, canal existant). |
| Signer mon contrat | Candidat | Tâche visible dès la sélection jusqu'à sa signature (parcours du lot 7b) ; avant, pendant ou après le travail. |
| Commencer (`POST /api/missions/[id]/start` → `start_mission`) | Candidat de la session | Dès H−15 min (Africa/Douala) ; candidature `selected`, mission `pending` ou `confirmed` ; heure enregistrée une fois (`in_progress`) ; relance → même heure ; notification de l'entreprise. Aucune position demandée. |
| Fin (`POST /api/missions/[id]/complete` → `submit_completion_code`) | Candidat de la session, après son début | Code vérifié et consommé, réalisation (`completed`, `actual_end_time`) enregistrée dans la même transaction ; notification de l'entreprise (sans code). Erreur : réessai ; 5 erreurs → 15 min de blocage, compté en base sous verrou (appels directs et concurrents compris) ; relance après succès → réalisation d'origine, sans écriture. |
| Noter l'entreprise (`POST /api/missions/[id]/review` → `submit_mission_review`) | Candidat | Obligatoire : dialogue ouvert dès l'acceptation du code ; tâche persistante jusqu'à la note (reprise après coupure ou fermeture) ; ensuite, la signature est remise en évidence si elle manque. |
| Noter le candidat (même route) | Entreprise propriétaire | Facultative, après réalisation ; ne bloque rien. |

Tâches (`GET /api/tasks` → `candidate_tasks`) : la page renvoie les horaires prévus, débuts, fins et l'heure du serveur. Toutes les 5 s, elle recalcule la disponibilité du début (H−15) et le rappel de fin (heure prévue). Sur une page ouverte, un rappel s'affiche dans le toaster ; à la réouverture, la tâche est visible. Aucun SMS, push, tâche planifiée ni Realtime nouveau.

Le code n'apparaît jamais dans `get_mission`, `candidate_tasks`, les réponses des routes candidat, les notifications, les messages d'erreur ni les journaux. La table `mission_completion_codes` n'a aucun privilège de session (RLS sans policy) et n'est pas publiée en Realtime ; `missions` l'est, c'est pourquoi le code n'y figure pas.

### Évaluations et étoiles

- Une évaluation par auteur, mission et sens, entre les deux parties : index unique `(mission_id, reviewer_type)` sur `origin = 'mission_flow'`. Partie et profil évalué déduits de la session et de la mission. Relance → évaluation d'origine.
- Étoiles : trigger `trg_refresh_review_rating`, non exécutable en session. Il recalcule seulement `average_rating` du profil évalué : moyenne des évaluations vérifiées, arrondie au dixième (règle de `updateReliabilityScore`). Le recalcul est hors de la RPC exposée : le garde-fou F-41 (`company-permissions` E2 : aucune fonction exposée n'écrit `company_profiles`) reste vrai.
- Écritures directes sur `reviews` fermées (policy INSERT supprimée, privilèges retirés, trigger) ; évaluations vérifiées immuables, même en clé service. Lecture publique (`is_public`) inchangée.

### Écritures fermées

- `missions` : plus d'UPDATE, INSERT ni DELETE en session. Trigger, pour tous les rôles :
  - début et fin immuables une fois enregistrés ;
  - fin impossible sans début ni avant lui ;
  - horaire figé après le début.

  `payment_status`, `platform_fee`, tranches et `validated_at` : aucune session ne les écrit (lot paiement).
- `mission_check_ins` : écrits seulement par les RPC (début, fin, sans coordonnées) ; UPDATE interdit à tous ; coordonnées non lisibles en session.
- `mission_completion_codes` : code, mission et offre immuables ; consommation définitive (clé service comprise).
- Supprimés de la première version : `record_mission_check`, `validate_mission_hours`, calcul des heures retenues, distance de 500 m, routes `/check` et `/validate`, bouton « Valider … h », affichages « heures retenues ».

### Reprise des données

- Chaque mission encore à effectuer (`pending`, `confirmed` ou `in_progress`, sans fin) reçoit un code neuf, non consommé, sans tentative : aucune remise n'est déduite.
- Une mission déjà terminée ne reçoit pas de code.
- Les avis antérieurs restent en place avec `origin = 'legacy'` : ils ne valent ni note obligatoire ni étoiles.
- Requêtes de contrôle, en lecture seule (lot 0), dans l'en-tête de la migration.

### Validation

| Contrôle | Résultat |
|---|---|
| Preuve `pnpm test:rls mission-time-tracking` (réécrite) | ✅ 29 assertions, vraies sessions, missions créées par la route de sélection, état relu en clé service |
| Sélection et exposition (S1-S3, E1-E2) | Deux candidats d'une offre : deux codes distincts à six chiffres ; relance : même code ; entreprise propriétaire : chaque code en regard du bon candidat ; entreprise tierce 404 ; aucun code dans les réponses brutes (tâches, mission, RPC, lecture générique côté entreprise) ni dans les notifications ; table illisible en session et en anonyme |
| Début (D1-D5) | Tâches : signature à faire, début ouvert ; avant H−15 : 409 `too_early` avec l'heure ; code avant le début : 409 `not_started` sans tentative comptée ; début sans position, relance (même heure) ; cinq débuts simultanés : une écriture |
| Code (C1-C7) | Code de l'autre candidat refusé (4 essais restants) ; bon code, cinq envois simultanés : une réalisation, code consommé dans la même transaction ; réponse perdue : réalisation d'origine sans écriture ; réalisée sans GPS ni contrat signé ; huit erreurs simultanées : exactement 4 « incorrect » puis blocage ; bon code refusé pendant le blocage (route et appel direct) ; le second candidat reste sans confirmation ; format invalide 400 |
| Évaluations (R1-R6) | Avant réalisation 409 ; reprise avant notation : tâche présente ; note du candidat unique, étoiles de l'entreprise à 5 une fois ; tâche de signature conservée ; note facultative de l'entreprise : étoiles du seul bon candidat (4, l'autre 0) ; tiers, autre candidat, anonyme refusés ; INSERT et UPDATE directs refusés, y compris vers un autre profil |
| Contrat signé (K1) | Signature avant, puis début, code et note : plus aucune tâche |
| Tiers, écritures, suppression (X1-X4, L1) | Mission d'un autre candidat 404 ; entreprise 404 ; anonyme 401 ; écritures directes (fin, statut, paiement, frais, validation, événements, compteur) refusées ; en clé service, code, consommation, réalisation et évaluations immuables ; RPC et route de validation des heures absentes ; mission sans code : 409 `code_unavailable`, rien n'est déduit |
| Contrôle négatif (lecture des codes et écriture des avis rouvertes en session) | ❌ détecté : 3 échecs (E1, R6, X3), code de sortie 1. Pile réinitialisée, privilèges et triggers revérifiés |
| Reprise sur un état réel du lot 7b (missions créées par 7a, une commencée et une terminée par d'anciennes écritures, ancien avis inséré en session ; migration réelle appliquée en une transaction) | ✅ codes neufs non consommés pour les missions à effectuer ; aucun pour la mission terminée ; ancien avis conservé en `legacy`, ignoré par les étoiles et la tâche de note ; les deux missions reprises vont jusqu'au code accepté |
| `pnpm test:rls` complet | ✅ 22/22 preuves (dont `company-permissions` E2, qui a imposé le recalcul des étoiles par trigger) |
| Navigateur : Chrome headless, vrais clics, entreprise 1280×900 et candidat 375×812 tactile | ✅ 20 vérifications : sélection de deux candidats, codes distincts sur la bonne carte, consigne et support ; tâches du candidat ; réponse perdue au début (état relu, heure annoncée) ; rappel H−15 et rappel de fin déclenchés sur la page ouverte ; fermer le dialogue laisse la tâche ; code de l'autre candidat refusé puis bon code ; notation obligatoire immédiate ; aucune demande de géolocalisation ; réouverture avant notation ; signature remise en évidence ; réponses brutes sans code ; entreprise : code utilisé masqué, l'autre affiché, note facultative ; étoiles 4 et 5 ; notifications sans code ; contrats toujours non signés |
| `tsc --noEmit`, `eslint`, `prettier --check .`, `vitest run` (261 tests, dont les schémas du code et de l'évaluation) | ✅ |
| `pnpm build` contre la pile dédiée (cible 55421 vérifiée dans le bundle) ; types générés | ✅ ; identiques au schéma final |

### Limites restantes

- Paiement (versement, signature exigée, frais, remboursement), abonnements, annulations, absences, indemnités : lots dédiés. Aucun paiement n'est déclenché.
- Rappels internes seulement, sur la page ouverte : pas de notification planifiée (H−15, fin), faute de planificateur ; pas de SMS ni de push.
- Le code peut être saisi dès le début confirmé ; le rappel et la mise en avant attendent l'heure de fin prévue.
- ~~Le montant affiché reste le taux horaire de l'offre.~~ Traité au lot 7c-bis (§21) : montant fixe par candidat pour la mission.
- Blocage de la mission suivante si la note manque après 48 h (SRS §5.1) : non appliqué.
- Missions de plusieurs jours : une seule mission par sélection (premier jour), §18.
- ~~Temps réel : lot 7d.~~ Traité au §22. CI distante non observée. Script navigateur local, hors dépôt.

## 21. Suivi — Lot 7c-bis : montant fixe par candidat pour la mission (2026-11-07)

Branche `feat/lot-07c-bis-task-compensation`, base `origin/main-dev` (7963ac4, lot 7c intégré). **Réalisé et vérifié localement sur la pile dédiée, non commité, non déployé.** Migration : `supabase/migrations/20261107120000_mission_pay_per_candidate.sql`.

### État avant correction

- L'offre portait un taux horaire (`jobs.hourly_rate`), alors que le lot 7c a décidé une mission rémunérée à la tâche. Le détail d'offre calculait une « Rémunération totale » = durée × taux ; les cartes, la modération, les listes et le contrat affichaient « XAF/h ».
- Une colonne inutilisée, `jobs.salary_per_person_per_day` (salaire journalier, verrou `salary_locked`, trigger `enforce_salary_lock`), portait un troisième modèle.
- Le formulaire imposait côté client un minimum de 500 F/h, absent en base.
- Clauses v1 du contrat : « valider les heures effectuées », sans objet depuis 7c.

### Modèle retenu

- Un seul champ : `jobs.mission_pay_per_candidate integer not null`, en XAF, strictement positif (contrainte `jobs_mission_pay_per_candidate_chk`). C'est le montant versé à **chaque** candidat sélectionné pour la mission. Exemple : 3 places, 8 h-12 h, 10 000 F CFA ⇒ 10 000 F CFA pour chacun. Finir à 11 h 30 ou à 12 h 30 ne change rien.
- Devise : `jobs.currency` non nulle, XAF uniquement (`jobs_currency_xaf_chk`).
- `hourly_rate`, `salary_per_person_per_day`, `salary_locked` et `prevent_salary_modification` sont supprimés. `payments.hourly_rate` reste : cette table relève du lot paiement.
- Bornes : entier de 1 à 2 147 483 647 (type `integer`), en base comme dans Zod (`missionPaySchema`). Le minimum de 500 F/h n'est pas repris : il portait sur une heure.
- Dates, horaires et nombre de personnes restent affichés séparément. Ils servent à l'organisation du candidat et à l'appréciation du support, jamais à un calcul.

### Mécanisme

- `job_apply_content` (appelée par `create_job` et `update_job`) exige un nombre JSON entier strictement positif. Une chaîne, une fraction, zéro, une valeur négative, absente ou hors borne lève `invalid_job_data` (DETAIL `mission_pay_per_candidate`). Une charge utile contenant encore `hourly_rate` est refusée (DETAIL `hourly_rate`). Les contrôles de publication, de modification et de nouvelle modération du lot 6 sont repris à l'identique.
- `select_candidate` fige dans `contract_data` : `mission_pay_per_candidate`, `currency = 'XAF'` et `pay_basis = 'per_mission'`. Les horaires restent figés pour information. L'empreinte du lot 7b porte sur tout `contract_data` : ces valeurs sont couvertes sans changer `contract_terms_hash`.
- Clauses `simple-v2` et `formal-v2` : remise du code de fin et règlement du « montant forfaitaire convenu pour la mission, quelle que soit l'heure de fin effective ». Les contrats existants gardent leur version.
- `get_mission` (type de retour modifié, fonction recréée) renvoie le montant et la devise **du contrat**, jamais ceux de l'offre ; `null` sans contrat. Les listes du candidat (`/missions`, « Mes jobs » réservés) lisent aussi le contrat.
- Aucun calcul ne multiplie le forfait par une durée ou par le nombre de places : le calcul durée × taux du détail d'offre est supprimé.

### Reprise des données

Aucune conversion : un taux horaire ne se convertit pas en forfait sans la durée convenue. La migration échoue (`mission_pay_migration_blocked`, avec le nombre d'offres et de contrats concernés et une piste) dès qu'une offre existe. Le projet distant n'en a aucune (phase de test). Une pile de développement seedée se réinitialise puis se reseede (`scripts/seed-test-data.ts`, montants convertis à la main).

### Écrans

- **Formulaire** : libellé « Rémunération par candidat pour la mission (F CFA) », explication et exemple. Refus immédiat de 0, d'un négatif et d'une fraction. Horaires saisis pour les deux types d'offre ; le champ « heures par semaine », jamais enregistré, est retiré. Aperçu avec dates, horaires, nombre de personnes et montant séparés.
- **Affichage** : composant partagé `MissionPay` (« 10 000 F CFA pour la mission » / « 10,000 CFA francs for the mission ») et formateur `formatXaf`. Ils sont utilisés par la carte, le détail, la modération (travail, montant, plage horaire et nombre de personnes ensemble), les listes entreprise, les missions, « Mes jobs » et le contrat.

### Validation

| Contrôle | Résultat |
|---|---|
| `job-moderation` P1-P4 (nouvelles) | ✅ RPC directe : 0, négatif, 10 000,5, chaîne, absent, > integer et `hourly_rate` → `invalid_job_data` sur le bon champ, aucune offre. Route : 0, −5, 10 000,5 → 400. 10 000 XAF, 3 places, 08:00-12:00 enregistrés tels quels. Contraintes refusées même en clé service |
| `contract-signing` M1-M3 (nouvelles) ; L1, L6, R1, CL1-CL10 adaptées | ✅ 3 places à 10 000 F CFA, trois sélections : chaque contrat porte 10 000, XAF, `per_mission`, 08:00-12:00 ; quatrième candidature refusée (`no_positions`) ; l'empreinte change si le montant, la devise ou la nature changent ; la signature du candidat porte sur ces conditions ; offre modifiée après sélection sans effet ; clauses courantes v2 |
| `mission-time-tracking` P1 (nouvelle) | ✅ `get_mission` renvoie les 1 500 XAF du contrat, inchangés après modification de l'offre en clé service |
| Garde-fou de migration (transaction annulée, une offre présente) | ✅ échec `mission_pay_migration_blocked` avec DETAIL et HINT, rien n'est écrit |
| `pnpm test:rls` complet, pile dédiée | ✅ 22/22 preuves |
| Navigateur : Chrome headless, 390×844 tactile, vrais formulaires | ✅ 23 vérifications. Création par le formulaire (refus de 0, −500 et 10000.5), aperçu, modération puis approbation. Carte et détail en FR et en EN, deux sélections, contrats des deux candidats en FR (et en EN pour le premier), mission, « Mes jobs ». Aucun défilement horizontal |
| `tsc --noEmit`, `eslint`, `prettier --check .`, `vitest run` (264 tests), `pnpm build` (pile dédiée), types régénérés | ✅ |

### Limites restantes

- Versement Mobile Money, frais facturés à l'entreprise, abonnements et fourchette négociable : lots distincts. Temps réel : traité au §22.
- `payments.hourly_rate` et `hours_worked` (table du lot paiement) gardent l'ancien vocabulaire.
- Missions de plusieurs jours : le montant vaut pour la mission sélectionnée (une mission par sélection, §18). Il n'existe pas de forfait par jour.
- Un contrat antérieur à 7c-bis (aucun sur le distant) n'a pas de `pay_basis` : il afficherait « — » plutôt qu'un montant réinterprété.
- Libellés codés en dur hors dictionnaire (formulaire, maquette de l'accueil), antérieurs au lot : lot 9.

## 22. Suivi — Lot 7d : mises à jour en temps réel de l'application (2026-11-08)

Branche `feat/lot-07d-app-realtime`, base `origin/main-dev` (520b907, lot 7c-bis intégré). **Réalisé et vérifié localement sur la pile dédiée, non commité, non déployé.** Migration : `supabase/migrations/20261107150000_app_realtime_signals.sql`.

### État avant correction

- Un seul hook Realtime (`use-realtime-sync`) : `postgres_changes` sur `missions` et `job_applications`, côté candidat, pour Tâches et Mes jobs. Les deux tables étaient publiées en `REPLICA IDENTITY FULL` : les lignes complètes (colonnes héritées comprises) partaient vers le navigateur.
- Aucun autre écran ne se mettait à jour : suspension, rôle, plan, vérifications, modération, sélection, signature, début, code et avis n'étaient visibles qu'après un rechargement. La cloche interrogeait le serveur toutes les 60 s.
- L'échéance d'un plan entreprise n'avait aucun effet : `update_job` lisait `subscription_plan` sans `subscription_expires_at`. Le premium candidat suivait trois règles différentes (rôle seul sur le profil, date seule pour le matching, les deux sur `/upgrade/candidate`).
- Plusieurs chargements de page appelaient `getUser()` (appel réseau) et redirigeaient vers `/login` (route inexistante) en cas d'échec : sur un réseau coupé, l'écran se perdait.

### Modèle retenu : signal puis relecture

- **Émission en base.** Des triggers `AFTER … FOR EACH ROW` sur 18 tables appellent `realtime.send` avec un signal `{d: domaine, r: identifiant | null}`, dédupliqué par transaction (canal, domaine, ressource). Le signal part au commit ; une transaction annulée n'émet rien. Une erreur d'envoi ne fait jamais échouer l'écriture métier.
- **Trois canaux privés**, autorisés par RLS sur `realtime.messages` (extension `broadcast`) :
  - `user:<auth.uid>` : la seule session de ce compte, même suspendue (elle doit apprendre sa suspension ou la perte d'un rôle, y compris quand elle ne lit plus la ligne qu'elle consultait) ;
  - `admin` : administrateurs actifs, **domaine seul, sans identifiant** ;
  - `jobs:public` : comptes actifs, identifiant d'offre seulement, émis quand une offre est ou était visible (`active`).
- **Aucune émission depuis un client** : pas de politique INSERT. `realtime.send` est `SECURITY INVOKER`, donc refusé en session ; `rt_send` et les fonctions `rt_*` sont révoquées ; le schéma `realtime` n'est pas exposé par l'API. Un canal public homonyme n'atteint pas le canal privé.
- **Publication `postgres_changes`** : `missions` et `job_applications` sont retirées, `REPLICA IDENTITY` rétablie à `DEFAULT`.
- **Client** (`lib/realtime/provider.tsx`, monté une fois dans le layout racine) : une connexion par onglet ; canal personnel toujours ouvert, canal admin pour un admin actif, canal des offres seulement tant qu'un écran d'offres l'écoute. Les écrans déclarent ce qu'ils écoutent (`useLiveRefresh`, `<LiveRefresh>` pour une page serveur) et relisent leurs données autorisées. Les signaux rapprochés sont regroupés (300 ms). Un signal mal formé est ignoré (Zod) et n'est jamais affiché.
- **Droits** : la base les revérifie à chaque opération protégée (RPC existantes). Realtime ne sert qu'à mettre l'interface à jour.

### Droits et abonnements

- **Suspension** (`admin_set_user_active`) : bandeau « Votre compte est suspendu » ; actions retirées (candidature, publication, sélection, refus, signature, début, code, avis) ; canal des offres refusé et fermé ; lecture de ses propres informations conservée (règle SRS : la suspension bloque les actions, pas la lecture ; aucune ligne ne devient illisible). Une action partie d'un écran pas encore à jour est refusée en base (`account_suspended`).
- **Rôle et grade** : relecture du layout admin (grade, boutons) ; à la perte du rôle admin, canal admin fermé, cache SWR admin vidé, sortie de `/admin`. Un canal refusé (`Unauthorized`) déclenche une relecture de l'état du compte.
- **Changement de compte** : canaux fermés, cache SWR vidé, rechargement complet (aucun état mémoire de l'ancien compte ne survit) ; la déconnexion dans un onglet ramène les autres onglets à la connexion. Page restaurée depuis le cache arrière : rechargée.
- **Plans** : `company_effective_plan(plan, expires_at)` rend « free » une fois l'échéance passée, sans écriture SQL ; `update_job` l'applique. `my_account_state()` renvoie rôle, statut, plan stocké et effectif, échéance, renouvellement, premium effectif et l'heure du serveur. Le client programme une minuterie sur l'heure du serveur, retire le droit localement à l'échéance (jamais n'en accorde), puis relit. Annulation en fin de période (`auto_renew = false`) : plan conservé jusqu'à la date de fin. Premium candidat : rôle `candidate_premium` **et** `premium_until` futur (règle de `/upgrade/candidate`, appliquée aussi au profil).

### Réseau mobile et rappels

- **Reprise** : à chaque (ré)abonnement réussi d'un canal, au retour du réseau (`online`) et au retour au premier plan après 10 s, tous les écrans relisent (« * »). Les suppressions et retraits d'accès manqués sont donc récupérés ; les événements ne sont pas rejoués.
- **Hors ligne** (`navigator.onLine === false`) : aucune relecture n'est lancée. Les chargements maison lisent la session locale (`readSessionUser`) et ne retirent rien sur une erreur réseau ; seul un refus ou une absence réelle retire un contenu.
- **Réponses anciennes** : `useLatestRequest` (chargements maison) et SWR n'appliquent que la dernière lecture lancée.
- **Doublons** : l'ancien hook est supprimé ; une seule connexion par onglet ; un signal par transaction et ressource.
- **Tâches** : l'onglet Réseau montre que le recalage toutes les 5 s est une minuterie locale (aucune requête, voir les mesures) ; elle est conservée. L'heure du serveur sert de référence (décalage mesuré à chaque lecture).

### Matrice de suivi : changement → destinataires → écrans → test exécuté

Canal : `U` = `user:<uid>`, `A` = `admin`, `P` = `jobs:public`. Preuve : `pnpm test:rls realtime` (Z, B, C, P, J, M, N, R, S, X). Navigateur : script local hors dépôt, écrans ouverts sans rechargement (S1 à S5).

| Changement (écriture réelle) | Destinataires (canal, domaine) | Écrans relus | Test exécuté |
|---|---|---|---|
| Suspension, réactivation (`admin_set_user_active`, routes admin) | U compte ciblé `account` + `notifications` ; A `account` | Bandeau, actions retirées (détail d'offre, candidatures, publication, contrat, Tâches), canal des offres fermé ; listes et fiche admin | B1-B5 ; S1.1-S1.5 |
| Rôle, grade (clé service, aucun écran) | U `account` ; A `account` | Layout admin (grade, boutons), sortie de `/admin`, cache admin vidé | B6-B9 |
| `is_verified`, téléphone, locale (`recompute_user_verification`, inscription) | U `account` ; A `account` | Détail d'offre (accès à la candidature), profil | même trigger que B2, B6 |
| Plan entreprise : activation, changement, statut, annulation (clé service) | U `subscription` (tous les onglets) ; A `subscription` | Profil entreprise (plan, avantages, échéance), liste des offres (modification directe), page de modification | C1-C3 ; S2.1 |
| Échéance d'un plan, sans écriture | minuterie locale puis `my_account_state` | Mêmes écrans ; action périmée refusée | C4-C5 ; S2.2-S2.4 ; tests unitaires |
| Premium candidat (rôle, `premium_until`) | U `subscription` | Profil candidat, `/upgrade/candidate` | C6-C7 |
| Profil candidat : onboarding, progression, identité, CNI, MoMo, étoiles | U `profile` ; A `profile` | Profil, édition, paiement, détail d'offre ; admin candidats, CNI, MoMo, fiche | P1 ; M5 (étoiles) |
| Compétences, permis et justificatifs, liens, disponibilités, demandes de mise à jour, expirations | U `profile` ; A `profile` | Compétences, documents, disponibilités, Tâches ; admin justificatifs, demandes | P2-P5 ; S3.1 |
| Vérification et onboarding entreprise | U `profile` ; A `profile` | Formulaire d'offre (publication bloquée), tableau de bord, profil ; admin entreprises | P6-P7 |
| Création, modification, nouvelle soumission d'offre (`create_job`, `update_job`) | U entreprise `jobs` ; U candidats ayant postulé `jobs` ; A `jobs` ; P si visible avant ou après | Listes et détail entreprise, file admin, listes et détails candidats | J1-J2, C3, J11 ; S3.2 |
| Modération (`moderate_job`) | U entreprise ; A ; P si approuvée | Idem | J3-J4 ; S3.3 |
| Retrait de publication : modification Pro (`active` → `pending_review`), suppression (`delete_job`) | P `jobs` ; U entreprise et candidats | L'offre quitte les listes ouvertes ; détail ouvert → page introuvable | C3/J11, J12 ; S3.4 |
| Candidature, retrait (`apply_to_job`, `withdraw_job_application`) | U candidat et entreprise `applications` ; A `applications` | Mes jobs, Tâches, détail d'offre ; candidatures, tableau de bord ; admin | J5, J7, R1 |
| Présélection, refus (écriture entreprise en session) | U candidat `applications` | Mes jobs, Tâches | J6, J8 |
| Sélection (`select_candidate`) | U candidat : candidature, mission, contrat, notification ; U entreprise : idem et `jobs` (places) ; P (places) | Tâches, Mes jobs, Missions ; candidatures (deux onglets) ; compteurs de places | J9-J10 ; S4.1 |
| Signature de chaque partie (`sign_contract`) | U les deux parties `contracts` | Contrat, Tâches, candidatures | M1-M2 ; S4.2 |
| Début de mission (`start_mission`) | U les deux parties `missions` | Candidatures (statut), mission, Tâches | M3 ; S4.3 |
| Confirmation par code (`submit_completion_code`, tentatives) | U les deux parties `missions` | Idem ; le code ne circule jamais | M4, X2 ; S4.3-S4.4 |
| Évaluations, étoiles (`submit_mission_review`, trigger de note) | U les deux parties `missions` ; U évalué `profile` | Tâches, candidatures, profils | M5 |
| Montant de la mission | relu dans le contrat après signal | Mission, contrat | M6 |
| Notification créée, lue (RPC, routes admin, `PATCH /api/notifications`) | U propriétaire `notifications` | Cloche (compteur), page Notifications, tous les onglets du compte | N1-N2, B2, J9 |
| Coupure réseau, reconnexion, premier plan | client : relecture complète | Tous les écrans abonnés | R1-R2 ; S4.3 |
| Déconnexion, changement de compte | client : canaux fermés, cache vidé, rechargement | Tous | S1 (preuve) ; S5.1-S5.4 |

Écritures sans parcours applicatif (aucune écriture aujourd'hui, donc rien à diffuser) : `payments` (lot paiement), `job_favorites` (favori non enregistré : `TODO` dans le détail d'offre), `company_favorite_candidates`, `job_templates`, `company_availability_alerts`, `disputes`, `cancellation_penalties`.

### Validation

| Contrôle | Résultat |
|---|---|
| `pnpm test:rls realtime` (nouvelle preuve, vraies WebSocket) | ✅ 54/54. Autorisation (Z1-Z6), comptes (B1-B9), abonnements (C1-C7), profils (P1-P7), offres (J1-J12), missions (M1-M6), notifications (N1-N2), reconnexion (R1-R2), changement de compte (S1), confidentialité (X1-X2 : plus de 240 messages reçus, tous de la forme `{d, r, id}` ; aucun code de fin, numéro MoMo, IP de signature, chemin CNI, e-mail ni texte privé) |
| Navigateur, Chrome headless 390×844, écrans ouverts sans rechargement | ✅ 24/24. S1 : l'admin suspend l'entreprise pendant qu'elle consulte une candidature, boîte de sélection ouverte ; bandeau et bouton désactivé en 0,7 à 1,8 s ; sélection envoyée avec l'ancienne session → 403 `account_suspended`. S2 : Pro activé puis échu dans deux onglets ; retour au gratuit 0,3 s après l'échéance sans écriture SQL ; modification directe refusée (`job_locked_plan`) ; lien de modification retiré. S3 : justificatif validé par l'admin ; offre créée (file admin), approuvée (apparaît chez deux candidats), supprimée (disparaît des listes et du détail ouverts). S4 : sélection, tâche de signature, signatures ; coupure réseau côté entreprise (WebSocket fermée, requêtes bloquées) pendant le début et le code ; état « mission confirmée » retrouvé moins de 0,1 s après le retour du réseau. S5 : connexion de K1 par le formulaire dans deux onglets, déconnexion (l'autre onglet revient à la connexion), connexion de K3 : aucun contenu de K1 à l'écran, aucune trame vers ou depuis son canal. Aucun rechargement manuel |
| `pnpm test:rls` complet, pile dédiée | ✅ 23/23 preuves (dont `realtime` 54/54, `job-moderation` 36, `contract-signing` 45, `mission-time-tracking` 30). Un premier passage avait échoué sur `job-moderation` (coupure TCP `ECONNRESET` vers l'application, pas une assertion) ; il est repassé sans échec après réapplication de la migration finale |
| `vitest run` | ✅ 281 tests, 18 fichiers (dont 17 tests `realtime-signals` : signaux, regroupement, échéances, premium, garde des réponses anciennes) |
| `tsc --noEmit`, `eslint`, `prettier --check .`, `pnpm build`, types régénérés | ✅ ; types identiques au schéma de la pile ; contrôles négatifs : politique de lecture ouverte → 4 échecs (Z2, Z4, B3, S1) ; trigger des contrats désactivé → 3 échecs (J9, M1, M2) |

### Mesures réseau observées (onglet Réseau, CDP)

Six écrans ouverts en même temps, 45 s sans action, après 3 s de stabilisation :

| Écran | WebSocket | Canaux | Requêtes HTTP | Trames envoyées / reçues |
|---|---|---|---|---|
| Candidat `/jobs` | 1 | `user:<uid>`, `jobs:public` | 0 | 2 / 2 |
| Candidat `/tasks` | 1 | `user:<uid>` | 0 | 2 / 2 |
| Candidat `/my-jobs` | 1 | `user:<uid>` | 0 | 2 / 2 |
| Entreprise `/company/jobs/[id]` | 1 | `user:<uid>` | 0 | 2 / 2 |
| Entreprise `/company/dashboard` | 1 | `user:<uid>` | 0 | 2 / 2 |
| Admin `/admin/dashboard` | 1 | `user:<uid>`, `admin` | 0 | 2 / 2 |

Les seules trames au repos sont les battements de cœur Realtime. Le recalage toutes les 5 s de Tâches n'envoie aucune requête : c'est une minuterie locale, conservée. Avant le lot, la cloche interrogeait le serveur toutes les 60 s ; ce n'est plus le cas. Ouverture d'un écran : une lecture initiale, puis une relecture complète au premier abonnement du canal (événements survenus entre la lecture et l'abonnement). Sur les navigations suivantes, le canal est déjà ouvert : aucune relecture supplémentaire. Signal reçu : une relecture par écran concerné, regroupée sur 300 ms (une sélection, soit cinq signaux, donne une seule relecture).

Plan Supabase Free (200 connexions Realtime simultanées, 2 millions de messages par mois) : une connexion par onglet ouvert ; au repos, seuls les battements de cœur Realtime (environ un toutes les 25 s, non comptés comme messages). Un signal compte un message par destinataire connecté. Exemple : une sélection émet cinq signaux au candidat, cinq à l'entreprise et un sur le canal public par candidat connecté qui écoute un écran d'offres. Le canal public n'est ouvert que sur les écrans d'offres ; c'est le poste à surveiller si le nombre de candidats connectés en même temps augmente.

### Limites restantes

- **Canal admin déjà ouvert après rétrogradation** : sur cette version de Realtime (v2.130), aucun signal n'y a été reçu après la perte du rôle (B9). Ce comportement n'est pas garanti par le code : la charge utile admin ne porte de toute façon que le domaine, et le client ferme ce canal à la relecture de l'état.
- **Suspension** : la lecture des données propres reste possible (règle SRS) ; aucune donnée ne devient inaccessible, il n'y a donc rien à purger à ce titre.
- **Hors ligne non signalé** : si le navigateur ne passe pas `navigator.onLine` à `false`, une relecture déclenchée pendant la coupure échoue sans rien retirer ; la reprise relit tout.
- **Notifications push, SMS, rappels planifiés** (H−15, fin prévue, J−30/J−7 des documents), expiration automatique des offres et blocage à 48 h : non implémentés (pas de tâche planifiée). Les rappels de Tâches ne s'affichent que sur une page ouverte.
- **Abonnements** : aucun parcours d'activation, de changement, de renouvellement Mobile Money, de délai de régularisation ni d'essai Pro ; quotas d'offres actives non appliqués (SRS §6.11). Le lot Free/Premium et le paiement en dépendent.
- **Écrans d'onboarding** : ils n'écoutent que la suspension (`account`), pour ne pas perturber la saisie en cours.
- Script navigateur local, hors dépôt (`puppeteer-core` n'est pas une dépendance directe). CI distante non observée.
- **Limite de connexions de la pile locale** : 30 connexions par IP sur 5 minutes. Enchaîner la suite et le script navigateur peut la dépasser ; il suffit d'attendre.
