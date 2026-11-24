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
| F-12 | P2 | **Corrigé et vérifié localement (lot 8, §23).** Constat d'origine : le code OTP SMS et le numéro sont **journalisés en clair** (`console.log … token`). | `lib/actions/auth.ts:476-479` | Toute personne qui a accès aux logs Vercel peut valider le téléphone d'un tiers pendant la validité du code. Données personnelles dans les logs. | Supprimer le log ou masquer le numéro et le code. | Recherche : aucun `token` journalisé. |
| F-13 | P2 | **Corrigé et vérifié localement (lot 8, §23) ; retour Google réel non testé.** Constat d'origine : callback OAuth : `next` n'est pas validé (`${origin}${next}`). Une valeur `next=@domaine-tiers` produit une redirection ouverte. Si `next` contient `/signup/company`, l'`upsert` **écrase le rôle** d'un compte existant. | `app/auth/callback/route.ts:13-52` | Hameçonnage après connexion. Un candidat peut se changer en entreprise, ou un admin être rétrogradé, en se reconnectant par OAuth avec ce paramètre. | N'accepter que des chemins relatifs commençant par `/` et pas par `//` ni `/\`. N'upserter le rôle que si la ligne n'existe pas. Créer la page `/auth/error`, qui n'existe pas. | Tests unitaires du filtre `next` ; un utilisateur existant garde son rôle. |
| F-14 | P2 | **Corrigé et vérifié localement (lot 5, §15).** Constat d'origine : clients Supabase **non typés**, donc des erreurs de schéma passent `tsc`. Exemple : l'onboarding entreprise écrit dans une table inexistante `companies` et tente `users.is_verified = true` (neutralisé par trigger), erreurs ignorées. | `lib/supabase/client.ts`, `server.ts` ; `app/onboarding/company/page.tsx:112-134` | Les informations d'onboarding entreprise sont perdues sans message. D'autres décalages de schéma sont probables mais non mesurés. | `createBrowserClient<Database>` et `createServerClient<Database>`, puis corriger les erreurs révélées. | `tsc` vert avec clients typés. |
| F-15 | P2 | **Corrigé et vérifié localement avec un fournisseur simulé (lot 8, §23) ; appel réel à la passerelle IA non testé.** Constat d'origine : `/api/chat` : public (le middleware laisse passer `/api/*`), sans authentification, quota, limite de taille ni validation Zod. Appelle un LLM payant. Le prompt système promet des **retraits Mobile Money avec 2 % de frais et un paiement sous 48 h**, alors que le MVP l'interdit. | `app/api/chat/route.ts` ; `lib/supabase/middleware.ts:5` | Abus de coût, et informations fausses données aux utilisateurs. La variable de la passerelle IA n'est pas documentée dans `.env.example`. | Authentification, quota par utilisateur et par IP, limite de messages et de taille, prompt aligné sur les règles réelles. Ou retirer le chatbot du MVP. | Requête anonyme → 401 ; requête trop grosse → 413. |
| F-16 | P2 | **Corrigé et vérifié localement (lot 7a, §18).** Constat d'origine : politique « Companies can view candidate summaries » posée sur **`company_profiles`** : toute entreprise lit tous les profils d'entreprise (NIU, email de contact…). À l'inverse, aucune politique ne permet à une entreprise de voir le nom ou la photo de ses candidats : la liste des candidatures s'affiche sans identité. | baseline:1963 ; `app/company/jobs/[id]/page.tsx:115-131` | Fuite de données entre concurrents, et fonction de sélection inutilisable. | Remplacer par une vue ou une RPC qui expose les colonnes autorisées des candidats ayant postulé aux offres de l'entreprise (jamais téléphone, email, CNI, MoMo). Supprimer la politique erronée. | Une entreprise A ne lit pas l'entreprise B ; elle voit prénom, initiale et photo de ses candidats seulement. |
| F-17 | P2 | Annulation de candidature : aucune politique DELETE sur `job_applications`. La route renvoie `success` sans rien supprimer. | `app/api/jobs/[id]/apply/route.ts:200-215` ; politiques baseline | L'utilisateur croit avoir annulé. | Passer en `status = 'withdrawn'` (UPDATE contrôlé) et vérifier le nombre de lignes modifiées. | Après annulation, le statut vaut `withdrawn`. |
| F-18 | P2 | **Corrigé et vérifié localement (lots 2b et 9, §11 et §24) : notifications réelles, refus traduits avec étape suivante, liens morts et redirections `/login` supprimés ; écrans hors parcours vérifiés encore ouverts (§24).** Constat d'origine : le retour utilisateur est factice : `toast()` ne fait que `console.info`. Les pages mission, contrat et offres entreprise, ainsi que l'onboarding, ne montrent jamais les erreurs. Les liens `/login` et `/auth/error` mènent à des 404. | `hooks/use-toast.ts` ; `app/missions/[id]/page.tsx:93` ; `app/contracts/[id]/page.tsx:111` ; `app/company/jobs/[id]/page.tsx:101` | Échecs silencieux sur les parcours critiques et utilisateurs bloqués. | Un vrai composant de notification accessible (`role="status"`), routes corrigées. | Test de composant ; vérification manuelle sur mobile. |
| F-19 | P2 | **Partiellement corrigé (lot 9, §24) : paiement sous 48 h, séquestre et montant bloqué, retrait Mobile Money, remplacement garanti, sélection par IA, essai gratuit et application hors ligne retirés ; autres avantages d'abonnement non livrés listés pour le lot Free/Premium.** Constat d'origine : les textes promettent des fonctions **absentes du code** : paiement 100 % en 48 h ou 50/50, « montant bloqué » et remboursements, « remplacement garanti », « l'IA sélectionne pour vous », « essai gratuit 7 jours ». Aucun paiement, séquestre ni IA de sélection n'est implémenté (`lib/matching/ai-matching.ts` est heuristique). | `lib/i18n/fr.ts:1151-1189, 1310, 1353-1371` ; `lib/payments/mobile-money.ts` non importé | Promesses commerciales non tenues, avec un risque de confiance et un risque juridique (droit de la consommation et règles de communication commerciale à faire valider). | Retirer ou marquer « bientôt » ce qui n'existe pas. | Relecture produit : chaque promesse correspond à une fonction livrée. |
| F-20 | P2 | **Partie CI corrigée localement (lot 4, §13). Partie déploiement : configuration préparée et vérifiée localement (lot 4b, §14), non validée à distance ; sauvegarde reportée au point de contrôle avant les premiers utilisateurs.** Constat d'origine : CI et déploiement : Vitest **n'est pas exécuté en CI**. Le build ne dépend pas de `test-migrations`. `deploy.yml` utilise `supabase` et `vercel` en version `latest`. Aucune sauvegarde ou vérification n'est faite avant `db push` en production. Un « rollback » par tag redéploie l'application sans revenir sur la base. Le `db push` passe par le pooler 6543 (mode transaction), à vérifier. | `.github/workflows/ci.yml`, `deploy.yml` | Régressions non détectées, déploiements non reproductibles, migration destructive sans filet. | Ajouter `pnpm test`, figer les versions des CLI, faire dépendre le build de `test-migrations`, documenter la procédure de restauration (PITR ou sauvegarde) et l'utiliser avant `db push`. | La CI échoue si un test échoue ; versions figées. |
| F-21 | P2 | **Corrigé localement (lot 4, §13) ; `contracts` couvert au lot 7b (§19), `missions`, `mission_check_ins`, `mission_completion_codes` et `reviews` au lot 7c (§20).** Constat d'origine : aucun test d'autorisation automatisé. Les scripts `scripts/proof-*.ts` couvrent une partie de la RLS mais restent manuels et hors CI. Aucune preuve n'existe pour `users.role`, `job_applications`, `contracts` et `missions`. | `scripts/`, `tests/`, `ci.yml` | Les failles F-01 à F-07 auraient été détectées par une suite RLS négative. | Suite RLS « accès interdits » exécutée en CI sur la pile Supabase locale, qui existe déjà dans `test-migrations`. | Job CI `rls-tests` vert, et rouge si une politique est relâchée. |
| F-22 | P2 | **Corrigé (lot 10, §28) : consignes centralisées dans `AGENTS.md`, chemins et outils vérifiés ; README réécrit.** Constat d'origine : consignes IA obsolètes : `AGENTS.md` et les instructions Copilot imposent Next 14, next-intl, next-pwa, Three.js, lottie, `src/app/[locale]`, `messages/*.json`, et renvoient à `DESIGN_REFERENCE.md` et `COPILOT_INSTRUCTIONS.md`, qui n'existent pas. | `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/*` | Les agents génèrent du code incohérent avec le dépôt. | Aligner ces documents sur la stack réelle et sur les règles de sécurité de ce rapport (« jamais d'écriture directe sur une colonne porteuse de droits »). | Relecture : chaque outil cité existe. |
| F-23 | P2 | **Corrigé côté journaux (lots 8 et 10, §23 et §28) : toutes les routes `app/api/**` passent par le journal structuré, aucun `console.*` (test) ; outil de capture d'erreurs et alertes encore ouverts.** Constat d'origine : aucune observabilité : ni capture d'erreurs, ni journalisation structurée. Préfixes de log `[v0]` hérités. `error.message` Postgres renvoyé au client. | recherche négative ; `app/api/jobs/route.ts:81, 200` | Les incidents de production restent invisibles et des détails de schéma sont exposés. | Messages d'erreur génériques côté client. Un outil de capture d'erreurs léger, ou au minimum des logs structurés exploitables dans Vercel. | Une erreur serveur provoquée en préproduction est visible avec son contexte. |
| F-24 | P2 | **Corrigé localement (lot 3, §12) : `zod` 4.6.7.** Constat d'origine : `zod` 4.4.3 : avis haut (épuisement mémoire sur collections volumineuses). Validation utilisée côté serveur. | `pnpm audit` | Déni de service ciblé possible sur les routes qui valident des tableaux. | Passer `zod` à ≥ 4.6.6. | `pnpm audit` sans avis `zod`. |

### P3 — Améliorations secondaires

| ID | Prio | Constat | Preuve fichier | Correction minimale |
|---|---|---|---|---|
| F-25 | P3 | **Première étape faite (lot 10, §28) : `Content-Security-Policy-Report-Only` et `/api/csp-report` ; passage en mode appliqué ouvert.** Constat d'origine : pas de `Content-Security-Policy` (les autres en-têtes sont présents). | `next.config.ts` | CSP d'abord en `Report-Only`, puis appliquée. |
| F-26 | P3 | **Résolu au lot 7c-bis (§21) : trigger et fonction supprimés avec les colonnes de salaire ; vérifié en base au lot 10.** Constat d'origine : `enforce_salary_lock` s'appuie sur `auth.jwt()->>'role'`, qui ne vaut jamais `admin_founder` : le verrou bloque aussi les admins (échec sans faille). | `20260604120000_srs_v12_plans_alignment.sql:213` | Utiliser `is_admin_user()` et le grade. |
| F-27 | P3 | **Corrigé (lots 5, 9b et 10, §28) ; `handle_new_user()` conservée jusqu'au lot 0.** Constat d'origine : code mort ou dupliqué : `database.types.ts` racine (1 893 lignes contre 2 463), `lib/types.ts` et `lib/types/index.ts`, `lib/payments/mobile-money.ts`, `_ensureUserAndProfile`, `handle_new_user()` (accordé à `anon`), `public/manifest.json` en plus de `app/manifest.ts`, `next-intl` installé sans être utilisé, `/api/payments/withdraw`. | fichiers cités | Supprimer après vérification par recherche. |
| F-28 | P3 | **Partiellement corrigé (lot 9, §24) : parcours candidature, Mes jobs, gains, tableau de bord entreprise, accueil ; pluriels et accents des écrans vérifiés.** Constat d'origine : i18n incohérente : chaînes françaises en dur et sans accents dans les pages mission, contrat et offres entreprise, alors qu'un dictionnaire existe. | `app/missions/[id]/page.tsx`, `app/contracts/[id]/page.tsx`, `app/company/jobs/*` | Migrer ces pages vers le dictionnaire au fil des lots fonctionnels. |
| F-29 | P3 | **Clos (lot 10, §28) : rapport ignoré par `.gitignore` et `.git/info/exclude`, jamais versionné.** Constat d'origine : `.qwen/` (scripts d'intrusion, extraits du catalogue et des politiques SQL) n'est ni versionné ni ignoré. Un `git add .` le commiterait. Le rapport non versionné contient un email et un téléphone réels. | `git status` | **Traité le 2026-10-31** : `.qwen/` supprimé (aucune référence dans le projet). Reste à décider du sort du rapport non versionné. |
| F-30 | P3 | **Partie mission corrigée localement (lot 7c, §20) : horaires prévus, début H−15, rappels et affichage en `Africa/Douala` ; autres écrans ouverts.** Constat d'origine : fuseau horaire : aucune référence à `Africa/Douala`. Dates formatées avec `new Date()` ou `toLocaleDateString` côté serveur (UTC sur Vercel) et côté client. | recherche `timeZone` : aucun résultat | Formater avec `timeZone: "Africa/Douala"` et stocker en `timestamptz`. À traiter avec le lot pointage. |
| F-31 | P3 | **Corrigé (lot 10, §28) : deux pages lisaient en clé service sans garde propre ; `requireAdminPage()` ajouté.** Constat d'origine : le layout admin sert de seule garde aux pages `app/admin/**`. Le risque est faible tant que ces pages utilisent la session (RLS) et non `createAdminClient`, ce qui est le cas aujourd'hui. | `app/admin/layout.tsx` | Garder la règle « pas de service_role dans les pages admin » ; recontrôler le rôle dans toute page qui en aurait besoin. |

---

## 6. Hypothèses à vérifier (non démontrées)

| ID | Prio provisoire | Hypothèse | Pourquoi | Comment vérifier sans risque |
|---|---|---|---|---|
| H-01 | P0 si confirmée | La base de **production** contient les mêmes politiques que la baseline (F-01 à F-07, F-11). | La baseline a été extraite de la production (« remote_baseline »), mais l'état actuel n'est pas visible depuis le dépôt. | Requête en **lecture seule** sur `pg_policies` et `pg_trigger` en production (Studio, avec un rôle en lecture). |
| H-02 | P1 | Des comptes ont déjà exploité F-01 à F-06 (rôles admin inattendus, `sandbox_level` ou `premium_until` incohérents, abonnements à prix 0). | Les failles sont exploitables par tout compte. | Requêtes de comptage en lecture seule : `users` par rôle ; `candidate_profiles` avec `sandbox_level > 0` sans mission terminée (*à faire avant le déploiement du lot 9b, qui supprime la colonne, §25*) ; `subscriptions` avec `price = 0`. |
| H-03 | P2 | Le cron `cleanup_unconfirmed_signups` supprime tout compte à l'email confirmé et **sans téléphone** au bout de 30 minutes. `scripts/create-admin.ts` crée des admins sans téléphone. Avec `ON DELETE CASCADE` (baseline:1841), un admin créé ainsi disparaît. | Code et SQL lus ; pg_cron en production non vérifié. | Vérifier en production `cron.job` et la présence d'un téléphone sur les comptes admin (lecture seule). |
| H-04 | P2 | **Confirmée puis corrigée (lot 8, §23).** Le repli de `verifyPhoneOtpAction` (`freshUser.phone === e164` après une erreur SDK) peut valider un numéro sans code correct dans certains cas limites. | `lib/actions/auth.ts:483-497` | Test local : un code erroné ne doit jamais aboutir à `finalizeSignup`. |
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
| F-03c | Le callback OAuth faisait un `upsert` de `users.role` sur un compte existant. | Corrigé : insertion seule (`ignoreDuplicates`). La redirection ouverte (F-13) est corrigée au lot 8 (§23). |
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

## 23. Suivi — Lot 8 : vérification du téléphone, retour OAuth, EasyBot, erreurs et journaux (F-12, F-13, F-15, F-23, H-04) (2026-11-08)

Branche `fix/lot-08-auth-chat-logs`, base `origin/main-dev` (603da79, lot 7d intégré). **Réalisé et vérifié localement sur la pile dédiée, non commité, non déployé.** Migration : `supabase/migrations/20261108120000_chat_quota.sql`.

### Défauts reproduits avant correction

- **H-04 (confirmée).** L'ancienne `verifyPhoneOtpAction` d'`origin/main-dev`, exécutée avec des clients simulés (code `000000` refusé par Supabase Auth, numéro relu sur le compte égal au numéro demandé), a appelé `finalizeSignup` et renvoyé `{ ok: true }` : inscription finalisée sans code correct. Sur la pile réelle, le contrôle négatif (ancienne règle remise dans `findPhoneProof`) fait échouer H1 et H7 : en autoconfirm (`[auth.sms] enable_confirmations = false`, réglage local et de la pile de preuve), `updateUser({ phone })` confirme le numéro **sans code**. « Numéro relu = numéro demandé » ne prouve donc rien.
  Précision : Supabase Auth (v2.196) renvoie le numéro **sans `+`** (`237…`). L'ancienne comparaison avec `+237…` ne pouvait pas réussir sur cette version : le défaut ne se déclenchait que si le format coïncidait, et la reprise légitime après réponse perdue ne fonctionnait jamais non plus.
- **F-12 (confirmé).** La même exécution a journalisé `{"phone":"+237691234567","token":"000000"}`, puis le message brut du fournisseur. `sendPhoneOtpAction` journalisait le numéro complet à chaque envoi, `resendEmailOtpAction` l'adresse email, `finalizeSignup` le NIU et les objets d'erreur complets.
- **F-13.** `` NextResponse.redirect(`${origin}${next}`) `` : `next=@evil.example` donne `http://hôte@evil.example`, donc une redirection vers `evil.example` ; `next=.evil.example` aussi. Le rôle d'inscription était lu par `includes("/signup/company")`, y compris dans la query string. `/auth/error` n'existait pas (404 après un échec OAuth).
- **F-15.** `/api/chat` : aucun contrôle ; le corps (`UIMessage[]`) était passé tel quel au modèle, rôle `system` compris ; deux nouvelles tentatives automatiques par appel ; promesses de « paiement sous 48 h », « frais de retrait 2 % », « montant minimum de retrait 1 000 XAF » et « pointage géolocalisé ». Questions rapides « Comment retirer mes gains ? » et « Quels sont les frais ? ».
- **F-23.** `GET /api/jobs`, `GET /api/categories` et `GET /api/user` renvoyaient `error.message` de Postgres. Les routes `app/api/jobs/**` journalisaient les objets d'erreur complets (`details` peut contenir des valeurs, `Key (phone)=(…)`) et, au retrait d'une candidature dans un état inattendu, la ligne entière.

Les deux derniers points sont constatés à la lecture du code ; ils n'ont pas été rejoués sur l'ancienne version.

### Constats complémentaires trouvés pendant le lot

| ID | Constat | Traitement |
|---|---|---|
| F-42 (P2, nouveau) | Supabase Auth retrouve un changement de numéro par le **numéro** (`phone_change`), pas par la session : un code valide émis pour le compte B, saisi dans la session de A, est accepté et renvoie une session de B (preuve H4). L'ancienne action appelait `verifyOtp` avec le client de la session : la session de B était écrite dans les cookies du navigateur de A, puis `finalizeSignup` marquait **A** vérifié avec le numéro de B. Constat par lecture du code et comportement d'Auth observé ; non rejoué sur l'ancienne action. | Corrigé : `verifyOtp` passe par un client anon sans persistance ; un succès pour un autre compte est refusé (`otpWrong`) et la session émise est révoquée. |
| F-43 (P3, nouveau) | `GET /api/jobs` : `search` injecté dans le filtre PostgREST `.or(...)` (`,` et `(` modifient le filtre) ; `page` et `limit` non bornés (`limit=100000`, ou `NaN` qui donne une erreur 500). | Corrigé : séparateurs et jokers retirés, 100 caractères au plus ; `limit` entre 1 et 50. |
| F-44 (P2, nouveau) | En autoconfirm, aucun numéro réel ne peut être vérifié : aucun SMS n'est envoyé et aucun code n'est valide. Seul l'ancien repli aurait pu « fonctionner », sans preuve de possession. | Refus par défaut. **Lot 0** : vérifier en lecture seule que `GET <projet>/auth/v1/settings` renvoie `phone_autoconfirm: false` en production. |

### Vérification du téléphone (H-04, F-12)

La logique serveur est sortie du fichier `"use server"` : `lib/auth/phone-verification.ts` (`requestPhoneCode`, `verifyPhoneCode`, `findPhoneProof`), appelée par les actions et par la preuve.

- Seul un code accepté par Supabase Auth **pour le compte de la session** vérifie le téléphone. `finalizeSignup` (lot 1) suit : rôle jamais réécrit, insertion atomique, `app_metadata` recopié de la base.
- Un échec de `verifyOtp` (code erroné, expiré, consommé ou émis pour un autre compte) ne finalise l'inscription que sur **preuve serveur** :
  1. `public.users.phone` vaut le numéro et `phone_verified` est vrai : ces colonnes ne sont écrites que par `finalizeSignup` (cas : réponse de l'action perdue) ;
  2. ou Supabase Auth exige un code (`phone_autoconfirm = false`, lu sur `/auth/v1/settings`), le numéro confirmé du compte est celui demandé, et sa confirmation est **postérieure au dernier envoi** enregistré dans `sms_send_log` pour ce compte et ce numéro (cas : code accepté par Auth, réponse jamais reçue par le serveur). Si le réglage est illisible ou en autoconfirm, cette source est ignorée.
- Renvoi d'un code alors que la preuve existe déjà : aucun SMS ni enregistrement. Auth n'enverrait rien pour un numéro déjà confirmé, et un nouvel envoi effacerait la preuve.
- Après un succès, la session du navigateur est rafraîchie pour porter `app_metadata.phone_verified` dans le JWT (le middleware relit la base à défaut).
- Journaux : opération, catégorie et code Auth (`otp_expired`). Jamais le numéro, le code, l'email ni le message du fournisseur (`logServerError`, `logServerWarning`). Le contournement de développement (`DEV_TEST_PHONES`, hors production) est conservé, sans journal du numéro.

### Retour OAuth (F-13)

- `safeInternalPath` (`lib/auth/safe-redirect.ts`) n'accepte qu'un chemin absolu interne. Sont refusés : URL absolue, `//`, `\`, `@`, caractère de contrôle ou espace dans le chemin, leurs formes encodées (jusqu'à trois décodages), les chemins `/api/` et `/_next/` et le callback lui-même. Repli : `/`. La query string est conservée et réencodée.
- La redirection est construite par `new URL(chemin, origine)` : elle reste toujours sur l'origine de l'application.
- Le rôle d'inscription est lu sur le **chemin exact** (`/auth/signup/company`, `/auth/signup/candidate`). La ligne `users` n'est créée que si elle n'existe pas (correction F-03c conservée) ; le callback n'écrit jamais `app_metadata`.
- `/auth/error` : page traduite (FR/EN) avec « Reprendre la connexion » (`/auth/login`) et « Créer un compte ». Le message du fournisseur n'est jamais affiché.

### EasyBot (F-15)

Paramètres, seuils, coût plafonné et lancement local : `docs/chatbot.md`.

- Ordre des contrôles (`lib/chat/handler.ts`) :
  1. session, sinon 401 ;
  2. compte ouvert et actif, sinon 403 : ligne `users`, `is_active` non faux, téléphone vérifié (sauf administrateur) ;
  3. corps de 32 Kio au plus, sinon 413, avant toute lecture JSON ;
  4. Zod : rôles `user` et `assistant`, parties texte seules (sinon 400) ; 12 messages, 1 000 caractères par question, 4 000 par réponse, 12 000 au total (sinon 413) ;
  5. fournisseur configuré, sinon 503 ;
  6. quota, sinon 429 avec `Retry-After` ;
  7. un seul appel au modèle (`maxRetries: 0`).
- Le serveur fixe le modèle (`openai/gpt-5-mini`), les instructions (`lib/chat/system-prompt.ts`) et le budget de sortie (500 jetons). Les champs `system`, `model` et `maxOutputTokens` envoyés par le client sont ignorés.
- Quota : `consume_chat_quota` (clé service seule) prend un verrou consultatif par compte, puis par IP, et réserve dans la même transaction. Seuils : 20 par heure et 60 par jour et par compte ; 120 par heure et par IP **fiable** (Vercel uniquement, `observedClientIp`). La réservation est atomique entre requêtes simultanées et entre instances. Une erreur du contrôle de quota donne 503, sans appel.
- Instructions alignées sur les parcours livrés : montant fixe en XAF par candidat et par mission, début dans Tâches dès H−15, fin confirmée par le code à six chiffres, signature depuis Tâches. Aucune promesse de versement, de délai, de retrait Mobile Money ou de frais. Questions rapides remplacées (« Comment suis-je rémunéré ? », « Où signer mon contrat ? »).
- Client : historique réduit aux 10 derniers messages texte, saisie limitée à 1 000 caractères (Zod), refus affichés et traduits (401 avec lien de connexion, 403, 413, 429, 503). En cas d'erreur du fournisseur, l'écran ne reçoit que `chat_unavailable`.

### Erreurs et journaux (F-23, partiel)

- `lib/observability/server-log.ts` écrit une ligne JSON par événement : `level`, `op`, `category`, `code` (SQLSTATE, PostgREST ou Auth), `reason` (seulement si c'est un code métier), `status` et `requestId` (`x-vercel-id`). Jamais `message`, `details`, `hint`, paramètres ni contenu. Aucune dépendance : les lignes sont lisibles et filtrables dans les journaux Vercel actuels.
- `lib/api/errors.ts` (`internalErrorResponse`) renvoie un 500 de la forme `{ error: "Internal server error", code, requestId }`. Codes : `jobs_failed`, `job_failed`, `job_write_failed`, `applicants_failed`, `mission_failed`, `application_failed`, `categories_failed`, `user_failed`.
- Les réponses dont dépendent les écrans sont conservées : refus de candidature (`code`, `missing`, message de justificatif), suppression et modification d'offre (`code` traduit), modération, 404 `Job not found`. Un identifiant invalide et l'erreur `PGRST116` restent des 404 ; toute autre erreur devient un 500 journalisé.
- Fichiers couverts : `lib/actions/auth.ts`, `lib/auth/finalize-signup.ts`, `app/auth/callback`, `app/api/chat`, `app/api/jobs/**`, `app/api/categories`, `app/api/user`.

### Validation

| Contrôle | Résultat |
|---|---|
| Reproduction sur l'ancienne `verifyPhoneOtpAction` (`origin/main-dev`, clients simulés, script jetable hors dépôt) | Défaut confirmé : code refusé et numéro relu identique → `finalizeSignup` appelé, `{ ok: true }` ; journal avec le numéro et le code |
| `pnpm test:rls phone-verification` (nouvelle preuve, Supabase Auth réel, état relu en base) | ✅ 12/12. H1 reproduction H-04 en autoconfirm ; H2 code erroné ; H3 code expiré ; H4 code d'un autre compte ; H5 succès (rôle et `app_metadata` cohérents) ; H6 réponse perdue après finalisation (idempotent, sans doublon) ; H7 réponse perdue avant le serveur (refus en autoconfirm, reprise si Auth exige un code, renvoi sans nouvel envoi) ; F-12 aucun code ni numéro dans les journaux du processus. Contrôle négatif (ancienne règle remise) : 2 échecs (H1, H7) |
| `pnpm test:rls oauth-callback` (route réelle, `redirect: "manual"`, aucun appel Google) | ✅ 15/15. R1 chemin interne et query string conservés ; R2-R9 URL externe, `//domaine` (encodé ou non), `\`, `@domaine`, encodages simples et doubles → `/` sur l'origine de l'application ; R10 sans `next` ; E1 sans code, code invalide, erreur du fournisseur → `/auth/error` ; E2 page servie avec « Reprendre la connexion » ; A1 candidat existant via l'inscription entreprise : rôle et `app_metadata` inchangés ; A2 nouveau compte : ligne `company`, `app_metadata` sans rôle ; A3 `/signup/company` dans la query string : aucune ligne |
| `pnpm test:rls chat-quota` (route réelle, fournisseur HTTP simulé qui compte les appels) | ✅ 12/12. C1 401 ; C2 403 (sans ligne, suspendu, non vérifié) ; C3 413 (corps, nombre, longueur) et 400 (`system`), sans quota ni appel ; C4 un appel, modèle `openai/gpt-5-mini`, instructions du serveur, 500 jetons ; C5 10 requêtes simultanées avec 3 restantes : exactement 3 acceptées et 3 appels, puis 429 et `Retry-After` sans appel ; C6 25 réservations parallèles par connexions distinctes, limite 5 → 5 ; 12 sur une même IP, limite 4 → 4 ; RPC fermée à `anon` ; C7 erreur du fournisseur : `chat_unavailable`, ni clé, ni URL, ni contenu. Contrôle négatif (verrous retirés et `pg_sleep(0.05)` ajouté pour élargir la course, pile dédiée) : 3 échecs (C5, C6 ×2) |
| Journaux de `next start` pendant toute la suite | Lignes JSON du lot (`op`, `category`, `code`, `reason`, `status`) ; aucun numéro, code, jeton, clé, URL du fournisseur ni contenu de conversation. Les routes hors périmètre (modération, sélection) journalisent encore un objet d'erreur, ici le code forcé par les preuves |
| `pnpm test:rls` complet, pile dédiée | ✅ 26/26 preuves |
| `vitest run` | ✅ 354 tests, 24 fichiers ; nouveaux : `safe-redirect` (filtre `next`), `server-log` (aucune valeur sensible écrite, réponses 500), `chat-request` (limites, rôles, prompt sans promesses), `chat-handler` (`MockLanguageModelV3` : aucun appel sur 401/403/413/400/429/503, un appel sinon), `phone-verification` (décision H-04) |
| `tsc --noEmit`, `eslint`, `prettier --check .`, `pnpm build` | ✅ |
| Types générés (`supabase gen types --schema public`, CLI 2.117.0, pile dédiée) | Seuls ajouts : `chat_request_log` et `consume_chat_quota` ; `lib/database.types.ts` régénéré, identique au schéma |

### Vérifications qui dépendent encore d'un fournisseur réel

- **SMS (Twilio)** : envoi réel, contenu du SMS, réglage `phone_autoconfirm = false` du projet distant, ordre réel « envoi enregistré puis confirmation » (horloges de Supabase Auth et de Postgres). Le réglage de production est simulé dans H7.
- **Google** : aller-retour réel `authorize` → Google → `/auth/callback`. Le retour est simulé par une ligne `flow_state` du fournisseur `google` ; l'annulation (`error=access_denied`) est couverte sans Google.
- **Passerelle Vercel AI** : appel réel (clé ou OIDC), effet de `reasoningEffort: "minimal"` sur la longueur des réponses, coût réel. Les tests utilisent un fournisseur simulé (serveur HTTP local et `MockLanguageModelV3`).
- **Vercel** : présence de `x-vercel-id` et de `x-vercel-forwarded-for` (identifiant de requête et quota par IP). En local, ces deux valeurs sont absentes et la limite par IP n'est pas appliquée.

### Limites restantes

- F-23 : les routes admin, profil, contrats, missions et paiements journalisent encore `error.message` ou des objets d'erreur (côté serveur seulement, sans les renvoyer au client). Préfixes `[v0]` dans `app/api/matching`, `app/api/payments` et `lib/payments`. Aucun outil de capture d'erreurs ni d'alerte.
- EasyBot : aucune mémoire de conversation côté serveur ; l'historique vient du client et reste borné. Un utilisateur peut fabriquer des messages « assistant » dans l'historique, dans les mêmes limites de taille et sous les mêmes instructions. Le chatbot reste affiché aux visiteurs non connectés, qui voient l'invitation à se connecter.
- Quota : une requête acceptée est comptée même si le fournisseur échoue. Il n'existe pas de plafond global du projet : les limites bornent le coût par compte et par IP, pas le nombre de comptes.

## 24. Suivi — Lot 9 : retours utilisateur, redirections et textes FR/EN (F-18, F-19, F-28) (2026-11-08)

Branche `fix/lot-09-user-feedback-i18n`, base `origin/main-dev` (361cb26, lot 8 intégré). **Réalisé et vérifié localement sur la pile dédiée, non commité, non déployé.** Aucune migration ni changement de droits en base.

### Défauts constatés avant correction

| Parcours | Constat (lecture du code, confirmé à l'écran pour les points marqués ★) |
|---|---|
| Connexion | La page de connexion ignorait `next` : après connexion, on arrivait toujours sur `/jobs`, `/profile` ou `/company/dashboard`. Quatre écrans redirigeaient encore vers `/login` (404) et sept utilisaient `?redirect=` (non lu). Le middleware perdait la query string. |
| Candidature | Les refus de `/apply` s'affichaient avec `error`, en anglais (« Already applied to this job », « Your sandbox level is too low… »), sans étape suivante. Le refus pour justificatif renvoyait une phrase française sans code. Le détail d'offre annonçait « Candidature envoyée ! » pour une candidature **retirée** ou **refusée**. Aucun écran ne permettait de retirer une candidature (route seule). |
| Mes jobs | Les erreurs de lecture étaient ignorées : une coupure réseau affichait « Vous n'avez pas encore postulé ». Une candidature retirée ou refusée disparaissait et donnait le même message. Textes en dur sans accents (« Reservees », « Preselectionne »). |
| Entreprise | `company_premium` était renvoyé vers `/` par `/company/dashboard` ★ (toutes les RPC entreprise l'acceptent) ; `/api/user` ne renvoyait pas son profil. Liens vers `/company/applications`, `/company/analytics`, `/company/notifications`, `/company/settings`, `/profile/company/edit` et `/upgrade/company` : 404. Statut `rejected` affiché brut sur le tableau de bord ; « Bon apres-midi », « Creer une offre ». Les refus de sélection ne disaient pas quoi faire ensuite. |
| Missions et contrats | La FAQ des Tâches demandait de « valider vos heures d'arrivée et de départ » (pointage supprimé au lot 7c) ; la note du contrat parlait de « pointage » ; « Montant fixe versé » laissait croire à un versement par l'application ; « Il vous reste 1 essai(s) ». |
| Promesses (F-19) | Accueil : « Paiement Mobile Money », « paiement garanti », « confiance garantie », « Zéro litige », « L'IA complète votre profil », « L'IA génère votre offre », « Le paiement des candidats est géré automatiquement », « Matching par IA », compteurs « 1 500+ missions, 200+ entreprises, 5 000+ candidats » sans source, application PWA qui « fonctionne hors ligne » (aucun service worker), neuf liens de pied de page vers des pages inexistantes. FAQ : délais de versement 7 jours / 48 h / 50-50. Profil candidat : bloc « Délai de paiement » (48 h, 50/50, 7 jours). Premium : « Payé en 48h ». Plans entreprise : « Paiement sécurisé : bloqué jusqu'à validation », « IA Talent Match », « 7 jours d'essai gratuits », « Remplacement garanti sous 2h », pénalités « montant bloqué ». Gains : solde, « Total retiré », heures travaillées, alors que `payments` n'est écrite par aucun parcours. |

### Vérification des affirmations sensibles

| Affirmation | Parcours réel | Traitement |
|---|---|---|
| Paiement sous 48 h, 50/50, 7 jours | Aucun versement : aucune écriture dans `payments`, `wallets`, `withdrawal_requests`. Le contrat v2 engage l'entreprise à « régler au candidat le montant forfaitaire convenu ». | Remplacé : montant fixe en XAF inscrit au contrat, réglé par l'entreprise ; l'application n'effectue pas encore de versement. |
| Séquestre, montant bloqué, pénalités sur montant bloqué | Aucun blocage de fonds. La suppression d'une offre engagée est refusée (`job_has_commitments`). | Remplacé : aucune somme n'est bloquée ni retenue ; contacter le support avant d'annuler. |
| Retrait Mobile Money | Le numéro MoMo est déclaré et vérifié par un admin ; aucun retrait. | Remplacé : numéro vérifié par l'équipe ; aucun paiement ni retrait par l'application. |
| Remplacement garanti | Aucun remplacement automatique. | Remplacé : contacter le support en cas d'absence. |
| Sélection, génération ou matching par IA | `match_score` jamais renseigné (tri des candidats par date à défaut) ; `/api/matching` n'est appelé par aucun écran ; aucune génération d'offre. | Remplacé : indicateurs de fiabilité (note, missions, vérifications, `company_job_applicants`) ; recherche par ville et catégorie. |
| Essai gratuit 7 jours | Aucun parcours d'essai ni de paiement ; plans écrits par la clé service seulement (SRS : essai Pro de 14 jours, non livré). | Remplacé : activation et changement de plan par le support (`mailto:`), sans essai. |
| Application hors ligne | Aucun service worker. | Remplacé : application web installable sur l'écran d'accueil. |
| Progression Sandbox automatique — *retirée au lot 9b, §25* (« Progressez mission après mission », « Montez en grade », seuils « 1 mission · 3.5★ », « 3 missions · 4★ », « 10 missions · 4.5★ ») | `candidate_profiles.sandbox_level` vaut 0 à la création ; le candidat ne peut pas le modifier (privilèges de colonne et trigger du lot 2) ; aucune fonction, aucun trigger, aucune tâche planifiée ni aucune route ne l'écrit ; `sandbox_config` (seuils `min_missions`, `min_profile_pct`) n'est lue nulle part ; l'écran admin l'affiche en lecture seule. Le niveau ne sert qu'au refus `sandbox_level_too_low` d'`apply_to_job`. | Remplacé, sur les clés existantes (`home.sandbox.subtitle`, `l0Desc` à `l3Desc`, `home.features.f3Desc`) : chaque candidat commence au niveau Nouveau ; le niveau est attribué par l'équipe EasyJob et n'évolue pas automatiquement ; une offre peut exiger un niveau minimum. Aucun critère, délai ni garantie. Aucun écran ne permet aujourd'hui à l'équipe de le modifier : l'attribution passe par la base. |
| Compteurs d'utilisateurs | Aucune source. | Remplacés par des faits du produit : montant fixe en XAF, deux signatures par contrat, code de fin à 6 chiffres, 2 villes. |

« Bientôt disponible » n'a été utilisé nulle part : aucune annonce produit explicite n'a été fournie. Le SRS décrit ces fonctions comme des exigences du MVP, mais pas comme une annonce publique ; leur affichage éventuel reste une décision produit.

### Corrections

- **Connexion** : `postLoginPath` et `loginHref` (`lib/auth/safe-redirect.ts`) réutilisent `safeInternalPath` (lot 8). La page de connexion lit `next` (ou l'ancien `redirect`) et y revient après authentification ; les chemins `/auth/*`, `/` et toute destination externe donnent la destination par défaut du rôle. Le middleware conserve la query string. Toutes les redirections passent par `loginHref` ; plus aucune vers `/login`.
- **Candidature** : `applyRefusalFeedback` (`lib/jobs/application-feedback.ts`) traduit chaque code de `/apply` dans la langue de l'interface et propose l'étape suivante (se connecter, terminer l'inscription, compléter le profil, gérer ses justificatifs, voir les autres offres, voir mes candidatures, contacter le support). Les toasts acceptent une action (lien) et restent affichés 4 s de plus. La route garde `error` et ses statuts HTTP ; elle ajoute `code` au refus de justificatif (avec `requirement`) et aux refus de retrait. Le détail d'offre affiche l'état réel (en attente, présélectionnée, sélectionnée avec lien vers Tâches, non retenue, retirée, absence) et permet de retirer une candidature en attente, avec confirmation ; un retrait n'est annoncé qu'après relecture du statut `withdrawn`.
- **Mes jobs** : lectures en erreur levées (SWR conserve le dernier état) ; bandeau « Connexion impossible : affichage du dernier état connu » avec « Réessayer », ou écran d'erreur si rien n'a encore été chargé ; « Aucune candidature en cours » (compact) et historique des candidatures retirées, refusées ou absentes ; libellés du dictionnaire.
- **Entreprise** : `isCompanyRole` (`company`, `company_premium`) pour le tableau de bord et `/api/user` ; liens morts remplacés (`/company/jobs`, `/profile/company`, `/profile/notifications`, `/profile/settings`, `/onboarding/company`, support) ; statuts du tableau de bord tirés de `companyJobs.status` ; messages de sélection et de refus avec l'étape suivante (signer le contrat, choisir un autre candidat, contacter le support, réseau) ; offre refusée en modération : « Modifiez l'offre pour corriger ce point ».
- **Missions et contrats** : FAQ des Tâches (signature, début dès H−15, code à six chiffres, évaluation), note du contrat, « montant fixe convenu » ; pluriels avec `plural` (`Intl.PluralRules`) pour les essais du code de fin, les postes, les candidatures et les offres.
- **Gains** (`/earnings`) : missions terminées et montant figé dans leur contrat, total en XAF, rappel qu'aucun versement n'est effectué par l'application ; plus de solde, de retrait ni d'heures.
- **Accueil** : textes et compteurs ci-dessus ; navigation et pied de page vers des destinations existantes (`#how`, `#features`, `#sandbox`, `/help/guide`, `/help`, `/terms`, `/privacy`, `mailto:support@easyjob.cm`) ; liens CGU et confidentialité de l'inscription corrigés (`/legal/*` → `/terms`, `/privacy`).
- **Plans** : noms, prix et structure inchangés ; seuls les textes des promesses ci-dessus sont corrigés ; boutons d'abonnement vers le support.

### Validation

| Contrôle | Résultat |
|---|---|
| Navigateur, Chrome headless 375×812 (émulation mobile), français puis anglais, pile dédiée, application `next start` (script local hors dépôt, fixtures en clé service comme `proof-candidate-selection`) | ✅ 34/34. (1) `/my-jobs` sans session → `/auth/login?next=%2Fmy-jobs` → connexion par le formulaire → retour sur `/my-jobs` ; `next=//evil.example/x` ignoré → `/jobs`. (2) Candidature à une offre exigeant un niveau Sandbox supérieur : toast « Candidature non envoyée / Application not sent » traduit, en haut de l'écran (bas du toast à 121-162 px, barre d'onglets à 747 px), action « Voir les autres offres » qui mène à `/jobs`. (3) Candidature réussie : toast de succès avec « Voir mes candidatures » ; retrait depuis le détail d'offre, base relue `withdrawn`. (4) Mes jobs : « Aucune candidature en cours » + historique « Retirée / Withdrawn » visible sans défilement. (5) Requêtes Supabase interrompues (navigateur en ligne) : bandeau « dernier état connu » + « Réessayer », candidatures conservées, puis retour à la normale ; premier chargement sans réseau → « Connexion impossible / Cannot connect », jamais « aucune candidature ». (6) `company_premium` : `/company/dashboard` affiché ; textes accentués ; carte Candidatures → `/company/jobs` |
| `pnpm test:rls`, pile dédiée | ✅ 26/26 au second passage complet. Premier passage : 24/26 ; `job-moderation` interrompue après I10 par `supabase db query` (« failed to connect to postgres: Connection timed out ») au bout de plusieurs heures, et `realtime` (C6, C7, J12, B2) dans la même période ; horloges hôte et Docker alignées ensuite ; les deux preuves relancées seules puis toute la suite : vertes. Aucune assertion liée au lot |
| Correction Sandbox de l'accueil (relecture) | `vitest run tests/user-facing-claims.test.ts` ✅ 7/7 ; contrôle négatif : ancien seuil remis en FR et ancien sous-titre en EN → 2 échecs détectés, textes restaurés ; `tsc`, `eslint` et `prettier --check .` ✅ |
| `vitest run` | ✅ 425 tests, 29 fichiers. Nouveaux : `login-redirect`, `application-feedback` (chaque code en FR et EN, sans texte anglais de la route en français, actions), `my-jobs` (états vides, historique, dernier état, gains, pluriels), `user-facing-claims` (promesses retirées absentes des dictionnaires, de l'accueil et des gains ; chaque lien interne statique vise une route existante ; plus de `/login`), `company-role`, toast avec action |
| `tsc --noEmit`, `eslint`, `prettier --check .`, `pnpm build` | ✅ |

### Points encore ouverts

- **Avantages d'abonnement non livrés** (lot Free/Premium) : priorité premium dans les candidatures (aucun tri premium en base) et offres exclusives ; frais de service 10 % / 8 % / 0 % (aucun paiement) ; favoris, invitation directe, modèles, rapport mensuel, export PDF/Excel, recrutement en masse, alertes, tableau de présence, contrats sectoriels, reporting, manager dédié, SLA, modération immédiate, visibilité accrue, quotas d'offres actives. Les textes restent affichés tels quels sur les cartes de plan.
- **Niveau Sandbox** : aucun écran ni aucune règle ne fait évoluer le niveau (texte de l'accueil corrigé, ci-dessus). Les critères éventuels d'attribution (`sandbox_config`) et un outil d'administration restent à décider. Le widget de complétude du profil candidat (`components/profile/profile-completion-widget.tsx`), hors accueil, n'a pas été relu. → *2026-11-08 : niveaux retirés au lot 9b (§25), widget compris.*
- **Écrans hors parcours vérifiés**, encore en dur en français ou sans accents : `/missions` (liste non reliée à la navigation), `/dashboard` candidat (hérité), une partie du détail d'offre et du tableau de bord entreprise (textes en ternaires FR/EN corrigés pour les accents, pas encore dans le dictionnaire), administration.
- **Navigation entreprise** : `BottomNav` n'est jamais rendue avec un rôle entreprise ; les écrans entreprise n'ont pas de barre d'onglets (conception actuelle, non modifiée). Les liens des onglets entreprise ont été corrigés sans effet visible.
- **Retrait** : une candidature retirée ne peut pas être renouvelée (`apply_to_job` lève `already_applied`) ; l'écran le dit. Changer cette règle relève d'une décision produit.
- Code mort : `computePaymentDelayMode` n'est plus appelé (lot 10).
- Appareils réels Android et iOS non testés (Chrome headless en émulation mobile seulement).

## 25. Suivi — Lot 9b : retrait des niveaux Sandbox, réputation par les avis de missions (2026-11-08)

Branche `refactor/lot-09b-remove-sandbox-levels`, base `origin/main-dev` (0db9384, lot 9 intégré). **Réalisé et vérifié localement sur la pile dédiée `easyjob-proof`, non commité, non déployé.** Migration `20261108130000_remove_sandbox_levels.sql`.

**Décision produit (2026-11-08)** : les niveaux Sandbox (Nouveau, Confirmé, Fiable, Expert) et le niveau minimum des offres sont supprimés. Les étoiles des évaluations de missions sont le seul indicateur de réputation affiché, avec leur nombre : « 4,5/5 · 2 avis » / « 4.5/5 · 2 reviews », ou « Pas encore d'avis » / « No reviews yet ». Un compte sans avis peut postuler à sa première mission. Pas de seuil d'étoiles, pas de classement par la note, pas de conversion des anciens niveaux.

### État avant retrait (lot 9)

| Élément | Usage constaté |
|---|---|
| `candidate_profiles.sandbox_level` (0-3, index, contrainte) | Seule règle active : refus `sandbox_level_too_low` dans `apply_to_job` (avant le contrôle des places et des documents). Renvoyé par `company_job_applicants`, lu par le matching (20 % du score, filtre `gte`), affiché en badge sur l'avatar du profil, dans le widget de complétude (carte des quatre niveaux et de leurs seuils) et sur la fiche admin. Jamais écrit par aucune fonction (§24). |
| `jobs.sandbox_level_required` (contrainte) | Lu par `apply_to_job`, le matching et `GET /api/jobs`. `create_job` et `update_job` ne l'écrivaient plus (lot 6) ; `job_apply_content` ignorait le champ sans le signaler. Aucun sélecteur dans le formulaire d'offre. |
| `sandbox_config` (table, 2 policies, 2 index, trigger) | Lue nulle part. |
| `candidate_profiles.is_sandbox`, `sandbox_missions_completed` ; `jobs.is_sandbox` ; `missions.is_sandbox` | « Mode Sandbox » (missions d'initiation) : jamais appliqué. Affiché seulement par `app/dashboard/dashboard-client.tsx` (non importé : `/dashboard` redirige) et par un badge de `JobCard` jamais alimenté (`GET /api/jobs` ne charge pas la colonne). |
| `job_templates.sandbox_level_required`, `company_availability_alerts.sandbox_level_min` | Aucun usage. |
| Textes | Accueil (section « Sandbox », liens de navigation et de pied de page, carte « Système de confiance », badge « Expert » de la maquette), widget de complétude, refus `sandbox_level_too_low` FR/EN, statistique admin « Niveau Sandbox ». |
| « Score de fiabilité » | `reliability_score` : **jamais calculé** (0 par défaut, seulement protégé en écriture). C'était pourtant le chiffre affiché à côté d'une étoile dans la liste des candidatures (`app/company/jobs/[id]`), renvoyé par `company_job_applicants` et par l'enrichissement de `/api/matching`. Le détail d'offre annonçait qu'une absence « peut affecter votre score de fiabilité ». Métrique distincte des avis : retirée des indicateurs publics. |

Les usages techniques du mot « sandbox » (bac à sable des fournisseurs Mobile Money, `MOBILE_MONEY_SANDBOX`, spike opérateur cité dans le SRS) ne sont pas concernés et restent en place.

### Migration

1. `candidate_profiles.review_count` (entier ≥ 0, protégé) : nombre d'évaluations `mission_flow` prises en compte dans `average_rating`. Rattrapé depuis `reviews` ; `average_rating` n'est pas modifiée. `refresh_review_rating` écrit désormais la note et le nombre dans la même instruction. L'unicité `reviews_mission_flow_unique` (mission, côté) et la reprise de `submit_mission_review` garantissent qu'une relance ne compte pas deux avis.
2. `protect_candidate_profile_columns` : colonnes Sandbox retirées de la liste, `review_count` ajoutée (refusée en session à la création comme à la modification).
3. `apply_to_job` : contrôle de niveau retiré ; les autres refus restent identiques et dans le même ordre.
4. `company_job_applicants` (type de retour changé, donc `drop` puis `create`) : `average_rating` et `review_count` remplacent `sandbox_level` et `reliability_score`. Ordre inchangé (`match_score`, puis date). Toujours aucune donnée sensible (F-16).
5. `job_apply_content` : `sandbox_level_required` dans le contenu d'une offre → `invalid_job_data` (comme `hourly_rate`), à la création comme à la modification.
6. Garde-fou : la migration échoue si une fonction du schéma `public` lit encore une colonne Sandbox (le corps PL/pgSQL n'est pas suivi par `pg_depend`). Elle journalise le nombre de profils et d'offres dont la valeur non nulle est supprimée. Colonnes, index, contraintes et table sont supprimés **sans CASCADE** : une dépendance oubliée ferait échouer la migration. Aucune vue, policy, publication Realtime, tâche `pg_cron` ni clé étrangère ne dépendait de ces objets.

Migrations historiques inchangées. `lib/database.types.ts` régénéré depuis la pile (`supabase gen types --schema public`, CLI 2.117.0) : retraits des colonnes et de `sandbox_config`, ajout de `review_count`, nouveau retour de `company_job_applicants`.

### Application

- **Supprimé** : badge de niveau (avatar 3D, en-tête de profil), carte des niveaux du widget de complétude, `SANDBOX_LEVELS` et `sandbox_level` de `lib/utils/profile-completion.ts`, refus `sandbox_level_too_low` (route, retour utilisateur, dictionnaires), critère et filtre du matching, colonne de `GET /api/jobs`, badge « Sandbox » de `JobCard`, section, liens et badge « Expert » de l'accueil, statistique admin « Niveau Sandbox », fonction morte `updateReliabilityScore` (second écrivain de `average_rating`, jamais appelée), composant mort `app/dashboard/dashboard-client.tsx`.
- **Réputation** : `lib/utils/reputation.ts` (`formatReputation`, textes `reputation.*` FR/EN). Profil candidat (sous les étoiles et carte « Note »), liste des candidatures côté entreprise, fiche admin. Sans avis, aucune étoile n'est remplie. Le profil et la liste se mettent à jour par les signaux temps réel existants (`profile`, `missions`).
- **Matching** (`/api/matching`, appelé par aucun écran) : les six autres critères gardent leurs proportions, ramenées sur 100 ; un candidat sans note garde la valeur neutre prévue. L'enrichissement renvoie la note et le nombre d'avis au lieu de `reliability_score`.
- **Accueil** : carte « Avis après chaque mission ». Avertissement du détail d'offre réécrit sans « score de fiabilité » et passé au dictionnaire.
- `reliability_score`, `completed_missions`, `total_missions` et `no_show_count` restent en base ; la fiche admin (non publique) affiche encore la « Fiabilité ».

### Validation

| Contrôle | Résultat |
|---|---|
| Upgrade réel : pile `easyjob-proof` remise à l'état du lot 9 (`db reset`), fixtures, puis `supabase migration up` sur cette même base (script local hors dépôt) | ✅ 4/4 avant, 19/19 après. **Avant** : candidat N sans avis (complétude 85 %, niveau 0) refusé `sandbox_level_too_low` sur une offre de niveau 3 et accepté ailleurs ; candidat R noté 4. **Après** : colonnes et table supprimées ; R garde 4 et reçoit `review_count = 1` ; N postule par la RPC à l'offre de niveau 3 ; permis manquant refusé par la RPC (`document_requirement`, `driving_license`, `missing`) et par la route (403), aucune ligne ; `create_job` avec l'ancien champ → `invalid_job_data` ; `company_job_applicants` sans niveau ni score de fiabilité ; première évaluation de F (5/5) puis relance (`already_reviewed`, note inchangée) → 5 avec un seul avis ; évaluation réciproque de l'entreprise conservée, sans effet sur le nombre d'avis de F ; `review_count` non modifiable par le candidat |
| Navigateur, Chrome headless 375 × 812, FR puis EN, `next build` + `next start` reliés à la pile, vrais clics (script et captures hors dépôt) | ✅ 31/31. Profil N « Pas encore d'avis », sans libellé de niveau ni défilement horizontal ; candidature par l'interface à l'ancienne offre de niveau 2, relue `pending` ; refus du permis affiché (« Cette offre exige un permis de conduire valide. » / « This job requires a valid driving licence. »), aucune candidature ; liste des candidats « Pas encore d'avis », sans niveau ni fiabilité ; évaluation par l'entreprise pendant que le profil de N est ouvert → « 4/5 · 1 avis » **sans rechargement** ; relance puis rechargement → toujours « 4/5 · 1 avis » ; liste « 4/5 · 1 avis » / « 4/5 · 1 review » ; profil R : note conservée ; formulaire d'offre sans champ ni sélecteur de niveau. Pas de défilement horizontal sur les cinq écrans, dans les deux langues |
| `pnpm test:rls`, même pile, après l'upgrade | ✅ 26/26. Preuves adaptées sans retirer les autres protections : `business-permissions` (tentatives sur `review_count` et `average_rating` à la place du niveau ; B2 : compte sans avis accepté ; refus du permis, des documents, de la complétude, du compte suspendu et de l'offre complète inchangés), `job-moderation` (P5 : ancien champ refusé par `create_job` et `update_job`, offre inchangée), `mission-time-tracking` (R5 : nombre d'avis du bon candidat, relance sans second avis, avis donné sans effet sur son propre compte), `candidate-selection` (F3 : colonnes autorisées avec `average_rating` et `review_count`) ; fixtures sans `sandbox_level` dans 16 preuves |
| `vitest run` | ✅ 429 tests, 30 fichiers. Nouveaux : `reputation` (formats FR/EN, singulier, sans avis) ; `application-feedback` (le refus de niveau n'existe plus) ; `user-facing-claims` (plus de « sandbox », de « niveau minimum » ni de « score de fiabilité » dans les dictionnaires et l'accueil ; aucune référence aux colonnes Sandbox dans `app`, `components`, `lib`, `hooks` ; `reliability_score` limité à l'admin) |
| `tsc --noEmit`, `eslint`, `prettier --check .`, `pnpm build` | ✅ |

### Limites

- **Production** : la requête de comptage H-02 sur `sandbox_level` (lot 0) doit être faite **avant** le déploiement ; la colonne n'existe plus ensuite (la migration journalise seulement les deux nombres).
- ~~`completed_missions` et `total_missions` ne sont incrémentés par aucun parcours : la liste des candidatures affiche « 0 missions » à côté de « 4/5 · 1 avis ». Non modifié ici.~~ Lot 9c (§26) : `completed_missions` réécrit depuis les missions confirmées par code ; la liste n'affiche plus que les étoiles. `total_missions` reste non écrit.
- Une note `average_rating` sans évaluation `mission_flow` (donnée héritée) n'est plus affichée : sans avis compté, l'écran indique « Pas encore d'avis ». La valeur reste en base.
- La note des entreprises n'a pas de compteur d'avis (non affichée dans les parcours vérifiés).
- Onglets de la liste des candidatures : libellés qui se chevauchent à 375 px (« Présélect. (0)Sélectionnées »), antérieur au lot.
- Formulaire d'offre : seule l'étape 1/5 est capturée ; les quatre autres ont été relues dans le code (aucun champ de niveau).
- ~~`UserStories_EasyJob_CM_MVP.md` décrit encore la montée de niveau (lot 10, documentation).~~ Lot 9c (§26) : épopée SAND marquée retirée, épopée EVAL réécrite.
- Appareils Android et iOS réels non testés.

## 26. Suivi — Lot 9c : réputation EasyJob en étoiles (candidats et entreprises) (2026-11-09)

Branche `feat/lot-09c-reputation-stars`, base `origin/main-dev` (8195e4c, lot 9b intégré). **Réalisé et vérifié localement sur la pile dédiée `easyjob-proof`, non commité, non déployé.** Migration `20261109120000_reputation_stars.sql`.

**Décision produit (2026-11-09)** : la moyenne des avis n'est plus l'indicateur affiché. Chaque profil a une réputation EasyJob de 0 à 5 étoiles par demi-étoiles, calculée en base. Les tiers ne voient que les étoiles ; les avis (note, motifs, commentaire) ne sont lisibles que par l'administration. SRS §5.2, §5.3 (note), §5.5, §6.2, §6.9, §6.14, §8.1 et user stories EVAL-01 à EVAL-05 mis à jour.

### État avant le lot (lot 9b)

| Élément | Constat |
|---|---|
| `reviews` | Policy « Anyone can view public reviews » (`is_public = true` par défaut) : note et commentaire de tous les avis lisibles par l'anonyme. |
| Surfaces des tiers | `company_job_applicants` renvoyait `average_rating`, `review_count`, `completed_missions` ; l'écran affichait « 4/5 · 1 avis » ou « Pas encore d'avis ». `/api/matching` sélectionnait les mêmes colonnes. |
| `completed_missions` | Jamais écrit (« 0 missions » affiché). |
| Expiration des justificatifs | Dérivée à la lecture ; aucun envoi J−30, J−7 ni à l'échéance (`document_expirations` vide, aucun écrivain). |
| Annulations, absences | Aucun parcours après sélection (`withdraw_job_application` ne vaut que pour une candidature `pending`, `delete_job` refuse une offre engagée) ; `cancellation_penalties`, `no_show_count` et `late_cancellation_count` jamais écrits. |
| Contestation | Aucun parcours ; le support est l'adresse `support@easyjob.cm` ; `disputes` existe sans écran. |
| pg_cron | Disponible et utilisé par trois purges (pile locale et Supabase). |

### Règles implémentées

| Catégorie | Candidat | Entreprise |
|---|---|---|
| Profil (½ à 50 %, 1 à 100 %) | `profile_completion_pct` existant | `company_profile_completion_pct` : mêmes critères et poids que `computeCompanyCriteria` (secteur 20, description > 20 caractères 20, logo 15, ville + adresse 15, RCCM ou NIU 15, nom + téléphone du contact 15) ; cohérence JS/SQL vérifiée (E1) |
| Expérience et engagements (solde 0..20, ½ par 5 unités, max 2) | +1 par mission dont le code est consommé et la fin enregistrée | +1 par offre (sous-offres regroupées sous `parent_job_id`) dès qu'une mission est confirmée par code et que chaque sélection est résolue (mission confirmée, annulée ou absence) |
| Manquements (application) | −5 par décision confirmée non annulée (annulation tardive, absence) | −5 par série de trois décisions en 90 jours |
| Avis (4-5 → +1, 3 → 0, < 3 → −5) | solde 0..10, max 1 étoile | solde 0..20, max 2 étoiles |
| Compétences (½ par compétence distincte, max 1) | justificatif lié `verified` et valide (règle d'expiration de `apply_to_job`) ; conduite : permis `verified`, valide, de catégorie couvrante (mapping de `has_verified_license_for`) | — |

- **Avis admissible** : `origin = mission_flow`, mission confirmée par code, non invalidé par une contestation acceptée.
- **Rejeu** : `compute_reputation` rejoue chaque solde dans l'ordre chronologique avec les bornes à chaque événement ; aucun cumul n'est stocké. Le résultat ne dépend que des sources (missions, codes, avis, litiges, incidents, documents).
- **Projection** : `reputation_scores` (score et progression), écrite par `refresh_reputation` seul (triggers sur missions, candidatures, avis, litiges, incidents, profils, documents, liens et compétences), ligne verrouillée : une variation réelle ne produit qu'une notification. `average_rating` et `review_count` restent les données sources ; `completed_missions` est réécrit depuis les missions confirmées par code.
- **Variations** : `reputation_changes` (gain ou baisse d'au moins ½, cause, motifs ou documents seulement, notification liée, accusé d'animation). Notification `system`, titre et texte dans la langue du compte, lien d'action dans `data.href`.
- **Indépendance** : aucun lien avec l'abonnement ni le premium (E2) ; `apply_to_job` inchangée.
- **Application et conditions séparées (revue du lot)** : la base applique une décision de manquement confirmée ; elle ne juge pas si le manquement est constitué. Les conditions pour prononcer une décision — délai d'annulation tardive (24 h candidat, 12 h entreprise, provisoires), offre partiellement pourvue, imputabilité, justificatif — ne sont pas encodées et sont à arbitrer (lot « Engagements et annulations », `PLAN_ACTION.md`). Le trigger `protect_reputation_incidents` ne vérifie que la cohérence des faits (`incident_mission_mismatch`, `incident_job_mismatch`, `incident_conflicts_with_completion`) ; `scheduled_start_at` et `occurred_at` sont informatifs.

### Confidentialité

- `reviews` : policy publique supprimée, `SELECT` retiré à `anon` et `authenticated` ; `is_public` vaut `false` par défaut et n'ouvre plus rien.
- `company_job_applicants` : `reputation_stars` remplace `average_rating`, `review_count` et `completed_missions`. `company_public_profiles` : colonne `reputation_stars` (détail d'offre). `/api/matching` : colonnes de note retirées. Aucune surface tierce n'affiche moyenne, nombre d'avis, « Pas encore d'avis », motif ni commentaire : composant `ReputationStars` (`role="img"`, « Réputation EasyJob : 3,5 étoiles sur 5 »).
- `reputation_scores` et `reputation_changes` : lecture du titulaire et des admins ; aucune écriture de session. `reputation_incidents` : aucun droit de session.
- Realtime : nouveau domaine `reputation` sur `user:<uid>` du seul titulaire et sur `admin` ; charge utile `{ d, r }` (plus l'`id` technique du message) ; les entreprises des candidatures reçoivent `applications` sans identifiant, les offres publiques `jobs`.
- Notification de baisse après un avis : motifs seulement, jamais l'auteur ni le commentaire.
- Les étoiles des tiers sont recalculées à la lecture si une échéance est passée depuis le dernier calcul (`reputation_stars_for`).

### Motifs et évaluation

`submit_mission_review(uuid, int, text, text[])` : motifs de la partie évaluée (6 par côté), distincts, au moins un sous 3, aucun pour 4-5. Mêmes règles dans `missionReviewSchema` (route) et le dialogue (puces FR/EN, envoi bloqué sans motif sous 3). Le commentaire reste privé. **Changement de comportement** : une relance qui envoie une note < 3 sans motif est refusée en 400 par la route avant d'atteindre la reprise idempotente ; une relance avec le même contenu valide renvoie toujours l'évaluation d'origine.

### Progression, notifications, animations

- `GET /api/reputation` (`my_reputation`, calcul à la lecture) ; `ReputationProgressCard` sur `/profile/candidate` et `/profile/company` (ancre `#reputation`) : palier nommé, barre, action (« Encore 2 missions confirmées »), progression par catégorie, rappel d'échéance à J−30. L'action mise en avant est celle de la catégorie la plus avancée vers sa demi-étoile suivante.
- `ReputationCelebration`, monté une fois dans `app/layout.tsx` : `POST /api/reputation/acknowledge` ne renvoie que les variations acquittées par cet appel ; seul cet onglet joue l'animation. Gain : carte festive brève ; baisse : carte discrète avec l'action (motifs + contestation par courriel au support, renouvellement, complétion du profil). `useReducedMotion` : aucune trajectoire ni particule.
- Centre de notifications : lien « Voir » (`data.href`, chemin interne vérifié par `safeInternalPath`).
- Reprise : scores initialisés avec `p_silent` (aucune notification ni variation).

### Échéances

`reputation_expiry_sweep()` planifiée par pg_cron toutes les 15 minutes (même garde que les purges existantes) : recalcul des profils dont `next_expiry_at` est passée (cause `document_expired`, notification persistante lue à la reconnexion), puis rappels J−30, J−7 et à l'expiration des justificatifs approuvés de `candidate_documents` via `document_expirations` (index unique par document, drapeaux, `skip locked`). Un document dont l'expiration a fait perdre des étoiles n'a pas de second avis. Même traitement pour la CNI vérifiée (revue du lot) : ligne `document_expirations` de type `cni` (écrite par `moderate_cni`, un index unique par candidat, doublons antérieurs retirés), alignée sur `cni_expires_at`, rappels remis à zéro quand la date change ; notification privée « CNI bientôt expirée » / « CNI expirée » vers `/profile/candidate/edit`. Le statut brut des documents n'est pas réécrit.

### Administration et contestation

- `GET /api/admin/reputation/[type]/[id]` (3 grades) : détail par catégorie, avis (note, auteur, mission, motifs, commentaire), impact rejoué (`admin_reputation_review_impacts`), contestation, manquements, variations.
- `POST` : `admin_open_review_contest` (3 grades) crée un litige `review_contest` au nom de la partie évaluée ; `admin_resolve_review_contest` (`admin_ops`, `admin_founder`) : décision définitive, `audit_logs` (étoiles avant et après), recalcul dans la transaction, notification de la partie. Trigger : aucune écriture de session sur ces litiges ; la policy de lecture des litiges masque la contestation à l'auteur de l'avis.
- Écrans : panneau sur `/admin/candidates/[id]` ; nouvelle fiche `/admin/companies/[id]` (lien « Réputation et avis » depuis la liste).

### Validation

| Contrôle | Résultat |
|---|---|
| Montée de version réelle : pile remise à l'état 9b (`db reset` sans la migration), données (candidat : 9 missions confirmées par code + 1 ancienne sans code, avis 5/5/2, `completed_missions = 0` ; entreprise : 10 offres, 10 avis de 5), puis `supabase migration up` sur cette base | ✅ candidat 1,5 (profil 1, 9 unités → ½, avis 5,5,2 → 0) ; entreprise 2 (offre sans code exclue, 9 avis admissibles → ½) ; `completed_missions` 0 → 9 ; **0 notification, 0 variation** ; tâche `reputation-expiry-sweep` planifiée ; types régénérés identiques |
| `pnpm test:rls reputation` (nouvelle preuve, vraies sessions) | ✅ 60/60 après la revue (44 avant ; ajouts I et V ci-dessous) — N 8 → 9 → 10 missions (aucune variation à la 9e, un gain et une notification à la 10e) ; T deux onglets (un seul accusé), reconnexion, compte tiers ; O offre à 2 places comptée une fois après résolution ; R plafond d'expérience, gain, motifs refusés (route et RPC, motif de l'autre partie, motif sur 5), baisse avec motifs seuls, plafond des avis à chaque événement (10 − 5 = 5, et non 6) ; P étoiles seules (RPC, vue, API, lecture directe : avis refusés en 42501 pour l'anonyme, un tiers, un autre candidat et l'auteur), Realtime (titulaire seul, `{d, r}`) ; C contestation (support, refus à admin_support, décision ops, audit, rejeu déterministe d'un événement ancien, gain cause contest, 409 au second essai) ; L J−30 sans doublon, permis expiré sans autre permis valide, échéance lue par l'entreprise avant la tâche, tâche idempotente, utilisateur déconnecté, reconnexion, attestation valide sans permis, renouvellement en attente puis approuvé, diplôme sans échéance ; B aucune décision inférée, intégrité des faits, décision appliquée sans seuil (30 h, 13 h, 48 h, offre sans sélection), −5, plancher 0, annulation du support, trois décisions entreprise → un retrait (deux fois) ; E profil entreprise (SQL = JS), premium sans effet, écritures et fonctions internes fermées |
| `pnpm test:rls`, même pile, build final | ✅ 27/27 preuves (dont `reputation` 44/44), même pile, après une montée de version réelle ; **après la revue (SQL modifié) : ✅ 27/27, dont `reputation` 60/60**, pile réinitialisée, types régénérés identiques |
| Contrôle négatif (lecture des avis rouvertes en session) | ❌ détecté : lecture des avis rouverte en session (grant + policy) → 1 échec (P5), code de sortie 1 ; `trg_reputation_reviews` désactivé → 5 échecs (R1, R3, R4, R6, P2). Pile restaurée, privilège et policy revérifiés |
| Navigateur : Chrome headless, 375 × 812 tactile, FR puis EN, vrais clics (script et captures hors dépôt) | ✅ 46/46, deux exécutions consécutives : profil candidat (étoiles et libellé accessible, « Prochain palier : 2,5 étoiles », « Encore 2 missions confirmées », statistique Missions = 8) ; 9e mission sans animation ; 10e mission : animation de gain dans **un seul** des deux onglets, progression mise à jour sans rechargement, rien au rechargement ; liste des candidats de l'entreprise : étoiles seules ; dialogue de notation : note 2 → 6 motifs du candidat, envoi bloqué sans motif ; baisse vue en direct par le candidat (carte discrète, « Motifs de l'avis : Retard. », « Contester auprès du support ») ; `prefers-reduced-motion` : félicitation sans particules ; détail d'offre (étoiles de l'entreprise) ; progression de l'entreprise ; liens d'action des notifications ; fiches admin candidat (avis, auteur, motifs, impact) et entreprise. Aucun défilement horizontal sur ces écrans, FR et EN |
| `tsc --noEmit`, `eslint`, `prettier --check .`, `vitest run` (448 tests, dont `reputation-progress`, `review-reasons` : codes et libellés SQL = dictionnaires), `pnpm build` contre la pile dédiée | ✅ |

Preuves adaptées : `candidate-selection` F3 (colonnes autorisées : `reputation_stars` au lieu de la note, du nombre d'avis et des missions) ; `mission-time-tracking` R3, R5, R6 (relances et tentatives de tiers avec une note valide sans motif, les refus attendus restant vérifiés).

### Revue du lot (2026-11-09)

| Point | Décision et mise en œuvre | Preuve |
|---|---|---|
| Sanctions | Séparation de l'**application** (une décision confirmée retire 5 unités ; entreprise : trois décisions en 90 jours → un retrait ; annulation par le support → solde rétabli) et des **conditions** pour prononcer la décision. Retirés du trigger `protect_reputation_incidents` : `incident_not_late` (24 h, 12 h) et `incident_without_selection`. Restent les seuls contrôles de cohérence : `incident_mission_mismatch`, `incident_job_mismatch` (nouveau), `incident_conflicts_with_completion`. Délais et offre partiellement pourvue : arbitrage inscrit au lot « Engagements et annulations » (`PLAN_ACTION.md`). | B0 aucune décision créée par les parcours (missions sans code, avis négatifs, contestations, échéances) ; B1 refus de cohérence ; B2 décision appliquée pour une annulation 30 h avant le début ; B5 décisions sur une offre sans sélection, 13 h et 48 h avant le début : toutes appliquées, deux retraits pour six décisions |
| CNI | **Existant** : `moderate_cni` écrit une ligne `document_expirations` de type `cni` à l'approbation, mais rien ne l'exploitait (aucun rappel). **Ajout** au traitement d'échéances : suivi aligné sur `cni_expires_at`, un index unique par candidat (doublons antérieurs retirés), rappels remis à zéro quand la date change, notifications privées (« CNI bientôt expirée » / « CNI expirée », lien `/profile/candidate/edit`). **Effet réel** : complétude inchangée (critère « CNI vérifiée », pas l'échéance) ; réputation inchangée (aucune catégorie, aucune unité de compétence). **Candidature** : refusée sur une offre qui exige la CNI ; **acceptée sinon**, car `users.is_verified` ignore l'échéance (écart avec le SRS §5.1, non corrigé : critères d'accès préservés, décision attendue). | I1 J−30, J−7 et expiration, un rappel chacun après deux passages ; I2 aucun rappel chez les autres comptes ; I3 complétude 100 %, mêmes étoiles qu'une CNI valide, aucune variation ; I4 403 `document_requirement` (`cni`, `expired`) ; constat I5 HTTP 200 ; I6 renouvellement : une ligne, rappels remis à zéro, candidature acceptée |
| Mauvais avis | Baisse réelle de ½ étoile (2 → 1,5), FR et EN, deux motifs (`late`, `poor_quality`) et un commentaire identifiable ; candidat déconnecté pendant l'avis. | V1 deux envois simultanés puis une relance : un seul avis, un seul « nouveau », impact −5 compté une fois, une variation, une notification ; V2 texte exact : « Votre réputation EasyJob passe à 1,5 étoile après un avis : retard, travail non conforme. » / « Your EasyJob reputation drops to 1.5 stars after a review: late arrival, work not up to standard. » ; V3 après reconnexion, une notification et une variation en attente, sans commentaire, nom de l'auteur, identifiant de l'entreprise ni de l'avis dans `/api/notifications` et `/api/reputation` ; V4 un seul accusé pour deux sessions ; V5 avis complet (commentaire, auteur, mission, motifs, impact −5) pour `admin_ops` et `admin_support`, 403 pour un tiers |

Contrôles : `pnpm test:rls` 27/27 ; `vitest` 448 tests ; `tsc`, `eslint`, `prettier --check .` verts. Application non modifiée par la revue (SQL, preuve et documentation seulement) : le build vérifié au navigateur reste valable.

### Dépendances restantes

- **Manquements** : aucun parcours ne produit de décision (annulation après sélection, constat d'absence, décision du support). `reputation_incidents` applique toute décision confirmée sans seuil ; aucune sanction n'est déduite. Conditions à arbitrer : lot « Engagements et annulations ».
- **Déploiement** : vérifier que pg_cron est activé sur le projet Supabase et que `cron.job` contient `reputation-expiry-sweep` après la migration (sinon la notice « pg_cron non activé » apparaît et la tâche doit être planifiée à la main) ; surveiller le premier passage (envoi des J−30/J−7 en cours, pas d'historique au-delà de J−1). Relever avant le déploiement le nombre d'avis existants et vérifier qu'aucun client ne lit `reviews` directement.
- ~~**CNI expirée et candidature (écart constaté, décision attendue)**~~ **Tranché et corrigé au lot 9d (§27)** : refus seulement sur une offre qui exige le document `cni` (I4) ; sur une offre sans exigence, la candidature est acceptée (I5, HTTP 200), car `users.is_verified` ignore l'échéance alors que le SRS §5.1 fait de la « CNI vérifiée non expirée » un critère essentiel. Non modifié ici (critères d'accès préservés par le lot).
- CNI et réputation : aucun effet (complétude fondée sur « CNI vérifiée », aucune unité de compétence) ; rappels J−30, J−7 et à l'expiration envoyés (revue du lot).
- Délai de 48 h pour noter et modération automatique des commentaires : non implémentés.
- `trust_score`, `late_cancellation_count`, `no_show_count`, `reliability_score` : toujours non calculés. `lib/matching/ai-matching.ts` lit encore `average_rating` côté serveur (aucune exposition).
- Contestation : saisie par le support à partir d'un courriel ; pas de formulaire dans l'application.

### Anciennes règles de paiement liées aux étoiles (pour le lot paiement)

- SRS §5.3 : délai de versement selon « note ≥ 4 étoiles » combinée au premium (100 % en 48 h, 50/50, 7 jours).
- SRS §5.3 et US-PAY-02 : annulation tardive du candidat → perte d'accès aux « missions de niveau supérieur » 7 jours et note moyenne affectée.
- US-EVAL-02 (avant lot) : « moyenne ≥ 4 → délai de paiement accéléré » ; §6.9 (avant lot) : « les notes impactent le délai de paiement ».
- Composants `PaymentDelayInfo`, `PremiumBenefits`, `/upgrade/candidate` : prop `averageRating` conservée mais ignorée (aucun délai implémenté).

Ces règles reposent sur la moyenne et les niveaux, qui ne sont plus des indicateurs : à redéfinir sur la réputation EasyJob ou à abandonner.

### Constats pendant la vérification

- **Corrigé** : un signal arrivé pendant le chargement initial était perdu (`mutate()` de SWR réutilisait la requête en vol) ; le hook force désormais une nouvelle lecture.
- **Corrigé** : la statistique « Missions » du profil candidat lisait `total_missions` (jamais écrit) ; elle lit `completed_missions`.
- Dans un onglet en arrière-plan, la carte d'animation reste affichée jusqu'au retour sur l'onglet (minuteries et animations suspendues par le navigateur), puis se ferme normalement.
- La félicitation de l'entreprise s'affiche par-dessus le haut d'un dialogue ouvert pendant 4,5 s (bouton de fermeture disponible).
- Antérieur au lot (§25) : libellés des onglets de la liste des candidatures qui se chevauchent à 375 px (le script clique par le DOM).

## 27. Suivi — Lot 9d : CNI en cours de validité, tâches du candidat et détail d'offre mobile (2026-11-10)

Branche `fix/lot-09d-offer-details-candidate-tasks`, base `origin/main-dev` (e6729f4, lot 9c intégré). **Réalisé et vérifié localement sur la pile dédiée `easyjob-proof`, non commité, non déployé.** Migration `20261110120000_cni_validity_candidate_tasks.sql`.

**Décision produit (2026-11-10)** : toute **nouvelle** candidature exige une CNI vérifiée et en cours de validité, y compris sur une offre sans document requis. Elle remplace l'écart constaté au lot 9c (§26, constat I5 : HTTP 200). SRS §5.1, §5.1.1, §5.4, §6.4, §6.6 et gestion des documents expirés mis à jour.

### CNI et candidature

| Élément | Avant | Après |
|---|---|---|
| Contrôle | `apply_to_job` ne lisait que `users.is_verified` (ignore l'échéance) ; refus seulement sur une offre exigeant `cni` | `candidate_cni_state(profil, now())` dans `apply_to_job`, après la suspension et avant `profile_not_verified`, quelle que soit l'offre |
| Source et convention | — | `candidate_profiles.cni_expires_at` (type `date`) ; prédicat `cni_expires_at::timestamp at time zone 'UTC' < now()` (même règle que l'ancien `apply_to_job` et `reputation_document_valid`) : valide jusqu'à 00:00:00 UTC du jour d'échéance inclus, expirée juste après ; sans date, valide. Comparaison à `now()` : aucun lien avec pg_cron |
| Refus | `document_requirement` (offre exigeant `cni`) ou HTTP 200 | `cni_expired` (errcode 42501 : HTTP 403 en appel direct PostgREST), détail `{"state": "expired" \| "renewal_pending" \| "renewal_rejected"}` ; la route renvoie 403 `{ code, state }` |
| Renouvellement | Photos d'une CNI vérifiée verrouillées sans demande admin (aucun renouvellement possible) ; notification « Soumettez votre nouvelle CNI depuis votre profil » sans issue | `protect_verified_candidate_data` et `lockedGroupsForCni` : une CNI vérifiée expirée libère ses photos, l'identité reste verrouillée ; l'envoi repasse la CNI en `pending` |
| Approbation | `moderate_cni` sans date posait « naissance + 10 ans », déjà passée pour un adulte (preuve `admin-cni` D2 : 2008-06-15) | refus `cni_expiry_invalid` si la date résultante est absente ou passée ; route `/api/admin/cni` 400 `expiry_invalid`, message dédié, champ date décrit comme obligatoire dans ce cas |
| Étoiles et complétude | — | la réputation ne lit pas la CNI ; l'approbation supprime les photos (T8.4) : sans correction, le premier envoi d'une nouvelle CNI faisait tomber le critère CNI (15 %) et l'étoile « profil ». Une CNI en renouvellement (date d'échéance posée par l'approbation et passée) reste comptée (SQL, fonction passée de `immutable` à `stable` car elle lit `now()` à l'écriture, et `computeCandidateCriteria`). Une révérification d'identité d'une CNI encore valide perd toujours ses 15 points tant que les photos manquent (règle du lot 2, preuve `business-permissions` G5, qui a détecté une première version trop large) |
| Portée | — | nouvelles candidatures seulement ; candidatures, sélections, contrats et missions existants non relus |

Interface : sur le détail, « Votre CNI a expiré. Renouvelez-la pour postuler. » et « Renouveler ma CNI » à la place de « Postuler » ; renouvellement soumis : « Votre nouvelle CNI est en cours de vérification… » et « Consulter le suivi » ; refusé : message et « Renouveler ma CNI ». Bannière sur la page d'édition du profil. **Finalisation** : sur un détail ouvert, la décision admin arrive par le signal privé `profile` du lot 7d (relecture autorisée de la page, `router.refresh`) : message, motif du refus (« Motif : … ») et bouton (« Renouveler ma CNI » ou « Consulter le suivi », vers `/tasks?task=cni`) changent sans rechargement ; l'échéance franchie écran ouvert bascule par une minuterie locale (`useCniState`, posée sur l'instant d'expiration, heure du serveur), sans interrogation périodique.

### Tâches et point rouge

- `candidate_action_tasks()` (SECURITY DEFINER, session du candidat) : profil (inscription, < 60 %), identité, téléphone, Mobile Money (absent, en vérification, refusé), CNI (7 états), justificatifs exigés par une offre. `action_required` faux pour une pièce en vérification, sauf complément demandé (refus, demande de mise à jour couvrant la CNI ou l'identité). Recalculé à chaque lecture : retrouvé en ouvrant l'onglet ou après reconnexion.
- Justificatifs : `candidate_application_blockers` (candidat, offre), écrite par `record_application_blocker` (recalcul `candidate_document_blocker`, fonction extraite des boucles de `apply_to_job`, mêmes états et même ordre), appelée par la route après un refus `document_requirement` ; aucun droit de session sur la table ; ligne effacée à la candidature ; tâche groupée par (type, compétence) avec les offres encore ouvertes.
- `/api/tasks` renvoie `missions` et `actions` ; la page Tâches et l'onglet partagent le cache SWR (`useCandidateTasks`) et les signaux Realtime existants (`missions`, `contracts`, `applications`, `jobs`, `profile`, `account`, plus reconnexion et retour au premier plan). Nouveau signal `profile` à l'insertion ou la suppression d'une offre mémorisée.
- Chaque refus résoluble ouvre `/tasks?task=<clé>` (profil, essentiel manquant, `cni`, `document:<type>:<compétence>`) : tâche mise en évidence, action focalisée.
- Point rouge (`pendingActionCount`) : demandes de mise à jour, actions requises, signature, début disponible, code de fin à l'heure de fin, notation. Ouvrir l'onglet ne l'efface pas ; libellé accessible « Tâches, une action vous attend » / « Tasks, an action is waiting for you » ; minuterie de 15 s pour un début de mission qui devient disponible.

### Détail d'offre mobile

- Candidat : travail demandé (titre, entreprise, catégorie, description), montant par candidat, lieu, date et horaires, exigences (compétences, justificatifs, tenue, instructions, ou « Aucune exigence particulière »), état de la candidature, entreprise. Action principale seule dans le bandeau fixé au-dessus de la barre d'onglets (montant non répété). Retirés : phrase du forfait, nombre de places, cœur (favori, jamais branché). Partage conservé avec libellé accessible ; sans `navigator.share`, copie du lien et confirmation. Textes nouveaux ou touchés passés au dictionnaire (`jobDetail`).
- Entreprise : en-tête dans le même ordre (travail, montant par candidat, lieu, date et horaires, exigences), nombre de postes pourvus conservé ; phrase du forfait retirée du récapitulatif du formulaire.
- Urgence : option retirée du formulaire (`urgency` toujours envoyé à `normal`) ; badge « Urgente » / « Urgent » calculé (`isJobUrgent`) dans la liste et le détail candidat, et (finalisation) sur le tableau de bord et la liste des offres de l'entreprise (`UrgentBadge`, même règle ; l'ancien indicateur `jobs.urgency` n'y est plus lu) : offre ouverte, début strictement futur et à 24 h ou moins, heures saisies en heure de Douala (UTC+1) ; minuterie sur la prochaine bascule (`useJobUrgent`, heure du serveur). `/api/jobs` ne classe plus par `urgency`. Frais : lot commercial.

### Validation

| Contrôle | Résultat |
|---|---|
| `pnpm test:rls` (pile `easyjob-proof` réinitialisée avec la migration, build final de la finalisation) | ✅ 27/27 preuves ; `reputation` 70/70 (60 au lot 9c ; 69 avant I15) |
| `reputation`, bloc I étendu | ✅ I4 offre exigeant la CNI : 403 `cni_expired` (état `expired`) avant les justificatifs, aucune ligne ; **I5 (ancien constat HTTP 200) : offre sans document, refus par la route (403) et par appel direct à la RPC (HTTP 403, `cni_expired`, état `expired`), aucune candidature** ; I7 tâches : CNI expirée (action, échéance) et justificatif mémorisé (offre listée), 2 actions ; I8 renouvellement par `/api/profile/documents` (3 × 200), identité toujours verrouillée (`field_locked`), CNI `pending`, date inchangée, complétude 100 %, étoiles et variations inchangées, signal Realtime `profile` ; I9 en attente : refus maintenu (route et RPC, `renewal_pending`), tâche en suivi sans action, point maintenu par le justificatif (1) ; I10 complément (refus `admin_ops` par la route) : action avec motif, `renewal_rejected`, 2 actions ; I11 approbation refusée sans date valide (400 `expiry_invalid`) puis acceptée avec la date de la pièce, tâche CNI retirée, point maintenu (1) ; I6 une ligne de suivi, rappels remis à zéro, candidatures acceptées (offre avec et sans CNI), étoiles conservées ; I12 casier déposé : suivi, 0 action ; approuvé : candidature acceptée, tâche et mémorisation effacées ; I13 limite exacte : `valid` à 00:00:00 UTC, `expired` à +1 µs, échéance aujourd'hui → 403, demain → 200, sans passage de pg_cron ; I14 refus documentaire par la route → tâche retrouvée par une nouvelle session, table fermée en lecture et écriture de session |
| `admin-cni` | ✅ D1a : approbation sans date (défaut 2008) ou avec une date passée → 400 `expiry_invalid`, CNI en attente ; D2 et D4 : date saisie (2034-06-15) |
| `business-permissions` G5 | ✅ après correction : une première version gardait le critère CNI pour toute CNI déjà vérifiée et faisait échouer G5 (révérification d'identité : −15 points attendus) ; la règle est restreinte au renouvellement d'une CNI expirée |
| Contrôle négatif (`candidate_cni_state` forcée à `valid` sur la pile dédiée) | ❌ détecté : 6 échecs (I4, I5, I6, I7, I9, I10), code de sortie 1 ; migration rejouée (idempotente), `reputation` 69/69 |
| Navigateur : Chrome headless, 375 × 812 tactile, EN puis FR, build final (script et captures hors dépôt) | ✅ 31/31 : badge « Urgente » / « Urgent » à 3 h, absent à 3 jours et à 24 h + 2 min, **apparu sans rechargement à H−24 sur un détail ouvert** ; ordre travail → montant → lieu → horaires → exigences ; ni cœur, ni phrase du forfait, ni nombre de places ; partage étiqueté (feuille native simulée avec le lien, repli « Lien de l'offre copié » sans partage natif) ; refus CNI et bouton visible au-dessus de la barre d'onglets ; bouton → `/tasks?task=cni`, tâche mise en évidence, action focalisée ; point rouge et libellé accessible FR/EN, conservé à l'ouverture de l'onglet ; écran ouvert : soumission → suivi et point éteint, refus admin → motif et point rallumé, approbation → tâche CNI retirée, point maintenu par le justificatif ; détail en renouvellement : « Consulter le suivi » ; puis « Postuler maintenant » ; vue entreprise FR/EN (ordre, postes pourvus, sans forfait) ; formulaire sans option urgente ; aucun défilement horizontal |
| Corrigé pendant la vérification navigateur | Bandeau d'action qui chevauchait d'1 px la bordure de la barre d'onglets ; en-tête qui masquait « Travail demandé » ; partage natif qui échouait sans repli ; animation de sortie du point rouge restée visible |
| Finalisation — échéance (type et prédicat) | `cni_expires_at` est une colonne `date` ; `apply_to_job` appelle `candidate_cni_state(v_profile, now())` (vérifié dans `pg_get_functiondef`, I15), qui lit `reputation_document_valid` : `cni_expires_at::timestamp at time zone 'UTC' < now()`. ✅ I13 : `valid` à J−1 23:59:59 UTC (juste avant) et à J 00:00:00 UTC (instant exact), `expired` à +1 µs (juste après) ; unitaires (`cni-validity`) : −1 ms, 0, +1 ms. Comportement conforme à la convention existante : seules les formulations « expirée dès 00:00 UTC » (migration du lot, `cni-validity.ts`, preuve, test, SRS, audit) ont été corrigées en « valide jusqu'à 00:00:00 UTC inclus, expirée juste après » |
| Finalisation — comptage avant déploiement (`reputation` I15) | ✅ 8 fixtures complètes, candidatures réelles par la route : échue hier (vérifiée, en attente, refusée) et échue aujourd'hui → `cni_expired` ; demain et sans date (vérifiée) → acceptées ; sans date ou à J+30 en première vérification → `profile_not_verified`. La requête documentée désigne exactement les 4 profils refusés pour ce motif, et le même ensemble que `candidate_cni_state` |
| Finalisation — navigateur (Chrome headless, 375 × 812, FR et EN, script hors dépôt) | ✅ 18/18 : détail ouvert avant la décision, refus depuis une seconde session (`admin_ops`, route) → message, motif et « Renouveler ma CNI » sans rechargement (marqueur de page conservé), bouton → `/tasks?task=cni` ; nouvelle pièce → « Consulter le suivi », approbation → « Postuler maintenant », sans rechargement ; échéance : heure du serveur simulée à J 00:00:00 UTC − 40 s (réponse `my_account_state` réécrite par le script), « Postuler maintenant » puis « Votre CNI a expiré… » et « Renouveler ma CNI », **aucune requête réseau** pendant l'attente ; entreprise, tableau de bord et liste des offres : « Urgente » / « Urgent » sur une offre imminente à indicateur `normal`, absent sur une offre à 4 jours à indicateur `urgent` ; aucun défilement horizontal |
| `tsc --noEmit`, `eslint`, `prettier --check .`, `vitest run` (483 tests, dont `cni-validity`, `job-urgency`, `candidate-tasks`), `pnpm build` contre la pile dédiée ; types régénérés identiques (première passe et finalisation) | ✅ |

### Limites

- **Données existantes** : des CNI approuvées sans date saisie portent « naissance + 10 ans », généralement passée. Ces candidats seront refusés dès la migration et devront renouveler leur CNI. À compter avant le déploiement (lecture seule), avec exactement la règle de `candidate_cni_state` : `select count(*) as refusees, count(*) filter (where cni_verified = 'verified') as expirees, count(*) filter (where cni_verified <> 'verified') as en_renouvellement from public.candidate_profiles where cni_expires_at is not null and cni_expires_at::timestamp at time zone 'UTC' < now();` L'échéance du jour compte (refus dès que 00:00:00 UTC est passé), quel que soit le statut ; une date absente ne compte pas (CNI vérifiée sans date : valide ; non vérifiée : refus `profile_not_verified`, autre motif). La première version de cette requête (`cni_verified = 'verified' and cni_expires_at < current_date`) oubliait l'échéance du jour et les CNI en attente ou refusées dont la date est passée. Exactitude vérifiée sur fixtures (preuve `reputation` I15). Un profil refusé plus tôt (inscription, complétude, suspension) reçoit ce refus-là d'abord. Prévoir un message au support.
- Les tâches « justificatif » n'existent que pour les refus passés par la route (un appel direct à `apply_to_job` ne mémorise pas l'offre).
- L'échéance écran ouvert n'a été vérifiée en navigateur qu'avec une heure du serveur simulée (minuit UTC ne peut pas être attendu) ; la décision réelle reste celle de la base à la candidature.
- Modération admin (`app/admin/admin-dashboard-client.tsx`) : seul écran qui affiche encore l'ancien indicateur `urgency` (hors périmètre candidat et entreprise ; à aligner avec le lot commercial).
- Antérieur au lot : `tests/user-facing-claims.test.ts` peut dépasser 5 s sous charge (parcours du dépôt) ; il passe seul.


## 28. Suivi — Lot 10 : documentation, consignes, nettoyage, journaux, CSP et fiabilité des preuves (F-22, F-23, F-25, F-26, F-27, F-29, F-31) (2026-11-10)

Branche `chore/lot-10-maintenance-docs`, base `origin/main-dev` (31b6c55, lot 9d intégré : tête de `origin/main-dev` vérifiée avant création). **Réalisé et vérifié localement, non commité, non déployé.** Une migration : `20261110130000_suspended_admin_guard.sql` (admin suspendu, ci-dessous). Stash `lint-staged automatic backup` et pile de développement non modifiés.

### Documentation et consignes (F-22)

- **README** réécrit court : démarrage Windows/PowerShell, cible de chaque base, variables, architecture, tests, liens vers les procédures. Versions renvoyées à `package.json`.
- **`AGENTS.md`** : source unique des règles communes (réutilisation, textes FR/EN, clients Supabase typés, autorisations en base, Realtime privé, journaux, bases et tests). `.github/copilot-instructions.md` n'est plus qu'un renvoi ; `.github/instructions/*` (backend, base, interface) et `.github/agents/*` (4 agents) ne gardent que les règles de leur domaine. Retirés : Next 14, next-intl, next-pwa, Three.js, lottie, `src/app/[locale]`, `messages/*.json`, `DESIGN_REFERENCE.md`, `COPILOT_INSTRUCTIONS.md`, niveaux Sandbox, délais de paiement, pause automatique, outil `mcp__supabase` des agents. Liens, chemins, scripts `pnpm` et symboles cités vérifiés par script (seuls signalements : `packageManager`, `app/[locale]` cité comme inexistant, `pg_policies`).
- **`pnpm env:target`** (nouveau, `scripts/show-target.ts`) : base visée par `.env.local` et la session (développement, preuve, autre pile locale, projet distant, valeur d'exemple), présence des clés sans valeur, incohérence entre URL client et serveur.

### Parcours nouvel arrivant (copie isolée)

Vérifié dans une copie de travail hors dépôt (worktree temporaire, `project_id` `easyjob-newcomer`, ports 545xx) pour ne toucher ni la pile de développement ni la pile de preuve, en suivant le README sous PowerShell : `pnpm install`, `Copy-Item .env.example .env.local`, `pnpm env:target` (valeur d'exemple), `pnpm bootstrap:local` (298 s), `pnpm env:target`, `pnpm dev -p 3200`, `Invoke-RestMethod /api/categories`, connexion. Défauts trouvés et corrigés :

| Défaut | Correction |
|---|---|
| `bootstrap:local` générait les types vers `src/types/database.ts` (ancienne arborescence) : échec de la CLI en fin de script | Étape retirée (les types de référence sont `lib/database.types.ts`, régénérés depuis la pile de preuve et contrôlés par la CI) |
| `bootstrap:local` réécrivait `.env.local` sans prévenir | Copie préalable dans `.env.local.remote.bak` si `.env.local` visait un projet distant ; cible affichée après écriture |
| Le seed journalisait ses erreurs puis annonçait « Seed data created successfully » (code 0), y compris après `ECONNRESET` au premier passage | Étapes en échec listées, code de sortie 1 |
| Seed non rejouable : comparaison `u.phone === phone` alors que Supabase Auth renvoie le numéro sans `+` (constat du lot 8) | Comparaison normalisée ; une relance sur base remplie échoue désormais explicitement (8 étapes listées) au lieu de mentir ; le README indique de réinitialiser d'abord |
| Comptes du seed inutilisables : téléphone seul, alors que `/auth/login` est par email et mot de passe ; texte « connectez-vous avec ces numéros, code 123456 » faux | Email `seed-000N@easyjob.local` et mot de passe local (pile locale seulement, contrôle `isLocalUrl` existant), `phone_verified` posé ; connexion vérifiée : candidat `/jobs` 200, entreprise `/company/dashboard` 200, `/api/user` avec le bon rôle |
| `pnpm bootstrap:local -- --skip-seed` (README) : pnpm 11 transmet `--` au script | README : `pnpm bootstrap:local --skip-seed` |
| `Start-Process pnpm` (procédure des preuves) : « n'est pas une application Win32 valide » (PowerShell choisit le script sans extension) | `Start-Process pnpm.cmd … -PassThru` et arrêt par `taskkill /t` |

Pile isolée arrêtée et supprimée (`supabase stop --no-backup`) ; worktree temporaire conservé hors dépôt (`%TEMP%\easyjob-newcomer`, à supprimer par `git worktree remove`).

### Nettoyage (F-26, F-27, F-29)

Chaque élément revérifié sur le HEAD (imports, scripts, routes, configuration, migrations, CI, documentation) :

| Élément | Constat | Décision |
|---|---|---|
| `database.types.ts` racine | Absent | Déjà retiré au lot 5 |
| `enforce_salary_lock` (F-26), ancien salaire journalier | Trigger et `prevent_salary_modification()` supprimés par `20261107120000_mission_pay_per_candidate.sql` ; aucun trigger `*salary*` sur la pile | Déjà résolu au lot 7c-bis |
| `lib/payments/mobile-money.ts` | Importé nulle part ; implémente des **retraits** (hors MVP) ; journalisait la requête avec le numéro (`[v0] … Sandbox Payment`) | **Supprimé** ; variables `MOBILE_MONEY_SANDBOX`, `MTN_MOMO_*`, `ORANGE_MONEY_*` retirées de `.env.example`, du README, de la CI et de la procédure (plus aucun lecteur). Le futur lot paiement choisira son fournisseur ; l'ancien code reste dans l'historique Git |
| `/api/payments/withdraw` | Répondait toujours 410 (et renvoyait le corps reçu) ; aucun appelant trouvé dans le dépôt (écrans, scripts, documentation, configuration Vercel). Un client externe authentifié n'est pas exclu par la session exigée, mais ne pouvait obtenir que ce 410 | **Supprimée** (404 au lieu de 410) |
| `public/manifest.json` | Identique à `app/manifest.ts` ; plus lié par la page depuis juin 2026 (`898cb0e`) ; les navigateurs lisent le manifeste lié par la page | **Supprimé** |
| `next-intl` | Installé, jamais importé, aucun plugin dans `next.config.ts` | **Retiré** (`pnpm remove`, arbre de dépendances seul) |
| `ts-node` | Aucun script ni configuration ne l'utilise (scripts en `tsx`) | **Retiré** |
| `lib/types.ts` / `lib/types/index.ts` | Pas un doublon : `lib/types.ts` réexporte les plans | Conservés ; exports morts retirés (`OTPCode`, `ApiResponse`, `SignUpFormData`, `OTPVerifyFormData`, `NavItem`, `User`, `CandidateProfile`, `CompanyProfile`, `PAYMENT_DELAY_RULES`, `CANCELLATION_PENALTY_RULES`) |
| `computePaymentDelayMode` | Plus appelé (§24) | **Supprimé** |
| `_ensureUserAndProfile`, `updateReliabilityScore` (F-36) | Absents | Déjà retirés (lots 1 et 9b) |
| `handle_new_user()` | Neutralisée au lot 1 (rôle en liste blanche, `EXECUTE` réservé à `service_role`), rattachée à aucun trigger dans les migrations | **Conservée** : un trigger distant sur `auth.users` en dépendrait et un `drop function` ferait échouer `db push`. Lot 0 : vérifier `pg_trigger` sur `auth.users`, puis supprimer |
| Scripts `pwa:*` (`pwa-asset-generator`) | Outil manuel qui produit `public/icons` | Conservés (vulnérabilités de développement déjà notées au lot 3) |
| Rapport `security-report-2026-09-12.md` (F-29) | Ignoré par `.git/info/exclude` (local) ; jamais dans l'index ni dans l'historique (`git log --all`, stash compris) ; contenu non lu | Motif `/security-report-*.md` ajouté à `.gitignore` |

Migrations historiques inchangées.

### Journaux (F-23)

- Toutes les routes `app/api/**` et `lib/api/mission-route.ts` passent par `internalErrorResponse` / `logServerError` : admin (candidats, fiche candidat, identité, CNI, entreprises, MoMo, URL signées, justificatifs, demandes de mise à jour, modération), profil (disponibilités, documents, identité, Mobile Money, justificatifs), sélection, contrats, missions, tâches, onboarding entreprise, matching (préfixes `[v0]`), notifications. Codes métier et refus inchangés ; les 500 deviennent `{ error: "Internal server error", code, requestId }` (aucun écran ne lisait le texte `error`, vérifié ; l'onboarding entreprise garde ses codes `upload_failed`/`save_failed`).
- Erreurs silencieuses rendues visibles : la fiche candidat admin transformait une erreur de lecture en 404 ou en fiche partielle (désormais 500 journalisé) ; les 500 des routes profil n'étaient journalisés nulle part.
- Catégorie `storage` ajoutée ; `reason: "result_mismatch"` pour un résultat de RPC incohérent sans objet d'erreur.
- Test `tests/server-log.test.ts` : aucun `console.*` dans `app/api` ni `lib/api`.

### CSP (F-25, première étape)

`Content-Security-Policy-Report-Only` (`lib/security/csp.ts`, `next.config.ts`) et `POST /api/csp-report` (corps borné à 16 Kio par `readBodyWithLimit`, 10 rapports au plus, 204, exclu du Proxy, journal `security.csp_report` : directive, origine bloquée, chemin masqué ; jamais l'URL complète). Origines inventoriées : `'self'`, Supabase (HTTP et `ws`/`wss` Realtime, images et PDF signés), `nominatim.openstreetmap.org`, `blob:`, `data:`. Procédure de passage en mode appliqué : `docs/deployment/production.md` §7.

### Pages admin (F-31)

Deux pages lisaient en clé service en se fiant au seul layout : `/admin/dashboard` (noms d'entreprises) et `/admin/companies/[id]`. Le layout ne se réexécute pas à chaque navigation côté client : `requireAdminPage()` (`lib/auth/admin-page.ts`) contrôle désormais le rôle au point d'accès aux données (layout et ces deux pages). Les autres pages admin lisent en session (RLS) ou par les routes `/api/admin/*`, qui revérifient le rôle. Usages justifiés de la clé service (inventaire) : lectures admin agrégées de `users`/`company_profiles`/`missions` sans politique admin (`/api/admin/candidates`, `companies`, fiche candidat, réputation, noms d'entreprises du tableau de bord), URL signées du bucket privé, purge des fichiers CNI et justificatifs, signature de contrat avec IP observée (`sign_contract_observed`), quota EasyBot, photo de candidat pour l'entreprise, finalisation d'inscription et callback OAuth. Les mutations admin passent par des RPC en session (audit de l'administrateur réel).

### Fiabilité des preuves

**`job-moderation` bloquée pendant des heures (lot 9).** Cause reproduite : une coupure **pendant** une requête (`select pg_sleep(4)`, `docker pause` de la base de la pile de preuve 2 s après) laisse `supabase db query` en attente sans limite (toujours bloquée après 120 s). Une coupure avant la connexion échoue seule en 13 s. Les appels passaient par `cmd.exe` → `pnpm exec` → lanceur Node → binaire, sans `timeout`. Correction : `scripts/lib/db-query.ts` (binaire natif lancé sans shell, un seul processus, délai `PROOF_SQL_TIMEOUT_MS` de 60 s, erreur qui nomme la preuve et l'étape), utilisé par les 8 preuves qui interrogent Postgres ; runner : délai par preuve `PROOF_TIMEOUT_SECONDS` (600 s), arrêt de tout l'arbre de processus, synthèse avec code de sortie et dernière étape affichée. Aucune relance automatique, assertions inchangées.

**Restes d'une preuve interrompue (trouvé en provoquant la panne).** Une preuve interrompue ne pouvait pas exécuter son `finally` : triggers temporaires laissés (`proof_l6_slow_*`, relance en échec « already exists »), et surtout `trg_protect_contract_writes` (`contract-signing`) ou `trg_reputation_candidate_documents` (`reputation`) pouvaient rester **désactivés** sur la pile de preuve, ce qui aurait pu masquer une régression aux exécutions suivantes. Les quatre preuves concernées retirent leurs restes et réactivent ces triggers au démarrage.

**`user-facing-claims` au-delà de 5 s sous charge.** Le test relisait de façon synchrone environ 280 fichiers source quatre fois (lecture à froid : 233 ms par passage ; expressions régulières : 11 ms). Chaque fichier n'est plus lu qu'une fois : seul, 544 ms → 242 ms pour les trois tests concernés. Sous une charge CPU artificielle (32 workers), le test reste vers 1,5 s avant comme après : la famine CPU domine et le dépassement de 5 s n'a pas été reproduit. Délai par défaut de Vitest inchangé.

### Admin suspendu (vérification de suivi, 2026-11-10)

Scénario réel sur la pile `easyjob-proof`, intégré à la preuve `admin-centralization` (section I) et à `realtime` (B5b, B5c), donc exécuté en CI. X est un `admin_ops` connecté **avant** sa suspension ; son jeton n'est jamais renouvelé.

**Suspension.** Aucune session ne peut suspendre un admin : `admin_set_user_active` refuse (`cannot modify admin account`), la route aussi (403 `admin_modification`), et `users.is_active` est fermé en écriture de session (lot 1). La suspension d'un admin passe donc par la clé service (support, Studio) : c'est ainsi que la preuve suspend X, après avoir vérifié le refus depuis une seconde session `admin_ops` (I2).

**Constat avant correctif** (même scénario, I3 à I5 en échec) : avec son jeton initial, X suspendu lisait encore CNI et Mobile Money d'un candidat en lecture directe, créait une URL signée du bucket privé, **suspendait un candidat** par appel direct de `admin_set_user_active` (effet en base et ligne `audit_logs`), insérait une notification pour un tiers, obtenait 200 sur `/api/admin/candidates`, la fiche candidat, `/api/admin/companies` et l'URL signée de photo, et voyait les pages `/admin/dashboard` et `/admin/companies/[id]`. Seul le canal Realtime `admin` (`rt_session_is_active_admin`) et les RPC de contestation et de modération relisaient déjà `is_active`.

**Correctif, au niveau qui accorde l'accès.**
- Base, migration `20261110130000_suspended_admin_guard.sql` : `is_admin_user()` et `is_ops_admin_user()` exigent `is_active is not false` ; les deux politiques qui recopiaient le contrôle de rôle (`audit_logs_select_founder_only`, `cancellation_penalties_admin_select`) aussi. Toutes les politiques (tables et Storage) et RPC qui appellent ces fonctions en héritent. Inventaire des autres contrôles : `admin_open_review_contest`, `admin_resolve_review_contest`, `moderate_job`, `rt_session_is_active_admin` lisaient déjà `is_active` ; `admin_reputation_review_impacts` n'est accordée qu'à `service_role`.
- Application : les 19 lectures du grade de session des routes `/api/admin/*` et `requireAdminPage()` filtrent `is_active is not false` ; un compte suspendu n'a plus de grade et chaque garde existante le refuse. `tests/admin-guard.test.ts` impose ce filtre à toute nouvelle lecture du grade dans une route admin (contrôle négatif : filtre retiré d'une route → échec).
- Inchangé : lecture de ses propres données et `my_account_state` (I6) ; canal privé `user:<uid>`, par lequel arrive le signal de suspension (B5b).

| Accès testé (jeton initial de X) | Avant | Après |
|---|---|---|
| Lecture directe `candidate_profiles` (CNI, MoMo) d'un candidat | 1 ligne | 0 ligne |
| URL signée Storage `candidate-documents` | accordée | refusée |
| RPC `admin_set_user_active` sur un candidat | candidat suspendu, 1 audit | `not authorized: admin only`, candidat actif, 0 audit |
| Insertion `notifications` pour un tiers | 1 ligne | 42501, 0 ligne |
| `GET /api/admin/candidates`, fiche candidat, `/api/admin/companies`, URL signée de photo | 200 (clé service) | 403 |
| Pages `/admin/dashboard`, `/admin/companies/[id]` | rendues | `NEXT_REDIRECT` vers `/`, sans données |
| Sa ligne `users`, `my_account_state` | lisibles | lisibles (`is_active: false`) |
| Canal Realtime `user:<uid>` / `admin` | — | signal `account` reçu / nouveau canal `admin` refusé (B5b) |
| Autre `admin_ops` actif pendant la suspension (I7) | — | lecture et route 200 |
| Réactivation, même jeton (I8, B5c) | — | lecture, URL signée, RPC, route, pages et canal `admin` rétablis |

Contrôles : migration appliquée par montée de version (`supabase migration up` sur la pile de preuve), types générés identiques ; `admin-centralization` 32/32 ; contrôle négatif (anciennes `is_admin_user` / `is_ops_admin_user` remises) : I3 et I4 en échec, code de sortie 1, migration réappliquée ; suite complète ci-dessous.

### Validation

| Contrôle | Résultat |
|---|---|
| Panne provoquée (procédure documentée : `PROOF_SQL_TIMEOUT_MS=15000`, `docker pause` 20 s après le départ de `job-moderation`) | ✅ échec en 271 s, I9 en échec, synthèse « dernière étape affichée : Error: supabase db query : … failed to connect to postgres », aucun processus `supabase` restant ; un trigger temporaire laissé, retiré par la relance, verte (1/1). Avant le correctif des restes : relance en échec (« trigger proof_l6_slow_job_delete already exists ») |
| Délai du runner (`PROOF_TIMEOUT_SECONDS=8`, `reputation`) | ✅ arrêt à 9 s, « délai de 8 s dépassé, processus arrêtés ; dernière étape affichée : ✅ R0 … », aucun processus restant, relance verte |
| `tests/proof-db-query.test.ts` | ✅ processus muet arrêté après le délai, étape nommée, processus vérifié mort ; code de sortie rendu sans reprise |
| Erreurs provoquées (trigger temporaire sur un compte fictif, message contenant un faux numéro ; application construite, pile de preuve) | ✅ 11/11 : Mobile Money, disponibilités, suspension admin → 500 `{ error: "Internal server error", code, requestId }` ; journaux `profile.payment.save`, `profile.availability.save`, `admin.candidates.set_active` avec `code: "23505"`, `category: "database"`, identifiant de requête ; ni numéro ni message brut dans la réponse ou les journaux ; 400 de validation, `self_modification` (403) et refus d'un candidat (403) inchangés |
| CSP, navigateur (Chrome headless 375 × 812, application construite, pile de preuve) | ✅ en-tête Report-Only seul ; connexion par le formulaire, WebSocket Realtime `ws://127.0.0.1:54421/realtime/v1/websocket`, photo envoyée puis affichée par URL signée : **aucune violation d'origine** (connect, img, frame, font, style). Violation volontaire (`fetch` tiers) : requête émise (rien n'est bloqué), rapport reçu, journal `{"directive":"connect-src","blocked":"https://tiers.example"}` sans le jeton de l'URL. **Seule violation réelle** : `script-src` `eval`, 45 fois, depuis un chunk qui contient Zod 4 (sonde `allowsEval` : `new Function("")` dans un `try/catch`, sans effet fonctionnel) |
| `pnpm test:rls`, pile `easyjob-proof`, build de la branche | ✅ 27/27 (passage après les correctifs du lot) ; **après la migration admin suspendu : ✅ 27/27**, dont `admin-centralization` 32/32 et `realtime` 56/56 (B5b, B5c). Un passage intermédiaire a été interrompu par un arrêt de Docker Desktop (pile injoignable : `realtime` arrêtée par le délai de 600 s après B5b, puis `HeadersTimeout` d'Auth) ; Docker redémarré, volumes intacts, suite rejouée en entier |
| `pnpm typecheck`, `pnpm exec eslint . --max-warnings=0`, `pnpm exec prettier --check .`, `pnpm test` (38 fichiers, 496 tests), `pnpm build` | ✅ |

Un premier passage de la suite (27/27) a visé par erreur un ancien `next start` du lot 9d resté sur le port 3100 (le nouveau serveur avait échoué en `EADDRINUSE`) ; il n'est pas compté. La procédure locale vérifie désormais que le serveur lancé est toujours en vie (`$app.HasExited`) — à faire aussi à la main : un port déjà occupé fait viser un ancien build.

### Statut de chaque constat

| ID | Statut | Prochaine action si ouvert |
|---|---|---|
| F-01, F-02, F-03 | Résolus (lot 1) | Déploiement ; lot 0 (comptes élevés) |
| F-04, F-05, F-06, F-11, F-17 | Résolus (lot 2) | Déploiement ; lot 0 (valeurs falsifiées) |
| F-07 | Résolu (lots 7b, 7c) | — |
| F-08, F-24 | Résolus (lot 3) | — |
| F-09 | Résolu (lot 6) | — |
| F-10 | Résolu sauf paiement (lots 7a à 7d) | Lot paiement (hors plan) |
| F-12, F-13, F-15, H-04 | Résolus (lot 8) | Vérifications fournisseur réel (SMS, Google, passerelle IA) |
| F-14 | Résolu (lot 5) | — |
| F-16 | Résolu (lot 7a) | — |
| F-18 | Résolu (lots 2b, 9) | Écrans hors parcours (§24) |
| F-19 | Partiel (lot 9) | Avantages d'abonnement non livrés : lot Free/Premium |
| F-20 | CI résolue (lot 4) ; déploiement préparé (lot 4b) | Validation à distance ; sauvegarde avant les premiers utilisateurs |
| F-21 | Résolu (lots 4, 7) | — |
| **F-22** | **Corrigé ici** | — |
| **F-23** | **Corrigé ici côté journaux** | Outil de capture d'erreurs et alertes, si les journaux Vercel ne suffisent pas |
| **F-25** | **Première étape faite ici** | Observer les rapports en production ; `z.config({ jitless: true })` côté client pour supprimer les rapports `eval` de Zod ; passer en `Content-Security-Policy` ; nonces ensuite |
| **F-26** | Résolu au lot 7c-bis (vérifié ici) | — |
| **F-27** | **Corrigé ici** (avec lots 5 et 9b) | `handle_new_user()` : lot 0 puis suppression |
| F-28 | Partiel (lot 9) | Écrans hors parcours au fil des lots fonctionnels |
| **F-29** | **Clos ici** | — |
| F-30 | Partie mission résolue (lot 7c) | Autres écrans de dates |
| **F-31** | **Corrigé ici**, y compris l'admin suspendu (migration `20261110130000`, routes et pages) | Lot 0 : compter les admins suspendus en production avant la migration |
| F-32, F-33 | Résolus (lots 1, 4) | — |
| F-34, F-35 | Résolus (lot 2) | — |
| F-36 | Résolu (lot 9b) | — |
| F-37 | Ouvert | `ON DELETE` de `selected_by` / `requested_by` : lot suppression de compte (données personnelles) |
| F-38, F-39, F-40 | Résolus (lot 2b) | — |
| F-41 | Résolu (lot 5b) | Validation administrative des entreprises : prochain lot produit |
| F-42, F-43 | Résolus (lot 8) | — |
| F-44 | Résolu par refus par défaut (lot 8) | Lot 0 : `phone_autoconfirm: false` en production |
| H-01, H-02, H-03, H-05, H-06 | Ouvertes | Lot 0 (lecture seule) |

### Constats pendant le lot

- **Bouton Google non monté** : `components/auth/oauth-buttons.tsx` n'est rendu par aucune page ; la connexion Google n'est pas accessible depuis l'interface (le retour `/auth/callback` reste couvert par `oauth-callback`). Non modifié : décision produit (réafficher sur l'inscription ou retirer).
- **Contournement du layout admin non démontré** : une requête RSC de candidat sur `/admin/dashboard` et `/admin/candidates`, avec un arbre de routeur déclarant le layout déjà rendu, a reçu une redirection (307) dans les deux cas. La garde ajoutée suit la consigne de Next.js (contrôle au point d'accès aux données) ; l'exposition réelle avant correctif n'est pas prouvée.
- **Admin suspendu** : constaté puis corrigé (section « Admin suspendu » ci-dessus). Aucune session ne peut suspendre un admin : seule la clé service le permet.

### Limites

- Aperçu `blob:` de la photo non observé au navigateur (l'écran qui l'utilise, `/profile/candidate`, redirige un profil incomplet vers l'édition, qui envoie directement) ; l'origine est autorisée.
- Rapports CSP en production non observés ; preview Vercel : le script `vercel.live` sera signalé.
- Appareils Android et iOS réels non testés.

## 29. Suivi — Lot 11 : dossier entreprise vérifié par EasyJob (RCCM, NIU, représentant) (2026-11-11)

Branche `feat/lot-11-company-verification`, créée depuis `origin/main-dev` (1e63198 : lot 10 et migration `20261110130000_suspended_admin_guard.sql` présents). Non commité, non déployé. Suite de F-41 (lots 5b, 6). Première version (revue du RCCM seul) étendue après la décision produit du 2026-11-11 : **au lancement, seules les entreprises au dossier vérifié publient** ; particuliers et professionnels non formalisés reportés (PLAN_ACTION.md, non commencé). Règle produit : SRS §6.3.1.

### Dossier exigé et contrôles

| Élément | Pièces et champs | Contrôle manuel (admin_ops, admin_founder actifs) | Sources admises |
|---|---|---|---|
| RCCM | numéro, document | numéro et raison sociale | registre officiel accessible, greffe compétent |
| NIU | numéro (inscription ; correction par le support), attestation | correspondance avec l'entreprise auprès de la DGI ; un fichier ou un format valide ne suffit pas | service en ligne DGI, centre des impôts |
| Représentant | nom, fonction, pièce d'identité, habilitation (dirigeant mentionné ou mandat + document) | identité et habilitation | dirigeant mentionné dans les justificatifs, mandat |

La vérification CNI des candidats n'est pas réutilisée : autre compte, autre table, autre parcours. Chaque contrôle est enregistré dans `company_verification_checks` (ajout seul, UPDATE refusé) : décision (`approved`, `rejected`, `unverifiable`), version de l'élément et du dossier, source, référence ou note interne, motif communiqué (refus), auteur et grade, date. « Vérification impossible » laisse le dossier en attente. Aucune intégration externe simulée, aucun scraping, aucune validation par EasyBot : la base enregistre ce que l'admin déclare avoir constaté.

### Droits réellement appliqués

| Acteur | Dossier et pièces | Historique des contrôles | Contrôler, décider | Soumettre, corriger |
|---|---|---|---|---|
| Entreprise propriétaire | sa ligne en session ; ses fichiers (Storage du lot 5b) | état et motifs par `my_company_verification()` ; table illisible (42501), jamais la note interne ni l'auteur | non (`forbidden` ; 42501 sur les colonnes de revue, `niu`, `niu_verified`, versions, historique) | oui (onboarding, `submit_company_verification`) ; NIU par le support |
| Entreprise tierce | non (0 ligne, route 403, Storage refusé) | non | non | — |
| `admin_support` actif | fiche et URL signées (60 s) | lecture | non (403 `forbidden`) | — |
| `admin_ops`, `admin_founder` actifs | oui | oui | oui, sur la version lue | — |
| Admin suspendu (ancien jeton) | non (403, Storage refusé) | non | non | — |
| Anonyme | non (401) | non | non | non |

Mécanisme (migration `20261111120000_company_verification_review.sql`, non déployée, complétée sur place) :

- **Versions** : `rccm_revision`, `niu_revision`, `representative_revision` et `verification_revision`, augmentées par le trigger de protection pour **tout auteur** (session, clé service, support). Dépendances (prouvées par `company-dossier-visibility` D1) : raison sociale ou nom légal → **RCCM, NIU et représentant** (l'identité de l'entreprise doit correspondre au registre, à la DGI et à l'habilitation) ; numéro ou document RCCM → RCCM et représentant (dirigeant vérifié sur l'immatriculation) ; NIU ou attestation → NIU (`niu_verified := false`) ; champs et pièces du représentant → représentant ; autres champs → aucun. Le NIU reste en lecture seule pour l'entreprise. Une entreprise vérifiée qui modifie un élément contrôlé repasse en revue et retourne dans la file. L'historique n'est jamais effacé : un contrôle ne vaut que pour la version courante de son élément.
- **Concurrence** : verrou de ligne ; décision finale sur la version lue (`company_changed`) ; contrôle sur la dernière décision vue de cet élément (`check_changed`) ; seconde décision finale `company_not_pending`.
- **Décision finale** (`admin_review_company`) : trois contrôles approuvés sur les versions courantes et pièces présentes (`checks_incomplete`, `dossier_incomplete`) ; état, notification (« Dossier vérifié par EasyJob » ou correction avec motif) et `audit_logs` (identifiants des contrôles retenus, sans motif, référence, numéro ni chemin) dans la même transaction.
- **Droit de publier** : `company_verification_complete()` (statut, trois contrôles valides, pièces, compte et entreprise actifs, rôle entreprise) remplace le seul test du statut dans `create_job`, `update_job` et `moderate_job` (reprises à l'identique pour le reste). Non exécutable en session.
- **Pièces** : quatre fichiers via `PUT /api/company/onboarding` (préfixes `rccm-`, `niu-`, `rep-id-`, `mandate-`), dossier `<user_id>/` imposé par le trigger, ancienne pièce supprimée après remplacement. URL signée par `GET /api/admin/companies/[id]/document-url?doc=…` créée en session (politique Storage `is_admin_user`). Aucun chemin, numéro, NIU, nom du représentant, URL signée ou note interne dans les réponses non autorisées, les journaux, les notifications ou les signaux (preuve B5, D5, E1, H1 ; journaux du serveur relus après la suite complète : seules les pannes provoquées H1, avec `op` et `code`).
- **Realtime** : nouveau trigger sur l'historique (`rt_signal_users` + `rt_signal_admin`, domaine `profile`, charge `{ d, r }`) ; signaux existants inchangés.
- **Étoiles** : calcul inchangé (`reputation` verte ; la fixture de dossier n'est pas utilisée par cette preuve).

### Offres d'une entreprise qui perd la validation du dossier (décision produit du 2026-11-11)

Migration `20261111130000_company_dossier_visibility.sql` (non déployée). Le statut métier de l'offre n'est jamais modifié (ni `cancelled`, ni `rejected`, ni suppression) : visibilité et disponibilité sont **calculées** à partir du dossier.

- `company_dossier_valid(company_id)` : statut `verified`, pièces présentes, trois contrôles approuvés sur les versions courantes. Ne lit ni `users.is_active` ni `company_profiles.is_active` : les règles de suspension sont inchangées. `company_verification_complete()` = dossier valide + comptes actifs (droit de publier).
- **Lecture** (politique « Published jobs are viewable by all ») : une offre active n'est lisible que si le dossier est valide, ou par un candidat qui y a déjà postulé (`candidate_applied_to_job`, fonction `SECURITY DEFINER` pour éviter la récursion entre les politiques de `jobs` et `job_applications`). Entreprise propriétaire et admins inchangés. Toutes les lectures d'offres de l'application passent par la session (liste, détail, matching) : la règle couvre routes, pages et lectures PostgREST directes. Lien direct : `job_availability()` renvoie `unavailable` sans aucune donnée ; la page affiche « Offre indisponible ».
- **Candidature** : `apply_to_job` verrouille l'offre puis la ligne entreprise (`FOR SHARE`) et refuse `job_not_available`. **Sélection** : `select_candidate` (candidature, offre `FOR UPDATE`, puis entreprise `FOR SHARE`) refuse `company_not_verified`, **après** la relance idempotente d'une sélection déjà réussie (même mission, même contrat). Aucune remise en revue ne verrouille d'offre : pas de cycle.
- **Conservé** : candidatures existantes lisibles (candidat, entreprise, admin), retrait selon les règles existantes, contrats (consultation, signature), missions (début, code de fin), avis. Aucune RPC de mission ou de contrat n'est modifiée.
- **Realtime** : trigger `trg_rt_company_dossier` (`AFTER UPDATE … WHEN` le statut du dossier change réellement ; un `UPDATE OF verification_status` ne se déclenchait pas, le statut étant changé par le trigger `BEFORE` du lot 5b) → `jobs:public`, candidats ayant postulé et entreprise (domaine `jobs`, charge `{ d, r }`).
- **Écrans** : l'offre quitte la liste ouverte ; un détail ouvert affiche « Offre indisponible » (nouveau candidat) ou un avis « n'accepte plus de nouvelles candidatures » (candidat ayant postulé, retrait conservé) ; côté entreprise, « Sélectionner » est remplacé par l'explication, et la carte du dossier indique que les offres sont masquées aux nouveaux candidats.
- **Retour après validation (décision validée le 2026-11-11)** : retour automatique, sans nouvelle modération, des seules offres encore admissibles. Le SQL n'a pas eu à changer : la lecture publique exige `status = 'active'` (une offre annulée, expirée, refusée, pourvue ou en `pending_review` ne revient pas) ; `apply_to_job` et `select_candidate` refusent une offre pleine (`no_positions`) ; `update_job` renvoie toute offre active modifiée en `pending_review` et refuse la modification après une sélection (`job_has_selected_candidates`), donc une ancienne approbation n'est jamais réutilisée et les conditions figées des contrats ne bougent pas ; la suspension garde ses propres refus (`account_suspended`). Prouvé par B1 à B7 et par le parcours navigateur (retour sans rechargement : liste, détail ouvert, avis retiré, « Sélectionner » rétabli).
- **Mesures rapportées sans nouvelle règle** : (1) une offre `active` dont la date est passée reste absente de la liste (seule règle de date existante), mais le lien direct la montre et une candidature est acceptée — comportement antérieur au lot 11 pour toute entreprise validée, la base n'ayant aucune règle d'expiration (statut `expired` jamais posé) ; (2) une offre d'un compte suspendu au dossier valide reste visible — règles de suspension inchangées, comme demandé.

### Reprise des anciens dossiers

Section 9 de la migration : toute entreprise `verified` (ou `niu_verified = true`) repasse en `pending` non soumise et `niu_verified = false` ; l'état précédent est conservé dans `audit_logs` (`legacy_company_verification_reset`, acteur `system`). Elle complète son dossier puis le soumet. Les refus antérieurs exigent une modification avant resoumission. Prouvé en rejouant la section telle quelle (K1). Requêtes de comptage avant déploiement : PLAN_ACTION.md, lot 11.

### Écrans

- **Entreprise** (FR/EN, 375 px) : carte d'état sur le tableau de bord, le profil, l'onboarding et **dès l'entrée de la création d'offre** : état global, contrôle par contrôle (vérifié, à corriger avec motif, en attente), pièces manquantes, « Compléter » ou « Corriger mon dossier » (ouvre l'étape Documents). Onboarding : attestation NIU, représentant (nom, fonction, habilitation, pièce d'identité, mandat si besoin), boutons « Envoyer mon dossier », « Soumettre à nouveau », « Enregistrer ».
- **Admin** : file « À examiner » ; fiche en trois sections (RCCM, NIU, représentant) avec champs, pièces (PDF ou image par URL signée), consigne de source officielle, formulaire de contrôle (décision, source, référence interne, motif), historique (auteur, date, source, version précédente) ; décision finale. Si la version du dossier ou un contrôle change : bandeau, aperçu masqué, décisions retirées jusqu'à « Relire le dossier ». `admin_support` en lecture seule.
- **Mises à jour sans rechargement** : clés `profile`, `account` (entreprise), `admin:profile` (admin).

### Validation (pile `easyjob-proof`, données fictives)

| Contrôle | Résultat |
|---|---|
| Preuve `company-verification` | ✅ 36/36 : dépôt incomplet puis complet (A1-A4) ; consultation autorisée et refusée, vrais PDF de 2 et 3 pages servis par URL signée, Storage et historique directs refusés (B1-B6) ; auto-validation par RPC, colonnes, historique et routes, tiers, `admin_support`, admin suspendu avec son ancien jeton, saisies invalides, sans aucun effet (C1-C5) ; approbation refusée avec le RCCM seul, le NIU « vérification impossible », le NIU refusé (D2-D4) ; signaux `{ d, r }` (D5) ; correction, seconde décision, resoumission sans puis avec changement (E1-E4) ; pièce remplacée pendant la revue → éléments invalidés, décision sur l'ancienne version refusée, historique conservé (F1) ; trois enregistrements simultanés d'un contrôle → un seul (F2) ; panne en milieu de transaction (H1) ; quatre décisions finales simultanées → une seule (G1) ; approbation, création (201) et publication (I1-I2) ; dossier invalidé après création : approbation d'offre refusée sans trace, création et modification refusées par RPC directe et route, offre active non modifiée, statut forcé sans contrôle refusé, NIU modifié par le support → décertifié (J1-J4) ; reprise (K1) |
| Contrôles négatifs (copies modifiées des fonctions, restaurées ensuite) | ✅ droit de publier réduit au statut : J3 en échec ; décision finale sans les trois contrôles : 6 échecs (D2-D4, E1, E3, E4) ; contrôle sans `check_changed` : F2 en échec ; code de sortie 1 ; après restauration 36/36 |
| Preuves adaptées | `company-permissions` 46/46 (E1, E2 : colonnes et RPC du lot ; G2 : statut forcé en clé service → publication refusée ; H2 : raison sociale modifiée → NIU décertifié) ; `job-moderation`, `candidate-selection`, `contract-signing`, `mission-time-tracking`, `realtime` vertes avec la fixture `scripts/lib/verified-company.ts` ; `reputation` verte sans changement |
| Preuve `company-dossier-visibility`, retour après validation (B1-B7, P0) | ✅ 26/26 au total : offre active inchangée de retour avec signal `jobs:public`, candidature et sélection rétablies (B1) ; offres annulée et expirée pendant la revue toujours invisibles et fermées, offre pleine refusée (B2) ; offre datée d'hier absente de la liste (B3, mesure du lien direct rapportée) ; offre modifiée en `pending_review` toujours non publique, approbation sur version ancienne refusée (B4), publiée seulement après nouvelle modération (B5) ; contrat existant identique, modification après sélection refusée (B6) ; compte suspendu puis dossier revalidé : sélection et création toujours refusées (B7) |
| Preuve `company-dossier-visibility` (vraies sessions : entreprise, 5 candidats, admin, anonyme) | ✅ 19/19 (première version) : entreprise validée, offre visible, candidature et sélection (V1-V2) ; remise en revue par l'entreprise, statut de l'offre inchangé (M0) ; liste, route, page, lecture directe refusées au nouveau candidat et à l'anonyme, lien direct « indisponible » sans donnée (M1) ; candidature (RPC, route) et sélection (route, RPC) refusées sans effet (M2-M3) ; relance d'une sélection réussie sans nouvel engagement (M4) ; candidature existante lisible, entreprise et admin conservés (M5-M6) ; contrat signé, mission démarrée, code de fin et avis des deux parties (M7) ; retrait (M8) ; signaux `jobs:public`, candidat et entreprise (M9) ; retour automatique observé (B1) ; quatre courses à ordre imposé (R1-R4) ; dépendances entre contrôles, NIU en lecture seule, historique conservé, décision sur ancienne version refusée (D1-D2) |
| Contrôles négatifs (visibilité) | ✅ ancienne politique de lecture remise : M1 en échec ; contrôle du dossier retiré de `apply_to_job` : 5 échecs (M2, M3, M4, M6, R2) ; verrou partagé retiré de `select_candidate` : R4 en échec (sélection acceptée pendant la remise en revue) ; code de sortie 1 ; restauration 19/19 |
| `job-moderation` I9-I10 (ordre imposé) | ✅ I9 fiabilisée : la seconde opération ne part qu'après avoir **observé** la première en attente dans son trigger (`scripts/lib/proof-barrier.ts`, `pg_stat_activity`), sans délai fixe ni relance. Cause réelle trouvée au passage : les appels `supabase-js` sont paresseux (la RPC de sélection ne partait qu'au `Promise.all`) ; ils sont désormais lancés explicitement. 67/67 |
| Preuves plus anciennes adaptées (visibilité) | `business-permissions`, `jobs-rls-select`, `essentials-gate` et `reputation` créaient des entreprises au statut seul (parfois non vérifiées) dont les offres actives restaient lisibles et ouvertes : premier passage de la suite 25/29 (offres masquées, `job_not_available`), conforme à la décision. Fixture `verified-company.ts` ajoutée ; `reputation` ne l'applique qu'aux entreprises au profil complet (critère « RCCM ou NIU » des étoiles inchangé) ; 4/4 |
| `pnpm test:rls` complet après les migrations de visibilité (pile réinitialisée depuis les seules migrations, types identiques) | ✅ 29/29 au second passage (premier passage 25/29 : les quatre preuves adaptées ci-dessus). Parcours navigateur « dossier complet » rejoué : 30/30 (attente d'un renommage alignée : RCCM, NIU et représentant en attente). Un passage s'est arrêté au contrôle 18 sur une attente d'onglet en arrière-plan (interrogation par `requestAnimationFrame`, suspendue hors premier plan) ; attentes passées en interrogation périodique, deux passages 30/30. Journaux du serveur relus : aucun chemin, numéro, référence interne ni jeton |
| Navigateur : remise en revue en trois sessions (entreprise, nouveau candidat, candidat ayant postulé), 375 px, FR puis EN | ✅ 20/20 (dont retour sans rechargement : offre dans la liste, détail ouvert réaffiché avec « Postuler », avis retiré, « Sélectionner » rétabli) ; première version 17/17 : renommage depuis l'onboarding → dossier en revue ; sans rechargement, l'offre quitte la liste, le détail ouvert affiche « Offre indisponible » sans contenu, le candidat ayant postulé garde l'offre avec l'avis et son retrait, « Sélectionner » disparaît côté entreprise avec l'explication, la carte entreprise signale les offres masquées ; EN (« Job unavailable », « not accepting new applications ») ; aucun défilement horizontal ; nouvelle validation → l'offre revient (comportement actuel) ; aucune erreur de page |
| `pnpm test:rls` complet (première version du lot) | ✅ 28/28 au second passage. Premier passage 27/28 : `job-moderation` I9 (ordre forcé suppression puis sélection, route HTTP contre RPC à 400 ms d'écart) a vu la sélection gagner, avec un état cohérent (offre et candidature intactes) ; rejouée seule deux fois : 67/67. Aléa de minutage préexistant, sans lien avec le dossier (`delete_job` ne le lit pas), non masqué par une relance automatique. Après réinitialisation de la pile depuis les seules migrations : types identiques, `company-verification` 36/36, `company-permissions` 46/46, `company-onboarding` 19/19, `job-moderation` 67/67, navigateur 30/30 |
| Navigateur : Chrome headless, deux contextes (entreprise 375 × 812, admin 1280 px), build servi sur la pile de preuve | ✅ 30/30 : onboarding par l'interface avec quatre pièces (vrais PDF), dossier signalé dès l'entrée de la création d'offre, file admin, **PDF de 3 pages affiché** dans la fiche (`application/pdf`, « page 1/3 »), contrôles RCCM validé et NIU refusé reçus sans rechargement côté entreprise, approbation impossible tant que les trois contrôles ne sont pas validés, correction demandée, nouvelle attestation NIU et « Soumettre à nouveau », bandeau « dossier modifié » + aperçu masqué + contrôles désactivés sur la fiche restée ouverte, relecture, validations, « Dossier vérifié par EasyJob » reçu sans rechargement, création et publication d'une offre, mêmes écrans en EN (renommage → RCCM, NIU et représentant en attente ; blocage à l'entrée de la création d'offre), aucun défilement horizontal à 375 px, aucune erreur de page |
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .`, `pnpm test` (40 fichiers, 512 tests), `pnpm build` | ✅ |
| Types générés (`supabase gen types` sur la pile de preuve) | ✅ régénérés (table d'historique, 13 colonnes, RPC du dossier, `company_dossier_valid`, `candidate_applied_to_job`, `job_availability`) ; identiques après réinitialisation de la pile |

Écart de procédure : un ancien `next start` du lot 10 occupe toujours le port 3100 ; un passage a de nouveau visé cet ancien build (routes du lot en 404) et n'est pas compté. Les passages comptés utilisent un build servi sur le port 3101, après vérification que ce serveur est bien celui lancé (« Ready », route du lot présente).

### Ce qui n'est pas prouvé

- **Vérifications réelles auprès de la DGI, du registre ou du greffe** : non testées et non testables par fixtures locales. La preuve établit que la base exige une source et une référence déclarées par un admin habilité, et refuse toute approbation sans les trois contrôles ; la justesse du contrôle lui-même relève de la procédure de l'équipe.
- Envoi de pièces d'identité réelles, appareils Android et iOS réels, rapports CSP en production.
- Message de blocage du formulaire d'offre à la dernière étape (inchangé) : la création et la publication sont prouvées par route et RPC.

### Décisions restantes

Décisions prises (2026-11-11) :

- **Retour automatique** des offres encore admissibles après validation complète, sans nouvelle modération si leur contenu approuvé n'a pas changé : validé et vérifié (ci-dessus).
- **Correction du NIU** réservée au support : décision confirmée (règle du lot 5b conservée).
- **Source officielle inaccessible** : dossier en attente, aucune approbation automatique (appliqué : « vérification impossible »).

Restant à cadrer :

1. **Procédure de relance** quand la DGI ou le greffe restent inaccessibles : délai, relance, information de l'entreprise.
2. **Conservation des pièces** (pièces d'identité, pièces remplacées) : durée, suppression à la fermeture du compte (F-37) — avant l'ouverture publique.
3. ~~**Expiration des offres datées**~~ : traité par le lot 11b (§30), échéance de recrutement H−24 / H−2 en base.
5. Reprise : prévenir les entreprises vérifiées avant le déploiement (pièces à ajouter).


## 30. Suivi — Lot 11b : échéances de candidature et de sélection (2026-11-11)

Branche `fix/lot-11b-job-deadlines` (base `origin/main-dev`, 891ef2b, lot 11 intégré), **non commitée, non déployée**. Migration `20261112120000_job_recruitment_deadlines.sql`. Règle produit : SRS §5.4.

### Inventaire avant le lot

| Élément | Rôle constaté |
|---|---|
| `jobs.urgency` | Ancienne option manuelle fournie par le client, plus lue depuis le lot 9d. Ne détermine rien dans ce lot (preuve F4). |
| Badge « Urgente » | Calculé à l'affichage (`lib/jobs/urgency.ts`, début dans 24 h ou moins). Proximité du début, indépendante du régime. |
| `jobs.published_at` | Remis à null par `update_job`, réécrit à chaque approbation : ne garde pas la première publication. |
| `jobs.expires_at`, statut `expired` | Jamais renseignés. |
| Liste des offres | Filtrait `start_date >= date du jour UTC du serveur` ; le lien direct restait ouvert aux candidatures (écart mesuré au lot 11, B3). |

### Source de vérité

- Colonnes `first_published_at`, `publication_regime` (`normal` | `urgent`), `applications_close_at` (contrainte « toutes ou aucune ») et `legacy_publication` (offre publiée avant le lot). Aucun privilège d'écriture des sessions sur `jobs` (lot 2) ; `create_job` et `update_job` refusent les champs de publication (`invalid_job_data`, détail `publication`).
- Trigger `trg_job_publication_guard` (tout auteur, clé service comprise) :
  - au premier passage à `active` depuis `draft` / `pending_review`, déduit le régime de `now()` et de l'horaire approuvé (`job_publication_regime`), fige la première publication et stocke l'échéance (`job_recruitment_close` : H−24 ou H−2) ; hors fenêtre, `job_start_too_close` ;
  - ensuite, **échéance figée** : première publication, régime, échéance et marqueur `legacy_publication` ne changent plus (`publication_regime_locked`), dates et horaires non plus (`job_schedule_locked`) ; une nouvelle approbation après correction ne recalcule rien ;
  - une offre déjà active (places, retour après revalidation du dossier) ou réactivée depuis un autre statut n'est pas republiée ; une offre `legacy_publication` ne reçoit jamais de régime.
- `update_job` : offre publiée (ou antérieure au lot) → mêmes dates et horaires acceptés (fin absente = jour du début, comme le formulaire), tout changement refusé `job_schedule_locked` ; autres champs validés et offre renvoyée en modération (règles existantes : Pro et Business pour une offre active, sans candidat sélectionné). Offre jamais publiée → dates modifiables, début encore publiable exigé (`job_start_too_close`).
- Insertion « déjà publiée » par la clé service (seed, preuves) : acceptée seulement si les trois valeurs sont fournies.

### Contrôles

- `apply_to_job` et `select_candidate` : `now() >= applications_close_at` (ou échéance absente) → `recruitment_closed`, après les contrôles existants de compte, documents, statut et dossier, avant la capacité. Sélection : après la relance idempotente. Verrous et ordre inchangés (offre puis entreprise).
- `moderate_job` : `job_start_too_close` à la première publication seulement ; `create_job` : idem dès la saisie.
- `job_availability` : nouvelle valeur `closed` (offre lisible, recrutement clos). Champ calculé PostgREST `recruitment_open(jobs)` pour les listes (`/api/jobs`, suggestions `/api/matching`), à l'heure de la base.
- `now()` est l'heure de début de la transaction : une requête reçue avant l'échéance mais bloquée par un verrou est jugée à son heure d'arrivée.

### Écrans

Minuterie locale calée sur l'heure du serveur (`lib/jobs/use-recruitment.ts`), sans relecture HTTP périodique ; retour au premier plan et reconnexion relisent par `useLiveRefresh`.
- Liste candidat : l'offre disparaît à l'échéance.
- Détail : « Candidatures jusqu'au … » ; à l'échéance, « Les candidatures pour cette offre sont closes » et « Voir les autres offres » (candidat ayant postulé : candidature consultable). Le badge « Urgente » reste affiché indépendamment.
- Entreprise (candidatures) : échéance affichée ; à l'échéance, « Sélectionner » remplacé par l'explication, rejet et engagements conservés.
- Formulaire de correction : après publication, date et horaires en lecture seule, explication et lien « Créer une nouvelle offre » ; les autres étapes restent modifiables. Le formulaire renvoie les valeurs publiées ; la route de modification utilise `jobUpdateSchema` (date publiée renvoyée même passée). Un écran ouvert avant la publication reçoit `job_schedule_locked`, affiché en message métier.
- Codes traduits FR/EN : `recruitment_closed`, `job_start_too_close`, `job_schedule_locked`.

### Données existantes (décision validée)

Aucune date de première publication fiable : `published_at` est réécrit, et l'horaire approuvé à la première approbation n'est pas tracé (`audit_logs` ne le contient pas). **Rien n'est repris, inventé ni republié.** La migration marque `legacy_publication` les offres déjà publiées (statut publié ou passé, `published_at`, ou approbation tracée dans `audit_logs`) : elles restent lisibles mais closes, dates et horaires figés, même après une correction approuvée ; engagements conservés. La migration affiche leur nombre. Le seed de développement démarre ses offres à J+3. Aucune base distante n'est touchée ni réinitialisée.

### Validation (pile `easyjob-proof`, données fictives)

| Contrôle | Résultat |
|---|---|
| Preuve `job-deadlines` (sessions réelles : entreprise Pro, 6 candidats, 2 admins ops, anonyme) | ✅ 35/35 : régimes à la première publication (R0) ; candidature et sélection à H−24 / H−2 juste avant, exactement, juste après, sans effet après refus (N1-N6, U1-U6) ; publication à H−24 + 1 µs, exactement H−24, H−24 − 1 µs, H−4, H−4 − 1 µs, début passé par RPC, route et écriture de service (P1-P7) ; liste, lien direct et disponibilité d'une offre close, offre commencée (L1-L3) ; badge sans prolongation (G1) ; revalidation sans réouverture (V1-V2) ; relance de sélection, contrat signable, retrait, statuts inchangés (S1-S3) ; champs forgés, régime figé pour la clé service, saisie trop proche, ancienne option `urgency` (F1-F4) ; **horaires figés** : modifiables avant publication (D1), refusés après par RPC sur offres normales et urgentes, ouvertes et closes (D2), par route et clé service (D3), mêmes valeurs acceptées avec une autre correction (D4), offre revenue en modération (D5), nouvelle approbation sans changement temporel (D6), offre close repoussée avec candidatures et offre avec contrat (D7), revalidation du dossier (D8), offre antérieure au lot (D9) ; double approbation à ordre imposé, relances et candidatures simultanées (R1-R3) |
| Méthode des limites | Fonction de preuve temporaire `proof_l11b_case` (clé service) : place l'échéance ou le début relativement à `now()` puis appelle la vraie RPC sous l'identité de la session dans la même transaction ; instants exacts à la microseconde, sans attente. Pour une offre publiée, le trigger de garde est désactivé le temps du seul déplacement, dans cette transaction (pile jetable) |
| Contrôles négatifs | ✅ `apply_to_job` et `select_candidate` sans échéance : 9 échecs ; trigger désactivé : échec dès R0 ; verrou des horaires retiré du trigger et de `update_job` : 8 échecs (D2-D9) ; retiré du trigger seul : D3 en échec (écriture de la clé service acceptée) puis D4-D6, D8 ; restauration par réinitialisation de la pile depuis les migrations, 35/35 |
| Preuves adaptées | `company-dossier-visibility` B3 (écart du lot 11 fermé) et B4 (correction aux mêmes horaires) ; `realtime` (création à J+3, modification Pro aux mêmes horaires, mission recalée sur le jour), `mission-time-tracking`, `reputation` (offres insérées « déjà publiées ») ; `business-permissions`, `essentials-gate`, `jobs-rls-select` (début à J+3) |
| `pnpm test:rls` complet après la modification SQL (pile réinitialisée depuis les migrations) | ✅ 30/30 |
| Navigateur, échéances, 375 px, FR puis EN | ✅ 25/25 (passage précédent) : échéance franchie écran ouvert sans rechargement (liste, détail, candidat ayant postulé, entreprise) ; refus en base d'un envoi forcé ; « Voir les autres offres » ; coupure réseau puis une seule relecture serveur ; badge et candidatures closes simultanés ; EN ; aucun défilement horizontal |
| Navigateur, formulaire de correction, 375 px, FR puis EN | ✅ 12/12 : offre publiée → explication et lien « Créer une nouvelle offre », date et horaires en lecture seule (valeurs publiées), titre corrigé et soumis : offre en modération, dates, première publication, régime et échéance inchangés ; offre jamais publiée → champs modifiables ; écran ouvert avant la publication puis date changée → « Offre déjà publiée : sa date et ses horaires ne peuvent plus être modifiés… », aucune erreur technique, date inchangée en base ; EN ; aucun défilement horizontal ; aucune erreur de page |
| Tests unitaires, typage, lint, formatage, build | ✅ 522 tests (41 fichiers, dont `job-recruitment`), `tsc`, `eslint`, `prettier --check`, `next build` |
| Types générés (`supabase gen types --schema public`, pile réinitialisée) | ✅ identiques à `lib/database.types.ts` |

### Ce qui n'est pas prouvé

- Appareils Android et iOS réels ; onglet gelé plusieurs heures par le système (la reprise est prouvée par coupure réseau et par l'écouteur de premier plan).
- Visiteur anonyme : sans session, l'écran utilise l'horloge locale pour la minuterie (la base tranche toujours).

### Décisions prises (2026-11-11) et suites

- **Horaires figés après la première publication** : règle de lancement, appliquée en base pour tout auteur ; aucun contournement support. À réexaminer dans les lots « Engagements et annulations » et offres de plusieurs jours, sans les retirer du plan. Le parcours support de correction encadrée reste à construire (PLAN_ACTION.md).
- **Déplacer une mission publiée** : nouvelle offre, nouvelle modération, régime calculé à sa première publication ; aucun transfert de candidatures ; l'ancienne offre et ses engagements ne sont pas annulés.
- **Publication à exactement H−24** : refus maintenu.
- **Règle SRS « modification jusqu'à 12 h avant le début »** : historique, non appliquée, à remplacer dans le lot « Engagements et annulations » ; aucune règle concurrente ajoutée.
- **Offres antérieures sans historique fiable** : closes (`legacy_publication`), sans republication automatique ni date inventée.
- Offres de plusieurs jours et candidatures par journée : lot prévu, non traitées ici.

## 31. Suivi — Lot 12 : offres de plusieurs journées (2026-11-11)

Branche `feat/lot-12-multi-day-jobs` (base `origin/main-dev`, 0a1f381, lot 11b intégré par la PR #56), **non commitée, non déployée**. Migration `20261113120000_multi_day_jobs.sql`. Règles produit : SRS §5.4 (« Offres de plusieurs journées »), §6.6, §6.7, §6.8.

### Inventaire avant le lot

| Élément | Constat |
|---|---|
| Sous-offres | Aucune table. `jobs.parent_job_id`, `is_recurring`, `recurring_days` jamais écrits ; seul `reputation_company_offers` regroupait déjà par `coalesce(parent_job_id, id)`. |
| `jobs.end_date` | Saisi par le type « Contrat temporaire » du formulaire (intervalle), jamais utilisé : `select_candidate` créait une seule mission, sur `start_date`. Sens non établi. |
| Missions, codes | Une mission par candidature (index uniques), un code par mission (`mission_completion_codes`, clé `mission_id`, unicité `(job_id, code)`). |
| Réputation | Candidat : jointure mission × code. Avec plusieurs codes par mission, **double comptage** (corrigé, contrôle négatif `old_reputation`). |
| Contrat | Empreinte sur tout `contract_data` ; clauses versionnées immuables (`simple-v2`, `formal-v2`). |
| Formulaire | Catégories codées en dur sans lien avec `job_categories`, `category_id` jamais envoyé ; correction bloquée tant que la catégorie n'était pas ressaisie (corrigé). |

### Modèle retenu

- `jobs.schedule_format` : `full_period` (une candidature, un contrat, une mission globale) ou `per_day` (candidature, contrat et mission par journée). Une offre d'une journée est une période complète d'une journée.
- `job_days` : dates explicites (1 à 31, unicité de la date), horaires, bornes `starts_at` / `ends_at` calculées en Africa/Douala (fin ≤ début → lendemain), et pour `per_day` montant, places, places pourvues, régime et échéance. Aucune écriture de session ; lecture alignée sur la RLS de `jobs`. Trigger (tout auteur) : chevauchement interne refusé, calendrier figé dès la première publication (ajout, retrait, date, horaire : `job_schedule_locked`), régime et échéance d'une journée figés.
- Résumé de `jobs` tenu par les RPC : `start_date`, `start_time`, `end_time` = première journée, `end_date` = dernière ; `per_day` : `mission_pay_per_candidate` = plus petit montant (affichage), `positions_available` = somme, `publication_regime = 'per_day'`, `applications_close_at` = dernière échéance (l'offre reste listée tant qu'une journée est ouverte).
- `job_applications.job_day_id` (clé étrangère composée avec `job_id`) ; unicité `(job_id, candidate_id)` sans journée et `(job_day_id, candidate_id)` par journée : aucun retrait ni refus rouvert.
- `mission_days` : journées d'une mission (début et confirmation par journée), créées dans la transaction de sélection (la première par trigger sur `missions`, quel que soit l'auteur). Les codes sont rattachés à la journée (`mission_completion_codes.mission_day_id`, nouvelle clé primaire), unicité dans l'offre conservée.
- Mission globale réalisée (`actual_end_time`, `completed`) seulement avec sa dernière journée confirmée.

### Règles appliquées en base

| Règle | Où |
|---|---|
| Calendrier valide (doublon, début = fin, chevauchement, 31 journées, montants entiers positifs par journée, aucun montant journalier en période complète, aucun intervalle sans journées) | `job_days_parse`, `create_job`, `update_job`, trigger `job_days` |
| Première publication : période complète → régime du premier début ; au choix → régime et échéance par journée ; une journée non publiable → refus de toute l'offre avec les dates (`job_start_too_close`, détail `days`) | `moderate_job`, `job_publication_guard` |
| Offre antérieure à intervalle sans calendrier → `job_days_missing` (aucune journée déduite) | `moderate_job`, `job_publication_guard`, `select_candidate` |
| Candidature au choix tout ou rien, journées bloquantes nommées (`recruitment_closed`, `already_applied`, `no_positions`, `schedule_conflict`) | `apply_to_job_days` (via `apply_to_job_core`) |
| Période complète : `apply_to_job` inchangée en signature, `job_days_not_selectable` si des journées sont envoyées | `apply_to_job` |
| Retrait d'une journée précise, les autres inchangées | `withdraw_job_application(p_job_id, p_application_id)` |
| Sélection : échéance et places de la journée sous le verrou de l'offre ; verrou consultatif du candidat puis conflits (chevauchement ou < 3 h, 3 h admis) sur chaque plage ; refus `candidate_schedule_conflict` sans détail | `select_candidate`, `lock_candidate_engagements`, `candidate_schedule_conflicts` |
| Contrat : format, journées, horaires, montant, devise figés et couverts par l'empreinte ; formalisé à partir de 3 journées travaillées ; clauses v3 | `select_candidate`, trigger des contrats |
| Début par journée (H−15), confirmation par le code de la journée, essais et blocage par journée, réalisation globale à la dernière journée | `start_mission`, `submit_completion_code` (journée facultative pour une mission d'une journée) |
| Réputation : candidat +1 par mission réalisée (toutes ses journées), entreprise +1 par offre | `compute_reputation`, `reputation_company_offers` |
| Lectures sans code pour le candidat ; codes par journée pour l'entreprise propriétaire | `get_mission`, `candidate_tasks`, `company_job_missions`, `company_job_applicants`, `job_days_for_candidate` |
| Signaux Realtime minimaux existants | `trg_rt_job_days` (comme `jobs`), `trg_rt_mission_days` (`rt_on_mission_child`) |

### Écrans (FR/EN, 375 px)

- Formulaire : dates ajoutées une à une, horaires communs ou par journée, mention « se termine le lendemain », choix du format à partir de deux journées, montant pour toute la période ou montant et places par journée (« reprendre la première journée »), aperçu des journées ; catégories lues dans `job_categories`, enregistrées et préremplies ; après publication, calendrier en lecture seule.
- Détail candidat : journées, montant par journée ou pour la période, cases à cocher pour les journées encore accessibles, résumé avant envoi, état et retrait par journée, minuterie sur l'échéance de chaque journée (heure du serveur, sans relecture périodique), journées bloquantes et conflit expliqués.
- Entreprise : calendrier (montant et places par journée), filtre par journée, journée sur chaque candidature, codes et états par journée, progression, évaluation après la mission entière.
- Tâches : début et confirmation par journée, progression ; page mission : état de chaque journée ; contrat : format et journées figés ; Mes jobs : journée et montant de la candidature ; modération : calendrier soumis et journées non publiables nommées.

### Reprise

Diagnostic sans conversion ambiguë : offre sans intervalle → une journée identique à son horaire (ce que `select_candidate` engageait déjà) ; offre à intervalle → aucune journée (non publiable tant que l'entreprise n'a pas saisi ses dates ; publiée avant le lot : close, engagements conservés) ; chaque mission → une journée (horaire prévu, début et fin enregistrés), son code rattaché inchangé. Rejoué sur la pile de preuve ramenée au lot 11b avec des données fictives (offre simple publiée avec mission, offre à intervalle publiée avec mission de nuit, offre à intervalle jamais publiée, offre simple en attente) : 2 journées créées, 0 pour les deux intervalles, 2 journées de mission (la nuit 22:00 → 06:00 se termine bien le lendemain), 2 codes rattachés.

**À compter avant déploiement (lecture seule, lot 0)** :
`select count(*) filter (where first_published_at is null and not legacy_publication) as jamais_publiees, count(*) filter (where status = 'active') as actives, count(*) as total from public.jobs where end_date is not null and end_date <> start_date;` — offres qui ne recevront aucune journée ; prévenir les entreprises dont une offre en attente devra être ressaisie.

### Validation (pile `easyjob-proof`, données fictives)

| Contrôle | Résultat |
|---|---|
| Preuve `multi-day-jobs` (sessions réelles : entreprises A et B, 7 candidats, admin ops, anonyme ; routes et RPC) | ✅ 67/67 à la version finale (44 à la première version ; sections Q, réputation entreprise, V, choix confirmés, et W, conflit expliqué avant l'envoi, ajoutées ensuite et décrites plus bas) : calendrier non consécutif, horaires propres, nuit sur deux dates, neuf refus en base et par la route, parcours d'une journée, écritures directes (K1-K5) ; régime de la période sur le premier début, régime et échéance par journée (urgente H−2, normale H−24), refus tout ou rien avec la journée nommée, calendrier figé pour la clé service et la route, mêmes journées acceptées sans changement d'échéance, offre à intervalle refusée (P1-P6) ; candidatures (A1-A6) ; échéance d'une journée à la microseconde pour la candidature et la sélection, aucune réouverture (E1-E4) ; dernière place disputée, mission et contrat par journée, mission globale à trois codes, contrat formalisé, empreinte et signature (S1-S4) ; conflits à 3 h exactement et 3 h − 1 µs, période refusée pour une journée, refus sans détail, alerte au candidat, journées d'une même mission, course de deux entreprises à ordre imposé (C1-C6) ; réalisation par journée, codes d'une autre journée ou d'un autre candidat, blocage par journée, mission non terminée après une journée, réputation +1 une fois, évaluation unique, journées au choix +2 candidat et +1 offre, codes absents des lectures candidat, des notifications et de Realtime, écritures directes (M1-M10) ; suspension et dossier (D1) |
| Contrôles négatifs (une protection retirée à la fois, puis restaurée) | ✅ conflits retirés de `select_candidate` → C1, C2, C3, C6 en échec ; verrou consultatif retiré → C6 ; verrou du calendrier retiré → P4, P5, S3 ; échéance de la journée retirée → E2 ; réalisation globale dès la première journée → M2 à M5 ; ancien comptage de réputation → M5 ; tout ou rien de la candidature retiré → A3, A4, A5, E1, E4 |
| Preuves existantes adaptées | `candidate-selection`, `contract-signing`, `mission-time-tracking`, `business-permissions`, `job-moderation`, `company-dossier-visibility`, `reputation` : dates distinctes quand un même candidat est réutilisé (nouvelle règle d'engagement) ; contrat formalisé sur 3 journées explicites ; clauses v3 ; colonnes de journée dans la liste des candidats ; I15 lit `apply_to_job_core` ; `job-deadlines` déplace aussi la journée de l'offre |
| `pnpm test:rls` complet (pile réinitialisée depuis les seules migrations) | ✅ 31/31, deux fois (avant et après les dernières corrections d'écran) ; après la règle de réputation entreprise : 30/31 au premier passage (`job-deadlines` U4 : `candidate_schedule_conflict`, la fixture sélectionnait le même candidat sur l'offre normale et l'offre urgente, dont les plages, placées par rapport à l'heure courante, tombaient le même jour en soirée ; sélection acceptée portée sur un autre candidat), puis 31/31 sur la pile réinitialisée (`multi-day-jobs` 56/56, `reputation` 70/70) ; types identiques |
| Réputation entreprise (preuve `multi-day-jobs`, section Q, entreprise isolée) | ✅ Q1 offre au choix réalisée mais recrutement ouvert : aucune unité ; Q2 nouvelles sélections et réalisations avant la clôture : projection et variations inchangées ; Q3 et Q3b dossier remis en revue (offre masquée) : pas une clôture ; Q4 clos avec une journée sans code : aucune unité ; Q5 `cancelled`, mission `no_show`, candidature `no_show` : non résolus ; Q6 dernière réalisation après la clôture : +1 (trois candidats, deux journées), une variation, une notification ; Q7 quatre recalculs et deux balayages concurrents : aucun doublon ; Q8-Q9 période complète : rien avec une journée sur deux, +1 à la dernière ; Q10 offres closes sans travail : rien ; Q11 clôture par le temps : recalcul programmé à l'échéance, tâche planifiée → +1, calcul à un instant antérieur → rien. M7 et `reputation` O1 alignés (rien avant la clôture). Fixture `reputation` corrigée : ses offres historiques (`filled`) ont un recrutement clos. La clôture « par le temps » est simulée par une fonction de preuve qui place l'échéance et l'instant de recalcul programmé juste avant `now()` (aucun recalcul lancé par elle) ; **aucun remboursement ni absence validée n'est simulé** : ces cas restent non couverts |
| Contrôles négatifs de la règle | ✅ clôture ignorée → M7, Q1, Q2, Q11 ; statuts génériques tenus pour résolus → Q5, Q6 ; dossier en revue tenu pour une clôture → Q3b, Q11 (premier essai non détecté : le cas Q3 avait encore un engagement non résolu ; cas Q3b ajouté) ; échéance non programmée → Q4, Q11 ; restauration puis réinitialisation de la pile |
| Choix confirmés (preuve `multi-day-jobs`, section V) | ✅ V1 limite en journées travaillées : 20 journées étalées sur 58 jours et 31 journées étalées sur 61 jours acceptées, 32 refusées (`days_count`) ; V2 seuil du contrat : trois journées au choix d'un même candidat → trois missions et trois contrats simples distincts, période complète de deux journées → simple, de trois journées non consécutives → formalisé (S3, et `candidate-selection` S9, `contract-signing` CL10) ; V3 candidature à exactement 3 h d'un engagement sélectionné acceptée, à 3 h − 1 µs refusée (`schedule_conflict`, journée nommée), aucune ligne créée ; V4 une candidature en attente ne bloque pas une autre candidature au même créneau ; V5 journées au choix dont une incompatible : tout l'envoi refusé (409), journée nommée avec le motif `schedule_conflict`, rien créé, puis la journée compatible seule acceptée. Contrôle définitif à la sélection : C1, C2, C6 (verrou, ordre imposé). Test unitaire `job-schedule` : 20 journées sur plus de deux mois valides, 32 journées refusées |
| Contrôles négatifs des choix confirmés (puis restauration, preuve de nouveau 61/61) | ✅ conflit retiré de la candidature → C4, V3, V5 (premier lancement : mutation non appliquée, motif ambigu dans le script de contrôle, donc aucun résultat retenu ; corrigé puis rejoué) ; limite de journées levée → K3, V1 ; seuil du contrat à 2 → V2 ; seuil à 4 → S3. V4 n'a pas de contrôle négatif : un engagement n'existe qu'à partir d'une mission, donc d'une sélection |
| Reprise sur données du lot 11b | ✅ voir « Reprise » ; suppression d'une offre publiée : journées supprimées en cascade |
| Navigateur (Chrome headless 375 × 812, application construite, pile de preuve) | ✅ 25/25, trois passages (37/37 avec le parcours « conflit » X1-X8 ajouté ensuite, voir plus bas) : formulaire FR (trois dates non consécutives, nuit +1 j, journées au choix, montants et places, aperçu ; période complète à horaires propres), correction d'une offre publiée (catégorie préremplie, calendrier en lecture seule), candidat FR (fourchette de montants, deux journées cochées, résumé, journée restante proposée), Realtime entre sessions (candidatures rattachées à leur journée côté entreprise, sélection visible côté candidat), candidature ultérieure, coupure réseau puis reprise, rechargement, codes par journée côté entreprise et absents des pages candidat, candidat EN (période, résumé, Tâches « 0/2 days confirmed », contrat à deux journées) ; aucun défilement horizontal. Correction faite pendant la vérification : majuscule à chaque mot des dates (classe `capitalize`) et échéance globale affichée pour une offre au choix |
| Tests unitaires, typage, lint, formatage, build | ✅ 532 tests (42 fichiers, dont `job-schedule`), `tsc`, `eslint`, `prettier --check`, `next build` (dernier build : après la règle de réputation ; seuls une preuve, un test et les documents ont changé depuis) ; second passage contrôlé sous la même charge : 0 échec sur 10 |
| Test unitaire intermittent (passage contrôlé : 15 exécutions pendant `pnpm test:rls`, rapport JSON, aucune relance) | ⚠️ **Reproduit 4 fois sur 15**, toujours `tests/proof-db-query.test.ts` › « échoue après le délai, nomme l'étape et arrête le processus » (lot 10, sans lien avec le lot 12), code de sortie 1. Deux formes : `ENOENT` sur le fichier PID (2 fois : le Node fils n'a pas démarré ni écrit son PID avant le délai de 800 ms — hypothèse de minutage du test, sans effet sur l'outil) ; `expected true to be false` sur `isAlive` (2 fois : processus encore listé juste après l'arrêt — **cause non établie** : une expérience hors Vitest, 12 essais, montre le processus arrêté immédiatement). Test non modifié (ni relance, ni délai allongé) ; à traiter dans un lot de maintenance |
| Types générés (`supabase gen types --schema public`, pile réinitialisée) | ✅ identiques à `lib/database.types.ts` |

### Limites (ce qui n'est pas prouvé ou reste dépendant)

- **Recalcul planifié de la réputation** : la tâche `reputation-expiry-sweep` tourne toutes les 15 minutes (pg_cron). Le **passage réel de pg_cron n'a pas été observé** dans cette validation : la preuve appelle la fonction de balayage elle-même après avoir placé l'échéance et l'instant de recalcul juste avant l'heure courante. Entre l'échéance et le passage suivant, la projection stockée peut avoir jusqu'à 15 minutes de retard ; les lectures par un tiers (`reputation_stars_for`) et par le titulaire (`my_reputation`) recalculent dès l'échéance passée. À vérifier après déploiement : présence de la tâche dans `cron.job` et premier passage.
- **Test `proof-db-query` intermittent sous charge** (lot 10, sans lien avec ce lot) : 4 échecs sur 25 exécutions pendant la suite de preuves. La forme `ENOENT` s'explique par le démarrage du processus fils au-delà du délai de 800 ms (hypothèse de minutage du test) ; la **cause de la forme `isAlive` reste inconnue** (non reproduite hors Vitest). Aucune relance ni délai allongé ; correction suivie en maintenance (`PLAN_ACTION.md`).
- **Absences, remboursements et situations partielles** : aucun parcours livré (lots « Engagements et annulations » et paiement). **Aucune résolution n'est présumée** : ni absence validée, ni remboursement, ni statut générique tenu pour une résolution, ni fixture qui en simule un. Une journée non confirmée, une mission annulée ou contestée, une période complète partiellement réalisée restent non résolues, sans sanction, sans division du forfait et sans unité de réputation pour l'offre.
- Appareils Android et iOS réels ; onglet gelé plusieurs heures par le système.
- Visiteur anonyme : minuterie sur l'horloge locale (la base tranche).

### Choix confirmés par le produit (2026-11-11)

1. **Contrat formalisé dès trois journées prévues dans le même contrat.** Le compte porte sur les journées du contrat, pas sur l'écart entre la première et la dernière date : une période complète de trois journées non consécutives est formalisée ; deux journées → contrat simple ; trois missions journalières indépendantes (journées au choix) → trois contrats simples distincts. **Convention produit** pour choisir le format : elle ne vaut pas validation juridique (contenu légal du contrat formalisé : lot contrats, SRS §11.1). En base : `select_candidate` (`v_count >= 3`). Preuve : S3, V2.
2. **31 journées travaillées au plus par offre.** Limite sur le nombre de journées, pas sur l'étendue calendaire : 20 journées réparties sur deux mois sont admises. En base : `job_days_parse` (`days_count`), même borne dans le schéma partagé et le formulaire (`JOB_DAYS_MAX`). Preuve : K3, V1. (Places par journée de 1 à 10 000 : borne technique, non soumise à arbitrage.)
3. **Détection des conflits dès la candidature**, sur les seuls engagements **déjà sélectionnés** du candidat et avec la marge de 3 h ; les candidatures en attente ne bloquent rien ; le contrôle définitif reste obligatoire à la sélection, sous verrou. Un engagement est une journée d'une mission non annulée ni en absence, dont la sélection tient (`candidate_schedule_conflicts`) ; il n'existe donc qu'après une sélection. Preuve : C4, V3, V4, V5 (candidature) ; C1, C2, C6 (sélection).

**Point 3 : refus confirmé par le produit (2026-11-12), conflit expliqué avant l'envoi.**

| Format | À la candidature | Ce que voit le candidat |
|---|---|---|
| Période complète | Candidature refusée en entier (`schedule_conflict`, 409), aucune ligne créée | Message qui nomme les journées de l'offre incompatibles avec ses engagements |
| Journées au choix | Tout l'envoi refusé (`job_days_unavailable`, 409, tout ou rien), aucune ligne créée | Journées incompatibles nommées avec le motif « engagement trop proche » ; il peut renvoyer les seules journées compatibles |

Ces refus en base sont conservés : ils tranchent pour un écran périmé ou un appel direct. L'entreprise ne voit jamais ce refus (il précède toute candidature).

**Explication avant l'envoi (2026-11-12).**

- **Source de vérité** : `job_days_for_candidate` renvoie pour le candidat de la session, par journée, `schedule_compatible` (vrai, faux, ou nul quand la question ne se pose pas : visiteur, entreprise, journée déjà demandée) et `schedule_reason` (`schedule_conflict`). Le calcul appelle `candidate_schedule_conflicts`, la fonction de `apply_to_job_core` et de `select_candidate` : seuls les engagements déjà sélectionnés comptent, 3 h minimum, exactement 3 h admis, candidature en attente sans effet. Aucune règle d'horaire n'est recopiée dans le navigateur (`lib/jobs/day-state.ts` ne fait que lire ce verdict). Aucun détail de l'autre engagement (offre, entreprise, mission, dates, horaires) n'est renvoyé.
- **Écran** : journée incompatible visible, case désactivée, badge « Incompatible » / « Conflict » et motif écrit sous la journée (relié à la case par `aria-describedby`, sans survol) ; règle des 3 h rappelée ; période complète : journées nommées et candidature désactivée avec son explication.
- **Temps réel et réseau** : relecture par la RPC à chaque signal privé (`applications`, `missions`, `jobs`…), au retour au premier plan et à la reconnexion, sans relecture périodique ; une journée cochée devenue inaccessible est décochée et le changement est expliqué (dans la confirmation si elle est ouverte, l'envoi restant possible pour les journées encore valables). Lecture en échec : « Impossible de vérifier votre disponibilité » avec « Réessayer », aucune journée cochable ni présentée comme ouverte, candidature bloquée.
- **Preuve `multi-day-jobs` section W** (67/67) : W1 candidature en attente au même créneau sans effet ; W2 après sélection, journée à 3 h − 1 µs incompatible, journée à exactement 3 h compatible, seule journée incompatible d'une période identifiée ; W3 écran périmé : refus 409 des journées au choix et de la période, journée nommée, aucune écriture ; W4 journées compatibles envoyées ; W5 réponse limitée aux colonnes prévues, aucun détail de l'engagement chez le candidat, dans les refus ni dans la vue de l'entreprise, compatibilité non renseignée pour l'anonyme et l'entreprise, propre à chaque candidat ; W6 signal `{d, r}` au seul candidat, rien vers l'entreprise de l'offre consultée. Contrôle négatif : compatibilité non calculée → W2, W4 en échec, puis restauration (67/67).
- **Tests unitaires** `job-day-state` : verdict explicite seulement, ordre des états identique aux refus de la base, échéance exacte, journées décochées et motifs.
- **Suite complète** après la modification de \job_days_for_candidate\ : \pnpm test:rls\ 31/31 ; tests unitaires 539/539 (43 fichiers, exécutés pendant la suite) ; typage, lint, formatage, build ; types générés identiques.
- **Navigateur** (375 px, FR et EN, application construite) : X1-X8, 12 contrôles ajoutés aux 25 précédents (37/37) : journée incompatible non cochable avec motif relié à la case, journée à exactement 3 h et journée en attente ailleurs ouvertes ; sélection reçue pendant la confirmation → journée décochée, résumé mis à jour, changement expliqué, sans rechargement, puis envoi de la journée restante (une seule ligne écrite) ; coupure réseau avec lecture en échec → « Impossible de vérifier » et Réessayer, aucune journée cochable ni « Ouverte », puis reprise ; période complète bloquée avec la journée nommée ; textes EN ; aucun défilement horizontal.

### Réputation entreprise (décision validée du 2026-11-11)

**Règle.** Une offre rapporte +1 unité, une seule fois, quand au moins une réalisation est confirmée par code, que tous ses engagements sont résolus (travail confirmé, ou absence validée avec remboursement effectivement confirmé) et qu'aucun nouveau recrutement n'est possible. Sans travail réalisé, aucune unité ; sanctions indépendantes.

**Inventaire des états avant la modification.**

| État | Existant | Traitement |
|---|---|---|
| Candidature `selected` + mission dont toutes les journées sont confirmées par leur code | Parcours livré (lots 7c, 12) | **Résolu : travail confirmé** |
| Candidature `selected`, mission sans code consommé, une journée sur deux, ou sans mission | Courant | Non résolu |
| Candidature `no_show`, mission `no_show` | Statuts sans parcours d'écriture ni validation | Non résolu (le lot 9c les tenait pour résolus : retiré) |
| Mission `cancelled`, `disputed` | Statuts sans parcours d'annulation ni décision support | Non résolu (le lot 9c tenait `cancelled` pour résolu : retiré) |
| Absence validée avec remboursement confirmé | **Inexistant** (lots « Engagements et annulations » et paiement) | Non couvert ; aucune donnée n'en tient lieu |
| Candidature `pending`, `shortlisted`, `rejected`, `withdrawn` | Courant | Pas un engagement |
| Recrutement : échéance figée à la première publication (lot 11b ; au choix, dernière échéance des journées), jamais rouverte | Livré | **Seule clôture définitive** |
| Offre masquée (dossier en revue, lot 11), en modération après correction, pleine | Livré | Pas une clôture (temporaire ou réversible) |
| Offre antérieure au lot 11b (`legacy_publication`, sans échéance) | Livré | Close (aucune candidature possible) |

**Mise en œuvre.** `reputation_company_offers(p_company_id, p_at)` : unité accordée seulement si l'offre (groupe `parent_job_id` compris) est close à `p_at`, si au moins un engagement est un travail confirmé et si tous le sont ; horodatage : la plus tardive de la clôture et de la dernière confirmation. Aucun indicateur « point gagné » : le score est rejoué à partir des données (invalidation d'une preuve, décision du support → correction au recalcul). Plus de gain ni de retrait provisoire : rien ne compte avant la clôture, et après la clôture aucune sélection n'est possible. **Échéance** : `compute_reputation` renvoie pour une entreprise la prochaine clôture d'une offre déjà engagée (`reputation_company_next_close`) dans `next_expiry_at` ; le balayage existant `reputation_expiry_sweep` (pg_cron, toutes les 15 min) recalcule alors le score (cause `job`), sans visite ni écriture ; `reputation_stars_for` et `my_reputation` recalculent déjà à la lecture une fois l'échéance passée. Notification et animation : émises par `refresh_reputation` seulement si les étoiles changent, sous verrou de la ligne de score, donc jamais en double.

**Situations partielles qui attendent le parcours support** (documentées, non traitées) : période complète dont une journée n'est pas confirmée (aucune division du forfait, aucun remboursement journalier) ; journée au choix sélectionnée puis non travaillée ; absence ou annulation sans décision ni remboursement. Toutes laissent l'offre sans unité, sans sanction ni retrait automatique.

**Reprise.** Les offres que le lot 9c comptait grâce à un statut `no_show` ou `cancelled`, ou avant la clôture de leur recrutement, ne comptent plus. À compter avant déploiement (lecture seule) : comparer, pour chaque entreprise, `reputation_scores.experience_units` avant et après la migration (le premier recalcul suit le premier événement ou la tâche planifiée).

### Dépendances documentées

- Lot « Engagements et annulations » : signalement d'une journée non confirmée, justification, décision du support, contestation, remplacement, sanction, remboursement. Le garde-fou `protect_reputation_incidents` refuse une absence sur une mission dont **une** journée a été confirmée : à préciser par ce lot pour les missions globales.
- Lot contrats : signature de l'entreprise avant sélection et PDF livrés au lot 13 (§32) ; contenu légal du contrat formalisé toujours à valider.
- Lot de correction encadrée des horaires : le calendrier entier est désormais figé.

## 32. Suivi — Lot 13 : contrat signé à la sélection (2026-11-16)

Branche `feat/lot-13-contracts-selection`, créée depuis `origin/main-dev` (83ace11, lot 12 intégré). Migration `20261116120000_contract_selection.sql`. Non commité, non déployé.

### Inventaire avant le lot

- `select_candidate` (lots 7a à 12) créait sélection, mission, journées, codes, contrat `pending` et notification sans aucune signature ; l'entreprise signait ensuite, séparément, par `sign_contract`. La RPC était appelable directement en session.
- `get_contract`, `get_mission`, la réponse de `sign_contract` et les colonnes lisibles de `contracts` (`status`, `*_signed_at`, `*_terms_hash`, `updated_at`) révélaient à chaque partie l'état et l'heure de la signature de l'autre ; les notifications de signature aussi (« X a signé… », « signé par les deux parties ») ; le signal temps réel d'une signature allait aux deux parties.
- La présélection restait inscriptible en session (`protect_job_application_writes`) et affichée (onglet entreprise, libellés candidat).
- Aucun PDF ; aucune bibliothèque PDF dans le dépôt.

### Mécanisme

- **Aperçu** `contract_selection_preview` : lecture seule (`selection_prepare`, sans verrou ni écriture), mêmes contrôles et mêmes codes que la sélection ; renvoie le candidat en prénom et initiale, le format, les conditions, les clauses courantes et l'**empreinte de proposition** `contract_proposal_hash` (SHA-256 de `{v, kind, application_id, job_id, candidate_id, company_id, template, terms}`, `terms` = `contract_data` sans `mission_id`).
- **Signer et sélectionner** : `sign_and_select` (session, sans IP) et `sign_and_select_observed` (route, clé service, IP observée) appellent `contract_select_core`. Verrous dans l'ordre du lot 12 (candidature, offre, entreprise en partage, journée, verrou consultatif du candidat) ; relance sur une candidature déjà sélectionnée → résultat d'origine sans écriture (jamais de signature ajoutée à un contrat existant) ; contrôles refaits sur l'état verrouillé ; empreinte présentée différente de l'empreinte courante → `terms_mismatch` ; puis sélection, mission, journées, codes, contrat (clauses et `terms_hash` par le trigger du lot 7b), contrôle que le contrat inséré porte exactement l'empreinte présentée, signature de l'entreprise (`company_terms_hash = terms_hash`, statut `company_signed`), notification du candidat. Tout refus annule la transaction.
- `select_candidate` est supprimée ; `selection_prepare`, `selection_company_of` et `contract_select_core` sont fermées aux sessions.
- **Confidentialité** : `get_contract` renvoie `viewer_signed`, `can_sign`, `needs_review` (plus de statut ni d'horodatage) ; `get_mission` renvoie `contract_viewer_signed` ; `company_job_applicants` renvoie `contract_id` et `contract_to_sign` ; la signature renvoie `{contract_id, signed_party, already_signed}` ; colonnes de signature et `updated_at` retirées du `grant select` ; notification d'une signature seulement à une partie qui doit encore signer, sans dire qui a signé ; `rt_on_contracts` ne signale une signature qu'au signataire. Le détail reste en base pour le support (clé service).
- **Présélection** : `protect_job_application_writes` n'autorise plus que le refus en session ; `withdraw_job_application` accepte une ancienne présélection ; les écrans l'affichent « en attente » (`displayApplicationStatus`). Aucune donnée réécrite.
- **PDF** : `GET /api/contracts/[id]/pdf?locale=fr|en`, lecture par `get_contract` en session (tiers → 404) ; générateur sans dépendance (`lib/contracts/pdf.ts` : PDF 1.4, Helvetica en WinAnsi, pagination) ; contenu tiré des conditions et clauses figées (`lib/contracts/contract-pdf.ts`).

### Écrans (FR/EN, 375 px)

- Entreprise : « Voir le contrat proposé » ouvre un dialogue (candidat, journées et horaires, lieu, montant XAF, clauses, case de consentement en fin de contrat, « Signer et sélectionner » dans un pied réduit aux actions) ; si les conditions ont changé : bandeau et contrat relu ; plus d'onglet de présélection ; « Votre signature est attendue » ou « Signé par vous » sur la candidature.
- Contrat : mention propre au lecteur, plus de bloc « Signatures » des deux parties, bouton « Télécharger le contrat (PDF) ». Mission et Tâches : « Mission : Prévue », distinct de la mention de signature.

### Validation (pile `easyjob-proof`, données fictives)

| Contrôle | Résultat |
|---|---|
| Preuve `contract-selection` (nouvelle, sessions réelles) | ✅ 29/29 : aperçu et fermeture sans écriture, tiers, candidat et anonyme refusés ; consentement exigé ; double clic ; réponse perdue ; transaction complète (3 journées, 3 codes, empreinte présentée = contrat signé) ; confidentialité (lecture, mission, candidatures, réponse de signature, aucune notification à l'entreprise) ; tâche du candidat, début avant signature, tâche retirée après signature ; PDF FR/EN, accès direct d'une entreprise tierce, d'un autre candidat et d'un anonyme, PDF après la mission ; journées au choix (deux contrats) ; montant puis clauses changés après l'aperçu ; échéance franchie avant le clic ; deux entreprises en concurrence ; ancien appel `select_candidate` (404) ; contrat antérieur sans signature rétroactive ; ancienne présélection retirable |
| Preuves existantes adaptées | sélection par l'aperçu signé (`scripts/lib/sign-and-select.ts`) ; `contract-signing` : contrats « antérieurs » fabriqués en clé service pour éprouver la double signature, assertions de confidentialité (L5, S5, S7, S8, D1, D2) ; `candidate-selection` : présélection refusée, ancienne présélection sélectionnable, course C1 sur la seule signature ; `realtime` J6, M1, M2 ; colonnes `contract_id` et `contract_to_sign` (F3, P3) ; statut `company_signed` (S1, C4) |
| `pnpm test:rls` complet (pile réinitialisée depuis les seules migrations, application reconstruite) | ⚠️ puis ✅ : 31/32 en 663 s ; seul échec `contract-signing` S5, assertion de la preuve trop large (les 16 premiers caractères de l'heure de signature du candidat coïncidaient avec `created_at` du contrat, créé dans la même minute ; aucune fuite) ; assertion corrigée (horodatage complet), `contract-signing` relancée deux fois : ✅ 45/45. Pendant le développement, `company-dossier-visibility` M9 (signal `jobs:public` non reçu) et `reputation` (collision aléatoire de numéro de téléphone à la création des fixtures) ont échoué une fois chacune, puis sont passées à la relance et dans la suite complète : non liés au lot, non reproduits |
| Navigateur (Chrome headless 375 × 812, application construite) | ✅ 15/15 : entreprise FR (aperçu, fermeture sans effet, signature, mention), entreprise EN (aperçu), candidat EN (tâche, contrat, signature, tâche retirée de l'autre onglet ouvert sans rechargement en 0,9 s environ, mission), candidat FR (contrat, PDF de trois journées de nuit vérifié), lien direct d'un autre candidat ; aucun défilement horizontal. Corrigé pendant la vérification : double point après l'initiale (« Aline N.. ») et pied du dialogue qui masquait la moitié du contrat |
| Tests unitaires, typage, lint, formatage, build, types générés | ✅ 552 tests (dont `contract-pdf`), `tsc`, `eslint`, `prettier --check`, `next build`, types identiques au schéma de la pile réinitialisée |

### Limites

- Détail des signatures (horodatages, IP, empreintes) lisible par le support en clé service seulement : aucun écran admin des contrats.
- PDF à polices standard (un caractère hors WinAnsi devient « ? »), sans signature graphique ni identité civile figée, produit à la demande et non archivé. Contenu légal du contrat formalisé toujours à valider (SRS §11.1).
- Une ancienne présélection perd ce statut quand elle est sélectionnée, refusée ou retirée, comme toute candidature en attente ; aucune table d'historique des statuts.
- La signature du candidat n'est plus signalée à l'entreprise (sa propre vue ne change pas) ; la création du contrat l'est.

## 33. Suivi — Lot 14 : incidents de mission par journée (2026-11-17)

Branche `feat/lot-14-mission-incidents`, créée depuis `origin/main-dev` (63bdaf6, lot 13 intégré). Migration `20261117120000_mission_incidents.sql`. Non commité, non déployé.

### Inventaire et choix

- `reputation_incidents` (lot 9c) enregistre des **décisions de manquement** qui retirent 5 unités : ce lot n'y écrit rien. Son garde-fou raisonne à la mission (une journée confirmée suffit à refuser une absence) : inchangé, noté pour le lot « Engagements et annulations ».
- `disputes` (base initiale, réutilisée pour les contestations d'avis) n'a ni journée, ni nature, ni séparation des pièces, et ses droits sont trop larges (constat ci-dessous) : non réutilisée. Réutilisés : grades (`is_admin_user`, `is_ops_admin_user`, compte actif), décision définitive tracée dans `audit_logs` et notifiée (modèle des contestations d'avis), notifications, signaux privés (`rt_signal_users`, `rt_signal_admin`), stockage privé et URL signée de 60 s (modèle des justificatifs), verrous mission puis journée de `submit_completion_code`.

### Mécanisme

- Tables `mission_incidents` (un signalement par journée, nature et partie : idempotence), `mission_incident_statements` (versions, append-only, 5 par partie), `mission_incident_evidence` (pièces, 5 par partie). RLS active, aucun privilège de session ; triggers : faits immuables, décision définitive, déclarations et pièces non modifiables.
- RPC en session : `report_mission_incident`, `add_mission_incident_statement`, `mission_incidents_for_party` (versions et nombre de pièces, sans pièce, chemin ni auteur) ; support : `admin_mission_incidents`, `admin_mission_incident` (tout admin actif), `admin_decide_mission_incident` (ops et fondateur actifs, motif de 10 à 2000 caractères), `admin_incident_evidence_path`. Clé service : `record_incident_evidence` (route de dépôt, type lu dans les octets, 5 Mio). Bucket `incident-evidence` privé, sans politique.
- Trigger `mission_incident_close_on_confirmation` : journée confirmée par code → absence et code non remis ouverts clos (« journée confirmée »).
- Signaux `incidents` aux deux parties et au canal admin ; notifications à l'autre partie (signalement, version) et aux deux parties (décision), sans pièce.

### Écrans (FR/EN, 375 px)

Candidat : bouton « Signaler » dans *Tâches* et carte « Signalements » du détail de mission (version, justificatif). Entreprise : bloc « Signalements » dans les journées du candidat sélectionné. Dialogue : mission et date avant l'envoi, natures indisponibles désactivées avec leur motif. Support : `/admin/incidents` (filtres, dossier, journée et autres journées, versions, pièces à ouvrir, décision ; lecture seule pour `admin_support`).

### Validation (pile `easyjob-proof`, données fictives)

| Contrôle | Résultat |
|---|---|
| Preuve `mission-incidents` (sessions réelles) | ✅ 18/18 au premier passage : lundi confirmé (absence et code non remis refusés, retard accepté), mercredi signalé absent, vendredi toujours prévu (entreprise refusée avant le début, candidat prévient) ; aucune conséquence (journées, mission, contrat, réputation, manquements) ; double envoi simultané et relance ; versions contradictoires, pièce privée, faux PNG refusé ; tiers, autre candidat, anonyme refusés ; tables, bucket et RPC de service fermés en session ; support (dossier, pièce par URL signée), `admin_support` sans décision, admin suspendu refusé ; décision motivée tracée, relance, décision contraire refusée, sans conséquence ; reconnexion ; absence ouverte close quand la journée est confirmée ; course code / absence (l'exécution observée a confirmé le code d'abord : absence refusée ; l'ordre inverse est couvert par S5) |
| Navigateur (Chrome headless 375 × 812, deux sessions et le support) | ✅ 7/7 : entreprise FR (mission et date avant l'envoi, natures désactivées lundi et vendredi), candidat EN (signalement reçu sans rechargement en 0,4 s, version envoyée et reçue côté entreprise sans rechargement), Tâches EN (code non remis), support FR (liste, dossier, décision), décision reçue par le candidat sans rechargement (0,9 s), reconnexion FR ; aucun défilement horizontal |
| Tests unitaires, typage, lint, formatage, build, types | ✅ 558 tests (45 fichiers, dont `mission-incidents`), `tsc`, `eslint`, `prettier --check`, `next build` (23 s), types générés identiques au schéma de la pile réinitialisée |
| `pnpm test:rls` complet (pile réinitialisée depuis les seules migrations, application reconstruite) | ✅ 33/33 en 696 s, au premier passage |

### Constat hors lot

`public.disputes` garde les droits de la base initiale : `GRANT ALL` à `anon` et `authenticated`, politique `INSERT` limitée à `opened_by = auth.uid()`. Tout compte connecté peut donc créer une ligne (hors contestation d'avis, protégée par trigger) pour **n'importe quelle mission**, lisible ensuite par les parties de cette mission. Aucun écran n'en crée. Vérifié sur la pile de preuve (`has_table_privilege('authenticated','public.disputes','INSERT')` vrai). Non corrigé ici (hors périmètre) : **corrigé au lot 14b (§34)**.

### Limites

- Aucune conséquence des décisions (choix du lot) ; règle de `reputation_incidents` encore à la mission.
- Code non remis : la décision « établi » ne confirme pas la journée ; pouvoir non introduit (décision produit, `PLAN_ACTION.md` lot 14). **Arbitré et livré au lot 15 (§36)** pour la confirmation explicite de l'entreprise ; la décision générique est depuis refusée sur un « code non remis ».
- Aucun délai maximal pour signaler après la journée ; aucun retrait d'un signalement par son auteur ; pas d'écriture de complément par le support (seulement la décision).
- Les justificatifs restent stockés après la décision (aucune règle de conservation).

## 34. Suivi — Lot 14b : création de contestations sur les missions d'un tiers (2026-11-18)

Branche `fix/lot-14b-disputes-permissions`, créée depuis `origin/main-dev` (45d522e, lot 14 intégré). Migration `20261118120000_disputes_permissions.sql`. Non commité, non déployé.

### Parcours réels de `public.disputes`

- Écritures légitimes : `admin_open_review_contest` et `admin_resolve_review_contest` (lot 9c, `SECURITY DEFINER`, grade vérifié, `audit_logs`), qui ne passent ni par les privilèges ni par la RLS de la session.
- Lectures : route admin de réputation (clé service, après contrôle du grade) ; partie concernée en session (`disputes_select_party_or_admin`, contestation d'avis visible de la partie évaluée, preuve `reputation` C2).
- Aucun écran, route, script ni RPC n'écrit directement dans la table ; les signalements par journée du lot 14 vivent dans `mission_incidents`, sans lien avec `disputes`.

### Défaut reproduit (pile `easyjob-proof`, deux missions, sessions réelles)

| Tentative en session | Avant | Après |
|---|---|---|
| Tiers C3, étranger à la mission, crée une contestation à son nom | **créée** (relue en base : `opened_by` = C3, mission de C1), lisible ensuite par les deux parties | refusée (42501), aucune ligne |
| Tiers C3 au nom du candidat C1 | refusée (politique `opened_by = auth.uid()`) | refusée |
| Partie C1 sur sa propre mission, hors de tout parcours | **créée** | refusée |
| Anonyme | refusée (RLS) | refusée |
| Support (`admin_support`) au nom de C1 | **créée** (auteur usurpé) | refusée |
| Support : rattacher une ligne à une autre mission, la clore (`status`, `resolution`) | **acceptées**, sans `audit_logs` | refusées, ligne inchangée |
| Partie : rattachement, changement d'auteur, suppression ; support : suppression | 0 ligne (politiques absentes) | refusées |
| Lecture : parties de la mission | 1 ligne | 1 ligne (inchangé) |
| Lecture : tiers, anonyme | 0 | 0 |

Privilèges effectifs : avant, `anon` et `authenticated` avaient SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES et TRIGGER ; politiques INSERT (`opened_by = auth.uid()` ou admin, mission non vérifiée), SELECT, UPDATE (tout admin). Après : `authenticated` garde SELECT, `anon` n'a plus rien ; seule la politique SELECT reste ; le trigger `protect_review_contest_writes` refuse toute écriture de session (seconde barrière). Table, lignes existantes et historique conservés ; règles du lot 14 (incidents, réputation, paiement) inchangées. TRUNCATE n'est pas exposé par PostgREST : retiré par principe.

### Preuve

`mission-incidents`, section H (H1 à H4) : création par un tiers, au nom d'une partie, par la partie, par l'anonyme, par le support ; rattachement à une autre mission, changement d'auteur, décision hors RPC, suppression ; état relu en clé service ; lectures autorisées ; privilèges et politiques effectifs. Chemin légitime : `reputation` C2 (contestation ouverte et décidée par les RPC admin).

| Contrôle | Résultat |
|---|---|
| Reproduction sur la pile non corrigée | H1, H2, H4 en échec (trois lignes créées sur la mission de C1, rattachement et clôture par le support acceptés) |
| Après correctif | `mission-incidents` 22/22, `reputation` ✅ (C2 inchangé) ; types générés identiques |
| Contrôle négatif 1 : privilèges et politiques d'origine réintroduits, trigger corrigé conservé | H4 en échec (régression détectée) ; H1 et H2 tenus par le trigger |
| Contrôle négatif 2 : en plus, trigger du lot 9c remis | H1, H2 et H4 en échec ; pile réinitialisée ensuite, privilèges relus (`authenticated:SELECT` seul) |
| Suite RLS complète (pile réinitialisée depuis les seules migrations) | ✅ 33/33 en 593 s, au premier passage |
| Vitest (séparément), typage, lint, formatage | ✅ 558 tests, `tsc`, `eslint`, `prettier --check` ; aucun écran modifié, pas de parcours navigateur |

### Avertissement Next.js (diagnostic, sans changement de dépendance)

- Message exact du build : « ⚠ Your version of Next.js is affected by a known security vulnerability. This command is continuing after the upgrade reminder. » puis « Reference: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk » ; certains builds s'arrêtent sur `SecurityFatalError` et passent à la relance. Le message ne nomme pas l'avis.
- Version résolue (`pnpm-lock.yaml`) : `next@16.4.3` (et `eslint-config-next@16.4.3`).
- Identification par l'API citée (`{"next": ["16.4.3"]}`) : un seul avis, **GHSA-mfr8-8qww-v76h** (CVE-2026-119790), « Information disclosure across root params when a 'use cache' function is called through unstable_cache() », sévérité modérée (CVSS 4.0 : 6.3), versions affectées ≥ 16.3.0 et ≤ 16.4.4, **première version corrigée 16.4.5**. Avis : https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h.
- Conditions d'exposition : une fonction `'use cache'` qui lit un paramètre de la racine (root param), appelée à la fois directement et via `unstable_cache()`, pendant le premier remplissage après un démarrage. **Absentes du dépôt** : aucun `'use cache'`, aucun `unstable_cache`, aucun `cacheComponents`, aucun segment de racine dynamique (`app/[locale]` n'existe pas).
- Priorité : **basse** (version affectée, chemin vulnérable inutilisé). Correctif minimal à préparer dans un lot de dépendances distinct : `next` et `eslint-config-next` en 16.4.5, `pnpm install` (lockfile), puis la validation habituelle (typage, lint, tests, build, suite RLS, navigateur). **Corrigé au lot 14c (§35).**


## 35. Suivi — Lot 14c : Next.js 16.4.5 (GHSA-mfr8-8qww-v76h) (2026-11-17)

Branche `fix/lot-14c-next-security`, créée depuis `origin/main-dev` (7bb5278, lot 14b intégré). Mise à jour de dépendances seule : aucun fichier applicatif, aucune migration. Non commité, non déployé.

### Version retenue

- Avant : `next@16.4.3` et `eslint-config-next@16.4.3` (versions exactes dans `package.json`, résolues telles quelles dans `pnpm-lock.yaml`).
- Avis officiel relu (API GitHub Advisory, publié le 2026-11-16, non retiré) : GHSA-mfr8-8qww-v76h (CVE-2026-119790), sévérité modérée, `next` ≥ 16.3.0 et ≤ 16.4.4, **première version corrigée 16.4.5**. Les notes de version de 16.4.5 listent cet avis avec six autres correctifs modérés (GHSA-vc7v-qv4w-wrv8, GHSA-vvgp-ww4w-46vf, GHSA-rhh4-g77r-r9qj, GHSA-pc58-hwjq-p385, GHSA-7qx7-33qx-rqx2, GHSA-f3mh-rxg3-f5g2) ; à cette date, seul le premier figure dans la base GitHub.
- Avis publiés depuis : la base GitHub ne renvoie **aucun avis** affectant `next@16.4.5`, et un seul (le ciblé) pour 16.4.3. La 16.4.6 (`latest`, 2026-11-09) ne contient que des reports de corrections (dont la compression automatique des réponses de route handler, changement de comportement non souhaité ici), sans avis de sécurité.
- Retenu : **`next@16.4.5` et `eslint-config-next@16.4.5`**, épinglés comme avant.

### Diff de dépendances

`package.json` (2 lignes) et `pnpm-lock.yaml` : `next`, `@next/env`, `@next/swc-*`, `eslint-config-next` et `@next/eslint-plugin-next` passent de 16.4.3 à 16.4.5 ; cinq doublons transitifs devenus inutiles sont retirés (`caniuse-lite@1.0.30001793`, `@babel/parser@7.29.3`, `@babel/types@7.29.0`, `@babel/helper-string-parser@7.27.1`, `@babel/helper-validator-identifier@7.28.5`). Aucun nouveau paquet. Les dépendances déclarées par `next` sont identiques entre les deux versions. Installation avec pnpm 11.1.3 (`packageManager`) ; `pnpm install --frozen-lockfile` ✅.

### Audit `pnpm audit --prod`, par identifiant

| Avis | Paquet | Avant | Après |
|---|---|---|---|
| GHSA-mfr8-8qww-v76h (moderate) | `next` 16.4.3 | présent | **disparu** |
| GHSA-866g-f22w-33x8 (low) | `@ai-sdk/provider-utils` 4.0.27 (via `ai`) | présent | présent, inchangé (hors périmètre) |

Aucun nouvel avis.

### Avertissement du build

Le message « ⚠ Your version of Next.js is affected by a known security vulnerability… » (§34) n'apparaît plus : deux builds (`pnpm build` normal, puis relié à `easyjob-proof`), « ▲ Next.js 16.4.5 (Turbopack) », aucune occurrence de l'avertissement, de `SecurityFatalError` ni de l'URL `advisories/bulk`.

### Validation

| Contrôle | Résultat |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .` | ✅ |
| `pnpm test` | ✅ 45 fichiers, 558 tests |
| `pnpm build` | ✅ Next.js 16.4.5, sans avertissement |
| Preuves ciblées sur `easyjob-proof` (migrations à jour, 44/44), build de production + `next start` | ✅ `oauth-callback` 15/15 (retour vers `next`, chemins externes refusés), `admin-centralization` 32/32 (pages et routes admin), `contract-selection` 29/29 (dont F1-F3 : PDF du candidat et de l'entreprise, refus tiers 404 et anonyme 401), `essentials-gate` 6/6 (candidature par `POST /api/jobs/[id]/apply`, refus 403 `profile_not_verified`) |
| Navigateur : Chrome headless, 375×812 tactile, même build (script et fixtures hors dépôt, compte supprimé ensuite) | ✅ 13/13 : `/my-jobs?tab=history` sans session → `/auth/login?next=…` → connexion par le formulaire → retour à `/my-jobs?tab=history` ; `next=//evil.example/x` → reste sur l'application (`/profile`) ; candidat au téléphone vérifié refusé sur `/admin`, `/admin/dashboard`, `/admin/candidates`, `/admin/incidents` et par navigation client (renvoyé sur `/`) ; aucune erreur JavaScript ni d'hydratation ; pas de défilement horizontal |
| Suite RLS complète | non relancée en local (aucune route, RPC, politique ni preuve modifiée) ; couverte par la CI |

Observation sans lien avec la mise à jour : l'écran d'accueil (`components/ui/splash-screen.tsx`, environ 2,5 s à la première visite de la session) est un calque `fixed inset-0 z-100` qui capte les clics tant qu'il est affiché. Un script qui clique dès le chargement n'atteint pas le formulaire ; le composant est inchangé et le comportement est antérieur au lot.

## 36. Suivi — Lot 15 : fin de journée, code non remis et confirmation par le support (2026-11-17)

Branche `feat/lot-15-mission-completion`, créée depuis `origin/main-dev` (021c5e6, lot 14c intégré). Migration `20261119120000_mission_day_completion.sql`. Non commité, non déployé. Règles produit : SRS §6.8 (encadré « Lot 15 ») et §11.12.

### Constats de départ

- Le code d'une journée était accepté dès le début confirmé : *Tâches* affichait « En cours – fin prévue à … » avec un bouton actif, et `submit_completion_code` ne contrôlait aucune échéance.
- Le « code non remis » (lot 14) s'ouvrait dès le début prévu, même sans début confirmé.
- Aucune voie ne permettait de confirmer une journée sans code. L'expérience du candidat, l'unité d'offre, l'admissibilité des avis et le garde-fou des manquements ne reconnaissaient qu'un code consommé.

### Réalisation

| Sujet | Mise en œuvre |
|---|---|
| Échéance | `submit_completion_code` refuse `completion_not_open` (détail : fin prévue) tant que `now() < mission_days.ends_at`. Le contrôle vient après ceux qui existaient déjà (mission active, candidature sélectionnée, début confirmé) et **avant** toute lecture du code : code, compteur, fenêtre, blocage et réalisation restent intacts. `ends_at` est l'horaire figé, calculé en Africa/Douala (22 h → 6 h : fin le lendemain). |
| Code non remis | `report_mission_incident`, pour `code_not_received` : début confirmé exigé (`start_not_confirmed`) et fin prévue atteinte (`day_not_ended`), y compris en appel direct. Retard et absence inchangés. Une relance renvoie le dossier existant. |
| Provenance | `mission_days.completion_source` : `code`, `support` ou `legacy`. `legacy` marque à la reprise une réalisation antérieure sans code consommé, qui reste non comptée comme avant. Une contrainte lie réalisation et provenance, et la provenance est immuable une fois posée. La voie manuelle ne consomme jamais le code. |
| Contacts | `mission_incident_contacts` (append-only, aucun accès de session), par `admin_record_incident_contact` (tout admin actif). Une entrée est soit une demande (`sent`, `no_answer`, `unreachable`), soit une réponse obtenue (`work_confirmed`, `work_disputed`, `other`). Elle porte une date comprise entre le début de la journée et maintenant, un canal, une référence privée (obligatoire pour `work_confirmed`) et une note interne. Un double envoi ne crée pas de doublon ; l'audit ne reprend ni la référence ni la note. |
| Confirmation | `admin_confirm_mission_day` (`is_ops_admin_user`, compte actif). Conditions : dossier `code_not_received` ouvert, journée commencée, fin atteinte, réponse `work_confirmed` sur ce même dossier, motif. Verrous dans l'ordre mission, journée, dossier. Dans une seule transaction : décision (`decided`, `established`), ligne `mission_day_confirmations` (candidat, journée, dossier, contact, motif), journée marquée `support`, mission réalisée si c'était la dernière journée, trace `confirm_mission_day` dans `audit_logs` et notifications aux deux parties. Si la journée est déjà confirmée, le résultat acquis est renvoyé sans écriture. |
| Décision générique | `admin_decide_mission_incident` renvoie `use_day_confirmation` sur un « code non remis ». Entreprise injoignable ou travail contesté : le dossier reste en instruction. |
| Lectures | `mission_days_json` : `completion_available_at`, `completed_via`. `company_job_missions` : `completed_via`, et le code n'est plus renvoyé une fois la journée confirmée. `mission_incidents_for_party` : `resolution = support_confirmed_day`, motif masqué. `admin_mission_incident` : contacts, confirmation, `can_record_contact`, `can_confirm_day`. |
| Réputation et avis | Nouvelle fonction `mission_work_confirmed`. `compute_reputation` (candidat : une unité par mission dont toutes les journées sont `code` ou `support`), `reputation_company_offers`, `reputation_review_admissible` et `protect_reputation_incidents` acceptent une journée confirmée par code **ou** par le support. Les autres règles du lot 12 sont inchangées. |
| Écrans | La minuterie `useDeadlineNow` (`lib/realtime/use-deadline-now.ts`) est extraite de `useRecruitmentNow` (lot 11b), qui l'utilise désormais. Elle sert à *Tâches*, au point rouge de l'onglet, au détail de mission et au dossier admin. Dans *Tâches* et le détail : avant la fin, « Validation possible à partir de … » sans bouton ; à l'échéance, « Valider ma journée » et « Contacter le support » (dialogue du lot 14, nature présélectionnée, dossier existant retrouvé). Côté entreprise : « Confirmée par le support à …, après votre confirmation ». Côté support : contacts et confirmation (`app/admin/incidents/incident-completion-panel.tsx`). Les libellés « confirmée par code » sont corrigés là où la journée peut l'être par le support. |

### Preuves

La nouvelle preuve `mission-completion` (27 assertions) contrôle les horaires de trois façons : la fonction temporaire `proof_l15_case` pour l'instant exact, les horaires réels pour la nuit et le passage de minuit, la barrière du lot 11 pour les courses. Un trigger temporaire provoque la panne.

| Contrôle | Résultat |
|---|---|
| T1-T4 : juste avant la fin (+1 ms, heure de la base), le bon code et un code saisi pendant un blocage sont refusés sans rien modifier ; route (409 + `available_at`) et appel direct ; accepté à l'instant exact | ✅ |
| T5 : journée de 22 h à 6 h, fin à 6 h le lendemain (base, écran et refus) ; T6 : journée commencée la veille à 23:59 et finie après minuit, code accepté | ✅ |
| R1-R2 : code non remis refusé sans début, avant la fin (route et appel direct) et juste avant ; accepté à l'instant exact ; une relance renvoie le même dossier ; retard inchangé | ✅ |
| S1-S5 : contacts (demande, réponse contestée), validations, doublons ; confirmation refusée sans « travail confirmé » ; décision générique refusée ; refus pour le support, les parties, l'anonyme et un ops suspendu avec un jeton émis avant sa suspension (route, appel direct, contact, lecture) | ✅ |
| S6-S9 : confirmation avec provenance `support`, code non consommé, aucun départ enregistré, mission réalisée, décision rattachée, une trace, une notification par partie ; relance sans écriture ; un code saisi ensuite renvoie le résultat acquis ; confidentialité côté parties ; écrans entreprise et *Tâches* à jour | ✅ |
| C1 code puis support et C2 support puis code (ordres imposés) : une seule réalisation ; C3 code reçu pendant l'instruction | ✅ |
| P1-P2 : panne de la trace pendant la confirmation → 500 générique, rien n'est écrit ; la reprise aboutit | ✅ |
| E1-E3 : période complète (journée 1 par code, journée 2 par le support) réalisée à la dernière journée, candidat +1 une seule fois ; avis admissible ; offre +1 une seule fois après la clôture ; aucun manquement ni paiement | ✅ |
| X1-X2 : tables du lot fermées en session, provenance non modifiable, tiers 404, anonyme refusé | ✅ |
| Contrôle négatif 1 : `submit_completion_code` sans échéance | T1-T5 en échec (régression détectée) |
| Contrôle négatif 2 : confirmation ouverte à `is_admin_user` | S5 en échec (régression détectée) ; fonctions d'origine rétablies et relues |

Preuves existantes adaptées à l'échéance :

- `mission-time-tracking` et `multi-day-jobs` (journée 2 de la section M) ;
- `mission-incidents` : mercredi terminé et commencé ; la section S porte sur le retard de lundi ; S0 vérifie le refus de la décision générique sur un code non remis, S5 la clôture du code non remis par le code, J3 le refus `start_not_confirmed` ;
- `realtime` et `company-dossier-visibility`.

Les fixtures de `multi-day-jobs` (section Q) et de `reputation` marquaient une mission réalisée en clé service sans confirmer ses journées, un état impossible par les RPC. Elles confirment désormais les journées, comme `submit_completion_code`.

Navigateur (Chrome headless, 375 × 812 tactile, build de production relié à `easyjob-proof`, script et fixtures fictives hors dépôt) : ✅ 24/24, FR puis EN.

- La fin prévue est placée 40 s plus tard en base. « Valider ma journée » et « Contacter le support » apparaissent dans *Tâches* et dans le détail déjà ouverts 64 à 86 ms après l'échéance, sans rechargement.
- Contact du support depuis la tâche : nature présélectionnée, lien « Voir mon dossier » ; une relance indique que le dossier existe déjà.
- Le support consigne une demande puis une réponse « travail confirmé » ; la confirmation lui reste en lecture seule.
- Ops reçoit la réponse sur son écran ouvert, puis confirme la journée.
- Sans rechargement : *Tâches* propose « Noter l'entreprise », le détail affiche « Confirmée par le support » sans le motif, l'entreprise voit la confirmation et le code n'est plus affiché.
- Aucun défilement horizontal, aucune erreur JavaScript.

### Validation de l'état final

| Contrôle | Résultat |
|---|---|
| `pnpm test` (Vitest), puis suite RLS complète, l'un après l'autre | ✅ 570 tests (47 fichiers ; nouveaux : `mission-day-completion`, `douala-time`). Au premier passage, un échec intermittent sous charge, sortie non conservée et test non identifié (le lot 10 signale déjà `proof-db-query` comme intermittent) ; quatre passages suivants verts. |
| `pnpm test:rls` (pile réinitialisée depuis les seules migrations, build de production) | ✅ 34/34 au premier passage, 731 s. Un passage précédent avait révélé `realtime` (M4, M5) et `company-dossier-visibility` (M7), qui saisissaient un code avant la fin prévue ; corrigés ci-dessus |
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .`, `pnpm build` | ✅ (Next.js 16.4.5, sans avertissement) |
| Types générés (`supabase gen types` sur la pile réinitialisée) | ✅ identiques à `lib/database.types.ts` |

### Limites

- Entreprise injoignable ou travail contesté : aucune issue (SRS §11.12) ; le dossier reste en instruction.
- Journée jamais commencée : ni code ni confirmation manuelle possibles, le début confirmé étant exigé comme pour le code.
- Effet d'une journée confirmée par le support sur le futur versement : à traiter dans le lot paiement.
- `protect_reputation_incidents` raisonne encore à la mission (lot « Engagements et annulations »).
- Une panne pendant la confirmation n'alerte pas le support : l'écran affiche l'erreur et l'action peut être relancée.

## 37. Suivi — Lot 16 : journées contestées, double validation et révision interne (2026-11-17)

Branche `feat/lot-16-completion-disputes`, créée depuis `origin/main-dev` (78331c7, lot 15 intégré, identique au travail local). Migration `20261120120000_completion_disputes.sql`. Non commité, non déployé. Règles produit : SRS §6.8 (encadré « Lot 16 »), §11.12 et §11.13.

### Réutilisé

Dossiers par journée, versions et justificatifs privés (lot 14) ; contacts, confirmation explicite de l'entreprise et réalisation unique (lot 15 : verrous mission puis journée) ; grades `is_admin_user` / `is_ops_admin_user` (compte actif) ; `audit_logs` ; notifications durables (`notifications`) ; signaux privés (`rt_signal_users`, `rt_signal_admin`) ; tâche planifiée `reputation-expiry-sweep` (pg_cron, toutes les 15 minutes), qui appelle désormais aussi `incident_deadline_sweep()`. Les fonctions des lots 9c à 15 modifiées sont reprises à l'identique, sauf les lignes marquées « Lot 16 ».

### Réalisation

| Sujet | Mise en œuvre |
|---|---|
| Instruction | Situation qualifiée par le support (`admin_set_incident_situation`) ; questions adressées à une partie (`admin_request_incident_info`, notification dans l'application) et réponses (`answer_incident_info_request`, hors limite des 5 déclarations) ; notes internes (`admin_add_incident_note`) ; contacts avec `channel_verified`. Déclarations et pièces restent recevables après une décision (nouveaux éléments). |
| Délais | Origine : `created_at` du dossier + prolongations (`deadline_extension_hours`, `admin_extend_incident_deadlines` : 1 à 168 h, 720 h au total, motif, événement et audit). Pour un dossier ouvert par le candidat : événements `opened` et `party_notified` (in-app) à l'ouverture ; `reminder_24h` (notification à l'entreprise) et `escalation_48h` (interne) posés par `incident_deadline_sweep(p_at)` si l'entreprise n'a pas répondu (déclaration ou réponse consignée). Un index unique par étape rend le balayage idempotent. Aucune confirmation ni sanction n'est déclenchée. |
| Version du dossier | `mission_incidents.revision`, incrémentée par chaque déclaration, pièce, réponse obtenue ou requalification (déclencheurs). |
| Double validation | `admin_propose_incident_decision` (ops ou fondateur, conflit déclaré, version courante ; « établi » sur silence : examen renforcé atteint et second canal vérifié tenté) ; `admin_review_incident_proposal` (autre ops ou fondateur, non concerné ; refus `self_review_forbidden`, `proposal_stale`, `proposer_conflict`). Décision, journée `exceptional`, fin de mission, audit, événement et notifications dans une transaction. Un dossier tranché ailleurs ou une journée déjà confirmée : `already_confirmed` ou `obsolete`, sans écriture. Relance : `already_decided`. |
| Conflit d'intérêts | `mission_incident_conflicts` (append-only) : déclaration exigée à la proposition, à la validation et à l'affectation d'une révision ; « concerné » enregistré et bloquant. |
| Résultats | `established`, `not_established`, `partial`, `disagreement` (tentative amiable et orientation exigées). La décision générique du lot 14 reste réservée aux retards (`use_dispute_decision` pour une absence). |
| Révision | `request_incident_review` (partie, `now() < review_deadline` = décision + 7 jours ; l'autre partie rejoint la même révision) ; `admin_take_incident_appeal` (agent distinct du proposant et du décideur, non concerné) ; `admin_decide_incident_appeal` (maintenue, révisée, arbitrage ; une décision « établie » n'est pas annulée). Décisions successives append-only (`supersedes_id`). |
| Lectures | Parties : chronologie publique, questions qui leur sont adressées, décisions sans éléments vérifiés, révision (échéance, statut). Support : échéances, chronologie interne, notes, propositions (version, relecture), décisions, révisions (agents distincts disponibles). |
| Écrans | Parties : chronologie, réponse aux questions, décisions et demande de révision dans la carte de signalement (détail de mission et écran entreprise). Support : panneau d'instruction (`app/admin/incidents/incident-dispute-panel.tsx`) ; badges de liste (relancé, examen renforcé, proposition, révision) ; case « canal vérifié ». Provenance « Confirmée par décision du support » dans les écrans existants. |

### Preuves

Nouvelle preuve `mission-disputes` : 24 assertions, 55 s dans la suite complète.

| Contrôle | Résultat |
|---|---|
| D1-D5 : relance à 24 h et examen renforcé à 48 h exactement (rien à −1 µs) ; balayages répétés et concurrents sans doublon ; prolongation de 12 h (relance à 36 h exactement), motif, audit, invisible des parties ; réponse de l'entreprise qui arrête les relances ; silence sans confirmation | ✅ |
| V0-V5 : examen renforcé puis second canal vérifié exigés pour un silence ; support et entreprise refusés ; auto-approbation refusée ; déclaration de conflit exigée et bloquante ; ops suspendu avec un ancien jeton refusé (route, appel direct) ; dossier modifié pendant la seconde revue → `proposal_stale` ; double clic et relance → une décision ; journée `exceptional`, code non consommé ; révision possible exactement 7 jours | ✅ |
| C1-C4 : code puis décision, décision puis code (ordres imposés) ; confirmation explicite de l'entreprise puis décision ; panne de la trace → 500 générique, rien d'écrit, puis reprise | ✅ |
| R1-R3 : non établi (absence contestée) sans sanction, réputation inchangée ; partiel sans fin de journée ni division du forfait ; désaccord avec tentative amiable et orientation | ✅ |
| A1-A4 : révision refusée à l'échéance exacte, acceptée 1 ms avant ; demandes des deux parties ; proposant et décideur exclus ; agent affecté seul décide ; décisions successives ; annulation d'une journée confirmée refusée (`arbitration_required`) ; aucun agent distinct disponible (0 observé) → attente d'affectation | ✅ |
| I1, X1 : questions isolées par partie, réponse unique ; aucun élément vérifié, note interne ni référence privée dans les réponses des parties ; autre candidat et entreprise tierce 404 ; tables du lot fermées en session | ✅ |
| Contrôle négatif 1 : seconde validation sans le refus d'auto-approbation | V2 en échec (et suites V3, V4, A4) |
| Contrôle négatif 2 : seconde validation sans contrôle de version | V3 et V4 en échec ; fonction d'origine rétablie et relue |

Pendant la mise au point, la preuve a révélé deux défauts de la preuve elle-même, corrigés :

- instants calculés côté client à la milliseconde alors que `created_at` est à la microseconde ; la base calcule désormais l'instant ;
- `undefined` passé à un paramètre par défaut, qui réactivait « aucun conflit ».

Preuves existantes rejouées sans modification : `mission-incidents`, `mission-completion`, `mission-time-tracking`, `multi-day-jobs`, `reputation`.

Navigateur (Chrome headless, 375 × 812 tactile, build de production relié à `easyjob-proof`, script et contenus fictifs hors dépôt) : ✅ 20/20 en FR puis EN, en 64 s, avec un candidat, une entreprise et deux agents ops.

- Le candidat ouvre le dossier depuis la journée ; l'entreprise le voit en 0,3 s sans rechargement.
- Question du support reçue par l'entreprise, réponse envoyée ; le candidat ne voit pas la question.
- Proposition d'OPS1 visible chez OPS2 ; relecture affichée dès un nouvel élément de l'entreprise ; nouvelle proposition, puis validation par OPS2.
- Décision reçue par l'entreprise en 4 à 53 ms ; le candidat, hors ligne pendant la décision, la reçoit 0,5 s après la reconnexion, sans rechargement.
- Les parties lisent faits retenus, contradictions, justification et échéance de révision, jamais les éléments internes.
- Révision demandée par l'entreprise : en attente d'affectation, non affectable aux deux agents.
- Aucun défilement horizontal, aucune erreur JavaScript.

### Validation de l'état final

| Contrôle | Résultat |
|---|---|
| `pnpm test` (Vitest), puis suite RLS complète, l'un après l'autre (sorties conservées) | ✅ 578 tests, 48 fichiers, 10 s (nouveau : `mission-disputes`) ; aucun échec intermittent observé |
| `pnpm test:rls` (pile réinitialisée depuis les seules migrations, build de production) | ✅ 35/35 au premier passage, 712 s |
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .`, `pnpm build` (26 s, Next.js 16.4.5, sans avertissement) | ✅ |
| Types générés (pile réinitialisée) | ✅ identiques à `lib/database.types.ts` |

### Limites et décisions nécessaires

- **Annulation d'une journée confirmée** (SRS §11.13) : non introduite. Elle toucherait la réalisation immuable de la journée et de la mission, les avis déjà admissibles, la réputation rejouée (unités du candidat et de l'entreprise) et le futur versement.
- **Réalisation partielle** : identifiée seulement ; son traitement (journée, montant) relève du lot paiement.
- **Recours externes** : l'orientation est un texte libre ; la liste des recours à indiquer reste à valider.
- **Notifications externes** : aucun SMS ni e-mail n'est envoyé. Une tentative externe est seulement consignée par le support.
- **Délais** : appliqués aux dossiers ouverts par le candidat (l'entreprise doit répondre). Un dossier ouvert par l'entreprise n'a pas de relance automatique du candidat.
- **Tâche planifiée** : passage réel de pg_cron non observé sur la pile locale ; le balayage est appelé par la preuve. À vérifier après déploiement (`cron.job`, premier passage).
- **Journée jamais commencée** : toujours ni code ni confirmation, quelle que soit la voie.

---

## 38. Audit ciblé — abonnements candidat Free/Premium, préparation du lot 17 (2026-11-17)

Branche `feat/lot-16-completion-disputes`, commit `071f4b7` (lot 16), arbre propre ; stash `lint-staged automatic backup` conservé. Revue documentaire : aucun code, aucune migration ni aucun écran modifié ; aucune preuve RLS rejouée. Décisions inscrites : `PLAN_ACTION.md` (lot 17), SRS §5.2, §5.3, §6.11 et §11.9.

### Grille actuelle : annoncée et appliquée

| Avantage annoncé | Emplacement | Comportement réel | Contrôle côté serveur | Écart | Traitement proposé |
|---|---|---|---|---|---|
| Prix 1 000 FCFA / mois | `lib/i18n/fr.ts` et `en.ts` (`profile.upgradePremium.price`, `pricePeriod` ; FAQ « Comment fonctionne Premium ? ») ; SRS §6.11 ; US-SUB-01 (J+30) | Prix affiché, sans paiement. « Contactez le support » (`subscribeUnavailable`, `renewalNote`) | Aucun : `subscriptions` n'est écrite que par la clé service (lot 2, F-06) et n'est pas reliée au candidat | Durée non encodée (« mois » à l'écran, J+30 dans US-SUB-01) | Conserver le prix existant comme référence. Durée à fixer (30 jours ou mois civil) |
| Activation, échéance, plan effectif | `my_account_state` (`20261107150000_app_realtime_signals.sql`) ; miroir `isCandidatePremiumActive` (`lib/utils/company-plan.ts`) ; `/upgrade/candidate` | Premium actif si `users.role = candidate_premium` **et** `premium_until > now()`. Bascule à l'échéance sur l'heure du serveur, sans écriture | Colonnes protégées (lots 1 et 2) ; aucune RPC d'activation ; aucun écran admin (la fiche admin lit seulement `premium_until`) | Activation par SQL en clé service, sans audit ni motif. Deux sources : `profile-completion-widget.tsx:123` lit le rôle seul (CTA masqué pour un Premium expiré) ; `lib/matching/ai-matching.ts:131` lit `premium_until` seul | RPC admin gardée et auditée ; fonction SQL unique du plan effectif à un instant donné, réutilisée par le lot 17 |
| « Priorité sur toutes les candidatures », « Votre profil remonte en premier auprès des entreprises » | `profile.upgradePremium.bullets.priority`, `profile.premium.benefits.priority` (FR/EN) ; `PremiumBanner`, `PremiumBenefits`, `/upgrade/candidate` ; SRS §6.5 (5 %), §6.11 | `company_job_applicants` (`20261116120000_contract_selection.sql`) trie par `starts_at`, `match_score`, `created_at`. `match_score` n'est écrit par aucune RPC : l'ordre réel est la date de candidature. Le plan n'est pas transmis à l'entreprise | Aucun | **Promesse affichée non tenue.** Le poids de 5 % existe dans `ai-matching.ts`, mais `/api/matching` n'a aucun appelant et n'écrit rien | Retirer le texte (lot 17a). Toute priorité future suit les mécanismes ci-dessous |
| « Accès aux offres exclusives Premium » | `bullets.exclusive`, `premium.benefits.exclusive` (FR/EN) ; SRS §6.11 | Aucune offre réservée : ni colonne sur `jobs`, ni filtre de liste, ni contrôle dans `apply_to_job` | Aucun | **Promesse affichée non tenue** | Retirer, sans la remplacer (voir grille proposée) |
| Badge Premium visible par les entreprises | SRS §6.11, US-SUB-01 ; slogan « Démarquez-vous auprès des entreprises » | `PremiumBadge` seulement sur le profil du candidat (`candidate-profile-client.tsx:366`). La RPC des candidats n'expose aucun indicateur de plan | — | Le slogan suggère une visibilité qui n'existe pas | Ne pas exposer le plan aux entreprises ; reformuler le slogan |
| Paiement accéléré (48 h, 50/50, 7 jours) | SRS §5.3, §6.11, §7 ; US paiement et US EasyBot (trois paliers) | Retiré des écrans au lot 9 (`premium-benefits.tsx`, `payment-delay-info.tsx` ignore le rôle). EasyBot n'en parle pas et refuse tout délai (`lib/chat/system-prompt.ts`). Aucun versement | — | Reste dans le SRS et les user stories seulement | Ne pas réintroduire avant le lot paiement |
| Annulation, frais, sanctions | SRS §5.3 (moins de 24 h : perte des niveaux supérieurs ; absence : blocage 7 jours, bannissement à 3) ; SRS §11.9 | Aucun parcours d'annulation après sélection : `withdraw_job_application` refuse hors `pending` et `shortlisted` (`application_not_withdrawable`). `reputation_incidents` sans producteur. `cancellation_penalties`, `no_show_count`, `late_cancellation_count` jamais écrits. Aucune différence entre les plans | Base : manquement appliqué (−5) si une ligne existe (lot 9c) | Règles du SRS obsolètes (niveaux retirés) ; aucune souplesse Premium | Lot 17 (décisions ci-dessous) |
| Accompagnement, support | Centre d'aide, dossiers et contestations (lots 14 à 16) | Identiques pour tous les candidats ; aucune file prioritaire | Grades admin seuls | Aucun | Conserver l'égalité d'accès |
| Alertes, filtres, favoris | Aucune annonce candidat Premium ; `job_favorites` lu par `app/api/jobs/[id]/route.ts` | Pas d'alerte de nouvelle offre ; filtres de liste communs | — | Aucun | Option future (grille proposée) |
| Accueil et EasyBot | `home` (« Inscription gratuite ») ; `CHAT_SYSTEM_PROMPT` | Aucune mention de Premium | — | Aucun | Mettre EasyBot à jour quand la grille est livrée |

Trois constats transverses :

- les deux avantages présentés aujourd'hui sur la page d'abonnement, le profil et la bannière ne sont pas livrés. `tests/user-facing-claims.test.ts` ne les détecte pas : ajouter ces formules au test lors de leur retrait ;
- la réputation est indépendante du plan, en base (`20261109120000_reputation_stars.sql`, en-tête) comme dans le SRS §5.2 ;
- côté entreprise, `premiumCompany…priorityPool` (« Vos offres remontent en premier auprès des candidats Premium et notés 4★+ ») annonce aussi un mécanisme inexistant. Ce texte relève du futur lot « Design entreprise » ou d'un lot sur les plans entreprise.

### Décisions validées pour le lot 17 (2026-11-17)

Elles figurent dans `PLAN_ACTION.md` (lot 17) et dans le SRS §5.2. Après sélection : Free annule sans sanction jusqu'à 48 h avant la journée, Premium jusqu'à 24 h ; les limites exactes sont incluses ; une annulation reste signalable après le délai ; la décision du support précède toute sanction ; un empêchement reconnu ne donne aucune sanction ; une annulation tardive injustifiée ou une absence injustifiée confirmée retire 5 unités d'expérience ; un événement (y compris l'abandon de plusieurs journées dans une même demande) donne un seul manquement ; le retrait avant sélection reste sans sanction ; un retard suivi du travail peut figurer dans l'avis privé, sans sanction automatique. Journées au choix : l'annulation vise les journées désignées. Période complète : le support examine la poursuite et le remplacement. Les réalisations antérieures sont conservées.

Référence horaire proposée pour l'implémentation : début figé de la journée (lot 11b), heure de la base, affichage `Africa/Douala` (UTC+1, sans heure d'été). Exemple : journée du samedi 21 novembre à 08:00. Free sans sanction jusqu'au jeudi 19 à 08:00:00 inclus, Premium jusqu'au vendredi 20 à 08:00:00 inclus ; à 08:00:01, l'annulation est tardive et transmise au support. Une journée de nuit 22:00 → 06:00 se compte depuis 22:00.

### Points à arbitrer avant l'implémentation

**1. Plan retenu pour le délai.** Exemple commun : journée du samedi 21 novembre à 08:00, sélection le lundi 16 à 10:00.

| Option | Cas A : Free à la sélection, Premium activé jeudi 19 à 11:00, annulation jeudi 19 à 12:00 (J−44 h) | Cas B : Premium à la sélection, échu mercredi 18 à 23:59, annulation vendredi 20 à 07:30 (J−24 h 30) | Conséquences |
|---|---|---|---|
| Plan à l'annulation | Sans sanction (limite Premium : vendredi 08:00) | Tardive (limite Free : jeudi 08:00) | Simple, mais permet d'acheter Premium pour annuler. L'entreprise ne peut pas prévoir le préavis |
| **Plan figé à la sélection (recommandé)** | Tardive, transmise au support | Sans sanction | Prévisible pour les deux parties, comme les conditions figées du contrat. Valeur à enregistrer par `sign_and_select` sur l'engagement, hors empreinte du contrat. Journées au choix : figée à chaque sélection |
| Le plus favorable des deux | Sans sanction | Sans sanction | Protège le candidat ; garde l'effet d'aubaine |
| Premium aux deux instants | Tardive | Tardive | Le plus strict ; difficile à expliquer |

Si le plan est figé, l'entreprise doit voir la date limite d'annulation sans sanction de chaque engagement, sans mention du plan.

**2. Expiration ou activation après sélection.** Avec un plan figé, ni l'échéance ni l'activation ne changent un engagement déjà pris. Avec le plan à l'annulation, l'échéance raccourcit le préavis (cas B) et l'activation l'allonge (cas A). À trancher dans les deux cas : une activation retirée par le support pour erreur rétablit-elle le délai Free sur les engagements pris pendant cette activation ?

**3. Sélection faite quand le délai sans sanction est déjà passé.** Le cas n'est pas réservé aux offres urgentes. En régime normal, la sélection reste ouverte jusqu'à H−24 (lot 11b) :

- journée du samedi 21 à 08:00 et sélection le jeudi 19 à 20:00 (J−36 h) : le délai Free est dépassé depuis 12 h ; il reste 12 h à un Premium ;
- offre urgente publiée le vendredi 20 à 12:00 pour le samedi 21 à 06:00, sélection le vendredi 20 à 15:00 : les deux délais sont dépassés (Free : jeudi 06:00, Premium : vendredi 06:00). La sélection reste possible jusqu'au samedi 04:00 (H−2).

| Option | Effet | Conséquences |
|---|---|---|
| Stricte | Toute annulation après une telle sélection est tardive et examinée | Simple. Lourd pour un candidat qui a postulé des jours plus tôt et n'est prévenu que dans l'application (aucune notification push) |
| **Délai de réaction après la sélection (recommandé)** | Annulation sans sanction pendant N heures après la sélection, sans dépasser un seuil avant le début (valeurs à fixer ; exemple : 2 h, au plus tard H−3) | Exemple urgent : sélection vendredi 15:00 → sans sanction jusqu'à 17:00 ; l'entreprise peut encore resélectionner jusqu'au samedi 04:00. Délai et date affichés dans *Tâches* |
| Sans sanction jusqu'à la signature du contrat par le candidat | Le délai part de la signature | Incite à ne pas signer (la mission peut commencer sans signature, lot 13) ; déconseillé |

Dans tous les cas, afficher avant l'envoi de la candidature la règle applicable si la sélection arrive tard.

**4. Abandon de plusieurs journées dont certaines sont hors délai.** Exemple : journées au choix lundi 23, mardi 24 et mercredi 25 novembre à 08:00, candidat Free, demande le samedi 21 à 10:00. Lundi est à J−46 h (hors délai) ; mardi (J−70 h) et mercredi (J−94 h) sont dans le délai.

| Option | Effet | Conséquences |
|---|---|---|
| Demande jugée en bloc | Un dossier pour les trois journées ; un seul manquement (−5) au plus | Simple ; libère mardi et mercredi seulement après la décision du support |
| **Partage de la demande (recommandé)** | Mardi et mercredi annulés aussitôt, sans examen ; lundi forme l'événement unique soumis au support | Même sanction maximale (−5, une fois) ; places libérées aussitôt (sélection de mardi ouverte jusqu'au lundi 08:00) |
| En complément | Avant l'envoi, état de chaque journée affiché (« sans sanction » ou « examinée par le support ») ; le candidat peut garder lundi | Moins d'abandons tardifs |

Période complète (lundi 23 à mercredi 25), annulation le lundi 23 à 20:00 après une journée de lundi confirmée : mardi est à J−12 h, la demande est tardive. Elle forme un seul événement et le support examine la poursuite et le remplacement. La journée de lundi reste acquise. La mission n'étant pas entièrement réalisée, elle ne rapporte pas d'unité (règle du lot 12). Le forfait n'est pas divisé (lot paiement).

**Point découvert : préavis Premium et fermeture de la sélection.** Une annulation Premium faite à J−24 h exactement arrive quand la sélection d'une offre normale vient de se fermer (refus à H−24 exact, lot 11b). L'entreprise ne peut alors plus remplacer la place par la plateforme. Avec le délai Free (J−48 h), il lui reste 24 h. La souplesse Premium suppose donc une règle de remplacement : sélection rouverte pour la seule place libérée jusqu'à H−2, remplacement par le support, ou aucun remplacement. C'est à décider au lot 17d, car aucune réouverture silencieuse n'est admise (lot 11b).

### Grille Free/Premium proposée

Constantes pour les deux plans : candidature à toutes les offres publiées selon les mêmes exigences (CNI valide, documents, compétences, profil ≥ 60 %) ; réputation selon les règles d'étoiles du §5.2 ; vérification des documents ; support, signalements, contestations et révision interne ; contrat, PDF et montant fixe selon le contrat. Prix : seul existe 1 000 FCFA / mois (textes FR/EN, SRS §6.11) ; aucun nouveau prix n'est proposé.

| Avantage | Plan | Bénéfice candidat | Valeur entreprise | Dépendance technique, coût opérationnel | Effet sur Free | Quand |
|---|---|---|---|---|---|---|
| Annulation sans sanction jusqu'à J−48 h | Free | Règle claire, affichée par engagement | Préavis qui laisse 24 h pour resélectionner en régime normal | Lot 17 ; dossiers support pour les annulations tardives | — | Lot 17 |
| Annulation sans sanction jusqu'à J−24 h (acquis) | Premium | Souplesse face aux imprévus | Faible, voire négative : préavis plus court. À compenser par la règle de remplacement | Lot 17 ; plan effectif fiable et tracé (17a) | Aucun | Lot 17 |
| Relevé d'expérience PDF (missions et journées confirmées, entreprises, dates ; sans avis ni montant) | Premium | Preuve d'expérience hors plateforme | Indirecte : candidats plus investis | Générateur PDF du lot 13 et données existantes ; coût faible ; à ne pas présenter comme une attestation officielle | Aucun : l'historique reste visible dans l'application | Réalisable après le lot 17 |
| Alerte de nouvelle offre correspondant aux compétences et à la ville | Premium | Être informé plus tôt | Plus de candidatures rapides, surtout pour les offres urgentes | Notification dans l'application et signal temps réel, déclenchés à la publication (`moderate_job`) ; volume à limiter. Pleine valeur avec les notifications push (non livrées) | Léger avantage de rapidité ; la liste reste commune et toutes les offres restent visibles | Partielle maintenant ; complète avec les notifications push |
| Priorité d'affichage (option à arbitrer) | Premium | Être vu plus tôt dans la liste | Discutable : le tri ne reflète plus le mérite | Voir les mécanismes ci-dessous | Recul dans la liste | Non recommandée tant que le classement n'est pas défini |
| Paiement de l'abonnement en libre-service | Les deux | Activation sans le support | — | Lot paiement (fournisseur, webhooks, rapprochement) | — | Lot paiement |

Mécanismes de priorité envisageables, tous sans effet sur la liberté de choix (l'entreprise voit tous les candidats et sélectionne qui elle veut) :

1. **Tri secondaire.** Premium avant Free à l'intérieur de chaque journée, puis par date. Comme `match_score` est vide, l'abonnement deviendrait le premier critère de tri réel : un Free arrivé plus tôt passerait derrière un Premium arrivé plus tard. À limiter à des candidats à égalité sur un critère de mérite défini, s'il en existe un.
2. **Candidature anticipée.** Premium avant Free pendant un temps après la publication. Défavorable aux Free et aux offres urgentes ; déconseillé.
3. **Mise en avant signalée.** Libellé « Premium » visible par l'entreprise. Ce n'est pas un signal de fiabilité, puisque le préavis Premium est plus court ; déconseillé.

Ne sont pas proposés : offres exclusives (moins de candidats par offre, Free exclus), paiement accéléré (aucun versement), sélection garantie, file prioritaire de vérification documentaire (ralentirait l'inscription des Free).

**Lecture commerciale.** Après retrait des promesses non livrées, Premium repose sur la souplesse d'annulation, puis sur le relevé et les alertes. Sa valeur reste mince tant que le paiement et les notifications push ne sont pas livrés. Il est conseillé de ne pas promouvoir Premium avant la livraison du lot 17.

### Décisions encore nécessaires

1. Plan retenu pour le délai : à la sélection (recommandé) ou à l'annulation ; sort d'une activation retirée par le support.
2. Sélection après le délai : option, durée N du délai de réaction et seuil avant le début.
3. Abandon mixte : partage de la demande (recommandé) ou demande jugée en bloc.
4. Remplacement après annulation : réouverture de la sélection pour la place libérée, remplacement par le support ou aucun remplacement (règle du lot 11b à amender explicitement).
5. Empêchement : justificatifs acceptés, délai de dépôt, grade qui décide (`admin_ops`/`admin_founder` comme aux lots 14 à 16, double validation ou non) ; constat d'une absence injustifiée sur les dossiers du lot 14.
6. Blocage de 7 jours et bannissement à trois absences (SRS §5.3, §11.9) : remplacés par le retrait de 5 unités ou conservés en plus.
7. Côté entreprise, encore ouvert : délai de 12 h, trois décisions en 90 jours, offre partiellement pourvue, imputabilité, pénalité de 20 % (lot paiement).
8. Premium : durée (30 jours ou mois civil), priorité retenue ou non, relevé et alertes retenus ou non, visibilité du plan par l'entreprise (déconseillée).

### Ordre d'implémentation proposé

1. **17a — Plan effectif candidat et textes.** Fonction SQL unique du plan à un instant donné ; RPC admin d'activation et de prolongation (grade, motif, `audit_logs`, signal `subscription`) ; widget et matching alignés ; promesses « priorité » et « offres exclusives » retirées en FR et EN, puis ajoutées à `user-facing-claims`.
2. **17b — Annulation par le candidat après sélection.** Journées désignées ou période complète ; délai figé et limite incluse ; date limite affichée aux deux parties ; demande partagée selon le point 4 ; annulation tardive transmise comme signalement.
3. **17c — Décision du support et manquement unique.** Producteur de `reputation_incidents` (un événement, un retrait) ; empêchement reconnu ; absence injustifiée confirmée sur les dossiers du lot 14 ; `protect_reputation_incidents` aligné sur la journée ; annulation de décision (solde rétabli, déjà en base).
4. **17d — Entreprise.** Information, place libérée, remplacement ; annulation par l'entreprise (arbitrages du point 7).
5. **Lot Free/Premium**, après le lot 17 : page d'abonnement réécrite, relevé d'expérience, alertes dans l'application, EasyBot. Puis notifications push, puis paiement (abonnement en libre-service, pénalités, versements).

---

## 39. Suivi — Lot 17a : plan candidat effectif, attribution administrative de Premium et conditions figées à la sélection (2026-11-17)

Branche `feat/lot-17a-candidate-subscriptions`, créée depuis `origin/main-dev` (`071f4b7`, lot 16 intégré). Les trois documents de l'audit du §38 sont conservés tels quels dans la branche. Migration `20261121120000_candidate_premium_plan.sql`. Non commité (travail local ; aucun déploiement effectué depuis ce travail). Essais sur la pile `easyjob-proof` uniquement. Règles produit : SRS §5.2, §6.5 et §6.11.

### Lectures du plan, avant et après

| Lecture | Avant | Après (lot 17a) |
|---|---|---|
| Base | `my_account_state` : rôle `candidate_premium` et `premium_until > now()`, règle écrite en ligne | `candidate_effective_plan(utilisateur, instant)` : même règle, en un seul endroit, fin exacte exclue. Fonction fermée aux sessions. Lue par `my_account_state`, `admin_candidate_premium`, `admin_manage_candidate_premium` et le trigger de sélection |
| État du compte (client) | `candidate.premium` ; bascule locale à l'échéance | Ajout de `candidate.plan` (`free`, `premium`) et `premium_started_at` ; `expireLocally` repasse en Free à l'instant exact (test unitaire) ; minuterie sur l'heure du serveur inchangée |
| Profil candidat, `/upgrade/candidate` | `useAccountState` + `isCandidatePremiumActive` réécrits dans chaque écran | Hook unique `useCandidatePlan` (`my_account_state`, puis rendu serveur avec la même règle en attendant) |
| Widget de complétude | `isCandidatePremium(role)` : rôle seul, un Premium échu passait pour Premium | Incitation retirée ; `isCandidatePremium` supprimée |
| Matching (`lib/matching/ai-matching.ts`) | `premium_until` seul, poids 5 %, motif « Candidat premium » renvoyé à l'appelant | Critère retiré (poids ramenés sur 75 %) — **décision validée le 2026-11-18** ; une priorité éventuelle sera définie avec la future grille commerciale. La route `/api/matching` n'a aucun appelant ; le plan n'est jamais renvoyé à une entreprise |
| Fiche admin | `premium_until` brut (« jusqu'au » une date passée) | Panneau « Premium (attribution administrative) » : plan effectif, début, fin, historique |
| Routes de profil candidat | Rôle `candidate` ou `candidate_premium` : contrôle d'accès, pas de plan | Inchangées |
| RPC métier | `apply_to_job`, `sign_and_select`, réputation, signalements : aucune lecture du plan | Inchangées ; seul le trigger des conditions d'engagement lit le plan |

`users.role` reste `candidate_premium` après une échéance naturelle (aucune écriture à l'échéance, décision du lot 7d) ; seul le calcul fait foi. `app_metadata.role` du jeton n'est pas mis à jour : le middleware ne l'utilise que pour reconnaître un admin.

### Réalisation

| Sujet | Mise en œuvre |
|---|---|
| Attribution | `admin_manage_candidate_premium(request_id, candidat, opération, fin, fin attendue, motif)`. Grade : `is_ops_admin_user` (`admin_ops`, `admin_founder`, compte actif) ; auteur = `auth.uid()`. Verrous `users` puis `candidate_profiles`. Activer : Free exigé, fin explicite et future (borne technique : avant le 10000-01-01 UTC, voir « Points de revue »), début = maintenant, rôle `candidate_premium`. Prolonger : Premium exigé, fin postérieure à la fin actuelle, début conservé. Arrêter : fin = instant de l'arrêt (Free aussitôt), rôle `candidate`. Motif de 10 à 500 caractères. |
| Idempotence, concurrence | Relance du même `request_id` : résultat d'origine (`already_applied`), sans nouvel historique, audit ni notification. Même clé avec d'autres paramètres ou un autre candidat : `request_conflict`. « Fin attendue » différente de l'état verrouillé : `premium_state_changed` (deux agents ne s'écrasent pas). |
| Trace | `candidate_premium_grants` en ajout seul (opération, début de période, fin précédente, fin, motif, auteur et grade, `source = 'admin_grant'`). Écriture du plan, historique, `audit_logs` (`candidate_premium_<opération>`) et notification FR/EN dans la même transaction. Aucune ligne dans `subscriptions` ni `payments` : ce n'est pas une preuve de paiement. |
| Lecture | `admin_candidate_premium` (`is_admin_user` : les trois grades actifs) ; route `GET/POST /api/admin/candidates/[id]/premium` (Zod, codes traduits, session sans clé service). |
| Conditions d'engagement | `mission_day_commitment_terms` : une ligne par journée créée par une sélection réussie (`trg_record_mission_day_commitment_terms`, `AFTER INSERT` sur `mission_days`, dans la transaction « Signer et sélectionner »). Champs : plan effectif à `job_applications.selected_at`, délai (Free 48, Premium 24, contrainte de cohérence), instant de sélection. Période complète : mêmes conditions pour chaque journée. Journées au choix : une sélection par journée, donc des conditions propres. Immuables pour tout auteur (clé service comprise), fermées aux sessions, sans signal temps réel. Le contrat, son empreinte et l'aperçu ne changent pas. |
| Temps réel | Signaux existants : `candidate_profiles` → `subscription` (candidat et canal admin), `users` → `account`, `notifications`. Le panneau admin écoute `admin:subscription`. Aucun signal vers l'entreprise. |
| Écrans | Profil : carte « Mon plan » (Free ou Premium, fin en heure de Douala). `/upgrade/candidate` : plan, début ou dernière fin, attribution par l'équipe, mêmes règles pour les deux plans, contact du support ; ni prix, ni avantage, ni bouton d'abonnement. FAQ et EasyBot alignés. Souplesse d'annulation non annoncée avant le lot 17b. |
| Promesses retirées | « Priorité sur toutes les candidatures », « Votre profil remonte en premier », « Offres exclusives », « Passez à Premium », prix 1 000 FCFA à l'écran ; côté entreprise, pilier « Pool de talents prioritaire » (offres « remontant en premier auprès des candidats Premium »). `user-facing-claims` les refuse dans les dictionnaires, EasyBot, l'accueil et tout fichier de `app`, `components` et `hooks`. |

### Arbitrages du 2026-11-18 (validés)

1. **Matching** : le retrait du bonus Premium de 5 % est conservé. Une priorité éventuelle sera définie avec la future grille commerciale (mécanisme, effet sur le classement, liberté de choix de l'entreprise).
2. **Engagements antérieurs sans plan connu** : chaque journée déjà sélectionnée au moment de la migration reçoit une ligne `terms_source = 'legacy'` dans `mission_day_commitment_terms` : plan et délai `null`, instant de sélection repris de `job_applications.selected_at` s'il existe. La reprise (`mark_legacy_commitment_terms()`, appelée par la migration) est idempotente et ne remplace jamais une ligne. Règle pour le lot 17b : **aucune sanction automatique d'annulation tardive** sur une journée `legacy` (ni sur une journée sans ligne), sur la base d'un plan ou d'un délai supposé. Les autres faits (absence, retard, code non remis…) restent examinés par le support selon leurs règles. Les nouvelles sélections gardent leurs conditions figées (`terms_source = 'selection'`). Comptage avant déploiement : requête en tête de la migration.
3. **Délai de réaction (lot 17b)** : pour une sélection faite après le seuil personnel (48 h ou 24 h avant la journée), désistement sans sanction **jusqu'à `selected_at` + 1 h inclus**. L'origine est l'heure de sélection enregistrée en base (`mission_day_commitment_terms.selected_at`, égale à `job_applications.selected_at`). Exemple : journée le samedi à 08:00, candidat Free sélectionné le jeudi à 20:00:00 (J−36 h) → sans sanction jusqu'au jeudi 21:00:00 inclus. Une sélection urgente a lieu au plus tard à H−2 : le délai se termine donc au plus tard à H−1.
4. **Notification découverte tardivement (lot 17b)** : le candidat peut signaler cette circonstance au support, qui l'examine avant toute sanction. La création d'une notification (`notifications.created_at`) et sa consultation (`read_at`, `is_read`) restent deux faits distincts ; aucun des deux ne déplace l'origine du délai. Aucune notification push n'existe.

### Points de revue du lot 17a (2026-11-18)

- **Page admin du candidat** : `app/admin/candidates/[id]/page.tsx` passe par `requireAdminPage` (session, grade, compte actif, relus en base à chaque rendu). Preuve A1 : un `admin_ops` suspendu avec une session ouverte avant la suspension est redirigé (`NEXT_REDIRECT`), `admin_ops` et `admin_support` actifs restent admis. Le layout redirige déjà ce cas ; la garde de la page couvre la navigation sans layout (audit F-31). Test `admin-guard` : la fiche doit utiliser la garde. Six autres pages admin lisent encore le grade sans filtre `is_active` : `candidates`, `cni`, `companies`, `momo`, `skill-documents`, `update-requests`. Elles sont antérieures au lot, hors périmètre, à corriger. Le test les liste et refuse toute nouvelle page dans ce cas.
- **Limite de 366 jours** : elle n'avait aucune justification technique. C'était un garde-fou contre une faute de saisie, qui revenait à imposer une durée commerciale supposée. Elle est **retirée** (code `period_too_long` supprimé). Restent exigées une date de fin explicite et future, et pour prolonger postérieure à la fin actuelle. **Limite technique réelle** : fin strictement avant le `10000-01-01 00:00:00 UTC` (`candidate_premium_max_end()`, même borne dans Zod et `max` du champ). Postgres accepte bien plus loin, mais l'API (ISO 8601), Zod et le champ `datetime-local` n'acceptent que des années à quatre chiffres. La borne refuse aussi `infinity`. La minuterie client est déjà plafonnée (`MAX_TIMER_MS`). Preuve G7 : fins à trois ans puis au 9999-12-31 acceptées ; `infinity` et le 10000-01-01 refusés.
- **Test `user-facing-claims`** : les motifs visent désormais les promesses non livrées dans leur contexte : priorité de candidature ou d'affichage, offres « exclusives » ou « réservées » aux Premium, versement accéléré. L'interdiction générale de « Passez à Premium », « Devenir Premium » et du prix est retirée, puisque le parcours commercial reste prévu au plan. Un test vérifie que les huit textes retirés au lot 17a sont détectés, et que ces appels et un prix restent autorisés.

### Validation (pile `easyjob-proof`, build de production)

- **Preuve `candidate-premium`** (26 assertions depuis les points de revue) : P1-P2 plan effectif et échéance exacte ; W1-W5 écritures refusées (candidat, tiers, `admin_support`, ops suspendu avec un jeton antérieur, anonyme ; fonction de plan fermée) ; G1-G6 activation, refus, prolongation, arrêt, historique, audit, notification, aucune ligne de paiement, signaux ; I1-I3 cinq relances simultanées, clé réutilisée, deux agents simultanés ; S1-S6 sélection Free puis activation, période complète Premium puis arrêt et relance, immuabilité, journées au choix avant et après expiration, instant exact de l'expiration (Free) et 1 µs avant (Premium), journée créée hors sélection ; L1 engagement historique (`legacy`, reprise idempotente) ; G7 fin lointaine acceptée, borne technique ; A1 page admin et admin suspendu ; C1 entreprise sans plan (aperçu, sélection, liste des candidats, signaux, lecture directe refusée).
- Preuves ciblées pendant le développement : `account-security`, `business-permissions`, `contract-selection`, `multi-day-jobs`, `realtime`, `admin-candidate-profile` ✅ (172 s).
- **Navigateur** (Chrome headless piloté par CDP, 375 × 812 tactile, script et comptes hors dépôt, deux sessions ops et candidat) : ✅ 27/27 en FR puis EN, en 40 s, puis 27/27 en 34 s après les points de revue. Plan Free puis Premium sur le profil sans rechargement (0,33 s après l'enregistrement), fin en heure de Douala, historique admin, « Mon plan » sans prix, arrêt reçu en 0,4 à 0,9 s, échéance sur écran ouvert (bascule 0,2 à 0,3 s après la fin), aucune ancienne promesse, aucun défilement horizontal, aucune erreur JavaScript.

### Validation de l'état final

Premier passage (2026-11-17), avant les points de revue : pile réinitialisée (57 s), Vitest 583 tests, suite RLS 36/36 (764 s), typage, lint, formatage, build, types identiques.

Après les arbitrages et les points de revue (2026-11-18) :

| Contrôle | Résultat |
|---|---|
| Pile `easyjob-proof` réinitialisée depuis les seules migrations (migration 17a modifiée : marquage `legacy`, borne technique) | ✅ 43 s |
| `pnpm test` (Vitest), puis suite RLS complète, l'un après l'autre | ✅ 590 tests, 49 fichiers, 11 s (nouveau : `candidate-premium-validation`) |
| `pnpm test:rls` (build de production relié à la pile) | ✅ 36/36 au premier passage, 797 s (`candidate-premium` : 26 assertions, 32 s) |
| `pnpm exec prettier --check .` | ❌ au premier essai : `lib/i18n/fr.ts` et `en.ts` (nouveaux messages `period_invalid` trop longs), sortie conservée ; ✅ après `prettier --write` (formatage seul) |
| `pnpm typecheck` (9 s), `pnpm lint` (45 s), `pnpm build` (27 s, sans avertissement), test `user-facing-claims` relancés après le reformatage | ✅ |
| Types générés (pile réinitialisée) | ✅ identiques à `lib/database.types.ts` |
| Navigateur, FR et EN, 375 px, deux sessions | ✅ 27/27 (34 s) |

### Limites

- Prix et durée commerciale non fixés ; aucun parcours de paiement ; l'attribution reste un acte du support.
- Le candidat ne voit pas l'historique de ses attributions (notification dans l'application seulement).
- Une activation antérieure faite en SQL a un début inconnu (affiché « Inconnu » côté admin).
- Six pages admin antérieures lisent le grade sans filtre `is_active` (voir « Points de revue ») ; leurs données passent par des routes ou une RLS qui revérifient un compte actif.
- Le test A1 ne sépare pas la garde de la page de celle du layout (les deux redirigent) ; la garde propre à la page est vérifiée par le test statique.

---

## 40. Suivi — Lots 17b–17c : annulations par le candidat et conséquences (2026-11-18)

Branche `feat/lot-17bc-candidate-cancellations`, créée depuis `origin/main-dev` (`3ae5aff`, lot 17a intégré ; constat Git). Migrations `20261122120000_candidate_cancellations.sql` et `20261123120000_partial_day_agreements.sql` (interruptions, décisions du 2026-11-19 et du 2026-11-20, ci-dessous). Non commité. Essais sur la pile `easyjob-proof` uniquement. Règles produit : SRS §5.2 (encadré « Lots 17b–17c ») et §6.8.

### Réutilisé

Conditions figées à la sélection et marquage `legacy` (lot 17a) ; manquements `reputation_incidents` et rejeu `compute_reputation` (lot 9c : −5 unités, solde et plafonds) ; verrous mission puis journée (lots 13 à 15) ; bucket privé `incident-evidence` et modèle de dépôt par la route (lot 14) ; grades `is_admin_user` et `is_ops_admin_user` (compte actif) ; révision interne à 7 jours par un autre agent (lot 16) ; `incident_notify`, `audit_logs`, signaux `rt_signal_users` et `rt_signal_admin` ; tâche planifiée `reputation-expiry-sweep` ; `admin_set_user_active` (même signature, mêmes messages).

### Réalisation

| Sujet | Mise en œuvre |
|---|---|
| Demande | `request_candidate_cancellation(request_id, journées, motif, précisions, choix)` : journées d'une même offre, non commencées, non confirmées, avant leur début. Verrous des missions (ordre des identifiants), puis des journées. Relance du même `request_id` → résultat d'origine ; autres journées → `request_conflict`. |
| Classement | `classify_cancellation_day(journée, instant)` sur `mission_day_commitment_terms` : `in_time` (≤ début − 48 h Free ou 24 h Premium), `reaction_window` (sélection après ce seuil et ≤ sélection + 1 h), `late`, `legacy` (conditions historiques ou absentes). Limites incluses, heure de la base. Classement et plan figés par journée dans `candidate_cancellation_days`. |
| Effet immédiat | Journées annulées dès la demande. Mission entièrement annulée → `cancelled`, candidature `withdrawn` (place libérée par le déclencheur existant, échéance de recrutement inchangée). Période interrompue (reste annulé ou confirmé) → mission `cancelled` (`candidate_cancellation_interrupted`), place conservée, journées confirmées acquises. Entreprise prévenue : dates seulement, sans motif, classement ni plan. Contrat et historique inchangés. |
| Justification | Au moins une journée `late` : motif et choix exigés en base. « Je n'ai pas de justificatif » → manquement immédiat (`cancellation_flow`). Justificatif annoncé → `awaiting_evidence` jusqu'au premier dépôt réussi (`record_cancellation_evidence`, clé service, type lu dans les octets) → `under_review`. Un envoi échoué ne change rien. Motif « notification découverte tardivement » proposé. |
| Décision et recours | `admin_decide_candidate_cancellation` (ops ou fondateur actif, motif ≥ 10 caractères) : acceptée → aucune sanction ; refusée → manquement (`support_decision`). Recours du candidat sous 7 jours (`request_cancellation_review`, ouvert pendant une suspension) ; décision par un autre agent (`reviewer_must_differ`) ; « overturned » → manquement annulé (`voided_at`), réputation rejouée, exclusions recalculées. |
| Un seul manquement | `reputation_incidents.cancellation_id` unique : une demande, quel que soit le nombre de journées tardives, donne au plus un retrait. Journée annulée : début, code, confirmation par le support (déclencheur `trg_block_cancelled_day`, tout auteur) et signalement (`trg_block_incident_on_cancelled_day`) refusés ; une absence sanctionnée sur la même journée est refusée (`incident_conflicts_with_cancellation`). `protect_reputation_incidents` raisonne désormais à la demande (journées non commencées) et non à la mission entière. |
| Exclusions | `candidate_cycle_reconcile` : trois manquements `candidate_late_cancellation` non annulés, commis après le retour du cycle précédent et non encore retenus → cycle 1 (`now()` + 6 mois), cycle 2 (+ 1 an), cycle 3 (sans fin). Intervalles calendaires de la base. Les faits commis avant un retour, même décidés après, restent hors du cycle suivant. Historique conservé (`account_suspensions.incident_ids`, cycles numérotés). Notification : motif, durée, dates des faits, recours. |
| Causes | `account_suspensions` (`admin`, `cancellation_cycle`, `fraud`) ; `users.is_active` = aucune suspension en cours (`refresh_account_active`). `admin_set_user_active` crée ou lève une cause `admin` ; la réactivation d'un compte suspendu pour une autre cause est refusée (`other_suspension_active`). Suspensions administratives antérieures reprises en lignes `admin`. `account_suspension_sweep` (tâche planifiée) : fin notifiée une fois, compte réactivé seulement sans autre cause. |
| Fraude | `admin_report_fraud` (tout admin actif) et pièces (`record_fraud_evidence`) ; `admin_suspend_for_fraud` (ops ou fondateur actif, fin explicite ou jusqu'à levée, motif) ; contestation du candidat (`contest_account_suspension`), maintien ou levée motivés. Aucune suspension automatique ; un justificatif refusé n'est pas une preuve de fraude. |
| Montant acquis | `mission_acquired_amount` (parties et support) : forfait × minutes prévues des journées confirmées (code, support, décision exceptionnelle) ÷ minutes prévues de toutes les journées, sur `contracts.contract_data` (journées, horaires, montant). Durée brute début → fin, nuit le lendemain, pause non déduite. Valeur exacte (4 décimales) et arrondi au franc (demi supérieur, à valider). États : `final`, `in_progress`, `settlement_pending` (journée interrompue non réglée ou d'issue « partiel » du lot 16 : aucune durée ni aucun montant inventés, jamais présentés comme nuls ; décisions du 2026-11-19 et du 2026-11-20, ci-dessous). Aucun versement, aucune amende. |
| Écrans | Mission (candidat) : « Annuler des journées », journées classées, récapitulatif, motif, choix explicite, pièce, suivi (pièce à réessayer, décision, recours). Journées « Annulée » ou « Désistement du candidat » ; montant acquis (deux parties) ; plus de début ni de code sur une journée annulée (Tâches, mission). Tâches : suspension en cours (contestation) et justificatifs attendus. Entreprise (offre) : date du désistement, code masqué. Support : `/admin/cancellations` (liste, dossier, plan à la sélection, pièces, décision, recours, fraude, suspensions, engagements futurs). FR et EN. |
| Temps réel | Domaines existants, charge utile `{d, r}` : `missions` (candidat ; entreprise sans ressource), `incidents` et `account` (canal admin), `account` (candidat suspendu). Aucun signal ne porte le plan ni le classement. |

### Interruption d'une journée commencée (décisions du 2026-11-19, du 2026-11-20 et du 2026-11-21)

Historique de la décision :
- **2026-11-18** : l'entreprise fixait le montant et le candidat l'acceptait. Réalisé puis retiré avant tout commit.
- **2026-11-19** : instruction par le support, décision par double validation (ops, fondateur), règlement proposé par le support selon une règle de valorisation validée (aucune).
- **2026-11-20** : décision et règlement réservés au fondateur actif, sans seconde validation, avec délais contrôlés par la base.
- **2026-11-21** (ce complément) : bornes du règlement validées et appliquées, prolongation unique de 7 jours, réexamen par le fondateur, suivi des montants.

La migration `20261123120000_partial_day_agreements.sql` n'a jamais été intégrée ni déployée : elle est réécrite sur place. Les tables de règlement du 2026-11-19 (`mission_day_partial_settlements` et son historique) et la route `/api/partial-settlements/[id]` sont remplacées. Aucune donnée réelle n'existe : seules les piles de preuve en ont porté, effacées à chaque réinitialisation.

#### Décisions validées et appliquées

Conservées du 2026-11-19 :
- **Signalement** : candidat ou entreprise, sur une journée commencée et non confirmée ; cause, heure de l'interruption (heure de Douala, entre le début réel et maintenant), travail effectué, raison. Un dossier `interruption` par journée ; l'autre partie y donne sa version, une fois.
- **L'entreprise ne fixe aucun montant**, ni à l'écran, ni par une route, ni par une RPC.
- **Travail, montant et discipline sont séparés** : une interruption n'est jamais en soi un manquement ; aucune décision de ce dossier ne crée de désistement, de sanction ni de suspension.
- **Blocage** : tant que le dossier n'est pas clos, ni le code, ni une confirmation du support, ni une décision exceptionnelle ne confirment la journée ; aucun essai de code n'est consommé.
- **Aucun versement ni remboursement.**

Ajoutées le 2026-11-20 :
- **Pouvoirs.**
  - Seul un `admin_founder` actif propose ou modifie un montant, prolonge son propre délai, clôt le dossier et finalise manuellement un accord. Pas de seconde validation sur ce parcours.
  - `admin_support` et `admin_ops` actifs recueillent versions, justificatifs, contacts et notes (fonctions du lot 16), sans fixer de montant ni clore.
  - Contrôlé dans la base (`is_founder_admin_user`, compte actif), dans la route (grade de session relu avec `is_active`) et dans les écrans. Un ancien jeton d'un fondateur suspendu est refusé.
  - Sur une interruption, la double validation et la décision générique du lot 16 sont refusées (`use_founder_decision`). Les autres parcours de litiges sont inchangés.
- **Délais**, calculés et contrôlés à chaque action à l'heure de la base (jamais par la tâche planifiée) :
  - 72 h pour chaque demande adressée à une partie : version de l'autre partie dès l'ouverture, puis chaque demande du support (`respond_by`). Réponse acceptée jusqu'à l'échéance incluse, refusée après (`response_deadline_passed`).
  - À l'échéance, examen du fondateur avec les éléments disponibles. Le silence ne prouve ni réalisation, ni absence, ni faute.
  - 48 h pour répondre à une proposition. Sans deux acceptations valides dans le délai, elle expire ; un refus la rend aussitôt non acceptée et renvoie le dossier au fondateur.
  - 72 h ensuite pour le fondateur : clôture motivée, ou prolongation exceptionnelle avec motif et date de fin explicite (une seule par dossier, 7 jours au plus : décision du 2026-11-21). Un dépassement est visible dans sa file (badge, en tête de liste) et déclenche un rappel, jamais une décision automatique.
- **Avis** (aucun push, SMS ni e-mail) : la mise à disposition dans l'application (notification créée) et la consultation effectivement observée (dossier affiché à son destinataire) sont enregistrées séparément. Une notification créée n'est jamais présentée comme lue ou reçue sur le téléphone. Avis initial, rappel avant l'échéance et avis d'expiration, une fois chacun.
- **Proposition et consentement** : montant motivé du fondateur après instruction ; aucun prorata ni répartition par étapes ; même montant pour le candidat et l'entreprise, chacun accepte ou refuse pour son compte ; le silence ne vaut jamais acceptation ; toute modification crée une version, annule les acceptations et rouvre 48 h pour les deux parties ; propositions, réponses et motivations conservées.
- **Finalisation** :
  - jamais sur une proposition expirée, refusée ou acceptée par une seule partie ;
  - après deux acceptations de la même version encore courante, code reçu même avant la fin prévue ; l'échéance de 48 h n'annule pas un accord déjà accepté par les deux parties ;
  - code non remis : recours immédiat d'une partie, puis finalisation manuelle par le fondateur seul, motivée, en provenance distincte `partial_support` ;
  - jamais une réalisation complète (`completion_counts` exclut `partial` et `partial_support`), jamais le montant initial à la place du montant accepté ; contrat signé et journées confirmées intacts.
- **Prévention des blocages** : un signalement identique ne rouvre pas un dossier clos et ne bloque pas à nouveau la journée ; un nouvel élément reste recevable pour examen (signalé au fondateur) sans rouvrir le blocage ; « interruption non établie » rétablit le parcours normal selon ses conditions (code à la fin prévue) ; « désaccord non résolu » reste distinct : il ne confirme pas la journée, ne crée aucun montant définitif et ne vaut ni renoncement à rémunération, ni remboursement, ni sanction. Aucune sanction pour silence ou désaccord.

#### Ce qui fonctionne

| Sujet | Mise en œuvre |
|---|---|
| Dossier et versions | `mission_incidents` (nature `interruption`, cause, heure déclarée, travail) ; `mission_interruption_versions` (une par partie). `report_mission_interruption` : verrous mission, journée, dossier ; dossier clos ou version déjà donnée → relecture sans écriture ; version de l'autre partie refusée après ouverture + 72 h. |
| Délais | `interruption_deadline_open(échéance, instant)` = instant ≤ échéance. `mission_incident_info_requests.respond_by` = demande + 72 h (déclencheur, dossiers d'interruption seulement) ; réponse tardive refusée par un déclencheur sur les déclarations liées. `interruption_state(dossier, instant)` calcule l'étape : `instruction` (une demande court encore), `founder_review` (échéance = fin de la dernière étape + 72 h, ou date de prolongation), `awaiting_parties` (proposition ouverte), `agreement`, `closed`. |
| Fondateur | `admin_propose_interruption_amount` (version attendue, double envoi idempotent, 0 au plafond de `interruption_settlement_cap`), `admin_close_interruption` (non établie, désaccord non résolu ; refusée pendant l'instruction, une proposition ouverte ou un accord), `admin_extend_interruption_review` (une seule par dossier, pendant son examen, 7 jours au plus après l'échéance prolongée), `admin_finalize_interruption` (accord valide, recours exigé, version exacte). Route `POST /api/admin/incidents/[id]/interruption` (Zod, grade de session actif, codes traduits). |
| Parties | `respond_interruption_proposal` (version courante exacte, une réponse par partie, double envoi idempotent, `already_responded`, `proposal_refused`, `proposal_expired`, `settlement_changed`), `request_interruption_finalization` (recours), `mark_interruption_viewed`. Route `POST /api/interruptions/[id]` ; tâches `GET /api/interruptions/tasks` (`my_interruption_tasks`). |
| Garde | `guard_day_completion_conflicts` (tout auteur, y compris clé service) : `partial` et `partial_support` exigent un accord valide ; toute autre confirmation est refusée tant que le dossier n'est pas clos ou en désaccord non résolu. `submit_completion_code` : `settlement_not_accepted` (proposition ouverte, refusée ou expirée), `interruption_unresolved`, `interruption_pending`, sans lecture du code. |
| Avis | `mission_interruption_notices` (étape, référence, destinataire, notification liée, mise à disposition, consultation) ; index unique : une étape une fois par destinataire, même sous balayages concurrents. |
| Rappels | `interruption_deadline_sweep(instant)`, ajouté à la tâche planifiée existante `reputation-expiry-sweep` : rappel 24 h avant l'échéance d'une demande, 12 h avant celle d'une proposition ; avis d'expiration ; dépassement du fondateur signalé une fois par échéance à chaque fondateur actif. Aucune écriture d'état ni décision. Les relances 24 h / 48 h du lot 16 ne s'appliquent plus aux interruptions. |
| Lectures | `mission_interruptions_for_party` (étape, échéances, versions, demandes de la partie, propositions et réponses, clôture, recours, ses avis) ; `admin_mission_interruption` (tout, plus prolongations, bornes et droits du fondateur) ; `admin_mission_incidents` ajoute étape, échéance et dépassement. |
| Écrans | Dossier (mission du candidat, offre de l'entreprise) : étape, échéance exacte en heure de Douala, montant « en examen » (jamais présenté comme nul), versions, échéance de la version attendue, échéance et expiration de chaque demande (réponse masquée après l'échéance), proposition courante avec motivation, réponses et Accepter/Refuser, historique des versions, accord puis « le code n'est pas remis : demander au support », décision, avis (mis à disposition, consulté). Tâches persistantes (candidat dans Tâches, entreprise sur son tableau de bord). Support : carte du fondateur (proposition, clôture, prolongation, finalisation ; lecture seule pour les autres agents ; plafond du contrat affiché ; réexamens à traiter), file avec badge de dépassement ; relances, propositions et décisions du lot 16 masquées sur une interruption. Saisies conservées lors des mises à jour. FR et EN, 375 px. |
| Temps réel | `rt_on_interruption_rows` sur les tables du parcours : signaux `incidents` et `missions` aux parties, `incidents` au support ; un avis destiné au fondateur ne signale que le support. Charge `{d, r}`. |

#### Bornes du règlement (décision validée du 2026-11-21, appliquée)

Les propositions sont ouvertes au fondateur actif, avec les règles réelles de la migration (`partial_settlement_policy()` : `validated: true`, minimum 0, aucun multiple imposé ; plafond par `interruption_settlement_cap(journée)`). Aucune fonction de bornes n'est remplacée, ni par la preuve, ni par le navigateur.

- **Montant** : entier en XAF, de 0 au plafond, sans multiple de 50. Négatif ou fractionnaire → `amount_invalid` ; au-dessus du plafond → `amount_above_cap`.
- **Plafond**, lu dans les conditions figées du contrat (`contracts.contract_data` : montant, journées, horaires), jamais dans l'offre, même modifiée après la sélection ; durées brutes du contrat, aucune pause déduite, aucune durée travaillée inventée :
  - mission d'une journée : le montant initial du contrat ;
  - forfait global : la part de la journée selon la formule du lot 17c (montant × minutes prévues de la journée ÷ minutes prévues de toutes les journées) ; si elle est fractionnaire, seul le plafond est arrondi à l'entier inférieur.
- Le plafond encadre la proposition ; il ne calcule pas la valeur du travail partiel.
- **Montant nul** : mêmes garanties qu'un montant positif (motif, montant affiché, acceptation explicite et distincte des deux parties sur la même version encore valide, finalisation par le code ou le fondateur). Ni le silence, ni l'expiration, ni une clôture administrative ne valent acceptation de 0.

| Cas | Plafond | Effet |
|---|---|---|
| Journée « au choix » de 9 000 XAF | 9 000 | 0 à 9 000 proposables ; 9 001 refusé |
| Forfait 30 000 sur 3 journées de 8 h ; J1 réalisée | J2 : 30 000 × 480 ÷ 1 440 = 10 000 | 10 000 reconnus pour J1 ; J2 de 0 à 10 000 ; J3 indépendante |
| Forfait 10 000 sur 8 h, 8 h, 5 h (1 260 min) ; J1 réalisée | J2 : floor(3 809,52) = 3 809 ; J3 : floor(2 380,95) = 2 380 | J1 reconnue 3 809,52 (lot 17c) ; J2 réglée 3 809 → 7 618,52 ; aucun double comptage |

#### Prolongation (décision du 2026-11-21)

Une seule prolongation par dossier (`mission_interruption_extensions.incident_id` unique), pendant l'examen du fondateur, avec motif obligatoire et date de fin explicite, au plus 7 jours après l'échéance qu'elle prolonge (`extends_due`, limite incluse). Elle est historisée et notifiée aux deux parties. Elle reste rattachée à cette échéance : une nouvelle version, une relance ou une réouverture ne la renouvelle pas (`extension_already_used`). À l'échéance, aucune décision financière automatique : le retard est visible dans la file du fondateur et rappelé.

#### Réexamen d'une décision du fondateur (décision du 2026-11-21)

- Une partie signale une erreur dans la clôture en vigueur et demande un réexamen motivé, dans le même dossier (`request_interruption_reexamination`, une demande en cours par partie). La demande ne change ni l'étape, ni les délais, ni le blocage.
- Le fondateur seul la traite (`admin_decide_interruption_reexamination`) :
  - **maintenue** (motivée) ;
  - **rouverte** : seulement pour « non établie » ou « désaccord non résolu » sur une journée non confirmée. La décision passe à l'historique (`mission_interruption_closure_history`) et le dossier revient à l'examen du fondateur ;
  - **traitement distinct** : la correction toucherait un accord finalisé ou une journée confirmée. Rien n'est modifié ici (`requires_separate_handling` si une réouverture est tentée).
- Les décisions successives sont conservées. Ce n'est pas présenté comme un recours indépendant.
- Le statut générique du signalement (`mission_incidents.status`, figé par le lot 14 dès la première décision) n'est pas réécrit : la première décision reste immuable et la protection du lot 14 n'est pas contournée.
- **Instruction après réouverture** (correctif de clôture du complément) : une seule lecture de l'état courant, `incident_instruction_open(dossier)`. Pour une interruption, l'instruction est ouverte tant qu'aucune clôture n'est en vigueur ; pour les autres natures, la règle des lots 14 à 16 (statut ouvert ou répondu) est inchangée. Cette fonction contrôle :
  - les contacts (`admin_record_incident_contact`) et la qualification (`admin_set_incident_situation`), reprises du lot 16 où seule cette condition change ;
  - les demandes (`admin_request_incident_info`) et les réponses aux demandes (déclencheur des déclarations liées) ;
  - la lecture du support : `instruction_open` exposé par `admin_mission_interruption`, et la route du dossier qui en déduit `can_record_contact`, donc le formulaire de contact, la situation et les demandes.

  Ce que cela donne :
  - un dossier rouvert accepte de nouveau contacts, réponses, qualification, demandes et réponses ;
  - les notes internes restent toujours ouvertes (règle du lot 16) ;
  - après une nouvelle clôture, contacts, qualification, demandes et réponses sont refusés (`incident_closed`) ; un nouvel élément libre reste recevable pour examen, sans rouvrir.
- Les décisions successives sont conservées : la clôture en vigueur, l'historique des clôtures remplacées, les réexamens et leurs décisions, et le statut générique de la première décision.

#### Suivi des montants et situations

- Le dossier affiche aux deux parties et au fondateur :
  - le montant déjà reconnu pour la mission (journées réalisées et accords réglés) ;
  - le plafond de la journée ;
  - la proposition en attente, le montant accepté, l'accord finalisé et l'état de finalisation (code ou fondateur) ;
  - la mention « information seulement : ce n'est pas un versement ».
- Le travail en examen n'est jamais présenté comme nul.
- Trois situations distinctes :
  - **journée** : « Interrompue — en examen », « accord à confirmer par le code », « accord partiel finalisé », « Interrompue — règlement non résolu » ;
  - **dossier** : son étape ;
  - **mission** : journées confirmées sur le total. Les autres journées suivent leur propre parcours ; la garde ne porte que sur la journée interrompue.

- **Terminologie** : « accord finalisé » (EN « agreement finalised ») remplace « accord réglé » et « règlement partiel confirmé » dans les écrans et dans la notification de confirmation par le code. Le suivi précise « information, aucun versement ». Aucun écran de ce parcours ne suggère qu'un versement a eu lieu ; un test unitaire refuse « réglé », « settled » et toute formule de versement effectué dans les textes du parcours.
- **Précision** : trois grandeurs distinctes.
  - Montant de l'accord : entier.
  - Plafond : part de la journée arrondie à l'entier inférieur ; c'est le seul arrondi.
  - Total reconnu : calcul exact au prorata (`acquired_exact`, 4 décimales), qui peut rester fractionnaire, par exemple 7 618,5238.

  L'affichage ne réinjecte jamais une valeur arrondie dans un calcul : la base calcule sur les valeurs exactes, et l'écran affiche le total exact (`formatXafExact`) avec la mention de ces trois règles. L'arrondi final d'un éventuel versement relève du lot paiement (décision à prendre). Aucun nouvel arrondi financier n'est introduit ; la carte du montant acquis du lot 17c conserve son affichage existant (arrondi proposé « à valider », plus le calcul exact).

#### Sort du calcul du montant acquis des lots 17b–17c

- **Inchangé (validé)** : forfait × minutes prévues des journées entièrement réalisées ÷ minutes prévues de toute la période, sur le contrat signé.
- **Journée interrompue** : aucune part automatique. Seul un accord finalisé (clôture `settled`, par code ou finalisation manuelle) ajoute son montant accepté (`settled_total`), jamais au-delà du plafond de la journée : aucun double comptage. Sinon l'état est `settlement_pending` et la journée « en examen », jamais présentée comme nulle ; un désaccord non résolu est signalé (`unresolved`) sans montant définitif.

#### Validation (décisions du 2026-11-20 et du 2026-11-21)

- **Preuve `mission-interruptions`** (31 assertions, règles réelles de la migration, aucune proposition ni acceptation insérée en base) :
  - **R1-R2, signalement** : journée non commencée, champs, tiers et anonyme ; double envoi (un dossier, une version, un avis « mis à disposition ») ; étape « instruction » jusqu'à l'ouverture + 72 h.
  - **P1-P4, pouvoirs et bornes** : support et ops instruisent sans décider ; double validation et décision générique du lot 16 refusées ; parties refusées ; fondateur suspendu (ancien jeton) refusé partout ; au-dessus du plafond (9 001 > 9 000), négatif et fractionnaire refusés, plafond affiché.
  - **D1-D3, délais d'instruction** : bornes exactes (échéance incluse, refus 1 ms après) ; réponse tardive refusée ; nouvel élément recevable ; examen du fondateur à l'échéance ; silence sans confirmation.
  - **F1-F2, délai du fondateur** : dépassement visible et rappelé une fois, aucune décision automatique ; prolongation de 7 jours exactement acceptée, 7 jours + 1 s et seconde prolongation refusées.
  - **S1-S9, proposition** : version unique, échéance + 48 h, version attendue périmée, plafond ; modification après une première acceptation ; une seule acceptation, tiers refusés ; acceptations concurrentes, accord non modifiable ; accord accepté puis code après l'échéance (montant accepté) ; refus ; silence et expiration ; course modification / acceptation ; recours, finalisation sans recours refusée, course finalisation / code, contrat intact.
  - **C1-C3, clôtures et réexamen** : désaccord non résolu ; non établie sans réouverture par un doublon ; réexamen maintenu, rouvert avec historique et sans nouvelle prolongation, accord finalisé jamais rouvert (traitement distinct, 4 000 intact).
  - **C4, instruction après réouverture** : contact, situation, note, demandes et réponse acceptés sur le dossier rouvert ; entreprise, admin suspendu et anonyme refusés ; première décision inchangée (statut, résultat, motif, date) ; clôture refusée tant qu'une réponse est attendue, puis nouvelle clôture ; historique (une clôture remplacée), deux réexamens et la clôture en vigueur conservés ; ensuite contact, situation, demande et réponse refusés (`incident_closed`), nouvel élément libre recevable.
  - **N1-N7, avis et montants** : consultation distincte de la notification ; rappels idempotents et tâche après reconnexion ; forfait 30 000 (10 000 conservés) ; forfait 10 000 sur 8 h, 8 h, 5 h (plafond 3 809 lu dans le contrat malgré une offre modifiée, 3 810 refusé, total 7 618,52, 3e journée indépendante) ; montant nul exigeant un motif, accepté par une seule partie puis expiré (jamais réglé), puis accepté par les deux et réglé à 0 ; réputation et signaux.
- **Défauts trouvés et corrigés** :
  - code après un accord refusé par `mission_incidents_decision_chk` (motif manquant ; `founder-2.txt`) ;
  - tâches de l'entreprise absentes de son tableau de bord ;
  - provenance d'une journée réglée absente de la liste de l'entreprise (`fnd-browser-1.txt`) ;
  - réouverture refusée par la protection « incident is final » du lot 14 (`caps-2.txt`, 28/30). Corrigé sans la contourner : le statut générique reste celui de la première décision, l'état courant est porté par les clôtures.
- **Navigateur** (Chrome headless par CDP, 375 × 812 tactile, sessions candidat, entreprise et fondateur, script hors dépôt, règles réelles) : ✅ 33/33 en FR puis EN, 54 s.
  - Échéance de la version chez l'entreprise sans rechargement ; tâches avec échéance ; textes en cours conservés.
  - Carte du fondateur : plafond 9 000 du contrat, proposition ouverte ; 9 001 refusé avec un message clair, rien envoyé.
  - Proposition réelle de 4 500, reçue sans rechargement (1,3 à 1,5 s) avec le suivi « proposition en attente », puis acceptations des deux parties depuis leurs écrans.
  - Code avant la fin au montant convenu ; état final « accord finalisé 4 500 », journée « accord partiel finalisé » (vérifié aussi après le correctif de terminologie : 33/33), sans mention de versement.
  - Consultations observées enregistrées, notifications jamais marquées lues ; aucune erreur JavaScript ni défilement horizontal.

#### État final

| Contrôle | Résultat |
|---|---|
| Pile `easyjob-proof` réinitialisée depuis les seules migrations | ✅ 59 s, dernière version `20261123120000` (état final, après le correctif de réouverture) |
| Types générés | ✅ identiques à `lib/database.types.ts` |
| `pnpm test` (Vitest), exécuté seul avant la suite RLS | ✅ 614 tests, 51 fichiers |
| `pnpm test:rls` (build de production relié à la pile) | ✅ 38/38 au premier passage, 1 036 s (`mission-interruptions` : 94 s) |
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .`, `pnpm build` | ✅ (build 63 s, sans avertissement) |

#### Arbitrages ouverts

1. **Désaccord non résolu** : la journée reste non confirmée et la mission ne passe pas « réalisée » ; suite à donner (orientation externe, clôture administrative de la mission).
2. **Statut générique après une réouverture** : `mission_incidents.status` garde la première décision (règle du lot 14) ; les listes filtrées par ce statut le montrent « décidé », avec l'étape courante en badge. L'instruction est contrôlée par l'état courant (ci-dessus).
3. **Traitement distinct** : revenir sur un accord finalisé, une journée confirmée ou un futur versement n'a pas de parcours ; il est seulement signalé.
4. **Délais des parties** : la prolongation des 72 h d'une demande n'est pas prévue.
5. **Arrondi d'un versement** : décision du lot paiement (le parcours n'arrondit que le plafond).

Restent hors de ce complément, comme demandé : le délai de 72 h n'est pas appliqué aux justificatifs d'annulation des lots 17b–17c ; sanctions, engagements pendant une suspension, avis et unités de réputation des missions partielles inchangés.

### Engagements futurs au moment d'une suspension

Rien n'est supprimé ni transformé en absence. Le candidat suspendu ne peut plus commencer (`account_suspended`, inchangé) mais peut encore annuler et suivre ses dossiers. Les engagements futurs sont listés dans l'audit de la suspension et sur le dossier du support (`candidate_future_engagements`).

### Arbitrages matériels encore ouverts

1. **Dossier laissé sans pièce** (`awaiting_evidence`) : délai de complément et issue. Aucune sanction automatique sur ce fondement.
2. **Engagements futurs d'un candidat suspendu** : information de l'entreprise, remplacement, annulation par le support. Le traitement opérationnel est à décider.
3. **Manquement annulé dans un cycle déjà suivi d'un autre cycle** : le cycle concerné est levé, les suivants sont conservés et l'arbitrage est tracé (`cancellation_cycle_arbitration_needed`). Reste à trancher : renumérotation, durée du cycle suivant, réduction éventuelle.
4. **Réputation de l'entreprise** : une offre avec un désistement ne rapporte jamais l'unité « offre réalisée », car un engagement annulé n'est pas une résolution (règle du lot 12). Ce n'est pas une attribution artificielle, mais l'entreprise subit le désistement du candidat. *Rectifié au §41 (lecture du 2026-11-19) : vrai pour une période interrompue (candidature restée `selected`) ; un désistement complet passe la candidature à `withdrawn`, qui sort des engagements comptés et ne bloque pas l'unité.*
5. **Remplacement** après clôture du recrutement ; poursuite ou remplacement d'une période abandonnée (place conservée).
6. **Montant** : arrondi au franc (demi supérieur proposé) ; durée brute ou nette des pauses. Bornes d'un règlement de journée interrompue : voir « Bornes du règlement » (décision du 2026-11-21).
7. **Fraude** : durée et critères ; recours au-delà de la contestation interne.
8. **Annulation par l'entreprise** (lot 17d).

### Validation

- **Preuve `candidate-cancellations`** (29 assertions) : L1-L4 limites Free et Premium incluses, délai de réaction jusqu'à sélection + 1 h inclus, historique ; A1-A2 effet immédiat, place libérée, entreprise prévenue sans plan, motif et choix exigés, manquement sans justificatif ; M1-M6 journées mixtes en un seul événement, relance, envoi de pièce échoué puis réussi, décision refusée (support, ops suspendu et candidat refusés, double envoi : un manquement), recours par un autre agent, décision acceptée, URL signée réservée au support ; R1-R4 début et annulation simultanés, journée annulée bloquée (début, réalisation même en clé service, signalement, absence sanctionnée), journée commencée ou débutée non annulable, cinq envois simultanés ; X1-X7 cycle de 6 mois, durée calendaire, plusieurs causes, dossier ancien décidé tard hors cycle, 1 an, exclusion définitive, recours qui lève l'exclusion, arbitrage tracé ; F1 fraude ; P1-P3 42 000 XAF exact, arrondi 4 286 à valider, journée partielle « en attente de règlement » (mise à jour du 2026-11-19), contrat inchangé ; C1-C2 confidentialité, tables fermées, signaux {d, r, id}.
- **Contrôle négatif** sur la pile jetable : déclencheur `trg_block_cancelled_day` retiré et limites rendues exclusives → 5 échecs détectés (L1, A1, L2, L3, R2 ; sortie conservée), puis pile restaurée par réinitialisation.
- **Preuves ciblées** pendant le développement : `candidate-cancellations`, `admin-centralization`, `mission-incidents`, `mission-completion`, `mission-disputes`, `multi-day-jobs`, `reputation`, `candidate-premium`, `mission-time-tracking`, `contract-selection` ✅ (607 s).
- **Navigateur** (Chrome headless par CDP, 375 × 812 tactile, trois sessions candidat, entreprise et ops, script hors dépôt) : ✅ 21/21 en FR puis EN, en 41 s. Dialogue avec journées classées, récapitulatif, confirmation bloquée sans motif ni choix, pièce déposée → « en examen » ; désistement visible chez l'entreprise sans rechargement (1,5 à 2,7 s), sans classement ni motif ; dossier reçu par le support, refus reçu par le candidat sans rechargement, recours proposé ; Tâches sans action de début ; aucun défilement horizontal, aucune erreur JavaScript. Une première passe a révélé que la candidature retirée disparaissait des onglets de l'entreprise : corrigé (onglet « Sélectionnées », badge « Désistement du candidat », signalement masqué sur une journée annulée).

### Validation de l'état final

| Contrôle | Résultat |
|---|---|
| Pile `easyjob-proof` réinitialisée depuis les seules migrations (protections du contrôle négatif restaurées) | ✅ 62 s, dernière version `20261122120000` |
| `pnpm test` (Vitest), puis suite RLS complète, l'un après l'autre (sorties conservées) | ✅ 597 tests, 50 fichiers, 22 s (nouveau : `candidate-cancellation`) |
| `pnpm test:rls` (build de production relié à la pile) | ✅ 37/37 au premier passage, 846 s (`candidate-cancellations` : 63 s) |
| `pnpm typecheck` (11 s), `pnpm lint` (59 s), `pnpm exec prettier --check .` (15 s), `pnpm build` (39 s, sans avertissement) | ✅ |
| Types générés (pile réinitialisée) | ✅ identiques à `lib/database.types.ts` |

### Limites

- Pas de délai ni d'issue pour un dossier resté sans pièce ; aucun rappel automatique.
- L'entreprise n'est prévenue que dans l'application (aucune notification push).
- Les six pages admin sans filtre `is_active` signalées au §39 restent à corriger.
- Le détail des pièces d'une fraude n'est visible que sur le dossier d'annulation concerné ou par la route admin des suspensions ; il n'y a pas d'écran dédié aux fraudes sans annulation.

## 41. Audit ciblé — annulations par l'entreprise et remplacements, préparation du lot 17d (2026-11-19)

Cadrage documentaire, sans implémentation ni écriture en base. Point de départ (constat Git) : `origin/main-dev` contient 17a (`3ae5aff`) et 17b–17c (`d2f1ecb`) ; la branche `feat/lot-17bc-candidate-cancellations` est alignée, l'arbre est propre et le stash de lint-staged est conservé. Comportements établis par lecture des migrations ; aucune preuve exécutée (aucun comportement important ne restait indécidable par lecture). Règles validées citées depuis le SRS §5.2 à §5.4 et `PLAN_ACTION.md` (lot 17) ; règles historiques du SRS signalées comme telles.

### Écarts relevés dans la documentation

- **§40, point 4** (unité « offre » après désistement) : inexact pour le désistement complet. `reputation_company_offers` (dernière version : `20261120120000`) ne compte que les candidatures `selected` ou `no_show` ; un désistement complet passe la candidature à `withdrawn` et ne bloque pas l'unité si les autres engagements sont confirmés. Seule une **période interrompue** (candidature restée `selected`, mission `cancelled`, journées restantes non confirmées) bloque l'unité, sans issue prévue. Non couvert par une preuve.
- **Plan, sous-lot 17c** : « absence injustifiée confirmée sur les dossiers du lot 14 » y figure comme producteur de manquement. Le seul écrivain de `reputation_incidents` est `cancellation_apply_sanction` (`candidate_late_cancellation`). Les natures `candidate_no_show` et `company_late_cancellation` n'ont **aucun producteur** ; la décision « établie » d'une absence (lot 14) reste sans conséquence.

### Inventaire

| Sujet | Règle documentée | Comportement réel | Contrôle en base | Écran | Décision manquante |
|---|---|---|---|---|---|
| Suppression d'une offre sans engagement | Historique (SRS §5.4, non appliquée) : modifier ou supprimer jusqu'à 12 h avant le début si le quota n'est pas atteint | `delete_job` (`20261101140000`) : suppression physique, quel que soit le statut ou l'échéance, si aucune candidature `selected`/`no_show`, mission, contrat ni ligne `cancellation_penalties`. Candidatures en attente effacées par cascade (`job_applications_job_id_fkey`), sans notification ni trace d'audit | Verrous candidatures puis offre ; refus `job_has_commitments` | `/company/jobs` : « Supprimer » toujours proposé, refus traduit (« contactez le support ») | Offre publiée avec candidatures en attente : suppression ou clôture tracée ; information des candidats |
| Annulation d'une offre ou d'une journée après sélection | Historique (SRS §5.3) : pénalité de 20 % due au candidat à moins de 12 h ; conditions entreprise « à arbitrer » (SRS §5.2) | **Aucun parcours.** `update_job` refuse dès une place pourvue (`job_has_selected_candidates`) ; calendrier figé (`job_schedule_locked`). Le statut `jobs.cancelled` et `missions.cancelled_by = 'company'` existent sans producteur | Refus seulement | Message « contactez le support » ; aucun outil du support | Tout le parcours (arbitrages 1 et 5 du plan) |
| Retrait d'un candidat sélectionné par l'entreprise | Aucune règle | Impossible : `protect_job_application_writes` refuse toute sortie de `selected`/`no_show` (« through support only »), mais aucune RPC du support n'existe | Trigger, tout auteur de session | Aucun | Admis ou non, motifs, effets (arbitrage 2) |
| Remplacement | Période complète : « le support examine la poursuite et le remplacement » (validé le 2026-11-17) ; « remplacement garanti sous 2 h » (SRS §6.11, Business) jamais livré et refusé par `user-facing-claims` | Seul remplacement possible : sélection ordinaire d'une autre candidature en attente, avant l'échéance, s'il reste une place. Texte affiché : « Aucun remplacement automatique » | `selection_prepare` : candidature `pending`/`shortlisted`, offre `active`, dossier entreprise valide, échéance (`recruitment_closed`), places, compte candidat actif (`candidate_unavailable`), conflits de 3 h sous verrou, empreinte, signature (`sign_and_select`). Profil ≥ 60 %, CNI valide et documents requis contrôlés **à la candidature seulement** (`apply_to_job_core`). Unicité (offre ou journée, candidat) : une candidature retirée ou refusée n'est ni réactivée ni renouvelée (`already_applied`). Période complète : la sélection couvre toutes les journées de l'offre (`job_effective_days`) | Sélection habituelle | Après clôture ; période entamée (arbitrage 3) |
| Places libérées, attentes, échéances | Lot 11b : échéance figée ; lot 17b : place libérée sans prolonger l'échéance | Désistement complet → mission `cancelled`, candidature `withdrawn`, `sync_job_positions_filled` décrémente offre et journée ; place sélectionnable jusqu'à l'échéance, puis `recruitment_closed`. Période interrompue : place conservée. Aucun avis aux candidats en attente. Absence signalée ou suspension : rien n'est libéré | Trigger du compteur ; échéances immuables | Offre : badge « Désistement du candidat » | Libération d'une place hors désistement (support, entreprise) |
| Période complète / journées au choix | Lot 12 : forfait non divisé (période) ; une mission par journée (au choix) | Au choix : chaque journée a sa candidature, sa mission, son contrat ; l'annulation libère la journée. Période : une candidature, une mission ; abandon partiel = interruption, place conservée | Lots 12 et 17b | Mission, offre | Contrat et base de montant d'un remplaçant sur une période entamée (aucun montant fixé ici) |
| Sanctions et réputation entreprise | −5 unités ; trois décisions en 90 jours → un retrait ; annulation par le support → solde rétabli (lot 9c) | Nature `company_late_cancellation` acceptée (cohérence : offre de l'entreprise), **sans producteur**. Le regroupement compte chaque ligne : aucun équivalent de `cancellation_id` unique côté entreprise | `protect_reputation_incidents` | Aucun | Délai, imputabilité, unité d'événement (arbitrages 1 et 5) |
| Indemnités et remboursements | Historique : 20 % (SRS §5.3), remboursement automatique du surplus (SRS §6.10) ; lot 12 : « absence validée avec remboursement effectivement confirmé » résout un engagement | Aucun versement. `cancellation_penalties` (`20260604120000`) : table vestige (pourcentages par défaut, lecture admin, insertion par clé service), sans producteur, qui bloque pourtant `delete_job`. `mission_acquired_amount` : information seulement | — | Montant acquis (parties) | Sort de la table vestige ; état « prévu, non versé » (lot paiement) |
| Engagements futurs d'un candidat suspendu | Ni supprimés ni transformés en absence (17c) | Début refusé (`account_suspended`) ; le candidat peut encore annuler ; le support voit la liste (`candidate_future_engagements`) ; l'entreprise n'est pas informée ; aucune annulation par le support | Fonction de lecture | `/admin/cancellations` | Arbitrage 4 |
| Absence signalée, non établie | Un signalement n'est jamais une absence établie (lot 14) | Dossier du lot 14, décision sans conséquence ; journée ni annulée ni libérée | `mission_incidents` | Signalements, support | Arbitrage 4 |

### Situations prioritaires

Une **journée commencée** (début enregistré) relève de l'interruption livrée en 17b–17c (§40) et n'est pas traitée ici. Les cas ci-dessous visent des journées non commencées.

| Cas | Exemple | Aujourd'hui | Conséquences à décider |
|---|---|---|---|
| A. Annulation avant toute sélection | Offre publiée le lundi pour le samedi, 3 candidatures en attente ; l'entreprise renonce le mardi | Suppression physique ; les 3 candidatures disparaissent sans avis | Clôture tracée plutôt que suppression d'une offre publiée ; avis aux candidats ; aucune sanction (recommandation : rien ne la justifie sans engagement) |
| B. Journée future annulée après sélection | Journées au choix 10, 11 et 12 ; deux candidats sélectionnés le 11 ; l'entreprise renonce au 11 le 9 au soir | Impossible (calendrier figé, aucun parcours) | Délai « tardif » ; une demande = un événement (deux candidats, au plus un manquement) ; contrats conservés, journée marquée annulée par l'entreprise ; information des candidats ; indemnité prévue, non versée |
| C. Journées restantes d'une période commencée | Période de 5 journées, 2 confirmées ; l'entreprise arrête les 3 dernières | Impossible ; seule l'interruption d'une journée commencée existe | Montant reconnu des 2 journées inchangé (`mission_acquired_amount`) ; les 3 journées forment un seul événement ; mission close sans être « réalisée » ; effet sur l'unité « offre » |
| D. Remplacer un candidat sans manquement | L'entreprise préfère un autre profil pour le 15, alors que le candidat a été sélectionné le 2 | Impossible | Admis ou refusé ; si admis : annulation par l'entreprise de ses journées (jamais un manquement du candidat), avec le délai et les effets de B |
| E. Désistement avant clôture | Offre normale du 20 à 8 h, clôture le 19 à 8 h ; désistement complet le 17 | Place libérée ; l'entreprise peut sélectionner une candidature en attente jusqu'au 19 à 8 h, avec tous les contrôles | Confirmer ce comportement ; avis éventuel aux candidats en attente |
| F. Désistement après clôture | Même offre, désistement le 19 à 20 h | Place libérée, mais toute sélection est refusée (`recruitment_closed`) | Remplacement tracé limité à la place libérée (proposition ci-dessous) ou aucun remplacement |
| G. Absence signalée, non établie | L'entreprise signale une absence le 10 à 9 h ; la période continue le 11 | Dossier ouvert ; journée du 10 ni annulée ni libérée ; le 11 reste dû | Aucun remplacement fondé sur le seul signalement ; suspension conservatoire des journées futures ou non, sans présumer la faute |
| H. Candidat suspendu avec engagements futurs | Exclusion de 6 mois le 5 ; journées sélectionnées le 8 et le 12 | Début refusé ; engagements maintenus ; entreprise non informée | Information de l'entreprise (« candidat indisponible », sans cause) ; annulation par le support au nom du candidat, sans nouveau manquement automatique ; place libérée ; remplacement (F) |

### Proposition à arbitrer : remplacement limité à une place réellement libérée

Après clôture, plutôt que de rouvrir l'offre :

- le support (grade à décider) ouvre un **remplacement** rattaché à une place libérée identifiée (journée, désistement ou annulation d'origine), avec motif et trace dans `audit_logs` ;
- seules les journées futures de cette place sont concernées ; calendrier, régime et échéance de l'offre restent figés ; l'offre ne réapparaît pas dans la liste publique ;
- candidats admissibles à décider (candidatures en attente existantes ou candidature sur invitation) ; jamais de réactivation d'une candidature retirée ou refusée ;
- la sélection reste `sign_and_select` : signature de l'entreprise, places, conflits avec la marge de 3 h, et **contrôles du dossier rejoués** (profil, CNI, documents), aujourd'hui vérifiés à la seule candidature ;
- une place = au plus un remplacement ouvert ; heure de fermeture à décider ; aucune garantie de remplacement annoncée.

Pour une période entamée, la sélection d'un remplaçant ne peut pas reprendre le contrat entier (journées passées incluses) : son contrat sur les seules journées restantes et la base de son montant sont à arbitrer, sans montant fixé ici.

### Réputation, forfait et paiement : effets actuels

| Élément | Désistement complet | Période interrompue | Annulation ou retrait par l'entreprise | Remplacement |
|---|---|---|---|---|
| Unité « offre réalisée » (`reputation_company_offers`) | Engagement retiré, ne bloque pas l'unité | Bloque l'unité, sans issue | Sans objet (aucun parcours) | Le remplaçant serait un engagement ordinaire, à confirmer |
| Engagements résolus | Seul le travail confirmé résout ; `cancelled` et `no_show` ne résolvent pas (lot 12) | Non résolu | — | — |
| Montant global du contrat | Inchangé, contrat conservé | Inchangé ; montant acquis au prorata des journées confirmées, journée interrompue « en examen » | — | — |
| Montants reconnus | Aucun | Conservés, jamais effacés | À conserver | — |
| Remboursement, indemnité | Aucun ; table `cancellation_penalties` vestige | Aucun | 20 % (historique, à réexaminer) | Aucun |

- **Règles validées** : unité « offre » du lot 12 ; un événement = un manquement (candidat) ; sanctions indépendantes de l'unité ; décision du support avant toute sanction ; aucun remboursement présumé ; calendrier et échéances figés.
- **Anciennes règles à réexaminer** : 12 h et 20 % (SRS §5.3) ; « modifier ou supprimer jusqu'à 12 h » (SRS §5.4) ; remplacement garanti (SRS §6.11) ; remboursement automatique du surplus (SRS §6.10) ; blocage de 7 jours et bannissement pour absence (SRS §5.3, §11.9).
- **Recommandations (non décidées)** : clôture tracée plutôt que suppression d'une offre publiée ; identifiant d'événement unique pour les manquements de l'entreprise ; un engagement annulé par l'entreprise ou retiré par le candidat ne prive pas l'offre de son unité à lui seul ; états financiers limités à « prévu, non versé » jusqu'au lot paiement.

### Limites

Aucune vérification exécutée. Les constats sur `reputation_company_offers` et sur l'absence de producteur de manquement viennent de la lecture de la dernière définition ; une preuve ciblée sur `easyjob-proof` les confirmera au début de l'implémentation.

### Suivi — 17d-0 : constats prouvés (2026-11-19)

Branche `feat/lot-17d-company-job-closure`, créée depuis `origin/main-dev` (`d2f1ecb`, lots 17b–17c intégrés : constat Git), documents du cadrage conservés, non commitée. Aucune règle métier modifiée par ces preuves.

| Constat | Preuve | Résultat observé en base |
|---|---|---|
| Désistement complet et unité « offre réalisée » | `candidate-cancellations` D2 | Journées au choix : une journée réalisée, l'autre abandonnée (candidature `withdrawn`) → l'offre rapporte l'unité une fois le recrutement clos ; avant le désistement, la journée encore due l'en empêchait. **Confirmé.** |
| Abandon d'une période commencée | `candidate-cancellations` D1 | Deux journées confirmées, la dernière annulée (candidature restée `selected`, mission `cancelled`) → aucune unité, même recrutement clos. **Confirmé : blocage sans issue.** |
| Absence injustifiée et `candidate_no_show` | `mission-incidents` N1 | **Précisé.** La décision générique d'un dossier d'absence est refusée (`use_dispute_decision`) : depuis le lot 16, l'absence se tranche par double validation, dont l'issue porte sur la réalisation du travail (« établi » = journée confirmée ; « non établi » = aucune absence fautive). Absence reconnue par le candidat, décision « non établi » par deux agents → aucune ligne `reputation_incidents`, candidature `selected`, mission non `no_show`, réputation inchangée. Aucune issue ne qualifie une absence injustifiée ; `candidate_no_show` n'a aucun producteur. |

Rectifications apportées : §40 point 4 (note déjà ajoutée, désormais prouvée) ; plan, sous-lot 17c ; SRS §5.2 (constats, sans nouvelle règle). Le constat d'absence reste à arbitrer (arbitrage 4 du plan).

### Suivi — 17d-1 : clôture tracée des offres publiées sans engagement (2026-11-19)

Règles validées (2026-11-24) appliquées ; SRS §5.4 (« Modification et réutilisation des offres ») et §8.1 (`job_closures`).

| Sujet | Mise en œuvre |
|---|---|
| Notions partagées | `job_offer_ids` (offre et sous-offres de l'entreprise), `job_has_commitments` (candidature `selected`/`no_show`, mission, contrat, pénalité : jamais le compteur de places), `job_was_published` (première publication, `legacy_publication`, `published_at`, clôture, ou statut qui suppose une publication). |
| Suppression | `delete_job` reprise : mêmes contrôles et verrous, refus `job_has_commitments` d'abord, puis `job_published` pour toute offre déjà publiée. |
| Clôture | `close_job(job, motif)` : entreprise propriétaire active déduite de la session (compte et profil actifs, dossier non exigé) ; motif 10 à 500 caractères ; verrous candidatures puis offres (ordre de `delete_job` et `sign_and_select`) ; relance → résultat d'origine (`already_closed`) ; refus `job_has_commitments`, `job_not_published`, `job_not_closable` (offre déjà annulée hors parcours). Statut `cancelled` + `jobs.closed_at` sur l'offre et ses sous-offres, ligne `job_closures` (auteur, motif, statut précédent, compteurs), une notification `application_update` par candidat en cours (sans motif), trace `close_job` dans `audit_logs` : une transaction. |
| Gardes (tout auteur) | `trg_job_closure_guard` : une offre clôturée ne change plus de statut ni de date de clôture, clé service comprise ; clôture posée hors session seulement. `trg_block_closed_job_applications` : aucune candidature, sélection ni refus sur une offre clôturée (retrait du candidat possible). `job_closures` en ajout seul, aucune écriture de session. |
| Visibilité | Politique de lecture : offre clôturée lisible par les candidats qui y ont postulé ; `job_availability` → `closed_by_company` ; motif lisible par l'entreprise et les admins seulement. Revalidation du dossier, modération (`job_not_pending`) et modification (`job_not_editable`) ne rouvrent rien. |
| Écrans FR/EN | `/company/jobs` : actions calculées par la base (`my_job_removal_actions`) : « Supprimer » (jamais publiée), « Clôturer l'offre » (dialogue : conséquences, motif, confirmation), « Annulation : contacter le support » (engagement, sans promesse d'outil) ; badge « Clôturée » et motif ; écran périmé → refus traduit et relecture. Candidatures de l'offre : bandeau, plus de sélection ni de refus. Candidat : « Offre clôturée par l'entreprise » dans *Mes missions*, page dédiée sur le lien direct (historique proposé au candidat qui a postulé). Relecture sans rechargement par les signaux existants (`jobs`, `applications`, `jobs:public`). |
| Route | `POST /api/jobs/[id]/close` (Zod `jobClosureSchema`, codes traduits) ; `DELETE /api/jobs/[id]` renvoie `job_published`. |

Hors périmètre, non implémentés : annulation après sélection, sanctions entreprise, remplacement, annulation des engagements d'un candidat suspendu, indemnités et remboursements.

**Preuves.** `job-closure` (26 assertions) : S1-S3 suppression (jamais publiée ; refus après publication, après retour en modération, offre historique) ; C0-C4 motif, clôture et conservation, notifications sans doublon, relance, lecture du motif ; V1-V3 visibilité, refus de candidature, de sélection et de refus, historique du candidat ; E1 sélectionné, mission, contrat ; D1-D5 droits (autre entreprise, anonyme, candidat, compte suspendu), écritures directes de session, clé service (réouverture, candidature, sélection, réécriture du motif), actions proposées, offre revenue en modération ; P1 panne de la trace sans effet partiel ; R1-R4 courses clôture/candidature et clôture/sélection dans les deux ordres (barrière du lot 11) ; G1 dossier en revue puis revalidé ; M1-M2 plusieurs journées ; T1 signaux `{d, r}`. Preuves adaptées (une offre publiée ne se supprime plus) : `job-moderation` I3, I8-I10 ; `candidate-selection` C4 ; `realtime` J12. Test Vitest `job-closure` (bornes du motif, codes traduits, aucune promesse d'annulation).

**Contrôles négatifs** (pile de preuve, sorties conservées) : ancien `delete_job` remis et `trg_job_closure_guard` désactivé → `job-closure` 6 échecs (S2, S3, D3, puis D2, D4, D5) ; suppression rouverte en session (procédure `local-proofs.md`) → `job-moderation` 4 échecs (B10, I1, I2, I3). Pile restaurée par réinitialisation, protections vérifiées.

| Contrôle | Résultat |
|---|---|
| Preuves ciblées pendant le développement : `job-closure`, `candidate-cancellations`, `mission-incidents` (N1 d'abord en échec : décision générique refusée, constat corrigé vers la double validation), `job-moderation`, `candidate-selection`, `realtime` | ✅ |
| Pile `easyjob-proof` réinitialisée depuis les seules migrations, puis `pnpm test:rls` complet (build de production relié à la pile) | ✅ 39/39, 992 s |
| `pnpm test` (Vitest), séparément | ✅ 619 tests, 52 fichiers (dont `job-closure`, 5 tests) |
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .`, `pnpm build` | ✅ |
| Types générés depuis la pile réinitialisée | ✅ identiques à `lib/database.types.ts` |
| `job-closure` relancée sur le build final (après le correctif d'écran ci-dessous) | ✅ 26/26 |
| Navigateur (Chrome headless par CDP, 375 × 812, sessions entreprise et candidat, deux onglets candidat, script hors dépôt) | ✅ 27/27 en FR puis EN, 37 s |

**Navigateur.** Brouillon : « Supprimer » seul ; offre engagée : « Annulation : contacter le support » et dialogue refermable ; offre publiée : « Clôturer l'offre », motif trop court refusé avant l'envoi, clôture confirmée (message, badge « Clôturée », motif dans l'onglet des offres terminées) ; côté candidat, sans rechargement : « Offre clôturée par l'entreprise » dans *Mes missions* et page dédiée sur le détail ouvert ; écran périmé (sélection pendant que le dialogue est ouvert) : refus compréhensible, offre restée active ; aucun défilement horizontal, aucune erreur JavaScript. Une première passe a révélé que le bouton « J'ai compris » du dialogue « support » ne le fermait pas (`AlertDialogAction` du dépôt ne ferme rien seul), ni le bouton « Annuler » du dialogue de suppression existant : corrigés sur cet écran. Observation hors lot : le menu d'actions des cartes (`components/ui/dropdown-menu.tsx`) s'affiche dans la carte et la resserre tant qu'il est ouvert, à 375 px (comportement antérieur).

**Avant déploiement** (lecture seule) : compter les offres publiées sans engagement que les entreprises ne pourront plus supprimer, et les offres déjà `cancelled` (historiques, non clôturables par ce parcours) : `select status, count(*) from public.jobs where first_published_at is not null or legacy_publication or published_at is not null group by 1;`.

**Limites.** Notification dans l'application seulement ; le motif n'est pas montré aux candidats ; *(rectifié par le complément ci-dessous : la suppression en clé service de l'historique est fermée)* ; aucune clôture partielle de journées.

### Complément — 17d-1 : historique d'une offre publiée et candidatures figées (2026-11-24)

**Suppression en clé service : appelants et cascades.** Aucun code de l'application ne supprime une offre, une entreprise, un profil ou un compte avec la clé service. Seuls le faisaient `delete_job` (session de l'entreprise, règles propres) et les nettoyages des preuves (une vingtaine). Effacer une offre emportait en cascade ses candidatures (et leurs contrats, `contracts_application_id_fkey`), missions et journées, signalements, annulations et `job_closures`. Les traces d'audit (`resource_id` sans clé étrangère) et les notifications survivaient, mais pointaient vers une offre disparue. La suppression d'une entreprise ou d'un profil candidat effaçait les mêmes lignes par cascade. Aucun parcours administratif de purge n'est validé : cette permission ne servait qu'au nettoyage des preuves. **Le chemin est fermé.**

| Sujet | Mise en œuvre |
|---|---|
| Garde de l'historique | `trg_job_history_guard` (jobs) et `trg_job_application_history_guard` (job_applications), avant suppression, pour tout auteur : une offre publiée (`job_was_published`) ou une candidature sur une telle offre ne s'efface pas (`job_history_protected`). Cela couvre la clé service, les fonctions `SECURITY DEFINER` et les cascades (entreprise, profil, compte). `job_closures` : suppression soumise à la même règle. Une offre jamais publiée reste supprimable. |
| Maintenance | `job_history_maintenance()` : `session_user` `postgres` ou `supabase_admin`, c'est-à-dire une connexion directe à la base. Une requête de l'application passe toujours par PostgREST (`authenticator`) et n'en est jamais une, même en clé service. |
| Preuves | `scripts/lib/proof-purge.ts` (`purgeProofJobs`) : connexion directe à la pile dédiée (`readLocalDbUrl`, hôte local imposé), offre par offre, au mieux ; appelée en tête du nettoyage de chaque preuve qui crée des offres, et pour la candidature supprimée de `realtime` R1. Aucune voie ouverte à l'application. |
| « Plus aucun refus » | Précisé (décision du 2026-11-24) : **tout changement de statut** d'une candidature sur une offre clôturée est refusé (`job_closed`), qu'il s'agisse d'un refus par l'entreprise ou d'un retrait par le candidat (route `DELETE /api/jobs/[id]/apply` : 409 `job_closed`). Candidatures figées à la clôture. |
| Présentation historique | Candidat : la candidature passe dans la section historique de *Mes missions* (`splitApplications`), badge « Offre clôturée par l'entreprise ». Entreprise : l'onglet « En attente » de l'offre devient « Offre clôturée (n) », badge « Offre clôturée », sans action ; le compteur « en attente » du tableau de bord exclut les offres clôturées. |

**Preuves.** `job-closure` passe à 28 assertions. V2 : retrait par le candidat refusé (route et RPC). H1 : en clé service, suppression de l'offre clôturée, de ses candidatures, de sa clôture, d'une offre publiée sans clôture, d'une entreprise sans contrat (cascade) et d'un profil candidat (cascade) → refusée (`job_history_protected`) ; offre, candidatures, clôture, audit et notifications intacts. H2 : offre jamais publiée toujours supprimable. Vitest : `my-jobs` (offre clôturée → historique). Une première version de H1 visait l'entreprise principale, protégée aussi par la contrainte `contracts_company_id_fkey` ; elle a été remplacée par une entreprise sans contrat, pour que seule la garde puisse refuser.

**Contrôles négatifs** (remesurés, sorties conservées) :
- ancien `delete_job` et gardes de réouverture et d'historique désactivés → `job-closure` 7 échecs (S2, S3, D3, H1, puis D2, D4, D5) ;
- gardes d'historique seules désactivées → 2 échecs (H1, D4 en conséquence) ;
- suppression rouverte en session → `job-moderation` 1 échec (B10) tant que la garde de l'historique reste active, 4 échecs (B10, I1, I2, I3) si elle est aussi désactivée.

| Contrôle | Résultat |
|---|---|
| Pile `easyjob-proof` réinitialisée sur le SQL final, `pnpm test:rls` complet | ✅ 39/39, 1083 s ; aucune offre ni candidature restante après la suite |
| `job-closure` ciblée | ✅ 28/28 ; fixtures purgées (0 compte, 0 offre, 0 clôture restants) |
| `pnpm test` (Vitest) | ✅ 620 tests, 52 fichiers |
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .`, `pnpm build` | ✅ |
| Types générés (pile réinitialisée) | ✅ mis à jour (`job_history_maintenance`), identiques |
| Navigateur (CDP, 375 × 812, FR puis EN) | ✅ 31/31 : historique côté candidat, onglet « Offre clôturée » côté entreprise, sans action |

**Constat hors lot.** `candidate-cancellations` laisse quatre comptes de preuve sur la pile. L'immuabilité de `case_evidence` (lot 17b–17c) refuse la mise à `null` de `uploaded_by` lors de leur suppression. Ce n'est pas lié à ce lot ; à traiter avec la maintenance des preuves.

**Limites.** La suppression d'un compte (droit des personnes) est désormais bloquée tant qu'elle effacerait l'historique d'une offre publiée : son parcours relève du lot « Données personnelles ». La protection porte sur l'offre, ses candidatures et sa clôture. Les missions, contrats et traces d'audit gardent leurs propres règles.

## 42. Correctif — horaires par journée dans le formulaire d'offre (2026-11-24)

Branche `fix/job-form-day-schedules`, créée sur `d346aeb` (lot 17d commité et poussé sur `origin/feat/lot-17d-company-job-closure`, **non intégré** à `origin/main-dev` : constat Git ; à fusionner après 17d). Non commitée. Essais sur `easyjob-proof` uniquement. Aucune migration.

### Constat et cause

Constat utilisateur : toutes les journées prennent les mêmes horaires, sans moyen apparent d'en définir un par date.

Reproduction dans le vrai formulaire (navigateur, 375 px), puis relecture en base :

- **Le choix existait et l'enregistrement était correct.** En décochant « Mêmes horaires pour toutes les journées », chaque date affichait ses champs. `create_job` et `update_job` enregistraient l'horaire propre de chaque journée dans `job_days`, comme prévu au lot 12 : lundi 08–16, mercredi 10–14, vendredi 22–06 relus en base.
- **Le choix était peu visible.** Il prenait la forme d'une simple case **cochée par défaut**, placée sous la liste des dates : seuls les champs communs étaient affichés, et rien n'indiquait l'autre mode.
- **Écrasement silencieux.** Recocher la case faisait appliquer les horaires communs à toutes les journées lors de l'envoi, sans confirmation, et perdait les différences saisies.
- **Résumés trompeurs.** Les horaires de l'offre (`jobs.start_time`/`end_time`) sont ceux de la première journée. Ils étaient affichés comme horaires de toute l'offre dans trois écrans : le champ « Horaire » de la modération, la carte d'offre de la liste candidat et la carte de la liste des offres de l'entreprise. Une offre aux horaires variables y paraissait donc avoir les mêmes horaires partout.

Le détail d'offre, l'aperçu, le contrat (lots 12 et 13) et l'écran des candidatures affichaient déjà les horaires de chaque journée.

### Correction

| Sujet | Mise en œuvre |
|---|---|
| Choix explicite | Dès deux dates, groupe « Horaires » à deux options (`role="radio"`) : « Mêmes horaires pour toutes les journées » et « Horaires différents selon les journées ». Dans le second mode, chaque date affiche ses champs de début et de fin, avec une indication sous le groupe. |
| Passage aux horaires par journée | Chaque date reprend les horaires communs déjà saisis comme valeurs initiales. |
| Retour aux horaires communs | Si les journées ont des horaires différents, confirmation avant l'écrasement : « Remplacer les horaires » applique ceux de la première journée à toutes les dates ; « Garder les horaires par journée » ne change rien. Sans différence, le retour se fait sans confirmation. Boutons empilés à 375 px. |
| Conservation | L'état du formulaire est unique : mode et horaires sont conservés en changeant de format, après une erreur de validation et en revenant à une étape précédente. En correction avant publication, le mode et les horaires enregistrés sont relus depuis `job_days`. |
| Résumés | `hoursVary` (`lib/jobs/schedule.ts`) : si les horaires diffèrent, la modération, la carte de la liste candidat (`/api/jobs` lit `job_days`) et la liste de l'entreprise affichent « Horaires selon les journées » au lieu des horaires de la première journée. |
| Règles inchangées | Heure de Douala, nuit « se termine le lendemain », refus des horaires invalides et des chevauchements (`scheduleIssue`, `job_days_parse`), rémunération à la tâche, calendrier figé après la première publication (champs et choix désactivés, refus en base), échéances, sélection et conflits de 3 h. |

### Vérification

| Contrôle | Résultat |
|---|---|
| Parcours de bout en bout (CDP, 375 × 812 ; FR période complète, EN journées au choix ; mode commun) | ✅ 40/40 : lundi 08–16, mercredi 10–14, vendredi 22–06 (+1 j) enregistrés en base pour les deux formats ; aperçu, modération (journées et résumé), détail d'offre, contrat (un contrat de trois journées ou un contrat par journée) ; erreur de validation corrigée sans perte ; retour d'étape ; confirmation et « garder » ; correction avant publication rechargée puis enregistrée ; après publication, champs et choix en lecture seule et refus en base ; mode commun (09–17 partout, résumé non « variable ») ; aucun défilement horizontal, aucune erreur JavaScript |
| Preuves ciblées (SQL inchangé) : `multi-day-jobs`, `job-deadlines`, `job-moderation`, `jobs-rls-select`, `contract-selection` | ✅ 5/5 |
| `pnpm test` (Vitest, dont `hoursVary`) | ✅ 621 tests, 52 fichiers |
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .`, `pnpm build` | ✅ |

Suite RLS complète non relancée : aucune migration ni fonction SQL modifiée. La première passe du parcours a échoué sur deux points du script (bouton « Voir » de la modération sous la barre fixe ; écran de correction d'une offre publiée fermé au plan gratuit). Elle a aussi révélé un débordement des boutons du dialogue à 375 px, corrigé.

**Limite.** La carte d'une offre affiche « Horaires selon les journées » sans détail ; le détail par date reste sur la page de l'offre.

## 43. Audit ciblé — abonnements entreprise, préalable au lot 17d-2 (2026-11-19)

Cadrage documentaire, sans modification du code ni de la base. Point de départ (constat Git) : `origin/main-dev` = `7bf9bf8`, qui contient 17d-0 et 17d-1 (#57, `d346aeb`) et le correctif des horaires par journée (#59, `27bf80d`). La branche `feat/lot-17d2-company-cancellation` a été créée depuis cette base. Aucun fichier de code n'y est modifié et le stash de lint-staged est conservé. **17d-2 est suspendu (décision du 2026-11-19)** : le lot Free/Premium entreprise n'a encore été ni cadré ni livré. Méthode : lecture des dernières définitions SQL, des routes, des écrans et des dictionnaires, du SRS (§3, §5.3, §5.4, §6.11) et des user stories (US-SUB-02, offre urgente, modification d'offre). Aucune requête en base, aucune preuve exécutée.

Identifiants du registre (`docs/product/DECISIONS.md`, depuis le 2026-11-19) : `ANN-06`, `ABO-05` à `ABO-18`, `MNT-09`, `MNT-10`, `ANN-14`, `ENT-01` à `ENT-07`. Rectification du 2026-11-19 : le quota d'offres (`ABO-10`) et les frais de publication urgente (`MNT-09`) sont décidés ; les propositions de ce paragraphe qui les concernent (« quota à arbitrer », « pas de déclinaison par plan » pour l'urgence) sont remplacées par ces entrées. Les avantages cibles **communs à Free et Premium** sont aussi décidés : duplication en brouillon, modèles, exports PDF/CSV et assistance sans garantie (`ABO-12` à `ABO-15`, `ENT-02`). Ils remplacent, sur ce périmètre, les lignes « Modèles d'offres (Pro) », « export PDF/Excel » et « Réutilisation d'une offre ou modèles : à décider » ci-dessous. Ils ne sont pas livrés. Les **favoris Premium** sont décidés pour les seuls candidats ayant déjà réalisé une mission pour l'entreprise : liste privée, sans coordonnée ni priorité, conservée mais suspendue à l'expiration de Premium (`ABO-16`). Ils remplacent, sur ce périmètre, la ligne « Favoris… (Pro, Business) » ci-dessous, sans valider l'invitation directe ni les invitations prioritaires. L'éligibilité après une réalisation partielle reste rattachée à l'arbitrage existant. Les **statistiques avancées Premium** sont décidées (`ABO-17`) : activité, recrutement, réalisation par catégorie de journée, montants contractuels et reconnus distincts des paiements, graphiques, comparaisons et filtres, sur la seule activité de l'entreprise. Free garde listes, compteurs et exports ; un indicateur peu fiable est affiché comme indisponible ; aucun paiement n'est simulé. Elles remplacent, sur ce périmètre, la ligne « Rapport mensuel, reporting basique ou avancé » ci-dessous (les factures restent au lot paiement). Non livrées : le tableau de bord n'a que quatre compteurs opérationnels. La **fourchette de rémunération Premium** est décidée (`ABO-18`, `MNT-10`) : montant fixe ou fourchette au choix de l'entreprise Premium ; montant demandé par le candidat dans les bornes (par journée pour les journées au choix) ; candidature acceptée à ce montant ou refusée, sans contre-offre ; montant unique figé par « Signer et sélectionner ». Les contrats existants ne changent pas, les offres publiées gardent leurs conditions après l'expiration de Premium, et l'entreprise ne reçoit aucun pouvoir sur les montants partiels. Complément du 2026-11-19 (`ABO-18`) : Premium doit être actif à la première publication (brouillon conservé si Premium a expiré : renouvellement ou montant fixe avant une nouvelle soumission) ; modifier les bornes d'une offre publiée exige Premium actif, aucun candidat sélectionné et une nouvelle modération, sans modifier automatiquement un montant demandé ni présumer un consentement. Ce complément ne vaut que pour les bornes et ne tranche pas les autres droits de modification (`ABO-08`). Non livrée : un seul montant fixe existe aujourd'hui. Encaissement et ajustements : lot paiement. Le **recrutement de remplacement après désistement** est décidé le 2026-11-20 (`ANN-14`), **commun à Free et Premium** : place réellement libérée, réouverture des seules places et journées libérées s'il reste au moins 4 h avant le début, fermeture à H−2, avis dans l'application et par e-mail aux anciens candidats non retenus, éligibles et disponibles (marge de 3 h), confirmation d'intérêt sans réactivation silencieuse, contrôles rejoués à « Signer et sélectionner », cycle distinct tracé. C'est une exception encadrée aux échéances initiales, sans modification des horaires publiés. La proposition qui réservait cette recherche à Premium n'est pas retenue (`ENT-03`). Complément du 2026-11-20 (`ANN-14`) : candidatures en attente et refusées alertées (confirmation d'intérêt explicite pour un refus) ; aucune alerte pour un retrait volontaire (retour volontaire possible dans ce seul cycle), pour le candidat à l'origine du désistement sur les journées abandonnées, ni pour un candidat déjà sélectionné ; confirmations rattachées au cycle, sans réactivation ni ancien consentement ; seuils de 4 h et H−2 appréciés au début de chaque journée libérée ; contrôles existants revérifiés à la sélection. Principe et destinataires validés ; fonctionnalité non livrée ; modalités restantes à cadrer (période commencée, règles financières, service d'e-mail, retour du candidat à l'origine du désistement). Non livré : aucune réouverture ni aucun service d'e-mail n'existe. Absences signalées et suspensions restent hors de ce périmètre. **Arbitrages 1 à 3 réglés le 2026-11-20** (`ABO-07`) : Free et Premium remplacent les quatre plans ; Free par défaut ; attribution tracée par `admin_ops` et `admin_founder` ; anciens comptes requalifiés explicitement, sans conversion de `starter`, `pro` ou `business` ; rôle `company_premium` sans effet (`ABO-11`). Les droits dépendant de `pro`/`business` (modification directe, `ABO-08`) ne sont pas repris d'office. L'arbitrage 9 est réglé dans le même sens : le lot « Plan entreprise effectif et gestion administrative tracée » précède 17d-2. **Lot réalisé le 2026-11-20** (non commité) : `ABO-08` tranché (modification directe réservée à Premium), profil entreprise limité au plan, à sa fin et à l'attribution (`ABO-19`), anciennes présentations à quatre plans retirées ; compte rendu au §44.

**Décisions validées, conservées** (2026-11-19, pour 17d-2) : Free annule dans le délai jusqu'à 48 h avant la journée, Premium jusqu'à 24 h avant, limites incluses. Le plan est figé au moment de chaque sélection. Une annulation après le seuil reste possible ; elle est qualifiée de tardive. Les conséquences financières et les sanctions restent à définir.

### Plans, rôles et appellations présents

| Élément | Où | Valeurs | Usage réel |
|---|---|---|---|
| `company_profiles.subscription_plan` | `20260604120000` (SRS v1.2) | `free`, `starter`, `pro`, `business` (contrainte `company_profiles_subscription_plan_chk`) | Source déclarée du plan. Écrite par la clé service ou en SQL direct seulement (colonnes fermées aux sessions, `20261101130000`) |
| `company_profiles.subscription_expires_at` | idem | Échéance ; vide = sans fin | Lue par `company_effective_plan` |
| `company_effective_plan(plan, expires_at)` | `20261107150000` (lot 7d) | `free` si la valeur n'est ni `starter`, ni `pro`, ni `business`, ou si l'échéance est passée (`<= now()`, donc Free à l'instant exact de l'échéance) ; sinon la valeur stockée | `update_job`, `my_account_state`. **Aucun paramètre d'instant** : le calcul se fait toujours à `now()`, contrairement à `candidate_effective_plan(uid, at)` (lot 17a) |
| `company_profiles.subscription_tier` | baseline | Ancienne appellation, recopiée vers `subscription_plan` en `20260604120000` | Lue en dernier repli par `/profile/company`, avant le plan calculé |
| `company_profiles.trial_ends_at` | baseline | Fin d'essai | `hasUsedTrial` du profil, sans effet (essai masqué depuis le lot 9) |
| Table `subscriptions` | baseline | `plan` en texte libre (« gratuit, starter, pro, business, premium »), `status`, `auto_renew`, `expires_at` | Lue par `my_account_state` (renouvellement affiché) et en repli par le profil. Écritures de session fermées (F-06, lot 2) ; aucun producteur dans l'application |
| Rôle `company_premium` (`user_role`) | `20260526120000` | Rôle, pas un abonnement | Mêmes droits que `company` partout (`role in ('company', 'company_premium')`). Aucun parcours ne l'attribue : l'inscription crée `company`, `users.role` est fermé aux sessions (`20261031120000`). `isCompanyPremium()` n'a aucun appelant. Le SRS §3 lui prête « options urgentes gratuites, reporting, support prioritaire » : aucun de ces droits n'existe |
| `COMPANY_PLAN_FEES` (`lib/types`) | TypeScript | Frais 10/8/0/0 %, urgence 2 000/1 000/0/0, `selectionDeadlineHours` 48/24/12/6, `lateCancellationHours` 48/48/24/12, `trialDays` 0/0/7/7 | Lue seulement par `getCompanyPlanPermissions`, qui n'a aucun appelant, pas plus que `getCompanyPlan` ni `isPlanAtLeast` (`lib/utils/company-plan.ts`). Rien n'y est une décision validée. Les délais de sélection contredisent le lot 11b (H−24 et H−2 pour tous) ; Business à 12 h contredit « Premium 24 h » |
| `getPlanLimits` (`lib/utils/profile-status.ts`) | TypeScript | `directEdit` pour `pro` et `business`, offres illimitées pour tous, couleurs | Liste des offres, page de modification, profil entreprise |
| **Free/Premium entreprise** | — | **Absent** | Aucune valeur, aucune fonction, aucun texte. La seule correspondance chiffrée entre plans et délai d'annulation (`lateCancellationHours`) est une constante sans appelant, non validée |

### Activation, expiration et changement de plan

- **Activation et changement** : aucune route, aucune RPC, aucun écran admin. Seule une écriture en clé service (ou en SQL direct) de `subscription_plan` et `subscription_expires_at` les permet. La fiche admin d'une entreprise n'affiche pas le plan. Il n'existe ni historique (aucun équivalent de `candidate_premium_grants`), ni motif, ni trace d'audit, ni notification.
- **Expiration** : calculée à la lecture, sans écriture (lot 7d). Les écrans ouverts basculent par minuterie sur l'heure du serveur, puis par le signal `subscription` (`rt_on_company_profiles`, `rt_on_subscriptions`).
- **Renouvellement, régularisation sous 3 jours, essai Pro de 14 jours, Mobile Money** (SRS §6.11, US-SUB-02) : absents.
- **Interface** : « Changer de plan avec le support » (lien e-mail) et « Le changement de plan est effectué par l'équipe EasyJob ». Ces deux textes sont exacts.
- **Conséquence pour 17d-2** : on peut calculer le plan effectif dans la transaction de sélection (`now()`). En revanche, rien n'atteste qui a fixé ce plan, quand, ni pourquoi. Un plan modifié en clé service juste avant une sélection ne laisserait aucune trace. Figer un délai de 24 h sur une telle base n'est pas vérifiable.

### Avantages annoncés et comportement réel

Sources : SRS §6.11 (tableau entreprise), §3 (rôle `company_premium`), §5.3, §5.4 ; US-SUB-02 et user stories de l'offre urgente et de la modification ; écran `/profile/company` (`PremiumCompanyBenefits` : avantages du plan courant ; `UpgradeBanner` : plans supérieurs, pour Free et Starter). Les composants `premium-company-showcase` et `plan-features` n'ont **aucun appelant** : leurs textes existent dans les dictionnaires mais ne sont pas affichés.

| Avantage annoncé (source) | Comportement réel | Contrôle serveur | Écart | Proposition de traitement |
|---|---|---|---|---|
| Offres actives : Free 2, Starter 5, Pro et Business illimitées (SRS §6.11, US-SUB-02) ; écran : « Offres illimitées » pour tous (`jobsUnlimited`, compteur) | Aucune limite | Aucun | Le SRS et l'écran se contredisent ; aucun quota décidé | Arbitrer : illimité pour tous (déjà affiché) ou quota Free (nombre à décider). Aucun chiffre fixé ici |
| Modification directe des offres actives, Pro et Business (SRS §6.11 ; §5.4 « comptes premium ») ; US : modification par un compte premium même quota atteint (date, nombre, salaire), candidats prévenus ; écran : « Éditez vos offres publiées à tout moment, sans support » | Plan effectif `pro` ou `business` : modification d'une offre active **sans candidat sélectionné**, qui repasse en modération (`pending_review`). Dates et horaires figés après publication pour tous (`job_schedule_locked`) ; refus pour tous dès qu'une place est pourvue (`job_has_selected_candidates`). Free et Starter : `job_locked_plan` | `update_job`, avec `company_effective_plan` : **seul droit lié au plan contrôlé en base** | La user story contredit le calendrier figé (lot 11b) et l'engagement signé. « À tout moment, sans support » est inexact : il y a un retour en modération et des verrous | Candidat crédible pour Premium, réalisable avec le contrôle existant. Texte à rectifier. Jamais après une sélection : cela relève de la correction encadrée par le support (futur lot) |
| Options urgentes : payantes pour Free (2 000 FCFA), réduites pour Starter (1 000 FCFA), incluses pour Pro et Business (SRS §5.x, §6.11 ; US offre urgente ; `urgentPaid`, `urgentReduced`, `freeUrgent`, `starterKicker`, `tagline`) | Le régime urgent se déduit de l'horaire à la première publication, sans option ni frais (lots 9d, 11b) | — | Promesse d'une option et d'un prix qui n'existent pas | Retirer des textes. Pas de déclinaison par plan : l'urgence n'est pas une option |
| Frais de service 10 / 8 / 0 % (`serviceFee10`, `reducedFee`, `zeroFee`, accroches) | Aucun prélèvement, aucun paiement | — | Frais annoncés inexistants | Retirer ; lot paiement |
| Visibilité accrue, « offres en priorité dans les recherches » (Starter ; SRS « légère mise en avant ») | Liste des offres sans critère de plan | — | Non livré | Retirer. Ne pas proposer sans règle de classement (même réserve que pour la priorité candidat, §38) |
| Indicateurs de fiabilité, recommandations IA (Pro ; `aiMatch`, `aiRecoOn`) | Étoiles et vérifications visibles par **toutes** les entreprises ; la route de matching n'a aucun appelant | Aucun contrôle de plan | Fonction commune présentée comme un avantage Pro | Présenter comme commun, ou retirer de la liste Pro |
| Favoris, invitation directe, invitations prioritaires, alertes de disponibilité (Pro, Business) | Absents côté entreprise (`job_favorites` sert aux favoris d'offres du candidat) | — | Non livré. Une invitation directe contournerait la candidature publique et ses contrôles (profil, CNI, documents) | Retirer. Futur lot si décidé, avec les contrôles de candidature rejoués |
| Modèles d'offres (Pro) ; « réutiliser une ancienne offre » pour toute entreprise (SRS §5.4) | Absent (seule la recopie d'horaires entre journées existe dans le formulaire) | — | Non livré ; le SRS le prévoit pour tous | Retirer de Pro. Futur lot, plan à décider |
| Rapport mensuel, reporting basique ou avancé, export PDF/Excel, factures (Pro, Business) | Tableau de bord simple ; aucune facture | — | Non livré | Retirer ; futur lot (données, ou paiement pour les factures) |
| Recrutement en masse, 10 candidats et plus (Business) | Une sélection signée à la fois (`sign_and_select`, conflits de 3 h) | — | Non livré, contraire à la signature par sélection | Retirer |
| Tableau de présence en temps réel (Business) | Début et fin de journée visibles sur chaque mission (lots 7c, 15), pour tous ; aucune vue d'ensemble | — | Partiel, et commun | Retirer de Business. Vue d'ensemble éventuelle plus tard |
| Contrats sectoriels validés (Business) | Deux modèles, `simple` et `formal`, pour tous (lot 13) | — | Non livré ; aucune validation juridique | Retirer |
| Remplacement garanti sous 2 h (Business, SRS §6.11) ; texte actuel « Aide en cas d'absence… contactez le support » | Aucun remplacement ; le support est le même pour tous | — | Promesse déjà reformulée (lot 9), mais encore classée « Business » | Présenter comme commun ; le remplacement relève de 17d-4 |
| SLA prioritaire, support 24/7, traitement sous 1 h, account manager (SLA 4 h), support standard 48 h (Starter, Business) | Aucune file prioritaire, aucun délai | — | Engagements de service non tenus | Retirer. Un engagement de service est une décision opérationnelle, pas un développement |
| Modération immédiate en moins de 30 min (Business) | File unique de modération | — | Non livré | Retirer. À ne pas proposer : cela presserait la vérification |
| Essai gratuit de 7 ou 14 jours (SRS §6.11, US-SUB-02) | Aucun essai ; badge masqué (lot 9) | — | Déjà refusé par `user-facing-claims` | Laisser retiré |
| Prix de 5 000, 12 000 et 25 000 FCFA (SRS §6.11, US-SUB-02) | Non affichés | — | Aucune décision commerciale récente | Hors périmètre : aucun prix fixé ici |
| Annulation, tous plans : « aucune somme n'est bloquée ni retenue… Contactez le support avant d'annuler une mission engagée » | Exact aujourd'hui | — | À revoir avec 17d-2 | Réécrire avec 17d-2 |
| Showcase non affiché (« −45 % », « ×2 », « 12 grandes entreprises… », multi-utilisateurs, branding) ; `plan-features` (« 2 offres actives maximum ») | Non affichés | — | Textes inutilisés, chiffres sans source | Supprimer lors de la réécriture, pour éviter leur réemploi |
| Offres illimitées, contrat signé, historique (Free) | Livrés pour tous | Contrôles existants | Aucun | Conserver, comme fonctions communes |

`user-facing-claims` ne couvre aujourd'hui que les promesses candidat (lot 17a) et les promesses générales du lot 9. Aucun motif ne vise les avantages entreprise ci-dessus.

### Dépendances avec les parcours

- **Publication** : modération, dossier vérifié (lot 11), échéances et régime (lot 11b) identiques pour tous les plans. Aucun quota. Le badge « Urgente » est calculé.
- **Correction** : le seul droit lié au plan est la modification d'une offre active sans sélection (Pro et Business). Après publication, le calendrier est figé pour tous. La correction encadrée des horaires par le support reste un futur lot.
- **Annulation** : 17d-1 (clôture sans engagement) ne dépend d'aucun plan. 17d-2 a besoin d'un plan Free/Premium entreprise **fiable, tracé et figé à la sélection** (comme 17a pour le candidat) ; sinon, ses engagements n'ont pas de délai déterminable.
- **Remplacement** : aucun lien au plan aujourd'hui. Si l'annonce Business (« remplacement garanti ») était reprise, elle dépendrait de 17d-4 et ne devrait pas être promise.
- **Paiement** : frais, urgence payante, prix, essai, renouvellement, régularisation et factures dépendent tous du lot paiement.

### Grille Free/Premium entreprise proposée (à valider)

**Communs aux deux plans** (déjà livrés) : publication soumise à modération, dossier vérifié, offres en nombre non limité (tant que l'arbitrage 7 n'en décide pas autrement), échéances du lot 11b, calendrier figé, sélection signée et contrat, réputation, indicateurs de fiabilité, suivi des journées, support, signalements, contestations, clôture d'une offre sans engagement.

| Avantage | Plan | Valeur pour l'entreprise | Effet sur les candidats et sur Free | Dépendance, coût | Réalisable |
|---|---|---|---|---|---|
| Annulation dans le délai jusqu'à 48 h avant la journée | Free | Règle claire, affichée par engagement | Préavis de 48 h au moins | 17d-2 | Avec 17d-2 |
| Annulation dans le délai jusqu'à 24 h avant la journée (**validé**) | Premium | Souplesse | Le candidat reçoit un préavis plus court. À compenser au moins par une information (arbitrage 5) | 17d-2, et un plan effectif fiable et tracé (prérequis ci-dessous) | Avec 17d-2, après le prérequis |
| Modification directe d'une offre active sans candidat sélectionné (retour en modération, calendrier figé) | Premium (option) ; ou tous ; ou retirée | Corriger une offre publiée sans passer par le support | Aucun, puisqu'aucun engagement n'existe | Contrôle existant dans `update_job`, à rebrancher sur le plan Premium | Immédiat |
| Relevé d'activité (offres, journées confirmées, montants contractuels ; sans avis ni donnée privée de candidat) | Premium (option) | Suivi pour la comptabilité interne | Aucun ; l'historique reste visible pour tous dans l'application | Générateur PDF du lot 13 et données existantes ; coût faible. Ce n'est ni une facture ni une attestation | Après 17d, dans le lot Free/Premium |
| Vue d'ensemble de la présence du jour | À décider | Suivi de plusieurs missions | Aucun | Données des lots 7c et 15 ; lot Design entreprise | Futur lot |
| Réutilisation d'une offre ou modèles | À décider (le SRS §5.4 la prévoit pour tous) | Publier plus vite | Aucun | Formulaire du lot 12 ; nouvelle publication et modération complètes | Futur lot |
| Frais réduits, urgence, factures, essai | — | — | — | Lot paiement | Futur lot |
| Engagement de délai du support | — | — | — | Décision opérationnelle et effectifs, pas un développement | Hors logiciel |

**Non recommandés** : priorité d'affichage des offres (aucune règle de classement), modération immédiate (pression sur la vérification), invitation directe sans candidature (contournerait les contrôles), recrutement en masse (contraire à la signature par sélection), remplacement garanti, contrats sectoriels sans validation juridique.

**Lecture commerciale** : une fois les promesses non livrées retirées, Premium entreprise repose sur le délai de 24 h et, si l'arbitrage 4 le retient, sur la modification directe. Sa valeur reste mince tant que le paiement n'existe pas. Le délai de 24 h a un coût pour les candidats, qui reçoivent un préavis plus court.

### Prérequis techniques de 17d-2 (proposition, non implémentée)

- **Un seul calcul en base du plan entreprise** (`free` ou `premium`), lu dans la transaction de sélection et figé par engagement, comme `mission_day_commitment_terms` (17a). Aucune valeur fournie par le navigateur.
- **Attribution tracée**, sur le modèle de 17a : grades à décider, date de fin explicite, motif, historique en ajout seul, audit, notification et signal `subscription`. Sans cela, un délai de 24 h figé n'est pas vérifiable.
- **Valeurs existantes `starter`, `pro`, `business`** : aucune correspondance n'est décidée (arbitrage 2). Requête de lecture à exécuter avant toute décision : `select subscription_plan, subscription_expires_at is null or subscription_expires_at > now() as en_cours, count(*) from public.company_profiles group by 1, 2;`.
- **Engagements antérieurs** : historiques, délai inconnu, aucune qualification tardive (décision validée, conservée).
- **Rôle `company_premium`** : sans effet sur les droits, déjà le cas en base. À clarifier dans le SRS §3.

### Arbitrages nécessaires à la validation de la grille

1. **Modèle de plans** : deux plans Free et Premium remplacent les quatre plans stockés, ou Premium s'ajoute à côté d'eux. Dans les deux cas, une seule source de vérité.
2. **Sort des valeurs `starter`, `pro`, `business` et du rôle `company_premium`** : correspondance explicite décidée par le produit, ou requalification au cas par cas par le support avant activation, ou autre règle. Droits pendant la transition (la modification directe est aujourd'hui réservée à `pro` et `business`).
3. **Attribution** : administrative et tracée comme en 17a (grades, date de fin explicite, motif, historique), ou une autre voie avant le lot paiement.
4. **Avantages Premium retenus** : délai de 24 h (acquis) ; modification directe (Premium, tous les plans, ou retirée) ; relevé d'activité ; autres lignes de la grille.
5. **Information du candidat** : afficher sur chaque engagement la date limite d'annulation dans le délai par l'entreprise, sans nommer son plan, ou ne rien afficher.
6. **Textes** : retrait immédiat des avantages non livrés (tableau ci-dessus) et ajout de motifs entreprise à `user-facing-claims` ; sort des prix, de l'essai et des quotas dans le SRS et les user stories.
7. **Quota d'offres actives** : abandonné (illimité pour tous, comme l'écran l'affiche) ou quota Free, dont le nombre reste à décider. *Réglé le 2026-11-19 : `ABO-10` (registre).*
8. **Vestiges** : `subscription_tier`, `trial_ends_at`, table `subscriptions`, `COMPANY_PLAN_FEES`, `getCompanyPlanPermissions`, `getCompanyPlan`, `isPlanAtLeast`, `isCompanyPremium`, composants non affichés : à supprimer, ou à conserver jusqu'au lot paiement.
9. **Ordre** : livrer d'abord le plan entreprise effectif et son attribution (sous-lot préalable), puis 17d-2 tel que validé ; ou livrer 17d-2 avec une annulation opérationnelle seule, sans classement, en marquant ses engagements « délai non déterminé » jusqu'au plan entreprise.

**Limites.** Audit par lecture seule : la répartition réelle des plans stockés (développement, production) n'a pas été mesurée. Les dates des décisions citées viennent des documents du dépôt.

## 44. Suivi — Plan entreprise effectif et gestion administrative tracée (2026-11-20)

Branche `feat/company-premium-plan`, créée depuis `origin/main-dev` (`7bf9bf8`, inchangé : constat Git) avec le travail documentaire en cours (registre, §43). Non commitée. Stash de lint-staged conservé. Essais sur la pile `easyjob-proof` uniquement ; ni la pile de développement ni le projet distant n'ont été lus.

**Décisions appliquées** (registre `docs/product/DECISIONS.md`) : `ABO-07` (Free/Premium, attribution, échéance, reprise explicite, rôle), `ABO-08` (modification directe réservée à Premium, confirmée le 2026-11-20 `[UV]`), `ABO-11` (rôle seul sans effet), `ABO-19` (profil entreprise, confirmé le 2026-11-20 `[UV]`). Non tranchées et non implémentées : corrections après sélection, parcours de correction du support (`ECH-05`), avantages validés mais non livrés, communs aux deux plans (`ABO-12` à `ABO-15`) et Premium (`ABO-16` à `ABO-18`), frais d'urgence (`MNT-09`), paiement.

### Inventaire préalable

`easyjob-proof`, lecture seule, avant réinitialisation : aucune ligne `company_profiles`, aucun compte entreprise, aucune ligne `subscriptions` (les preuves purgent leurs fixtures). Aucune ancienne valeur n'y existait : la reprise est prouvée avec des fixtures locales. La production n'a pas été inventoriée (requête de lecture fournie ci-dessous).

### Réalisation

| Sujet | Mise en œuvre |
|---|---|
| Migration 1/2 (`20261125120000`, additive) | `company_plan_requalifications` (ajout seul) : choix explicite Free, ou Premium avec date de fin, pour un compte qui porte encore `starter`, `pro` ou `business` ; ancienne valeur et ancienne échéance recopiées au moment du choix ; auteur (`admin_ops` ou `admin_founder` actif), motif de 10 à 500 caractères, voie (`admin_session` ou `database_maintenance`), clé d'idempotence, numéro d'ordre `seq`. `company_plan_requalify` : session d'un ops ou fondateur actif, ou connexion directe à la base (`session_user` postgres) avec un auteur désigné qui doit être ops ou fondateur actif ; jamais PostgREST, clé service comprise. N'écrit pas le plan. `company_plan_transition_report()` : comptes anciens et état « prêt ». Aucun droit modifié. |
| Migration 2/2 (`20261125130000`) — garde | Premier bloc, en lecture seule : si un compte ancien n'a pas de choix à jour (choix le plus récent portant sur l'ancienne valeur et l'échéance encore en base), `company_plan_transition_blocked`, avec en détail le nombre, les anciennes valeurs et les identifiants. La CLI applique chaque fichier dans une transaction : constaté le 2026-11-20 sur une première version fautive de la migration (erreur au 15e énoncé) ; table d'historique absente, ancienne contrainte intacte, version non enregistrée. |
| Reprise | `company_plan_transition_apply()` (propriétaire seulement) : même contrôle après verrouillage des lignes, puis pour chaque compte : plan stocké = choix (Premium avec sa fin, ou Free sans fin), début de période pour Premium, ligne `company_premium_grants` « requalify » (ancienne valeur, ancienne échéance, auteur et motif du choix, source `requalification`), audit `company_plan_requalified`, notification dans l'application. Aucun historique d'abonnement antérieur n'est inventé. |
| Modèle de plan | Contraintes : `subscription_plan` null, `free` ou `premium` ; Premium exige une fin. `company_effective_plan(plan, fin)` : Premium ⇔ `premium` et fin future ; Free à l'instant exact ; aucun paramètre de date (aucun plan passé reconstitué). `premium_started_at` ajouté. |
| Attribution | `admin_manage_company_premium` (modèle du lot 17a) : activer, prolonger, arrêter ; ops et fondateur actifs ; verrou du profil ; relance du même `request_id` → résultat d'origine ; fin attendue différente → `premium_state_changed` ; borne de fin reprise du lot 17a (`candidate_premium_max_end()`, 10000-01-01 UTC exclu), aucune durée imposée ; plan, historique, audit et notification dans une transaction ; aucune ligne de paiement. `admin_company_premium` : lecture des trois grades actifs, reprise comprise. |
| Droits | `update_job` : refus `job_locked_plan` hors Premium effectif ; autres contrôles inchangés. `my_account_state` : partie entreprise sans la table `subscriptions` (`renews` = null), `premium_started_at` ajouté. |
| Route et écrans | `GET`/`POST /api/admin/companies/[id]/premium` (Zod partagé, codes traduits). Fiche admin : panneau générique `PlanGrantPanel` (le panneau candidat l'utilise aussi, mêmes identifiants de test). Profil entreprise : `CompanyPlanCard` (plan, fin ou dernière fin, début, « attribué par l'équipe EasyJob », modification directe selon le plan, contact du support) ; compteur d'offres sans quota ; anciennes listes d'avantages, bannière et vitrine supprimées ; lectures de repli (`subscription_tier`, `subscriptions`, essai) retirées. Offres : `companyCanDirectEdit`. Textes FR/EN : refus et mention de blocage sans renvoi à un parcours de correction non livré. |
| Conservés sans effet | Colonnes `subscription_tier`, `trial_ends_at`, table `subscriptions`, rôle `company_premium` : encore présents en base ; plus aucune lecture applicative du plan ne s'y appuie. |

### Méthode exacte de reprise des anciens comptes

1. Lecture seule en production : `select subscription_plan, subscription_expires_at is null as sans_fin, subscription_expires_at > now() as en_cours, count(*) from public.company_profiles group by 1, 2, 3;`.
2. Aucune ancienne valeur : les deux migrations s'appliquent ensemble.
3. Anciennes valeurs : appliquer la migration 1 seule ; pour chaque compte, enregistrer un choix (`select public.company_plan_requalify(gen_random_uuid(), '<entreprise>', 'free' | 'premium', <fin ou null>, '<motif>', '<admin ops ou fondateur>');` en connexion directe, ou par une session admin) ; vérifier `select * from public.company_plan_transition_report();` (tous « prêts ») ; appliquer la migration 2. Un compte sans choix, ou dont l'ancienne valeur ou l'échéance a changé depuis le choix, arrête la migration sans effet. Le déploiement en deux temps n'a pas été essayé : la CLI applique toutes les migrations en attente, la procédure exacte reste à préparer avec le déploiement.

### Droits réellement accessibles après migration

| Situation | Accès |
|---|---|
| Entreprise Free (défaut, nouvelle, ancien compte requalifié Free, Premium échu ou arrêté) | Publication, modération, sélection, contrats et parcours existants ; modification d'une offre jamais publiée, en attente ou refusée ; **pas** de modification directe d'une offre active (`job_locked_plan`) ; offres illimitées |
| Entreprise Premium (fin future) | Même chose, plus la modification directe d'une offre active **sans candidat sélectionné**, qui repasse en modération ; calendrier publié figé |
| Rôle `company_premium` sans plan Premium | Free (prouvé) |
| `admin_support` actif | Lecture du plan et de l'historique |
| `admin_ops`, `admin_founder` actifs | Lecture ; activation, prolongation, arrêt ; choix de reprise (avant la transition) |
| Admin suspendu (ancien jeton), entreprise, tiers, anonyme | Aucune lecture admin ni écriture |
| Clé service | *(État initial, avant le complément ci-dessous.)* Pouvait encore écrire le plan et ses dates en `UPDATE` direct, sans historique ni audit. Fermé par le complément (`trg_company_plan_write_guard`), vérifié le 2026-11-22 (suivi ci-dessous) |

### Défaut trouvé pendant les preuves

Le choix « le plus récent » était trié par `created_at desc, id desc`. `created_at` vaut `now()`, identique pour tous les choix d'une même transaction : l'ordre retombait sur un identifiant aléatoire et un choix caduc pouvait être retenu (échec intermittent de la reprise T5 au premier passage complet). Corrigé par un numéro d'ordre `seq` (identité). Assertion ajoutée : cinq choix successifs dans une même transaction, le dernier fait foi (diagnostic et historique). Contrôle négatif sur l'ancienne version : 34 PASS, 4 FAIL (T3, T7 ; T0, T0b en conséquence) ; après correctif : 38/38 sur trois passages consécutifs.

### Preuves

`company-premium` (38 assertions) : P1-P4 plan effectif (Free par défaut, échéance exacte et 1 µs avant, rôle seul et ligne `subscriptions` active sans effet, contraintes en clé service) ; W1-W3 écritures et lectures refusées (entreprise, RPC, support en écriture, ops suspendu avec ancien jeton, tiers, anonyme) ; G1-G8 activation, notification sans donnée sensible, signaux, refus de période, de motif, d'état lu et de borne, prolongation, lecture support, arrêt, historique en ajout seul ; R1 signaux `{d, r, id}` ; E1-E6 modification directe (Premium accepté avec nouvelle modération, Free refusé, échéance exacte, calendrier figé, autre entreprise, candidat sélectionné, compte suspendu) ; I1-I3 cinq relances simultanées, clé réutilisée, deux agents simultanés ; T0-T10 reprise (garde du fichier avec et sans choix, refus avec diagnostic, choix refusés, choix explicite et relance, compte restant cité seul, choix caduc, panne sans effet partiel, reprise appliquée, notifications sans motif, relance sans effet, ajout seul, annulation complète) ; A1 fiche admin. Preuves adaptées sans retirer d'assertion : `job-moderation` (Premium à la place de Pro), `job-deadlines`, `multi-day-jobs`, `company-dossier-visibility`, `realtime` (C2 : `renews` = null malgré une ligne `subscriptions`), `company-permissions` (B : Premium et `premium_started_at` refusés en session ; E2 : liste exacte des écrivains complétée par `admin_manage_company_premium`, dont les gardes sont prouvées par `company-premium`).

| Contrôle | Résultat |
|---|---|
| Preuves ciblées : `company-premium`, `company-permissions` (E2 d'abord en échec, liste complétée), `company-verification`, `job-moderation`, `job-deadlines`, `multi-day-jobs`, `company-dossier-visibility`, `candidate-premium`, `realtime` | ✅ |
| Pile `easyjob-proof` réinitialisée depuis les seules migrations, `pnpm test:rls` complet (build de production relié à la pile) | Premier passage : ⚠️ 38/40. Deux échecs intermittents, sans lien établi avec ce lot : `account-security` 7 (6 finalisations d'inscription simultanées : une erreur journalisée `auth.finalize_signup.users_update`) et `company-verification` C1 (une des cinq écritures interdites lancées en parallèle, `verification_revision`, sans code d'erreur ; aucun effet constaté). Chacune relancée seule deux fois : ✅ 36/36. Second passage, pile réinitialisée de nouveau : ✅ **40/40**, environ 1170 s. Aucune relance automatique ajoutée ; sorties conservées hors dépôt |
| Types générés comparés après la réinitialisation finale | ✅ identiques |
| `pnpm test` (Vitest), séparément | ✅ 631 tests, 53 fichiers (dont `company-premium`, 8 tests ; `user-facing-claims` étendu aux avantages entreprise retirés) |
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .`, `pnpm build` | ✅ |
| Types générés depuis la pile réinitialisée | ✅ mis à jour (`lib/database.types.ts`) |
| Navigateur (Chrome headless par CDP, 375 × 812, sessions entreprise, ops et support, script hors dépôt) | ✅ 21/21, FR puis EN |

**Navigateur.** Profil Free (plan, attribution, mention « réservée au plan Premium », aucune ancienne présentation) ; offres Free (mention de blocage) ; fiche admin support en lecture seule ; activation par l'ops avec motif ; profil et offres ouverts basculés en Premium sans rechargement (date de fin en heure de Douala, modification directe décrite) ; arrêt et retour à Free sans rechargement ; échéance à l'heure du serveur sans rechargement ; relecture après rechargement et historique conservé ; envoi depuis un état lu périmé refusé (`premium_state_changed`) ; aucun défilement horizontal, aucune erreur JavaScript. Une première passe a échoué sur une erreur du script (libellé anglais attendu en minuscule), corrigée dans le script.

**Avant déploiement** (lecture seule) : la requête d'inventaire ci-dessus ; compter les offres actives des comptes `pro`/`business` actuels, qui perdront la modification directe s'ils sont requalifiés Free.

**Constat hors lot.** Les deux échecs intermittents du premier passage complet ne s'étaient jamais présentés dans les comptes rendus précédents. Ils concernent l'inscription concurrente (`finalizeSignup`) et une écriture interdite en parallèle sur `company_profiles`. À surveiller au prochain passage complet ; aucune cause n'est établie ici.

**Limites.** Notification dans l'application seulement ; aucun suivi des demandes de support ; aucun parcours de paiement ni de prix ; le figement du plan entreprise à la sélection relève de 17d-2 ; la clé service pouvait encore modifier le plan sans trace (fermé par le complément, vérifié le 2026-11-22 ; même écart côté candidat, non corrigé) ; `candidate_effective_plan(uid, at)` (lot 17a) reçoit encore une date mais ne relit que l'état présent : hors de ce lot, signalé.

### Complément — écritures tracées, reprise en deux temps, échecs initiaux (2026-11-20)

Même branche, non commitée ; changements indexés et stash conservés. **État de vérification au 2026-11-20 : partiel ; vérifié le 2026-11-22 (suivi ci-dessous).** Le SQL de ce complément est écrit mais **n'a pas été exécuté** : la pile `easyjob-proof` est devenue inaccessible pendant la répétition (voir « Incident »). Ni les preuves ciblées, ni la suite RLS complète, ni la répétition en deux temps n'ont tourné sur ce SQL.

#### Écritures du plan : inventaire et fermeture

| Écriture | Auteur | Légitime | Après ce complément |
|---|---|---|---|
| `admin_manage_company_premium` | `admin_ops`, `admin_founder` actifs (session) | Oui (ABO-07) | Seule voie courante ; pose l'indicateur `easyjob.company_plan_write` le temps de l'écriture |
| `company_plan_transition_apply` | Migration, maintenance directe | Oui (reprise explicite) | Pose l'indicateur ; écrit état, historique, audit et notification |
| Création d'un profil (`finalizeSignup`, onboarding) | Clé service | Oui, valeurs par défaut | Acceptée si Free, sans fin ni début ; refusée sinon |
| `UPDATE` direct du plan, de la fin ou du début | Clé service, SQL direct | Non (aucun historique, aucun audit) | Refusé : `company_plan_untracked_write` (42501) |
| Code applicatif (`app/`, `lib/`) | — | — | Aucune écriture du plan (lectures seulement), constaté par recherche |
| Fixtures des preuves (`job-moderation`, `job-deadlines`, `multi-day-jobs`, `company-dossier-visibility`, `realtime`) | Clé service | Non | Remplacées par `scripts/lib/company-premium-fixture.ts` : la vraie RPC, sous l'identité d'un `admin_ops` de la preuve |

Mise en œuvre (migration 2/2) : déclencheur `trg_company_plan_write_guard` (BEFORE INSERT OR UPDATE, tout auteur). L'indicateur ne peut être posé ni par une requête PostgREST (aucune fonction exposée n'appelle `set_config`), ni par une session. Aucun nouvel appel de service n'est créé : le helper des preuves appelle la RPC existante sous un admin réel de la preuve, qui la revérifie (`is_ops_admin_user`). Les fonctions temporaires de `proof-company-premium` qui placent une fin à l'instant exact posent l'indicateur explicitement, sur la pile de preuve seulement ; elles sont retirées en fin de preuve. Assertions ajoutées (exécutées le 2026-11-22, suivi ci-dessous) : S1 activation, prolongation, début et arrêt écrits en clé service → refus, sans aucun effet sur l'état, l'historique, l'audit ni les notifications ; S2 création d'un profil déjà Premium refusée, création par défaut acceptée ; S3 SQL direct sans parcours refusé ; S4 prolongation autorisée ensuite (une ligne d'historique, un audit, une notification de plus). P4 réécrite : refus de la garde d'abord, contraintes vérifiées derrière la garde.

**Même écart côté candidat, non corrigé ici** : `users.role` (`candidate_premium`) et `candidate_profiles.premium_until` restent modifiables en clé service sans historique ni audit. Signalé dans le plan (lot 17a, suivi).

#### Reprise en deux temps

**Vérifié dans la CLI 2.117.0** (`--help`) : `supabase db push` et `supabase migration up` appliquent **toutes** les migrations en attente ; aucune option n'applique un seul fichier (`--include-all` concerne les migrations antérieures absentes de l'historique distant). `supabase db reset --version <v>` existe, pour une base locale seulement. La release (`deploy.yml`, sur tag) exécute `supabase db push --linked --dry-run`, puis `--yes`. **Conséquence** : une reprise en deux temps exige **deux releases** — la première avec la seule migration 1 (la migration 2 n'est pas encore dans le tag), la seconde qui l'ajoute.

Procédure prévue (à confirmer par la répétition) :
1. Release N (migration `20261125120000` seule) : `db push --linked --dry-run` doit lister ce seul fichier. Aucun droit ne change ; tout changement de plan ou d'échéance est désormais journalisé (`company_plan_changed_before_transition`, ancienne et nouvelle valeur, rôle de base).
2. Inventaire : `select * from public.company_plan_transition_report();` (connexion directe).
3. Un choix par compte ancien : `select public.company_plan_requalify(gen_random_uuid(), '<entreprise>', 'free' | 'premium', <fin | null>, '<motif>', '<admin ops ou fondateur actif>');` en connexion directe, ou par la session d'un ops ou fondateur actif (RPC `company_plan_requalify`).
4. Vérifier que tous les comptes sont « prêts ».
5. Release N+1 (migration `20261125130000`) : `db push --linked --dry-run` puis `--yes`. Si un compte n'est pas prêt, la migration s'arrête dans sa transaction : rien n'est appliqué, la version n'est pas enregistrée, la release échoue ; enregistrer les choix manquants et relancer le déploiement du même tag.

Cas particuliers :
- **Comptes déjà Free** (ou sans valeur) : aucun choix requis, aucune ligne d'historique ni notification ; plan inchangé.
- **Compte créé entre les deux étapes** : Free par défaut ; rien à requalifier.
- **Plan modifié entre les deux étapes** (ancien modèle, clé service) : journalisé ; un choix enregistré avant devient caduc (« non prêt ») et la migration 2 refuse tant qu'un nouveau choix n'est pas enregistré. Un compte passé d'une ancienne valeur à Free n'a plus besoin de choix ; son ancien choix est ignoré et le changement reste dans l'audit.
- Après la migration 2, plus aucune écriture hors parcours : aucun changement de plan ne peut être perdu ou déduit.

**Répétition : non réalisée le 2026-11-20 ; réalisée le 2026-11-22 (suivi ci-dessous).** Premier pas exécuté : copie de la pile mise à jour, migration 2 retirée de la copie (hors dépôt, pour simuler la release N), puis `pnpm exec supabase db reset --workdir $stack --version 20261124120000`. La commande n'a pas rendu la main en 600 s. Après son interruption, le conteneur de base de `easyjob-proof` est resté bloqué dans Docker (`docker exec`, `inspect`, `restart`, `kill` sans réponse). Redémarrage de Docker Desktop autorisé par l'utilisateur : Docker ne redémarre pas (« terminated unexpectedly »). `wsl -l -v`, puis `wsl --shutdown` (autorisé par l'utilisateur), restent eux aussi sans réponse. Un redémarrage de Windows semble nécessaire. La pile de développement `easyjob-cm` est arrêtée avec Docker ; ses volumes ne sont pas touchés ; elle n'a pas été relancée. Le script de répétition reste à exécuter après redémarrage.

#### Échecs du premier passage complet (sorties conservées hors dépôt)

| Preuve | Assertion et erreur exactes | État observé | Cause | Rapport avec le lot |
|---|---|---|---|---|
| `account-security` | « 7. 6 finalisations concurrentes → 1 ligne candidate, 1 profil » : un des six appels `finalizeSignup` renvoie `{ ok: false, errorCode: 'generic' }` ; journal `auth.finalize_signup.users_update`, catégorie `unexpected`, **sans** `code` ni `status` | Une ligne `users` (rôle `candidate`, téléphone vérifié), un profil : état final correct | **Inconnue.** Une erreur PostgREST ou Postgres porte un code (classée « database ») ; une erreur sans code est l'enveloppe que supabase-js renvoie quand la requête HTTP elle-même échoue. Hypothèse : échec de transport sous charge. Non reproduit : 150 tours × 6 finalisations concurrentes et 5 écritures parallèles (1 650 appels) sur la pile de preuve, aucun code vide | Le lot ne modifie ni `users`, ni `finalizeSignup`, ni leurs déclencheurs. Aucune fixture du lot n'intervient dans cette preuve, qui s'exécute en premier dans la suite. Aucun lien établi, sans que l'absence de lien soit démontrée |
| `company-verification` | « C1 : auto-validation … → refusée, aucun effet » : cinq `UPDATE` interdits lancés en parallèle ; le 4e (`verification_revision = 99`) renvoie un code vide (`""`), là où les quatre autres renvoient `42501` | `noEffect()` vrai : aucune colonne protégée modifiée, aucun contrôle ajouté | **Inconnue.** Même signature que ci-dessus (erreur sans code, et non absence d'erreur) | La migration 2 modifie `company_profiles` (colonne, contraintes ; la garde d'écriture vient du présent complément). Une erreur de la base porterait un code : ces changements n'expliquent pas une erreur sans code. Non démontré |

Aucune relance automatique n'a été ajoutée. Les deux preuves sont passées seules deux fois chacune, puis dans le second passage complet (40/40) ; cela ne prouve pas l'absence de lien.

#### Contrôles de ce complément

| Contrôle | Résultat |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .` | ✅ |
| `pnpm test` (Vitest) | ✅ 631 tests, 53 fichiers |
| Preuves ciblées, suite RLS complète, répétition en deux temps, types générés, navigateur | ⛔ non exécutés le 2026-11-20 (pile indisponible) ; exécutés le 2026-11-22, suivi ci-dessous |

### Suivi — vérification du complément (2026-11-22)

Docker et WSL rétablis par l'utilisateur ; sept conteneurs `easyjob-proof` démarrés. Branche, modifications, cinq suppressions indexées et stash conservés (constat Git). Copie des migrations de preuve restaurée par `init-proof-stack` (migrations 1 et 2 identiques au dépôt, empreintes comparées). `easyjob-cm` et les autres projets n'ont pas été touchés. `db reset --version`, dont l'interruption avait précédé le blocage, n'a pas été réutilisé : le schéma antérieur a été obtenu par une réinitialisation normale sur une copie des migrations sans les fichiers du lot.

#### Répétition réelle de la reprise en deux temps (easyjob-proof)

Commandes exécutées (sorties conservées hors dépôt). `$stack` : copie de la pile de preuve, hors dépôt ; `$env:DB_URL` : base de cette pile (port 54422, contrôlé avant chaque commande).

| Étape | Commande | Observé |
|---|---|---|
| Schéma de production avant le lot | migrations 1 et 2 retirées de la copie ; `pnpm exec supabase db reset --workdir $stack` | Dernière version `20261124120000`, ancienne contrainte à quatre plans |
| Comptes anciens | Fixtures en clé service (ancien modèle) : `pro` (fin future), `business` (sans fin), `starter` (fin passée), `free`, sans valeur (`null`), un `admin_ops` actif | Écriture acceptée, comme avant le lot |
| Release N | migration 1 seule dans la copie ; `pnpm exec supabase db push --workdir $stack --db-url $env:DB_URL --dry-run`, puis `--yes` (même commande que `deploy.yml`, `--db-url` au lieu de `--linked`) | Le dry-run et l'application ne listent que `20261125120000` ; aucun plan ni droit modifié |
| Intervalle | choix `pro` → Premium (connexion directe, `company_plan_requalify(…, '<admin_ops>')`) ; choix `business` → Free (session de l'admin, RPC) ; échéance de `pro` modifiée en clé service après son choix ; entreprise créée | Changement journalisé (`company_plan_changed_before_transition`, rôle `service_role`, ancienne et nouvelle valeur) ; diagnostic : `business` prêt, `pro` non prêt (choix caduc), `starter` non prêt |
| Release N+1, premier essai | migration 2 ajoutée ; `db push … --yes` | **Échec** (code 1) : `company_plan_transition_blocked`, « 2 compte(s) sans choix explicite à jour (anciennes valeurs : pro, starter) » et leurs identifiants. Aucun effet : version non enregistrée, ni table d'historique, ni garde, ni colonne `premium_started_at`, ancienne contrainte et journal de l'intervalle intacts, aucune notification |
| Choix manquants | `starter` → Free ; nouveau choix `pro` → Premium (connexion directe) ; `company_plan_transition_report()` | Trois comptes « prêts » |
| Release N+1, second essai | même `db push … --yes` | Migration 2 appliquée (code 0) |
| Relance | `db push … --yes` | « Local database is up to date », rien appliqué |

État final vérifié : deux versions enregistrées ; garde active, journal de l'intervalle retiré, contraintes Free/Premium ; `pro` Premium jusqu'à la fin du **second** choix, `business` et `starter` Free sans fin ; `free`, sans valeur et entreprise créée dans l'intervalle inchangés, sans choix, historique ni notification ; trois lignes `requalify` (ancienne valeur, ancienne échéance, auteur `admin_ops`, motif du choix retenu), trois audits `company_plan_requalified`, quatre `company_plan_requalification_recorded`, un `company_plan_changed_before_transition` ; trois notifications (une en anglais pour un compte EN) ; aucun doublon.

La répétition a été faite deux fois sur le SQL final, après les deux corrections ci-dessous, avec le même résultat.

#### Défauts trouvés pendant cette vérification, corrigés

1. **Auteur faux dans le journal de l'intervalle** (répétition, premier passage) : un changement fait en clé service était journalisé avec le rôle `postgres`. La fonction est `SECURITY DEFINER` : `current_user` y vaut son propriétaire. Correction : rôle de la requête (`current_setting('role')`, posé par PostgREST), à défaut `session_user` ; contrôlé (`service_role` en clé service, `postgres` en connexion directe).
2. **Surfaces ouvertes à la clé service** (examen du contournement) : les privilèges par défaut de Supabase accordaient `EXECUTE` à `service_role` sur toute nouvelle fonction, dont la reprise et la garde. Les appels étaient refusés par les contrôles internes, mais restaient possibles. Plus grave : les déclencheurs d'ajout seul ne bloquaient que `anon` et `authenticated`, donc **la clé service pouvait insérer un faux choix de reprise au nom d'un admin, ou une fausse ligne d'historique**. Correction : `EXECUTE` retiré à `service_role` sur les fonctions internes et d'écriture ; sur `company_plan_requalifications` et `company_premium_grants`, `service_role` garde lecture et suppression (nettoyage des preuves), sans insertion ni modification, et les déclencheurs refusent aussi son insertion.

#### Contournement de l'indicateur de transaction : examiné

| Voie | Constat |
|---|---|
| Fonctions qui citent `easyjob.company_plan_write` | Trois : `admin_manage_company_premium` et `company_plan_transition_apply` (le posent), la garde (le lit). Catalogue interrogé |
| `set_config` dans les fonctions exposées | Douze fonctions l'appellent, toutes avec un nom littéral (autres indicateurs : `easyjob.system_update`, `easyjob.rt_sent`…) ; aucune ne laisse l'appelant choisir le nom |
| `/rest/v1/rpc/set_config` (clé service) | 404 `PGRST202` : absente du schéma exposé |
| Même appel avec `Content-Profile: pg_catalog` | 406 `PGRST106` : seuls `public` et `graphql_public` sont exposés |
| En-tête HTTP arbitraire | Sans effet : refus de la garde (42501) |
| Réglage par rôle (`pg_db_role_setting`) | Aucun ne pose l'indicateur ; aucun rôle d'API n'est superutilisateur |
| Appel direct de la reprise, de l'attribution, du choix (clé service) | Non exécutables (privilèges) ; refusés auparavant par les contrôles internes |
| Insertion directe dans l'historique ou les choix (clé service) | Refusée (privilèges et déclencheur) |
| GraphQL | `pg_graphql` n'est pas activé sur la pile de preuve : **non testé**. Raisonnement : une mutation passerait par le même déclencheur et ne peut pas poser l'indicateur ; à vérifier sur un projet où l'extension est active |
| Persistance dans la transaction | Les deux fonctions remettent l'indicateur à `off` juste après l'écriture ; une erreur annule la transaction |
| Fonctions temporaires des preuves | Posent l'indicateur, exécutables par `service_role` **sur la pile de preuve seulement**, le temps de la preuve (retirées en fin de preuve et au démarrage suivant) |

Assertions S5 (catalogue) et S6 (tentatives HTTP en clé service, état et historique inchangés) ajoutées à `company-premium`. G8 ajustée : la modification de l'historique en clé service est désormais refusée par les privilèges (« permission denied »), avant le déclencheur ; l'assertion exige 42501 et des motifs inchangés.

**Contrôle négatif** : `trg_company_plan_write_guard` désactivé sur la pile de preuve → `company-premium` 38 PASS, 6 FAIL (P4, S1, S2, S3, S6 ; S4 en conséquence) ; garde réactivée (`tgenabled = O`), pile réinitialisée ensuite.

#### Preuves et contrôles

| Contrôle | Résultat |
|---|---|
| `company-premium` | ⚠️ 43/44 (G8, ci-dessus), puis ✅ 44/44 |
| Preuves adaptées : `company-permissions`, `job-moderation`, `job-deadlines`, `multi-day-jobs`, `realtime`, `candidate-premium`, `company-verification` | ✅ company-permissions 48/48, job-moderation 67/67, job-deadlines 35/35, multi-day-jobs 67/67, realtime 56/56, candidate-premium 26/26, company-verification 36/36 |
| `company-dossier-visibility` | ⚠️ Premier passage 25/26 : M9 en échec, l'écoute `jobs:public` n'a reçu **aucun** événement (`public: 0`, candidat 1, entreprise 10). Relancée seule : ✅ 26/26 (`public: 5`). **Cause inconnue** ; c'était la première preuve lancée après le redémarrage des conteneurs. La fixture Premium remplacée dans cette preuve précède la section M et ne touche pas `jobs:public` ; aucun lien n'est établi |
| Types générés depuis la pile réinitialisée | ✅ identiques à `lib/database.types.ts` |
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .` | ✅ |
| `pnpm test` (Vitest), séparément | ✅ 631 tests, 53 fichiers |
| `pnpm build` (relié à la pile de preuve) | ✅ |
| Suite RLS complète sur le SQL final, pile réinitialisée | ✅ **40/40**, environ 1 000 s cumulées (`account-security`, `company-verification`, `company-dossier-visibility` et `company-premium` compris) |
| Navigateur (CDP, 375 × 812, FR puis EN) | ✅ 21/21, sans erreur JavaScript ni défilement horizontal ; le script (hors dépôt) attribue désormais Premium par la route admin et non plus en clé service |

## 45. Suivi — Lot 17d-2 : annulation par l'entreprise après sélection (2026-11-22)

**Point de départ (constat Git du 2026-11-22).** Le lot « Plan entreprise effectif et attribution tracée » est intégré à `origin/main-dev` (#60, `88e8a11`). Branche `feat/lot-17d-2-company-cancellation` créée depuis `origin/main-dev` ; arbre propre, stash existant (`lint-staged automatic backup`) conservé, aucun commit, push ni déploiement. Travail sur la pile `easyjob-proof` seulement.

**Décisions utilisées** (`docs/product/DECISIONS.md`) :

| Identifiant | Statut | Usage dans le lot |
|---|---|---|
| ANN-06 | validation documentée | Délai Free 48 h / Premium 24 h, limites incluses ; plan figé à chaque sélection ; tardive sans sanction, frais, indemnité ni remboursement ; engagements antérieurs : délai inconnu |
| ANN-04 (entreprise) | `[U]` instruction du 2026-11-22 | Une demande (plusieurs journées, plusieurs candidats) = un événement |
| ANN-08 | à confirmer | Appliqués : journées futures non commencées, orientation si début atteint, aucune réouverture, avis dans l'application, motif obligatoire. Non appliqués : retrait ciblé d'un candidat, justificatifs de force majeure |
| ABO-07 | validation documentée | Plan effectif lu par `company_effective_plan` dans la transaction de sélection |
| ANN-14 | validation documentée (désistement) | Non déclenché : concerne le désistement du candidat |
| REP-04, SAN-06, MNT-04, MNT-06 | — | Aucune conséquence ajoutée ; constats consignés |

Précisions de l'instruction du 2026-11-22 consignées sous ANN-06 : un changement ultérieur de plan ne modifie pas un engagement ; la qualification « tardive » ne vaut pas autorisation d'une conséquence ; ANN-14 n'est pas déclenché.

**Livré** (migration `20261126120000_company_cancellations.sql`) :

| Volet | Comportement |
|---|---|
| Conditions figées | `mission_day_company_terms`, une ligne par journée, écrite par un déclencheur dans la transaction de « Signer et sélectionner » (`selected_at = now()`, ligne de l'entreprise déjà tenue en partage par `contract_select_core`). Hors de cette transaction, ou pour une journée antérieure, `legacy` sans plan. Immuable pour tout auteur ; insertion et suppression refusées aux sessions et à la clé service (lecture seule en clé service, sans TRUNCATE) |
| Qualification | `company_cancellation_classify` : `in_time` si l'heure de la base ≤ début − délai figé, `late` au-delà, `legacy` sans conditions. Aucun délai de réaction (non décidé) |
| Aperçu | `company_cancellation_preview` : journées encore engagées de l'offre et de ses sous-offres, par date et par candidat (prénom et initiale), état `cancellable` ou `begun`, qualification, plan et délai figés de l'entreprise, heure du serveur |
| Demande | `request_company_cancellation` : dates entières (toute journée annulable d'une date visée doit figurer, sinon `cancellation_preview_stale`) ; futures et non commencées (`day_already_begun`, `day_started`) ; motif de 10 à 500 caractères ; tardive sans accord → `late_not_acknowledged`, sans effet. Une transaction : événement, journées, missions sans journée restante annulées (`cancelled_by = company`, `company_cancellation` ou `company_cancellation_interrupted`), un avis par candidat (offre et dates, « ne vous est pas imputée », sans motif ni qualification), avis à l'entreprise, audit `company_cancellation`. Relance : même résultat ; clé réutilisée pour d'autres journées : `request_conflict` |
| Conservé | Contrat, candidature `selected`, place (aucune réouverture), journées confirmées, montant reconnu |
| Gardes étendues | Journée annulée par l'une ou l'autre partie : début, confirmation (clé service comprise) et signalement refusés (`day_cancelled`) ; une seule annulation par journée, quelle que soit la partie (`guard_single_day_cancellation`) ; absence ou annulation tardive du candidat refusées sur une journée annulée par l'entreprise (`incident_conflicts_with_company_cancellation`) ; créneau libéré pour la marge de 3 h (journée annulée par l'entreprise seulement) |
| Vues | `mission_days_json` et `company_job_cancellations` indiquent l'auteur (`cancelled_by`) ; `mission_acquired_amount` sort les journées annulées par l'entreprise du calcul et les compte à part (`company_cancelled_days`) |
| Temps réel | Signal `missions` aux parties de chaque mission touchée et à l'entreprise, `incidents` à l'administration ; charge utile `{d, r}` |
| Écrans | Offre de l'entreprise : panneau « Annuler des journées » (dates, candidats, qualification et délai figé, date commencée non sélectionnable avec orientation, récapitulatif des conséquences, accord sur la tardiveté, motif, historique) ; mission (candidat et entreprise) : « Annulée par l'entreprise » ; carte du montant reconnu : journées annulées par l'entreprise non comptées. FR et EN |

**Ordre des verrous.** Missions (identifiants croissants), journées, puis offres en partage : même ordre que le désistement du candidat, le début et le code ; « Signer et sélectionner » prend la candidature puis l'offre, jamais une mission existante. Le contrôle des dates entières est fait après le verrou partagé de l'offre.

**Résultats observés.**

| Contrôle | Résultat |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .` | ✅ |
| `pnpm test` (Vitest) | ✅ 641 tests, 54 fichiers (dont `company-cancellation`, 10 cas) |
| `pnpm build` (relié à la pile de preuve) | ✅ |
| Types générés | identiques au schéma final (pile réinitialisée) |
| Preuve ciblée `company-cancellations` | ✅ 26/26 (deuxième passage). Premier passage conservé : 24/26 — R3 : la garde de réputation comparait le début enregistré à l'annulation, pas le début courant ; l'écart n'apparaissait qu'après un recalage fait par une fonction de preuve (voir le complément ci-dessous : manipulation réservée à la preuve), garde rendue robuste aux deux valeurs ; A2 comptait des avis d'autres cas (défaut de la preuve, filtré par offre) |
| Contrôles négatifs | N1 blocage des journées annulées désactivé → R3 ; N2 conditions réécrivables en clé service → T4 ; N3 garde de réputation de 17b → R3 (chacun 25/26, code de sortie 1) ; pile réinitialisée ensuite |
| Navigateur (Chrome headless par CDP, 375 × 812 tactile, entreprise et deux candidats, script hors dépôt) | ✅ 14/14, FR puis EN : dialogue, qualification, date commencée non sélectionnable, récapitulatif, confirmation bloquée sans motif puis sans accord, un événement ; journées « Annulée par l'entreprise » chez le candidat sans rechargement, sans motif ni qualification ; candidat hors ligne pendant une annulation, à jour au retour du réseau ; aucun défilement horizontal, aucune erreur JavaScript. Premier passage : 3 échecs du script (ordre des dates recalées, onglet non ouvert, date commencée cliquée), aucun de l'application |
| Suite RLS complète sur le SQL final, pile réinitialisée | ✅ **41/41**, environ 1 200 s cumulées (`candidate-cancellations` adaptée : clé `cancelled_by` attendue dans `company_job_cancellations`) |

**Constats et limites** (aucune règle décidée ici) :

- **Retrait ciblé d'un candidat** (ANN-08, à trancher). Exemple : offre « 3 hôtesses le 12/12 » ; l'entreprise ne veut plus que Paule, sans faute de sa part, et garde les deux autres. Aujourd'hui, elle annule toute la date ou contacte le support.
- **Motif obligatoire** (ANN-08) appliqué, à confirmer.
- **Unité « offre » de l'entreprise** (REP-04) : la candidature reste sélectionnée et la mission annulée, l'unité est donc bloquée (ni gain, ni retrait) jusqu'à 17d-5.
- **Montant** : aucune indemnité ni frais (MNT-04 ouvert) ; le montant reconnu des journées confirmées suit MNT-06 (information).
- **Créneau du candidat** : libéré pour une journée annulée par l'entreprise ; une journée annulée par le candidat garde le comportement antérieur (elle retient encore son créneau), écart antérieur non traité ici.
- **Administration** : l'événement est tracé (audit, signal) mais n'a pas encore d'écran de suivi dans `/admin`.
- **Hors lot** : remplacement (ANN-14 non déclenché), absences injustifiées (SAN-05), paiement, avantages commerciaux non livrés, producteur `company_late_cancellation`.
- `interruption_json` compte encore les seules journées annulées par le candidat dans son résumé `mission_days.cancelled` (information du dossier d'interruption, non modifiée).

### Complément du 2026-11-22 — décisions ANN-15, ANN-16, ECH-09

**Décisions** (`[UV]` « oui » de l'utilisateur du 2026-11-22, `docs/product/DECISIONS.md`) : ANN-15 motif obligatoire, visible par l'entreprise et l'administration seulement ; ANN-16 retrait ciblé d'un candidat sans faute réservé au support (parcours et habilitations à cadrer, aucun outil livré ni annoncé) ; ECH-09 une journée annulée avant son début, par le candidat ou l'entreprise, ne bloque plus son créneau ni sa marge de 3 h. Les autres arbitrages sont inchangés.

**Cas R3 précisé.** Le recalage de R3 était une manipulation réservée à la preuve : `proof_l17d2_shift`, fonction temporaire `postgres` qui désactive `trg_protect_mission_day_writes`. En vérifiant la règle, un écart réel est apparu ailleurs : avant le début, la clé service pouvait encore modifier les horaires d'une mission ou d'une journée de mission (`protect_mission_writes` et `protect_mission_day_writes` ne les figeaient qu'après le début ; `job_days` était déjà figé pour tout auteur). Aucun parcours de l'application ne les écrit (seule `sync_single_mission_day`, fonction de la base). Fermé : `mission_schedule_locked` pour la clé service, avant comme après le début, `starts_at` et `ends_at` compris. Les 18 recalages des fixtures de 8 preuves passent désormais par la maintenance directe (`rescheduleFixture`).

**Livré.**

| Volet | Comportement |
|---|---|
| Disponibilité | `candidate_schedule_conflicts` ignore les journées annulées enregistrées (`candidate_cancellation_days`, `company_cancellation_days`) ; une demande refusée ou en cours ne libère rien. Calcul partagé : aperçu, candidature, sélection définitive (sous `lock_candidate_engagements`). Avant : seule une mission entièrement annulée était libérée, si bien qu'une journée annulée dans une période restait bloquante |
| Horaires | `mission_schedule_locked` (missions, journées de mission) pour la clé service |
| Motif | `admin_company_cancellations` (admin actif) ; entreprise inchangée ; candidats jamais |
| Écrans | Aucun texte ajouté ; l'offre ouverte par le candidat relit sa disponibilité sur le signal `missions` et à la reconnexion |

**Résultats observés.**

| Contrôle | Résultat |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .`, `pnpm build` | ✅ |
| `pnpm test` | ✅ 641 tests |
| Types générés | identiques au schéma final (pile réinitialisée) |
| Preuve `company-cancellations` | ✅ 34/34 (F1 période complète, F2 aucune place rouverte, F3 journées au choix et désistement avec justificatif en attente, F3b désistement partiel d'une période, F4 annulation refusée puis en cours face à une sélection définitive, F5 compte suspendu, S1 horaires figés en clé service, M1 motif) |
| Contrôle négatif N4 (blocage réintroduit) | premier essai : 1 échec seulement (F1) ; F3 et F4 portaient sur des missions d'une journée, déjà libérées par le statut « annulée » ; renforcés (F3b, F4 sur une période de deux journées) : 3 échecs (F1, F3b, F4) |
| Navigateur (CDP, 375 × 812, FR puis EN) | ✅ 20/20 : offre voisine bloquée puis libérée sans rechargement ; libérée après le retour du réseau pour le candidat hors ligne ; aucune erreur JavaScript |
| Suite RLS complète sur le SQL final, pile réinitialisée | ✅ **41/41**, environ 1177 s cumulées (`multi-day-jobs`, `mission-completion`, `mission-incidents`, `mission-disputes`, `mission-time-tracking`, `contract-selection`, `company-dossier-visibility`, `realtime` avec leurs recalages par la maintenance directe) |

## 46. Cadrage — Lot 17d-3 : interventions du support sur les engagements (2026-11-23)

**Nature.** Cadrage documentaire : aucun code, aucune migration, aucun build ni aucune preuve. Constats lus dans le code et le catalogue de la pile `easyjob-proof` (SQL de `origin/main-dev`). Les propositions ci-dessous sont **à décider** ; elles ne valent pas validation.

**Point de départ (constat Git du 2026-11-23).** 17d-2 est intégré à `origin/main-dev` (`6167235`, migration `20261126120000_company_cancellations.sql`) et absent de `origin/main` (`e536ee1`, v0.1.10). Branche locale `feat/lot-17d-2-company-cancellation` au même commit, arbre propre, stash conservé.

**Socle commun déjà livré (réutilisable).**

| Élément | Existant |
|---|---|
| Journée annulée | Deux origines seulement : `candidate_cancellation_days` (17b) et `company_cancellation_days` (17d-2) ; une seule annulation par journée (`guard_single_day_cancellation`) ; plus de début, de confirmation ni de signalement (`trg_block_cancelled_day`, `block_incident_on_cancelled_day`), clé service comprise |
| Disponibilité | ECH-09 : journée annulée avant son début → créneau et marge de 3 h libérés (`candidate_schedule_conflicts`) |
| Mission | `mission_close_if_interrupted` : annulée quand il ne reste aucune journée à réaliser ; auteur = dernière annulation ; candidature, contrat et montant reconnu inchangés |
| Calendrier | Figé pour tout auteur applicatif, clé service comprise (`job_schedule_locked`, `mission_schedule_locked`, ECH-02) |
| Suspensions | `account_suspensions` par cause (`admin`, `cancellation_cycle`, `fraud`) ; `users.is_active` = aucune cause en cours ; début, candidature et sélection refusés (`account_suspended`) ; suspension pour fraude et levée par `admin_ops`/`admin_founder` actifs ; `admin_set_user_active` réservé à ces deux grades |
| Signalements (lot 14) | `report_mission_incident` : retard, absence, code non remis ; absence signalable par l'entreprise seulement à partir du début de la journée ; un signalement ne change rien à l'engagement |
| Décision sur la réalisation (lot 16) | Absence : double validation par deux `admin_ops`/`admin_founder` actifs distincts (`admin_propose_incident_decision`, `admin_review_incident_proposal`) ; « établi » = journée confirmée à titre exceptionnel (`incident_confirm_day_exceptional`) ; « non établi » = travail non démontré, **jamais** absence fautive ; révision interne de 7 jours (ADM-04) |
| Écrans support | `/admin/incidents` (signalements, dossiers) ; `/admin/cancellations` (désistements du candidat, avec la liste « Engagements futurs déjà sélectionnés » d'un candidat suspendu, `candidate_future_engagements`) ; aucun écran pour les annulations par l'entreprise (`admin_company_cancellations` existe sans écran) |
| Ce qui n'existe pas | Aucune fonction ne permet au support d'annuler une journée ; aucun constat d'absence injustifiée ; aucun producteur de `candidate_no_show` (SAN-05) ; aucune demande tracée de l'entreprise vers le support (seul un lien e-mail, ABO-15) |

**Distinction de principe (pour les trois parcours).** L'**annulation opérationnelle** (la journée n'aura pas lieu) est séparée de toute **qualification** (délai, imputabilité), de toute **sanction** (manquement, exclusion) et de toute **conséquence financière** (indemnité, frais, remboursement : MNT-04, lot paiement). Une annulation par le support n'est ni une faute, ni une absence, ni un remboursement.

### Parcours 1 — Retrait ciblé demandé par l'entreprise, sans faute du candidat

- **Décisions validées** : ANN-16 (principe : réservé au support ; parcours et grades à décider), ANN-15 (motif visible par l'entreprise et l'administration seulement), ANN-06 (qualification du délai de l'entreprise, sans conséquence), ANN-04 (un événement par demande), ECH-09, ECH-02, DON-04. ANN-14 **ne s'applique pas** (désistement du candidat seulement).
- **Existant** : l'entreprise ne peut annuler que des dates entières ; une demande qui laisse de côté un candidat d'une date est refusée (`cancellation_preview_stale`). Aucun autre chemin.
- **Manque** : demande tracée de l'entreprise, instruction et décision du support, écriture de l'annulation pour un seul candidat, avis, écran.
- **Proposition (à décider, ANN-17)** :
  - *Demande* : depuis l'écran de l'offre, l'entreprise demande le retrait d'un candidat nommé pour des journées futures précises, avec motif (ANN-15) ; la demande est tracée et ne change rien tant qu'elle n'est pas décidée ; l'écran ne l'annonce qu'une fois livrée.
  - *Habilitations* : instruction par tout admin actif (`admin_support` compris) ; décision par `admin_ops` ou `admin_founder` actif, motivée, une seule validation (aucune sanction en jeu).
  - *Pièces* : motif de l'entreprise ; aucune justification demandée au candidat, aucune pièce contre lui.
  - *Délais* : demande recevable jusqu'au début de la première journée visée ; décision avant ce début, sinon la demande devient sans objet et l'engagement reste entier (jamais d'acceptation par silence) ; journée commencée → interruption existante.
  - *Effet si accepté* : journées enregistrées comme **annulation par l'entreprise** (même table, même qualification ANN-06 sur les conditions figées, auteur du support tracé) ; disponibilité libérée (ECH-09) ; **place non rouverte** (comme 17d-2) ; autres journées et autres candidats inchangés ; contrat, candidature et montant reconnu conservés ; aucune conséquence sur la réputation du candidat.
  - *Information* : candidat prévenu sans le motif (« retiré de ces journées à la demande de l'entreprise, non imputé ») ; entreprise prévenue de la décision et de son motif.
  - *Recours* : l'entreprise peut demander un réexamen d'un refus par un autre agent habilité, avant le début ; pas de recours du candidat sur une absence de faute, mais un signalement d'erreur reste possible.

### Parcours 2 — Engagements futurs d'un candidat suspendu ou empêché

- **Décisions validées** : ANN-13 (première partie : engagements ni supprimés ni transformés en absences), SAN-03 et SAN-07 (causes de suspension), DON-04 (aucune cause ni suspension révélée à l'entreprise), ECH-09, ANN-01 et ANN-05 (désistement du candidat lui-même). ANN-14 **ne s'applique pas** sans décision.
- **Existant** : le candidat suspendu ne peut ni commencer ni postuler ; ses engagements futurs restent « sélectionnés » ; le support voit leur liste ; l'entreprise n'est pas informée et découvre au mieux un début absent le jour même (cas H d'AUDIT §41). `[CT]` **Constat** : `request_candidate_cancellation` ne vérifie pas le compte actif, si bien qu'un candidat suspendu peut encore se désister lui-même, avec les règles de 17b (qualification et sanction). Le comportement n'est ni décidé, ni contraire à une règle écrite. Un candidat **empêché** sans suspension (hospitalisation, impossibilité d'agir) n'a que le désistement par lui-même ; personne ne peut agir en son nom.
- **Manque** : annulation par le support au nom du candidat, information de l'entreprise sans cause, décision sur les engagements laissés en place.
- **Proposition (à décider, ANN-18)** :
  - *Déclencheur* : suspension en cours couvrant la journée (toutes causes), ou empêchement déclaré par le candidat ou un proche et instruit par le support.
  - *Habilitations* : `admin_ops` ou `admin_founder` actif, motif interne obligatoire ; `admin_support` instruit et lit.
  - *Pièces* : suspension en cours (aucune pièce de plus) ; empêchement : élément fourni, conservé comme les justificatifs de 17b (pièces privées), jamais transmis à l'entreprise.
  - *Délais* : avant le début de chaque journée ; recommandé dès la suspension pour les journées qu'elle couvre ; journées postérieures à la fin prévue de la suspension conservées par défaut.
  - *Effet* : nouvelle origine d'annulation, distincte du candidat et de l'entreprise (« par le support pour indisponibilité ») : **aucun manquement, aucune qualification de délai opposable au candidat**, aucun frais ni indemnité ; disponibilité libérée (ECH-09) ; autres journées non visées inchangées ; contrat, candidature (place) et montant reconnu conservés jusqu'à décision sur la place ; mission close seulement s'il ne reste aucune journée.
  - *Information* : entreprise prévenue que le candidat « n'est plus disponible pour ces journées », **sans cause** ; candidat prévenu ; aucune mention de la suspension hors de l'espace du candidat et du support.
  - *Recours* : le candidat garde la contestation de sa suspension (17c) ; une levée de suspension ne rétablit pas une journée déjà annulée (annulation définitive) — point à confirmer.
  - *Place* : non rouverte par défaut ; une réouverture ou un remplacement relèvent de 17d-4 et d'une décision distincte (ANN-12 ouvert).

### Parcours 3 — Absence signalée, distincte d'une absence injustifiée établie

- **Décisions validées** : ADM-04 (double validation, révision interne), SAN-01 (une absence injustifiée **confirmée** retire 5 unités, un manquement par événement), REP-04 (une journée non confirmée bloque l'unité « offre »), ANN-01, ECH-08 ; question ouverte SAN-05 (constat), à confirmer SAN-04 (blocage de 7 jours). Garde-fou du plan : aucun signalement ni décision « non établi » ne vaut absence établie.
- **Existant** : signalement par l'entreprise à partir du début ; dossier du lot 16 sur la **réalisation du travail** ; « non établi » laisse la journée non confirmée, sans montant, sans faute. Aucun constat d'absence injustifiée, aucun `candidate_no_show`. Une journée signalée a commencé : elle n'est plus annulable (17b, 17d-2), donc ECH-09 ne la libère pas.
- **Manque** : décision distincte de constat, ses pièces et délais, le recours, l'effet sur les journées futures et l'unité « offre ».
- **Proposition (à décider, SAN-08)** :
  - *Décision distincte*, ouverte seulement après une décision « non établi » devenue définitive (révision interne close) : le constat porte sur l'**imputabilité** de l'absence, pas sur la réalisation.
  - *Habilitations* : double validation par deux `admin_ops`/`admin_founder` actifs distincts, comme le lot 16 ; `admin_support` instruit.
  - *Pièces* : versions des deux parties, contacts tentés, preuve d'empêchement éventuelle du candidat ; un délai de réponse du candidat de 72 h (aligné sur RGL-05) proposé, le silence ne valant pas aveu (RGL-04).
  - *Issue* : « absence injustifiée établie » → manquement unique (SAN-01) ; « non imputable » ou « empêchement reconnu » → aucun manquement. Seul ce constat peut produire `candidate_no_show`.
  - *Recours* : révision par un autre agent pendant 7 jours (ADM-04, comme 17c).
  - *Effets* : la journée signalée reste non confirmée (aucun montant) ; les **journées futures restent engagées** (aucun remplacement sur le seul signalement, cas G) ; après un constat, leur sort relève du parcours 2 (annulation par le support) ou d'une décision explicite ; l'unité « offre » de l'entreprise et l'éventuel remboursement relèvent de 17d-5 et du lot paiement.

### Effets comparés

| | Retrait ciblé (P1) | Suspendu ou empêché (P2) | Absence signalée (P3) |
|---|---|---|---|
| Disponibilité | Libérée (ECH-09) | Libérée (ECH-09) | Inchangée (journée commencée, non annulée) |
| Place | Non rouverte (proposé, comme 17d-2) | Non rouverte par défaut (17d-4) | Inchangée |
| Autres journées | Inchangées | Seules les journées visées | Inchangées |
| Contrat, montant reconnu | Conservés | Conservés | Conservés ; journée signalée sans montant tant que non confirmée |
| Sanction | Aucune | Aucune | Seulement après un constat distinct (SAN-08) |
| Finances | Aucune (MNT-04 ouvert) | Aucune | Aucune (remboursement : lot paiement) |

### Arbitrages prioritaires

1. **Qui décide d'un retrait ciblé, et la place est-elle rouverte ?** Exemple : offre de 3 hôtesses le 12/12 ; l'entreprise demande le 9 le retrait de Paule, sans faute. **Recommandation** : décision par `admin_ops`/`admin_founder` actif avant le début, enregistrée comme annulation par l'entreprise (qualification ANN-06, sans conséquence), place non rouverte ; Paule prévenue sans le motif.
2. **Que deviennent les engagements d'un candidat suspendu ?** Exemple : Paul est suspendu le 5 pour 6 mois ; il est sélectionné le 8 et le 12. **Recommandation** : annulation par le support des journées couvertes par la suspension, dès la suspension, sans manquement ; entreprise prévenue « candidat indisponible », sans cause ; place non rouverte sans décision 17d-4.
3. **Un candidat suspendu peut-il encore se désister lui-même ?** Exemple : Paul, suspendu, annule lui-même le 8 à J−1 : aujourd'hui, désistement tardif et nouveau manquement possible. **Recommandation** : décider explicitement ; si le parcours 2 est retenu, réserver ce cas au support pour éviter un manquement pendant une suspension.
4. **Une levée de suspension rétablit-elle une journée annulée ?** Exemple : la suspension de Paul est levée le 7 après contestation ; la journée du 8 a été annulée le 5. **Recommandation** : non (annulation définitive, ECH-09 et contrat inchangés) ; une nouvelle sélection reste possible si une place existe.
5. **Constat d'absence injustifiée : qui, quand, sur quelles pièces ?** Exemple : Awa ne vient pas le 10 ; l'entreprise signale l'absence ; la décision du lot 16 conclut « non établi ». **Recommandation** : constat distinct après la décision définitive, double validation, 72 h de réponse pour le candidat, recours de 7 jours ; jamais de manquement sans ce constat ; journées futures conservées.

## 47. Suivi — Lot 17d-3 : interventions du support sur les engagements (2026-11-23)

**Point de départ (constat Git du 2026-11-23).** `origin/main-dev` = `6167235` (17d-2 intégré). Branche `feat/lot-17d-3-support-interventions` créée depuis ce commit, en emportant les modifications documentaires non commitées du cadrage (§46) ; stash conservé ; aucun commit, push ni déploiement. Travail sur `easyjob-proof` seulement.

**Décisions** (`docs/product/DECISIONS.md`) : ANN-17, ANN-18, SAN-08, validées par le « oui » de l'utilisateur du 2026-11-23 sur la proposition du §46 et précisées par son brief du même jour (`[UV]`). Réutilisées : ANN-16, ANN-15, ANN-13, ANN-06, ANN-04, ECH-09, ECH-02, ADM-04, DON-04. La validation du constat (SAN-08) **n'autorise aucune** sanction, exclusion, déduction de réputation ni conséquence financière.

**Livré** (migration `20261127120000_support_interventions.sql`) :

| Volet | Comportement |
|---|---|
| Retrait ciblé (ANN-17) | `request_targeted_removal` : demande tracée de l'entreprise propriétaire active (motif de 10 à 500 caractères), un candidat, journées futures non commencées, une demande en attente par journée, relance idempotente ; rien ne change avant la décision. `admin_decide_engagement_request` : `admin_ops`/`admin_founder` actif, note motivée, journées choisies revérifiées sous verrou (début atteint à l'instant exact : refus) ; acceptation écrite dans `company_cancellations` (`support_request_id`, `decided_by`, qualification ANN-06 sans conséquence) ; candidat prévenu sans le motif ; entreprise prévenue de la décision |
| Candidat suspendu (ANN-18) | Toute suspension d'un candidat qui a des journées futures couvertes ouvre une tâche (`trg_support_task_on_suspension`) ; rien n'est annulé automatiquement. Décision d'un ops/fondateur actif, sur suspension en cours et journées couvertes revérifiées (`suspension_not_active`, `day_not_covered`) ; troisième origine d'annulation (`support_cancellations`, `support_cancellation_days`), sans manquement ; entreprise prévenue « candidat indisponible », sans cause ; mission close inscrite `admin` / `support_cancellation` ; une levée ne restaure rien |
| Demande du candidat suspendu | `request_support_cancellation` (« Demander l'annulation au support »), journées couvertes par la suspension, message facultatif, aucun manquement ; `request_candidate_cancellation` refuse désormais un compte suspendu (`account_suspended`), après la relance d'une demande déjà enregistrée ; candidats non suspendus inchangés |
| Constat d'absence (SAN-08) | `absence_findings` (+ `absence_finding_events`, pièces dans `case_evidence`) : ouverture par tout admin actif sur un signalement d'absence de l'entreprise, journée non confirmée, en parallèle du lot 16 ; réponse et pièces du candidat jusqu'à `candidate_due_at` incluse (72 h) ; chaque réponse ou pièce crée une révision et annule une proposition en cours ; proposition puis validation par deux ops/fondateurs actifs distincts, sur la révision courante, seulement si la décision du lot 16 est définitive « non établi » (`absence_realization_state`) ; recours d'une partie avant `decided_at + 7 jours` (fin exclue), tranché par un agent distinct des deux validateurs ; « infirmé » ramène à l'instruction. **Aucun effet** : aucune écriture dans `reputation_incidents`, aucun cycle ni suspension ; aucune fonction de réputation, de cycle ou de balayage ne lit les constats |
| Origine « support » partout | `mission_day_cancelled_by/at`, gardes de journée (début, confirmation, signalement), garde d'annulation unique, `mission_close_if_interrupted`, `candidate_schedule_conflicts` (ECH-09), `company_job_cancellations`, `protect_reputation_incidents` (aucune faute du candidat) |
| Protection | Six tables fermées aux sessions et aux écritures de la clé service ; deux dossiers dont l'état n'avance que par les fonctions de la base ; cascades `SET NULL` d'un compte supprimé admises (déclencheur imbriqué), y compris pour `company_cancellations` |
| Écrans | Offre (entreprise) : « Demander le retrait au support » par candidat sélectionné, état de la demande ; mission : « Annulée par le support » (candidat) / « Candidat indisponible » (entreprise) ; candidat suspendu : « Demander l'annulation au support » à la place du désistement ; constat : version, pièce, recours (candidat), issue seule (entreprise) ; `/admin/interventions` (lecture et instruction : tout admin actif ; décisions : ops et fondateur) ; FR/EN |

**Résultats observés.**

| Contrôle | Résultat |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .` | ✅ |
| `pnpm test` | ✅ 648 tests, 55 fichiers (dont `support-intervention`) |
| `pnpm build` (relié à la pile de preuve) | ✅ |
| Types générés | identiques au schéma final (pile réinitialisée) |
| Preuve ciblée `support-interventions` | ✅ 25/25 au cinquième passage. Passages conservés (`proof-17d3-run1` à `run4`) : 21/25 puis 24/25 — échecs de la preuve elle-même (mot « indisponible » cherché dans le texte au lieu du titre, levée d'une suspension administrative par la mauvaise RPC, journées antérieures couvertes du même candidat, liste attendue des lecteurs des constats, titre d'offre de test contenant « suspension ») ; un passage interrompu par une erreur réseau passagère vers l'API d'authentification (`ECONNRESET`, pile saine ensuite) |
| Contrôles négatifs | N1 ancien désistement sans contrôle de suspension → S2 à S5 ; N2 décision ouverte au support → R2 à R4 ; N3 manquement produit par un constat établi → F5 ; N4 demandes réécrivables en clé service : **premier essai non détecté** (D1 visait une colonne absente, puis une valeur contraire à une contrainte : l'erreur ne prouvait rien) ; corrigé (modification valide sur une colonne réelle de chaque table) → D1 détecté ; pile restaurée, puis réinitialisée |
| Navigateur (Chrome headless par CDP, 375 × 812 tactile, entreprise, trois candidats et un ops, script hors dépôt) | ✅ 14/14, FR puis EN, premier passage : demande de retrait en attente, décision du support, « Annulée par l'entreprise » chez l'entreprise et le candidat sans rechargement, motif jamais montré au candidat ; suspension en direct : panneau « Demander l'annulation au support » à la place du désistement ; acceptation pendant la coupure réseau du candidat, état à jour au retour ; « Candidat indisponible » sans cause ; constat ouvert, version de la candidate lue par le support et absente de la vue de l'entreprise ; aucun défilement horizontal, aucune erreur JavaScript |
| Suite RLS complète sur le SQL final, pile réinitialisée | ✅ **42/42**, 1 287 s cumulées. Passages conservés : le premier, interrompu à la 12e preuve par l'arrêt de Docker Desktop (aucun échec jusque-là, `rls-full-17d3.log`) ; le second, 41/42 (`rls-full-17d3b.log`) : `candidate-cancellations` créait un dossier d'annulation **pendant** une suspension (scénario X3 du lot 17c), désormais refusé par la décision ANN-18. Adaptation sans perte d'intention : dossier ancien déposé avant la suspension et décidé après le retour (X4 inchangé), plus X2b (désistement refusé pendant la suspension) ; 32/32 isolément, puis suite complète verte |

**Faits et hypothèses.** Observé : comportements ci-dessus, en base et à l'écran. Hypothèses et choix à confirmer (consignés sous SAN-08 et ANN-17) : origine des 72 h = ouverture du constat (demande adressée au candidat, par analogie avec RGL-05) ; recours ouvert aux deux parties et « infirmé » = retour à l'instruction (par analogie avec le lot 16 et ADM-04) ; réexamen d'un refus de retrait non livré. La décision du lot 16 est posée par la voie de maintenance dans la preuve ; sa double validation réelle relève de `mission-disputes`.

**Limites.** Aucun écran admin pour les annulations par l'entreprise hors des demandes ; empêchement d'un candidat non suspendu non traité ; conséquences d'un constat (SAN-01, SAN-04) non appliquées ; aucune réouverture ni remplacement (ANN-14 non étendu) ; aucun e-mail (avis dans l'application).

### Complément du 2026-11-24 — articulation du constat avec la réalisation (SAN-08)

**Écart corrigé.** La première version exigeait, avant toute décision du constat, une décision **définitive « non établi »** du lot 16 : elle imposait donc de créer et de terminer un dossier du lot 16, ce que la validation du 2026-11-23 ne prévoit pas (instruction `[U]` du 2026-11-24). Remplacée par `absence_realization_state`, qui distingue quatre états :

| État | Effet sur le constat |
|---|---|
| `clear` (aucune contestation ; pas de décision, ou « non établi » définitif) | parcours propre : version, proposition, seconde validation ; « non établi » ne décide rien |
| `contested` (proposition du lot 16 en attente, « code non remis » non tranché, révision ouverte, demandée ou en arbitrage) | proposition et validation refusées (`realization_review_open`) |
| `work_confirmed` (journée confirmée ou décision « établi ») | « absence injustifiée établie » refusée (`work_confirmed`) ; « non imputable » possible |
| `ambiguous` (début enregistré, accord partiel, « partiel » ou « désaccord », interruption) | « absence injustifiée établie » refusée (`realization_ambiguous`) ; « non imputable » possible |

Courses : la proposition et la validation tiennent la mission et la journée en partage ; une confirmation concurrente attend, ou la décision lit la confirmation enregistrée. Réciproque : tant qu'un constat « établi » est en vigueur, la journée ne peut pas être confirmée (`absence_finding_established`, tout auteur), jusqu'à ce qu'un recours l'infirme. Les définitions de « contestation ouverte » et de « partielle ou ambiguë » sont des **choix provisoires**, consignés sous SAN-08 avec les autres modalités à confirmer.

**Résultats observés.**

| Contrôle | Résultat |
|---|---|
| Preuve `support-interventions` | ✅ 30/30 au premier passage, dont G1-G5 par les vrais parcours du lot 16 (signalement, début, proposition et revue par deux agents, demande de révision ; seule l'échéance de révision est déplacée, comme `mission-disputes`) : G1 constat décidé sans aucun dossier du lot 16 ; G2 confirmation refusée, clé service comprise, sous un constat établi ; G3 contestation ouverte bloquante à chaque étape ; G4 journée commencée puis travail confirmé : « établie » refusée, « non imputable » validée ; G5 course validation / début de journée, puis confirmation par le lot 16 refusée |
| Contrôles négatifs | N5 garde réciproque désactivée → G2, G5 ; N6 contrôle réduit à la contestation → G4 ; pile restaurée |
| Suite RLS complète sur l'état final, pile réinitialisée | ✅ **42/42**, 1 989 s cumulées (`support-interventions` 30/30), copie des migrations vérifiée identique au dépôt. Passages conservés : (1) `rls-full-17d3d.log`, 41/42 — la pile avait été réinitialisée **sans recopier** la migration modifiée (`init-proof-stack` oublié) : la suite a tourné sur l'ancienne version de SAN-08, d'où `support-interventions` 25/30 ; erreur de procédure, non du code ; (2) `rls-full-17d3e.log`, 41/42 — `reputation` dépasse le délai de 600 s, bloquée sur une requête HTTP de dépôt d'avis après l'étape P1 (aucune attente de verrou en base, serveur répondant ensuite) ; relancée seule : 1/1 ; **cause non établie**, partie non modifiée par le lot |

### Finalisation du 2026-11-24 — modalités validées (SAN-08, ANN-17)

**Source.** `[UV]` « oui » de l'utilisateur du 2026-11-24 aux choix provisoires du constat et au point isolé du réexamen, avec ses modalités (`docs/product/DECISIONS.md` SAN-08, ANN-17).

**Écarts repris du diff restant** (le reste était livré et a été conservé) :

| Modalité | Avant | Après |
|---|---|---|
| Contestation bloquante | fenêtre de révision du lot 16 ouverte comprise | contestation en instruction, proposition en attente ou recours non résolu seulement |
| Issue favorable | « non imputable » | « absence injustifiée non établie » / « unjustified absence not established », qui ne confirme ni le travail ni un droit au paiement |
| Origine des 72 h et des 7 jours | `now()` de la transaction | création de la notification d'ouverture ou de décision, dans la même transaction (`candidate_notified_at`, `decision_notified_at`, contraintes « + 72 h » et « + 7 jours ») ; lecture jamais prise en compte |
| Historique | dernière décision seule dans la ligne | journal : chaque décision (issue, note, proposeur, validateur, notification, échéance), recours et infirmation |
| Nouveaux éléments | refusés après 72 h ou après la décision | transmissibles à tout moment par les deux parties (texte, pièce), sans révision, réouverture ni délai |
| Support | ouverture seulement | note d'instruction ; ni proposition ni validation |
| Réexamen d'un refus de retrait | non livré | demande motivée liée à la demande refusée, sans annulation automatique, décision ops/fondateur avant le début |

**Résultats observés.**

| Contrôle | Résultat |
|---|---|
| Preuve `support-interventions` | ✅ 37/37 au deuxième passage (H1-H7 : délais égaux à l'instant des notifications, non lues ; support instructeur ; issue « non établie » et sa mention ; nouveaux éléments sans effet ; recours de l'entreprise, infirmation par un tiers et décisions successives conservées ; réexamen ; début franchi pendant le traitement). Premier passage 36/37 (`proof-17d3-1124-run1.log`) : F4 attendait encore le refus d'une pièce tardive (ancienne règle) |
| Navigateur (CDP, 375 × 812, FR puis EN) | ✅ 10/10 au second passage. Premier passage 8/10 (`browser1124-run1.log`) : **défaut réel** — un nouvel élément n'écrit que dans le journal, sans signal temps réel ; l'écran du support ne se rafraîchissait pas. Corrigé (`trg_rt_absence_finding_events`, charge utile `{d, r}`) |
| Lint, Prettier, Vitest (648), typecheck, build | ✅ |
| Types générés | identiques au schéma final |
| Suite RLS complète, migrations recopiées (empreintes identiques), pile réinitialisée | ✅ **42/42**, 1 440 s cumulées |

Contrôles négatifs N5 et N6 non rejoués : les protections qu'ils visent n'ont pas changé.

**Modalités résiduelles non définies** (signalées, non inventées) : nombre de nouveaux éléments (limite technique de 10 textes et 5 pièces par partie) et de réexamens successifs (non limité en base) ; traitement d'un élément transmis pendant l'instruction après les 72 h (consigné, sans nouvelle révision) ; effet d'une décision ultérieure du lot 16 « établi » après un constat « non établie ».

### Complément final du 2026-11-24 — éléments pendant l'instruction, plafonds, réexamens

**Source.** `[U]` consigne du 2026-11-24 (`docs/product/DECISIONS.md` SAN-08 (j) et (j bis), ANN-17). Elle **remplace** les modalités résiduelles de la finalisation précédente (plafonds de 10 textes et 5 pièces, élément tardif sans révision).

| Point | Après |
|---|---|
| Élément reçu avant la décision finale | texte ou pièce, même après les 72 h : révision suivante, proposition qui ne l'inclut pas périmée ; la seconde validation contrôle d'abord la version lue (`finding_stale`, relecture) ; aucun délai prolongé, aucun recours créé |
| Après la décision finale | élément ajouté au journal (`after_decision`), sans réouverture ni infirmation |
| Plafonds | plafonds cumulatifs retirés ; restent les contrôles techniques de taille et de format ; aucune protection de fréquence n'existe sur ces routes, aucune n'est ajoutée |
| Réexamen | un seul par refus, contrôle serveur (index unique, demande refusée verrouillée, `reexamination_exists`) ; réexamen d'un réexamen refusé accepté en base, nombre **à décider** ; l'écran n'est pas présenté comme une protection |
| Compatibilité | « absence injustifiée non établie » compatible avec une confirmation ultérieure du travail (aucune garde ne la bloque) |

**Résultats observés.**

| Contrôle | Résultat |
|---|---|
| Preuve `support-interventions` | ✅ 42/42 au deuxième passage. Premier passage 41/42 (`proof-17d3-fin-run1.log`) : H6 attendait l'ancien code de doublon (`removal_already_requested`, désormais `reexamination_exists`) ; la course I3, laissée au hasard, n'avait produit que l'ordre « dépôt d'abord » : réécrite avec les deux ordres imposés par la barrière du lot 11 |
| Contrôle négatif N7 (élément avant la décision seulement journalisé) | → I1, I3 ; pile restaurée puis réinitialisée |
| Lint, Prettier, Vitest (648), typecheck, build | ✅ |
| Suite RLS complète, empreinte de la migration identique (`1699E3449745…`), pile réinitialisée | ✅ **42/42**, 1 680 s cumulées |

Contrôles non rejoués (inchangés) : navigateur, contrôles négatifs N1 à N6.

