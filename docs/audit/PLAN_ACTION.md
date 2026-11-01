# Plan d'action — suite de l'audit du 2026-10-31

Source : `docs/audit/AUDIT.md` (commit `801b696`). Les lots sont classés par risque et par dépendance. Chaque lot doit pouvoir être relu et mergé seul.
Convention de migration du dépôt : en-tête avec tables affectées et rollback en commentaire (`.github/instructions/database.instructions.md`).

| Ordre | Lot | IDs | Nature | Taille |
|---|---|---|---|---|
| 0 | Vérification production (lecture seule) | H-01, H-02, H-03 | Diagnostic | Petit |
| 1 | Verrouiller les rôles et les comptes — **corrigé et vérifié localement, non déployé** | F-01, F-02, F-03 | Sécurité | Petit |
| 2 | Verrouiller les colonnes et tables porteuses de droits — **corrigé et vérifié localement, non déployé** | F-04, F-05, F-06, F-11, F-17 | Sécurité | Moyen |
| 3 | Mettre à jour les dépendances vulnérables — **corrigé et vérifié localement, non déployé** | F-08, F-24 | Sécurité | Petit |
| 4 | Tests RLS négatifs en CI et durcissement CI/CD — **partie CI faite localement ; déploiement préparé et vérifié localement (lot 4b), non validé à distance** | F-20, F-21 | Qualité | Moyen |
| 5 | Typer les clients Supabase | F-14 | Refactoring ciblé | Moyen |
| 6 | Publication et modération des offres | F-09 | Fonctionnel et sécurité | Moyen |
| 7 | Sélection → mission → contrat → pointage | F-07, F-10, F-16, F-30 | Fonctionnel et sécurité | Grand (3 sous-lots) |
| 8 | Hygiène auth, chatbot et journaux | F-12, F-13, F-15, F-23, H-04 | Sécurité | Petit à moyen |
| 9 | Retour utilisateur et textes | F-18, F-19, F-28 | UX | Moyen |
| 10 | Documentation, consignes IA et nettoyage | F-22, F-27, F-29, F-25, F-26, F-31 | Maintenance | Petit |

---

## Lot 0 — Vérifier l'état de la production (lecture seule)

- **Objectif** : savoir si les failles P0 et P1 sont présentes **et** si elles ont déjà été exploitées, ce qui détermine l'urgence du lot 1 et un éventuel nettoyage de données.
- **IDs** : H-01, H-02, H-03.
- **Périmètre** : requêtes `SELECT` sur `pg_policies`, `pg_trigger` (y compris les triggers sur `auth.users` qui appellent `handle_new_user`), `cron.job`, `app_metadata.role` des comptes admin ; comptages sur `users` (par rôle), `candidate_profiles` (`sandbox_level`, `premium_until`, `driving_license_verified`), `subscriptions` (`price = 0`), comptes admin sans téléphone.
- **Exclusions** : aucune écriture ni correction de données dans ce lot.
- **Fichiers** : aucun. Consigner les résultats dans `docs/audit/AUDIT.md`, section 6.
- **Dépendances** : aucune.
- **Critères d'acceptation** : chaque hypothèse H-01 à H-03 passe à « confirmée » ou « infirmée », avec la requête utilisée.
- **Contrôles** : exécution par le responsable de la base, avec un rôle en lecture seule.
- **Risques / retour arrière** : aucun (lecture seule).

## Lot 1 — Verrouiller les rôles et les comptes (P0)

> **Statut (2026-10-31)** : réalisé sur la branche `fix/lot-01-account-security` (base `origin/main-dev`), **non commité, non déployé**. Détails, résultats et risques résiduels : `AUDIT.md` §9.
> Le mécanisme retenu diffère de la proposition initiale. La frontière principale est faite de **privilèges de colonnes** (`UPDATE (locale)` seul pour `authenticated`, aucun `INSERT`). Un trigger de défense en profondeur s'appuie sur `current_user` plutôt que sur `easyjob.system_update`. `handle_new_user()` a aussi été neutralisé.
>
> **Avant déploiement** :
> 1. Revue, puis commit et PR vers `main-dev` (CI : `test-migrations` appliquera la migration et vérifiera les types).
> 2. Lot 0 en lecture seule sur la production : rôles admin inattendus dans `public.users` et `app_metadata`, trigger éventuel sur `auth.users` appelant `handle_new_user`.
> 3. Vérifier qu'aucun outil externe (Studio, scripts d'exploitation) n'écrit dans `users` avec une clé `anon` ou un JWT utilisateur. Ces écritures sont désormais refusées.
> 4. Après le déploiement, rejouer `scripts/proof-account-security.ts` sur une pile locale à jour. Ne **jamais** l'exécuter contre la production : le script le refuse.
> 5. Corriger les comptes élevés illégitimement si le point 2 en révèle (`public.users.role` et `app_metadata.role`), avec une trace dans `audit_logs`.

- **Objectif** : aucun utilisateur ne peut modifier son rôle, son statut actif, sa vérification téléphone ou ses sanctions, ni créer sa propre ligne `users`.
- **IDs** : F-01, F-02, F-03.
- **Périmètre** :
  - Migration : `protect_user_privileged_columns()` en `BEFORE UPDATE ON users`. Elle fige `role`, `is_active`, `phone_verified`, `no_show_count`, `ban_reason`, `ban_expires_at`, `device_fingerprint` sauf si `easyjob.system_update = 'on'`. Même motif que `protect_user_is_verified`, à fusionner éventuellement.
  - Migration : supprimer la politique « Service role can insert users » (le rôle `service_role` contourne déjà la RLS) ou la limiter `TO service_role`.
  - `lib/actions/auth.ts` (`finalizeSignup`) : rôle calculé par liste blanche (`candidate` | `company`, sinon `candidate`) et **jamais** d'écrasement d'un rôle existant (lire la ligne avant l'`upsert`).
  - Vérifier que `admin_set_user_active`, `admin_edit_candidate_identity` et les flux qui écrivent `phone_verified` ou `is_active` activent bien `easyjob.system_update`, sinon les adapter.
- **Exclusions** : refonte de l'auth, changement du modèle de rôles.
- **Fichiers probables** : `supabase/migrations/<nouvelle>.sql`, `lib/actions/auth.ts`, `lib/database.types.ts` (régénéré si nécessaire).
- **Dépendances** : aucune. Peut être livré avant le lot 0 si l'on veut agir sans attendre.
- **Critères d'acceptation** :
  - En session candidate, `PATCH users {role, is_active:true, phone_verified:true}` laisse les valeurs inchangées.
  - Un INSERT `users` en `authenticated` ou `anon` est refusé.
  - Un signup avec `user_metadata.role = "admin_founder"` produit `candidate`.
  - La suspension et la réactivation admin fonctionnent toujours (`scripts/proof-admin-centralization.ts`).
- **Contrôles** : `supabase db reset` local, script de preuve dédié (sur le modèle `scripts/proof-*.ts`), test unitaire de la normalisation du rôle, `tsc`, `lint`, `test`.
- **Risques / retour arrière** : un flux légitime qui écrivait ces colonnes sans le drapeau serait silencieusement neutralisé. Les recenser par recherche avant de merger. Retour arrière : `drop trigger` et recréation de la politique (SQL dans l'en-tête de migration).
- **Après déploiement** : si le lot 0 révèle des comptes élevés illégitimement, corriger leurs rôles (hors de ce lot, avec trace dans `audit_logs`).

## Lot 2 — Verrouiller les colonnes et tables porteuses de droits (P1)

> **Statut (2026-10-31)** : réalisé et finalisé sur la branche `fix/lot-02-business-permissions` (base `origin/main-dev`, faf91fc), **corrigé localement, non commité, non déployé**. F-34 (complétude, critère CNI) et F-35 (verrou d'identité et MoMo, `is_verified`) sont inclus. Détails, preuves, comportement du recalcul et risques résiduels : `AUDIT.md` §10.
> Écarts par rapport au périmètre ci-dessous :
> - Privilèges de colonnes comme frontière principale, comme au lot 1, avec des triggers sur `current_user` en défense en profondeur.
> - La complétude est calculée en base pour toutes les écritures, par traduction SQL de `computeCandidateCriteria`. Ce n'est pas une RPC appelée par le client.
> - `otp_codes` est conservée (accès révoqués) : son état distant est inconnu.
> - Recandidature après retrait refusée (SRS §6.6).
>
> **Avant déploiement** :
> 1. Revue, puis PR vers `main-dev`.
> 2. Lot 0, en lecture seule : rechercher les valeurs déjà falsifiées (H-01, H-02), et vérifier que `candidate_profiles` est absente de la publication Realtime.
> 3. Prévenir que le seuil de 60 % devient effectif (F-34).
> 4. F-38, F-39 et F-40 sont traités par le lot 2b (`fix/lot-02b-candidate-user-flows`, `AUDIT.md` §11). La candidature par l'interface y est vérifiée.

- **Objectif** : les contrôles métier ne peuvent plus être contournés par PostgREST.
- **IDs** : F-04, F-05, F-06, F-11, F-17.
- **Périmètre** :
  - Trigger sur `candidate_profiles` qui fige `sandbox_level`, `premium_until`, `driving_license_verified`, `profile_completion_pct`, `onboarding_status`, `reliability_score`, `completed_missions` hors `system_update`. Recalculer `profile_completion_pct` et `onboarding_status` côté serveur (RPC) à partir de `lib/utils/profile-completion.ts`.
  - `job_applications` : supprimer la politique INSERT candidat et créer une RPC `apply_to_job(job_id)` `SECURITY DEFINER` qui porte les contrôles de `app/api/jobs/[id]/apply/route.ts` ; la route l'appelle. Limiter l'UPDATE candidat à `pending → withdrawn`, par trigger ou RPC. Remplacer la suppression par le passage à `withdrawn` (F-17).
  - `subscriptions` : INSERT réservé aux admins.
  - `otp_codes` : supprimer la table si inutilisée (vérifier en production qu'elle est vide), sinon révoquer `anon` et `authenticated`.
- **Exclusions** : le cycle mission et contrat (lot 7), la modération des offres (lot 6).
- **Fichiers probables** : nouvelle migration, `app/api/jobs/[id]/apply/route.ts`, `lib/utils/profile-completion.ts`, les pages qui écrivent `profile_completion_pct` (`onboarding-client.tsx`, `profile/candidate/edit`).
- **Dépendances** : lot 1, qui fixe le motif du drapeau `system_update`.
- **Critères d'acceptation** :
  - En session candidate, les colonnes protégées restent inchangées.
  - Un INSERT direct `job_applications` est refusé ; via `/api/jobs/[id]/apply`, la candidature est créée seulement si tous les contrôles passent.
  - Le candidat ne peut pas passer sa candidature à `selected`.
  - Un INSERT `subscriptions` hors admin est refusé.
  - L'annulation produit `withdrawn`.
- **Contrôles** : scripts de preuve RLS, plus les preuves existantes `proof-essentials-gate`, `proof-license-gate`, `proof-profile-*` pour vérifier l'absence de régression.
- **Risques / retour arrière** : l'onboarding candidat peut casser s'il écrit directement `profile_completion_pct`. Tester l'onboarding de bout en bout. Rollback SQL en en-tête.
- **Taille** : moyen.

## Lot 3 — Mettre à jour les dépendances vulnérables

> **Statut (2026-10-31)** : réalisé sur la branche `fix/lot-03-dependency-security` (base `origin/main-dev`, 347344a), **non commité, non déployé**. `next` et `eslint-config-next` passent en 16.4.3, `zod` en 4.6.7, et des transitifs sont mis à jour dans leurs plages. `pnpm audit --prod` ne signale plus qu'un avis bas (`@ai-sdk/provider-utils`, reporté au lot 8). Détails, constats rectifiés et alertes restantes : `AUDIT.md` §12.
> Reste hors lot : `vitest` 4 (majeure, avis `tinypool` limités aux tests, à décider au lot 4) et la chaîne `pwa-asset-generator` (outil manuel, lot 10).

- **Objectif** : supprimer les avis critiques et hauts des dépendances d'exécution.
- **IDs** : F-08, F-24.
- **Périmètre** : `next` et `eslint-config-next` vers la dernière 16.x corrigée (au-delà de 16.4.0 d'après l'audit, version exacte à confirmer avec `pnpm audit` après la montée), `zod` ≥ 4.6.6. Les dépendances de développement (`pwa-asset-generator`, `eslint`) passent en second, dans le même lot si c'est trivial.
- **Exclusions** : passage à une version majeure, refonte de configuration.
- **Fichiers** : `package.json`, `pnpm-lock.yaml`.
- **Dépendances** : aucune. Parallélisable avec les lots 1 et 2.
- **Critères d'acceptation** : `pnpm audit --prod` sans avis critique ou haut sur `next` et `zod` ; `tsc`, `lint`, `test` et `build` verts ; test manuel de la connexion et de la redirection par le Proxy.
- **Risques / retour arrière** : changements de comportement mineurs de Next. Retour arrière par revert du lockfile.
- **Taille** : petit.

## Lot 4 — Tests RLS négatifs en CI et durcissement CI/CD

> **Statut (2026-10-31)** : partie CI réalisée sur la branche `ci/lot-04-rls-and-deployment` (base `origin/main-dev`, 3464565), **non commitée, CI distante non observée**.
> - `pnpm test:rls` exécute les 16 preuves (375 assertions), dans `test-migrations` sur une pile jetable unique.
> - `pnpm test` est ajouté à la CI, et `build` dépend des deux autres jobs.
> - F-33 est résolu (deux preuves obsolètes corrigées, aucun défaut applicatif).
> - Vitest passe en 4.1.12 (avis `tinypool` et `@vitest/mocker` corrigés).
> - Le contrôle négatif F-01 a été détecté.
>
> **Lot 4b (2026-10-31)** : `deploy.yml` préparé et vérifié localement sur `ci/lot-04b-deployment-reliability` (versions figées, SHA unique, CI exigée, dry-run, pooler en mode session, file d'attente). Reprise et protections recommandées : `docs/deployment/production.md`. `vercel.json` réserve la production à `deploy.yml` (previews conservées). `release.yml` ne pousse plus sur `main` : il tague le commit mergé avec la version préparée dans la PR (option A). Sauvegarde reportée au point de contrôle avant les premiers utilisateurs. Détails : `AUDIT.md` §14.

- **Objectif** : qu'une politique relâchée fasse échouer la CI, et que les déploiements soient reproductibles.
- **IDs** : F-20, F-21.
- **Périmètre** :
  - Job CI qui démarre Supabase local (déjà fait dans `test-migrations`) puis exécute une **suite d'accès interdits** : les preuves des lots 1 et 2 (dont `scripts/proof-account-security.ts`, déjà autonome : variables `API_URL` / `ANON_KEY` / `SERVICE_ROLE_KEY` issues de `supabase status -o env`), plus les `scripts/proof-*.ts` existants qui sont déterministes.
  - Garde-fou « pile locale uniquement » (F-32) : **fait au lot 1** (`scripts/lib/local-supabase.ts`, procédure `docs/testing/local-proofs.md`). En CI, réutiliser `scripts/init-proof-stack.ts` ou la pile de `test-migrations`, et exporter `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` et `DB_URL`. Reste à réparer `proof-admin-cni` et la fixture de `proof-essentials-gate` (F-33).
  - Ajouter `pnpm test` à la CI. Faire dépendre `build` de `test-migrations`.
  - `deploy.yml` : figer `supabase/setup-cli` (2.117.0, comme la CI) et la version de `vercel`. Ajouter une étape `supabase db push --dry-run` et documenter la restauration (PITR ou sauvegarde) avant le push réel.
- **Exclusions** : changement d'hébergeur, environnement de préproduction complet (à discuter séparément).
- **Fichiers probables** : `.github/workflows/ci.yml`, `deploy.yml`, `scripts/` (point d'entrée commun), `package.json` (script `test:rls`).
- **Dépendances** : lots 1 et 2, dont il réutilise les preuves.
- **Critères d'acceptation** : relâcher volontairement une politique sur une branche de test fait échouer la CI ; versions figées dans `deploy.yml`.
- **Risques** : durée de CI plus longue (Supabase local, environ 2 à 3 min).
- **Taille** : moyen.

## Lot 5 — Typer les clients Supabase

- **Objectif** : que `tsc` détecte les tables et colonnes inexistantes.
- **IDs** : F-14 (et révélation probable d'autres défauts).
- **Périmètre** : `createBrowserClient<Database>` et `createServerClient<Database>` dans `lib/supabase/*`. Corriger les erreurs révélées **sans changer le comportement**, sauf l'onboarding entreprise (`companies` → `company_profiles`, avec les colonnes réelles, et suppression de `is_verified: true`). Supprimer `database.types.ts` à la racine.
- **Exclusions** : refactoring des pages au-delà des corrections de type.
- **Fichiers probables** : `lib/supabase/*.ts`, pages et routes qui utilisent `select("*")` ou des colonnes divergentes, `app/onboarding/company/page.tsx`.
- **Dépendances** : idéalement avant les lots 6 et 7, pour qu'ils en profitent.
- **Critères d'acceptation** : `tsc` vert avec clients typés ; l'onboarding entreprise enregistre réellement les informations, vérifié en local.
- **Risques** : nombre d'erreurs inconnu. Si le volume est élevé, découper par répertoire (`app/api`, puis `app/admin`, puis les pages).
- **Taille** : moyen.

## Lot 6 — Publication et modération des offres

- **Objectif** : un chemin unique et sûr, création → modération → publication, qui fonctionne réellement.
- **IDs** : F-09.
- **Périmètre** :
  - L'UI `company/jobs/new` appelle `POST /api/jobs` au lieu d'un INSERT direct.
  - Un seul statut d'attente (choisir `pending_moderation` ou `pending_review` et migrer les données).
  - RPC `moderate_job(job_id, action, reason)` réservée à `admin_ops`/`admin_founder`, avec audit et notification à l'entreprise ; la route `moderate` l'appelle et vérifie le résultat.
  - Politique SELECT admin sur `jobs`.
  - Trigger qui interdit à l'entreprise de modifier `status` (sauf brouillon ou annulation) et les champs modérés après publication.
- **Exclusions** : sous-offres multi-jours et boost (non implémentés, hors lot).
- **Fichiers probables** : `app/company/jobs/new/page.tsx`, `app/api/jobs/route.ts`, `app/api/admin/jobs/[id]/moderate/route.ts`, `app/admin/dashboard/page.tsx`, `app/admin/admin-dashboard-client.tsx`, nouvelle migration.
- **Dépendances** : lots 1 et 2 (sécurité), lot 5 recommandé.
- **Critères d'acceptation** : test bout en bout local (entreprise vérifiée crée → l'admin voit → approuve → le candidat voit) ; une entreprise non vérifiée est refusée ; le passage direct à `active` par l'entreprise est refusé.
- **Contrôles** : script de preuve dédié et test manuel.
- **Taille** : moyen.

## Lot 7 — Sélection → mission → contrat → pointage

À découper en trois PR successives. Avant de commencer, **confirmer avec le produit** les règles minimales du MVP (contrat simple ou formalisé, pause automatique, validation des heures). Ne pas tout implémenter d'un coup.

### 7a — Sélection atomique et visibilité des candidats
- **IDs** : F-10 (partie sélection), F-16.
- **Périmètre** : RPC `select_candidate(application_id)` qui vérifie la propriété de l'offre, verrouille la ligne `jobs` (`FOR UPDATE`), contrôle les places, passe la candidature à `selected`, incrémente `positions_filled`, crée la `mission` et le `contract` en `pending`, puis notifie le candidat. Vue ou RPC qui expose aux entreprises les colonnes autorisées de leurs candidats (sans téléphone, email, CNI, MoMo ni coordonnées du domicile). Suppression de la politique erronée sur `company_profiles`.
- **Critères** : deux sélections concurrentes sur la dernière place produisent une seule réussite ; l'entreprise A ne lit pas l'entreprise B ; aucune donnée sensible du candidat n'est visible.

### 7b — Contrat
- **IDs** : F-07 (partie contrat).
- **Périmètre** : RPC `sign_contract(contract_id)` qui détermine la partie depuis `auth.uid()`, horodate côté serveur, enregistre l'IP transmise par la route, applique des transitions strictes, stocke la signature dans Storage et non en data-URL dans une colonne, et calcule une empreinte de `contract_data`. Retrait de l'UPDATE direct.
- **Critères** : une signature unilatérale ne produit jamais `completed` ; `contract_data` n'est pas modifiable par une partie.

### 7c — Pointage et validation des heures
- **IDs** : F-10 (partie pointage), F-07 (partie mission), F-30.
- **Périmètre** : RPC `check_in` et `check_out` (distance calculée côté serveur à partir de la position envoyée, une seule arrivée et un seul départ par mission, statut `in_progress` puis `completed`). Validation des heures par l'entreprise via RPC. Restriction de l'UPDATE entreprise sur `missions`. Dates affichées en `Africa/Douala`.
- **Critères** : un double clic ne crée pas deux arrivées ; une erreur est affichée à l'utilisateur ; l'entreprise ne modifie ni `payment_status` ni `platform_fee`.

- **Exclusions du lot 7** : paiement Mobile Money réel (lot distinct à cadrer : fournisseur, webhooks signés, idempotence, rapprochement), sanctions automatiques, niveaux sandbox automatiques.
- **Dépendances** : lots 1, 2 et 6, lot 5 recommandé.
- **Risques / retour arrière** : changement de modèle d'écriture (du client vers la RPC). Procéder par sous-lot, avec migration réversible et pages adaptées dans la même PR.

## Lot 8 — Hygiène auth, chatbot et journaux

- **IDs** : F-12, F-13, F-15, F-23, H-04.
- **Périmètre** :
  - Supprimer le log du code OTP et masquer les téléphones dans les logs.
  - Callback OAuth : valider `next` (chemin relatif interne uniquement), ne pas écraser un rôle existant, créer `/auth/error`.
  - `/api/chat` : authentification, quota (table `*_send_log` ou équivalent existant), limites de taille, prompt aligné sur les règles réelles. Ou désactivation jusqu'à cadrage.
  - Réponses d'erreur génériques (pas de `error.message` Postgres).
  - Test local de H-04.
- **Fichiers probables** : `lib/actions/auth.ts`, `app/auth/callback/route.ts`, `app/api/chat/route.ts`, `app/api/jobs/route.ts`.
- **Dépendances** : lot 1, qui touche le même fichier `auth.ts`.
- **Critères d'acceptation** : tests unitaires du filtre `next` (`//x`, `@x`, `/\x` refusés) ; requête anonyme vers `/api/chat` → 401 ; aucune occurrence de `token` dans les logs.
- **Taille** : petit à moyen.

## Lot 9 — Retour utilisateur et textes

- **IDs** : F-18, F-19, F-28.
- **Périmètre** : ~~remplacer `hooks/use-toast.ts` par un vrai composant (accessible, `aria-live`)~~ (fait au lot 2b, `AUDIT.md` §11 ; reste : textes des toasts en i18n), corriger `/login` en `/auth/login`, retirer ou marquer « bientôt disponible » les promesses non livrées (paiement 48 h, séquestre, remplacement garanti, IA, essai gratuit), passer les pages touchées par les lots 6 et 7 sur le dictionnaire i18n.
- **Exclusions** : refonte visuelle.
- **Dépendances** : à coordonner avec les lots 6 et 7 pour ne pas réécrire deux fois les mêmes pages. La partie « textes » peut partir tout de suite.
- **Critères d'acceptation** : chaque erreur des parcours mission, contrat et offres est visible ; une relecture produit valide que chaque promesse correspond à une fonction livrée ; contrôle manuel à 375 px sur Android et iOS.
- **Taille** : moyen.

## Lot 10 — Documentation, consignes IA et nettoyage

- **IDs** : F-22, F-27, F-29, F-25, F-26, F-31.
- **Périmètre** :
  - Aligner `AGENTS.md` et les fichiers `.github/*instructions*` sur la stack réelle (Next 16, i18n maison, pas de PWA SW, pas de Three.js) et y ajouter la règle « toute colonne porteuse de droits est protégée par trigger ; écriture via RPC ».
  - Supprimer le code mort listé en F-27.
  - Déplacer `.qwen/` hors du dépôt ou l'ignorer.
  - CSP en `Report-Only`.
  - Corriger `enforce_salary_lock`.
  - Mettre à jour la section CI du README.
- **Dépendances** : aucune. Peut être fait à tout moment, idéalement tôt pour la partie consignes IA.
- **Critères d'acceptation** : chaque outil ou fichier cité dans les consignes existe ; `tsc`, `lint` et `build` verts après suppression du code mort.
- **Taille** : petit.

---

## Hors plan (à cadrer séparément)

- **Paiement Mobile Money** : choix du fournisseur ou agrégateur, webhooks signés avec protection contre le rejeu, idempotence, rapprochement et gestion des échecs partiels. Aucun code de production n'existe aujourd'hui.
- **Données personnelles** : validation juridique (conservation des CNI, information des personnes, suppression ou export de compte, déclaration à l'autorité compétente). Cela produira des exigences techniques à planifier ensuite.
- **Observabilité** : choisir un outil de capture d'erreurs seulement après le lot 8, si les logs Vercel ne suffisent pas.
