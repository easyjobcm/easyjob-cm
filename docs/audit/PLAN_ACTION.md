# Plan d'action — suite de l'audit du 2026-10-31

Source : `docs/audit/AUDIT.md` (commit `801b696`). Les lots sont classés par risque et par dépendance. Chaque lot doit pouvoir être relu et mergé seul.
Convention de migration du dépôt : en-tête avec tables affectées et rollback en commentaire (`.github/instructions/database.instructions.md`).
Décisions produit : `docs/product/DECISIONS.md` (registre depuis le 2026-11-19). Les nouveaux lots y renvoient par identifiant au lieu de recopier les règles ; les textes antérieurs de ce plan restent en place.

| Ordre | Lot | IDs | Nature | Taille |
|---|---|---|---|---|
| 0 | Vérification production (lecture seule) | H-01, H-02, H-03 | Diagnostic | Petit |
| 1 | Verrouiller les rôles et les comptes — **corrigé et vérifié localement, non déployé** | F-01, F-02, F-03 | Sécurité | Petit |
| 2 | Verrouiller les colonnes et tables porteuses de droits — **corrigé et vérifié localement, non déployé** | F-04, F-05, F-06, F-11, F-17 | Sécurité | Moyen |
| 3 | Mettre à jour les dépendances vulnérables — **corrigé et vérifié localement, non déployé** | F-08, F-24 | Sécurité | Petit |
| 4 | Tests RLS négatifs en CI et durcissement CI/CD — **partie CI faite localement ; déploiement préparé et vérifié localement (lot 4b), non validé à distance** | F-20, F-21 | Qualité | Moyen |
| 5 | Typer les clients Supabase — **corrigé et vérifié localement, non déployé** | F-14 | Refactoring ciblé | Moyen |
| 5b | Droits d'écriture des entreprises — **corrigé et vérifié localement, non déployé** | F-41 | Sécurité | Petit |
| 6 | Publication et modération des offres — **corrigé et vérifié localement, non déployé** | F-09 | Fonctionnel et sécurité | Moyen |
| 7 | Sélection → mission → contrat → pointage — **7a, 7b, 7c, 7c-bis et 7d corrigés et vérifiés localement, non déployés** | F-07, F-10, F-16, F-30 | Fonctionnel et sécurité | Grand (4 sous-lots) |
| 8 | Hygiène auth, chatbot et journaux — **corrigé et vérifié localement, non déployé ; F-23 partiel** | F-12, F-13, F-15, F-23, H-04 | Sécurité | Petit à moyen |
| 9 | Retour utilisateur et textes — **corrigé et vérifié localement sur les parcours ciblés, non déployé ; F-19 et F-28 partiels** | F-18, F-19, F-28 | UX | Moyen |
| 9b | Retrait des niveaux Sandbox, réputation par les avis — **réalisé et vérifié localement, non déployé** | Décision produit du 2026-11-08 | Fonctionnel | Moyen |
| 9c | Réputation EasyJob en étoiles — **réalisé et vérifié localement, non déployé** | Décision produit du 2026-11-09 | Fonctionnel et confidentialité | Grand |
| 9d | Détail d'offre mobile, tâches et CNI en cours de validité — **réalisé et vérifié localement, non déployé** | Décision produit du 2026-11-10 | Fonctionnel et UX | Moyen |
| 10 | Documentation, consignes IA, nettoyage, journaux, CSP et fiabilité des preuves — **réalisé et vérifié localement, non déployé** | F-22, F-23, F-25, F-26, F-27, F-29, F-31 | Maintenance | Moyen |
| 11 | Dossier entreprise vérifié par EasyJob (RCCM, NIU, représentant) — **réalisé et vérifié localement, non déployé ; vérifications DGI et greffe réelles hors preuve** | Suite de F-41 (lots 5b, 6) ; décision produit du 2026-11-11 | Fonctionnel et sécurité | Grand |
| 11b | Échéances de candidature et de sélection, horaires figés après publication — **intégré à `origin/main-dev` (`f7b5259`), absent de `origin/main` ; déploiement distant non vérifié** ; compte rendu `AUDIT.md` §30 | Décision produit du 2026-11-11 | Fonctionnel et sécurité | Moyen |
| 12 | Offres de plusieurs journées (période complète, journées au choix) — **réalisé et vérifié localement, non déployé ; arbitrages produit signalés** | Décision produit du 2026-11-11 | Fonctionnel et sécurité | Grand |
| 13 | Contrat signé à la sélection — **intégré à `origin/main-dev` (`63bdaf6`), absent de `origin/main` ; déploiement distant non vérifié** ; `AUDIT.md` §32 | Décision produit (lot 13) | Fonctionnel et sécurité | Grand |
| 14 | Incidents de mission par journée — **intégré à `origin/main-dev` (`45d522e`), absent de `origin/main` ; déploiement distant non vérifié** ; `AUDIT.md` §33 | Décision produit (lot 14) | Fonctionnel | Grand |
| 14b | Contestations historiques réservées aux RPC admin — **intégré à `origin/main-dev` (`7bb5278`), absent de `origin/main` ; déploiement distant non vérifié** ; `AUDIT.md` §34 | Défaut constaté au lot 14 | Sécurité | Petit |
| 14c | Next.js 16.4.5 (GHSA-mfr8-8qww-v76h) — **intégré à `origin/main-dev` (`021c5e6`), absent de `origin/main` ; déploiement distant non vérifié** ; `AUDIT.md` §35 | Avis de sécurité | Sécurité | Petit |
| 15 | Fin de journée : code à l'heure de fin, confirmation par le support — **intégré à `origin/main-dev` (`78331c7`), absent de `origin/main` ; déploiement distant non vérifié** ; `AUDIT.md` §36 | Décision produit (lot 15) | Fonctionnel | Moyen |
| 16 | Journées contestées : instruction, double validation, révision interne — **intégré à `origin/main-dev` (`071f4b7`), absent de `origin/main` ; déploiement distant non vérifié** ; `AUDIT.md` §37 | Décision produit (lot 16) | Fonctionnel | Grand |
| — | Particuliers et professionnels non formalisés — **reporté (décision produit du 2026-11-11), non commencé** | — | Fonctionnel | À cadrer |
| 17 | Engagements et annulations — **17a, 17b–17c, 17d-0, 17d-1 et le correctif des horaires (§42) intégrés à `origin/main-dev` (`7bf9bf8`, constat Git du 2026-11-19), absents de `origin/main` ; déploiement distant non vérifié. plan entreprise effectif intégré à `origin/main-dev` (#60, `88e8a11`, constat Git du 2026-11-22) ; 17d-2 intégré à `origin/main-dev` (`6167235`, constat Git du 2026-11-23), absent de `origin/main` ; 17d-3 réalisé et vérifié localement, non commité (`AUDIT.md` §47)** (audit Free/Premium candidat : `AUDIT.md` §38 ; 17a : §39 ; 17b–17c : §40 ; 17d : §41 ; abonnements entreprise : §43 ; plan entreprise : §44 ; 17d-2 : §45 ; 17d-3 : §46, §47) | Dépendance du lot 9c | Fonctionnel | Grand (4 sous-lots) |

Constats Git (2026-11-18) : `origin/main-dev` = `071f4b7` (lots 11 à 16 intégrés) ; `origin/main` = `e536ee1` (v0.1.10), sans aucun de ces lots. **Déploiements distants non vérifiés** : ni la production ni les previews n'ont été observées. Des previews Vercel peuvent exister (`vercel.json` les conserve, lot 4b). Dans ce tableau et les statuts des lots, « non déployé » reprend l'état noté par chaque lot à sa clôture ; ce n'est pas une observation du projet distant.

---

## Lot 0 — Vérifier l'état de la production (lecture seule)

- **Objectif** : savoir si les failles P0 et P1 sont présentes **et** si elles ont déjà été exploitées, ce qui détermine l'urgence du lot 1 et un éventuel nettoyage de données.
- **IDs** : H-01, H-02, H-03.
- **Périmètre** : requêtes `SELECT` sur `pg_policies`, `pg_trigger` (y compris les triggers sur `auth.users` qui appellent `handle_new_user` : condition de sa suppression, lot 10), `cron.job`, `app_metadata.role` des comptes admin ; comptages sur `users` (par rôle), `candidate_profiles` (`sandbox_level` — **avant le déploiement du lot 9b**, qui supprime la colonne —, `premium_until`, `driving_license_verified`), `subscriptions` (`price = 0`), comptes admin sans téléphone.
- **Contrôles ajoutés par les lots suivants** (tous en lecture seule, avant le déploiement correspondant) :
  - **anciennes CNI vérifiées sans échéance** : `select count(*) from public.candidate_profiles where cni_verified = 'verified' and cni_expires_at is null;` — la règle de `candidate_cni_state` (lot 9d) les tient pour valides sans limite ; décider de les faire renouveler ou de poser une date ;
  - CNI refusées pour échéance dès la migration du lot 9d (requête du lot 9d ci-dessous) ;
  - `GET <projet>/auth/v1/settings` : `phone_autoconfirm: false` (lot 8, F-44) ;
  - `cron.job` contient `reputation-expiry-sweep` après la migration du lot 9c ;
  - comptes admin suspendus (`select id, role from public.users where role::text like 'admin_%' and is_active = false;`) : après la migration `20261110130000` du lot 10, ils perdent tout accès d'administration ; confirmer que c'est voulu pour chacun.
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

> **Statut (2026-11-01)** : réalisé sur `refactor/lot-05-supabase-types` (base `origin/main-dev`, de4ea66), **non commité**.
> - Clients typés ; 40 erreurs révélées corrigées, dont la modération, la création d'offre et le matching.
> - Onboarding entreprise réparé (`PUT /api/company/onboarding`, bucket `company-documents`).
> - `database.types.ts` racine supprimé.
> - Nouveau constat F-41 (auto-validation entreprise), à traiter dans un lot dédié.
>
> Détails : `AUDIT.md` §15.

- **Objectif** : que `tsc` détecte les tables et colonnes inexistantes.
- **IDs** : F-14 (et révélation probable d'autres défauts).
- **Périmètre** : `createBrowserClient<Database>` et `createServerClient<Database>` dans `lib/supabase/*`. Corriger les erreurs révélées **sans changer le comportement**, sauf l'onboarding entreprise (`companies` → `company_profiles`, avec les colonnes réelles, et suppression de `is_verified: true`). Supprimer `database.types.ts` à la racine.
- **Exclusions** : refactoring des pages au-delà des corrections de type.
- **Fichiers probables** : `lib/supabase/*.ts`, pages et routes qui utilisent `select("*")` ou des colonnes divergentes, `app/onboarding/company/page.tsx`.
- **Dépendances** : idéalement avant les lots 6 et 7, pour qu'ils en profitent.
- **Critères d'acceptation** : `tsc` vert avec clients typés ; l'onboarding entreprise enregistre réellement les informations, vérifié en local.
- **Risques** : nombre d'erreurs inconnu. Si le volume est élevé, découper par répertoire (`app/api`, puis `app/admin`, puis les pages).
- **Taille** : moyen.

## Lot 5b — Droits d'écriture des entreprises (F-41)

> **Statut (2026-11-01)** : réalisé sur `fix/lot-05b-company-permissions` (base `origin/main-dev`, 759f751), **non commité, non déployé**. Détails : `AUDIT.md` §16.
> - Privilèges de colonnes sur `company_profiles` : UPDATE limité aux 12 colonnes de l'onboarding, plus d'INSERT ni de DELETE en session.
> - Trigger fondé sur `current_user`, comme aux lots 1 et 2.
> - Décision produit : une entreprise vérifiée qui modifie son nom, son RCCM ou son document repasse en revue.
> - Preuve `company-permissions` ajoutée à `pnpm test:rls`.
>
> **Avant déploiement** :
> 1. Revue, puis PR vers `main-dev`.
> 2. Lot 0, en lecture seule : requête du §16 sur les validations et les plans existants.
> 3. Vérifier qu'aucun outil externe n'écrit `company_profiles` avec une clé `anon` ou un JWT utilisateur. Ces écritures sont désormais refusées.
>
> Reste ouvert : validation entreprise tracée (RPC ou interface admin, à cadrer), F-09 (lot 6), F-16 (lot 7a).

## Lot 6 — Publication et modération des offres

> **Statut (2026-11-01)** : réalisé sur `fix/lot-06-job-moderation` (base `origin/main-dev`, 737d02c, lot 5b intégré par la PR #54), **non commité, non déployé**. Détails : `AUDIT.md` §17.
> - Création, correction, modération et suppression par RPC (`create_job`, `update_job`, `moderate_job`, `delete_job`) ; plus aucune écriture directe en session sur `jobs`.
> - Valeurs canoniques : `pending_review` pour l'attente et `active` pour la publication ; leurs synonymes `pending_moderation` et `published` sont interdits par contrainte. Les autres statuts (`draft`, `rejected`, `filled`, `expired`, `cancelled`) restent valides avec leur sens.
> - Offre active modifiable seulement en plan Pro ou Business, avec nouvelle modération. Sources et écart avec le SRS : `AUDIT.md` §17.
> - Suppression refusée si l'offre a un candidat sélectionné, une mission, un contrat ou une pénalité d'annulation ; aucune annulation automatique (lot 7).
> - Preuve `job-moderation` ajoutée à `pnpm test:rls`.
>
> **Avant déploiement** : revue puis PR vers `main-dev` ; lot 0, en lecture seule, compter les offres `pending_moderation` et `published` reprises par la migration ; vérifier qu'aucun outil externe n'écrit ni ne supprime de lignes `jobs` avec une clé `anon` ou un JWT utilisateur.
>
> Reste ouvert :
> - validation administrative des entreprises, sans RPC, interface ni trace ;
> - F-16 (lot 7a) : une entreprise lit tous les profils entreprise ;
> - sélection → mission → contrat, annulation d'une offre engagée (lot 7) ;
> - champs du formulaire non enregistrés (catégorie, heures par semaine, avantages), à ressaisir lors d'une correction ;
> - arbitrage produit sur l'écart entre le verrouillage Free/Starter et la règle des 12 h du SRS §5.4.

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

À découper en quatre PR successives (7a à 7d). Avant de commencer, **confirmer avec le produit** les règles minimales du MVP (contrat simple ou formalisé, pause automatique, validation des heures). Ne pas tout implémenter d'un coup.

### 7a — Sélection atomique et visibilité des candidats

> **Statut (2026-11-06)** : réalisé sur `fix/lot-07a-candidate-selection` (base `origin/main-dev`, 92dfe16, lot 6 intégré), **non commité, non déployé**. Détails : `AUDIT.md` §18.
> - `select_candidate` : sélection, mission et contrat `pending`, notification, dans une transaction ; relance idempotente ; verrous candidature puis offre, comme `delete_job`.
> - Sélection et remise en cause d'une sélection interdites en session ; présélection, refus et retrait inchangés.
> - F-16 : politique supprimée ; candidats exposés par `company_job_applicants` (prénom, initiale, photo par route contrôlée) ; nom d'entreprise public par la vue `company_public_profiles`.
> - Preuve `candidate-selection` ajoutée à `pnpm test:rls`.
>
> **Avant déploiement** : lot 0, en lecture seule, la requête du §18 sur les sélections sans mission ni contrat, et la vérification d'unicité des missions et contrats par candidature (les index uniques échoueraient sinon).
>
> Reste ouvert après 7a : annulation d'une sélection (support, pénalités), signature (7b), pointage (7c), temps réel (7d).

- **IDs** : F-10 (partie sélection), F-16.
- **Périmètre** : RPC `select_candidate(application_id)` qui vérifie la propriété de l'offre, verrouille la ligne `jobs` (`FOR UPDATE`), contrôle les places, passe la candidature à `selected`, incrémente `positions_filled`, crée la `mission` et le `contract` en `pending`, puis notifie le candidat. Vue ou RPC qui expose aux entreprises les colonnes autorisées de leurs candidats (sans téléphone, email, CNI, MoMo ni coordonnées du domicile). Suppression de la politique erronée sur `company_profiles`.
- **Critères** : deux sélections concurrentes sur la dernière place produisent une seule réussite ; l'entreprise A ne lit pas l'entreprise B ; aucune donnée sensible du candidat n'est visible.

### 7b — Contrat

> **Statut (2026-11-06)** : réalisé sur `fix/lot-07b-contract-signing` (base `origin/main-dev`, b2f330a, lot 7a intégré), **non commité, non déployé**. Détails : `AUDIT.md` §19.
> - Signature par consentement explicite (SRS §11.8), sans image : `sign_contract` déduit la partie, horodate, vérifie l'empreinte présentée et calcule le statut ; relance idempotente.
> - `terms_hash` (SHA-256 des parties et des conditions figées) ; trigger d'immuabilité pour tous les rôles ; plus d'UPDATE en session ; SELECT limité aux colonnes non sensibles.
> - Écrans : contrat depuis la mission (candidat) et depuis la candidature sélectionnée (entreprise).
> - Preuve `contract-signing` ajoutée à `pnpm test:rls`.
>
> **Avant déploiement** : lot 0, en lecture seule, la requête de contrôle de la migration (signatures sans empreinte, statuts incohérents, data-URL).
>
> **Décision produit pour 7c** : conditionner ou non le démarrage de la mission à la double signature (SRS §6.7, US-CONT-02), sans bloquer le paiement d'une mission déjà effectuée.
>
> Reste ouvert : contenu légal complet et PDF, rappels et expiration (US-CONT-02), F-07 partie `missions` (7c).

- **IDs** : F-07 (partie contrat).
- **Périmètre** : RPC `sign_contract(contract_id)` qui détermine la partie depuis `auth.uid()`, horodate côté serveur, enregistre l'IP transmise par la route, applique des transitions strictes, stocke la signature dans Storage et non en data-URL dans une colonne, et calcule une empreinte de `contract_data`. Retrait de l'UPDATE direct.
- **Critères** : une signature unilatérale ne produit jamais `completed` ; `contract_data` n'est pas modifiable par une partie.

### 7c — Début de mission, code de fin et évaluations

> **Statut (2026-11-07)** : réalisé sur `fix/lot-07c-mission-time-tracking` (base `origin/main-dev`, 89c5466, lot 7b intégré), **non commité, non déployé**. Détails : `AUDIT.md` §20. La première version (pointage GPS, heures retenues, validation des heures) a été remplacée avant commit.
> - Mission rémunérée à la tâche : début dès H−15 (`start_mission`), fin confirmée par le code à six chiffres généré à la sélection et remis par l'entreprise (`submit_completion_code`, 5 essais puis 15 min de blocage). Aucune géolocalisation ; aucune validation des heures.
> - Tâches du candidat (`candidate_tasks`) : signer, commencer, valider le code, noter l'entreprise ; rappels sur la page ouverte ; heure de Douala.
> - Évaluations (`submit_mission_review`) : note de l'entreprise obligatoire, note du candidat facultative, une par sens ; étoiles recalculées par trigger.
> - Écritures directes fermées sur `missions`, `mission_check_ins`, `mission_completion_codes` et `reviews`. Preuve `mission-time-tracking` réécrite.
>
> **Avant déploiement** : lot 0, en lecture seule, les requêtes de contrôle de la migration (événements orphelins, missions écrites par une session, avis en double).
>
> Reste ouvert : notifications planifiées, blocage à 48 h faute de note, missions multi-jours, temps réel (7d), paiement. Montant par tâche : traité en 7c-bis.

- **IDs** : F-10 (partie suivi), F-07 (partie mission), F-30.
- **Périmètre** (révisé le 2026-11-07) : début de mission par RPC dès H−15, code de fin à six chiffres généré à la sélection et consommé par le candidat, tâches et rappels internes, évaluations dans les deux sens. Restriction des écritures sur `missions`, `mission_check_ins`, codes et `reviews`. Dates affichées en `Africa/Douala`. Sans géolocalisation ni validation des heures.
- **Critères** : un double clic ne crée ni deux débuts ni deux réalisations ; le code n'est lisible que par l'entreprise propriétaire ; les tentatives sont limitées en base ; une erreur est affichée à l'utilisateur ; l'entreprise ne modifie ni `payment_status` ni `platform_fee`.

### 7c-bis — Montant fixe par candidat pour la mission

> **Statut (2026-11-07)** : réalisé sur `feat/lot-07c-bis-task-compensation` (base `origin/main-dev`, 7963ac4, lot 7c intégré), **non commité, non déployé**. Détails : `AUDIT.md` §21.
> - `jobs.mission_pay_per_candidate` (entier XAF > 0, contrainte en base) remplace `hourly_rate` ; la colonne journalière inutilisée est supprimée ; devise XAF imposée.
> - Contrat : montant, `XAF` et `per_mission` figés par `select_candidate` et couverts par l'empreinte ; clauses v2 ; `get_mission` lit le contrat.
> - Migration bloquante si une offre existe (aucune conversion arbitraire).

- **Périmètre** : montant annoncé et montant accepté dans le contrat. Hors périmètre : versement Mobile Money, frais entreprise, abonnements, fourchette négociable, temps réel.
- **Critères** : 3 places à 10 000 F CFA ⇒ chaque contrat porte 10 000 XAF ; aucun calcul ne multiplie le forfait par la durée ou par le nombre de places ; un montant nul, négatif ou fractionnaire est refusé par la RPC comme par le formulaire.

### 7d — Temps réel (Realtime)

> **Statut (2026-11-08)** : réalisé sur `feat/lot-07d-app-realtime` (base `origin/main-dev`, 520b907, lot 7c-bis intégré), **non commité, non déployé**. Détails et matrice « changement → destinataires → écrans → test » : `AUDIT.md` §22.
> - Signal minimal `{d, r}` émis par trigger (18 tables) sur trois canaux privés autorisés par RLS (`user:<uid>`, `admin` sans identifiant, `jobs:public`) ; aucune émission possible depuis un client ; `missions` et `job_applications` retirées de `postgres_changes`.
> - Fournisseur client unique : une connexion par onglet, écrans abonnés par domaine, relecture regroupée, reprise complète à la reconnexion, au premier plan et au retour du réseau, purge au changement de compte.
> - Droits : suspension, rôle et plan revérifiés en base ; plan effectif à échéance (`company_effective_plan`, appliqué par `update_job`) ; `my_account_state` et minuterie sur l'heure du serveur.
> - Preuve `realtime` ajoutée à `pnpm test:rls` ; parcours navigateur sur écrans ouverts.
>
> **Avant déploiement** : vérifier en lecture seule la publication (`select tablename from pg_publication_tables where pubname = 'supabase_realtime';`, attendu : aucune ligne pour `missions` et `job_applications` après migration) et que l'autorisation Realtime des canaux privés est active sur le projet distant.
>
> **Dépendances manquantes (SRS)** : notifications push, SMS et e-mail ; tâches planifiées (rappels H−15 et fin prévue hors page ouverte, J−30 et J−7 des documents, expiration des offres 2 h avant, blocage à 48 h) ; parcours d'abonnement (activation, changement, renouvellement Mobile Money, régularisation sous 3 jours, essai Pro 14 jours, quotas d'offres actives) pour les lots Free/Premium et paiement ; favoris (`job_favorites`, `company_favorite_candidates`), modèles d'offre, alertes de disponibilité et litiges, sans écriture applicative aujourd'hui.

- **IDs** : suite de F-10 (retour immédiat des statuts de sélection, de contrat et de mission).
- **Périmètre** (élargi le 2026-11-08) : tous les parcours opérationnels dont un changement doit apparaître dans une autre session, un autre onglet ou un écran ouvert : comptes et droits, abonnements actuels, profils et vérifications, offres et candidatures, missions, contrats et évaluations, notifications. Reprise de l'état à la reconnexion, sans dépendre des événements manqués.
- **Critères** : une mise à jour apparaît entre deux sessions autorisées ; un tiers ne reçoit ni ne simule aucun événement ; après reconnexion, l'état affiché est celui de la base ; une action envoyée depuis un écran périmé est refusée par la base.

- **Hors lot 7** : abonnements payants, paiements, corrections exceptionnelles par le support (annulation d'une sélection, réparation d'une sélection sans mission) ; chacun à cadrer dans un lot distinct.
- **Exclusions du lot 7** : paiement Mobile Money réel (lot distinct à cadrer : fournisseur, webhooks signés, idempotence, rapprochement), sanctions automatiques, niveaux sandbox automatiques.
- **Dépendances** : lots 1, 2 et 6, lot 5 recommandé.
- **Risques / retour arrière** : changement de modèle d'écriture (du client vers la RPC). Procéder par sous-lot, avec migration réversible et pages adaptées dans la même PR.

## Lot 8 — Hygiène auth, chatbot et journaux

> **Statut (2026-11-08)** : réalisé sur `fix/lot-08-auth-chat-logs` (base `origin/main-dev`, 603da79, lot 7d intégré), **non commité, non déployé**. Détails : `AUDIT.md` §23.
> - H-04 confirmé puis corrigé : seul un code accepté par Supabase Auth pour le compte de la session vérifie le téléphone ; reprise après réponse perdue sur preuve serveur (ligne `users` déjà vérifiée, ou confirmation Auth postérieure au dernier envoi quand Auth exige un code). F-12 : plus aucun code, numéro, jeton ni réponse brute dans les journaux d'authentification.
> - F-13 : `next` réduit à un chemin interne (`safeInternalPath`), redirection construite sur l'origine, rôle d'inscription lu sur le chemin exact ; page `/auth/error`.
> - F-15 : session et compte actif exigés ; limites de taille, de messages et de rôles ; modèle, instructions et budget imposés par le serveur ; quota par compte et par IP fiable, atomique en base (`consume_chat_quota`) ; prompt aligné sur les parcours livrés. Paramètres : `docs/chatbot.md`.
> - F-23 (partiel) : journal JSON sûr (`lib/observability/server-log.ts`) et réponses 500 génériques avec code et identifiant de requête sur les routes d'auth, de chat, `app/api/jobs/**`, `categories` et `user`.
> - Preuves `phone-verification`, `oauth-callback` et `chat-quota` ajoutées à `pnpm test:rls`.
>
> **Avant déploiement** : en lecture seule, `GET <projet>/auth/v1/settings` doit renvoyer `phone_autoconfirm: false` (confirmations SMS actives), sinon aucun numéro réel ne peut être vérifié (refus par défaut) ; ajouter `AI_GATEWAY_API_KEY` (ou activer l'OIDC Vercel) ; ne pas définir `EASYBOT_GATEWAY_URL` ; appliquer la migration `20261108120000_chat_quota.sql`.
>
> Reste ouvert : F-23 sur les autres routes (admin, profil, paiements, `[v0]`), absence d'outil de capture d'erreurs ; vérifications dépendant d'un fournisseur réel (SMS Twilio, Google, passerelle IA) : `AUDIT.md` §23.

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

> **Statut (2026-11-08)** : réalisé sur `fix/lot-09-user-feedback-i18n` (base `origin/main-dev`, 361cb26, lot 8 intégré), **non commité, non déployé**. Détails, affirmations vérifiées et points ouverts : `AUDIT.md` §24.
> - Connexion : retour vers la page protégée d'origine (`next`, validation du lot 8) ; plus aucune redirection vers `/login`.
> - Candidature : refus de `/apply` traduits par code avec l'étape suivante ; état réel de la candidature ; retrait depuis le détail d'offre.
> - Mes jobs : « aucune candidature en cours » distinct de « jamais postulé », historique, dernier état conservé et « Réessayer » en cas de coupure.
> - Entreprise : `company_premium` accède au tableau de bord ; liens morts corrigés ; messages de sélection, de refus et de modération avec l'étape suivante.
> - Promesses retirées : paiement sous 48 h, séquestre, retrait Mobile Money, remplacement garanti, IA, essai gratuit, hors ligne, compteurs sans source ; écran des gains limité aux montants des contrats.
> - Tests : `login-redirect`, `application-feedback`, `my-jobs`, `user-facing-claims` (promesses et liens internes), `company-role`, toast avec action ; essai navigateur 375 px FR/EN (script local hors dépôt).
>
> **Décisions produit attendues** : affichage des avantages d'abonnement non livrés (lot Free/Premium) ; mention « bientôt disponible » éventuelle ; renouvellement d'une candidature retirée ; ~~progression Sandbox annoncée sur l'accueil~~ (tranché le 2026-11-08 : niveaux retirés, lot 9b).

- **IDs** : F-18, F-19, F-28.
- **Périmètre** : ~~remplacer `hooks/use-toast.ts` par un vrai composant (accessible, `aria-live`)~~ (fait au lot 2b, `AUDIT.md` §11 ; reste : textes des toasts en i18n), corriger `/login` en `/auth/login`, retirer ou marquer « bientôt disponible » les promesses non livrées (paiement 48 h, séquestre, remplacement garanti, IA, essai gratuit), passer les pages touchées par les lots 6 et 7 sur le dictionnaire i18n.
- **Exclusions** : refonte visuelle.
- **Dépendances** : à coordonner avec les lots 6 et 7 pour ne pas réécrire deux fois les mêmes pages. La partie « textes » peut partir tout de suite.
- **Critères d'acceptation** : chaque erreur des parcours mission, contrat et offres est visible ; une relecture produit valide que chaque promesse correspond à une fonction livrée ; contrôle manuel à 375 px sur Android et iOS.
- **Taille** : moyen.

## Lot 9b — Retrait des niveaux Sandbox

> **Statut (2026-11-08)** : réalisé sur `refactor/lot-09b-remove-sandbox-levels` (base `origin/main-dev`, 0db9384, lot 9 intégré), **non commité, non déployé**. Détails, preuves et limites : `AUDIT.md` §25.

- **Décision produit** : les étoiles des évaluations de missions sont le seul indicateur de réputation affiché (« 4,5/5 · 2 avis » ou « Pas encore d'avis ») ; un compte sans avis peut postuler à sa première mission.
- **Périmètre** : migration `20261108130000_remove_sandbox_levels.sql` (critère retiré de `apply_to_job`, `company_job_applicants` avec note et nombre d'avis, ancien champ refusé par `create_job` et `update_job`, `review_count` tenu par le trigger d'évaluation, colonnes Sandbox et `sandbox_config` supprimées) ; badges, widget, refus, matching, accueil et fiche admin ; « score de fiabilité » retiré des indicateurs publics.
- **Exclusions** : seuil d'étoiles pour postuler, classement par la note, conversion des anciens niveaux ; compteurs `completed_missions` et `total_missions` (jamais incrémentés).
- **Dépendances** : comptage H-02 du lot 0 sur `sandbox_level` à faire avant le déploiement.
- **Critères d'acceptation** : upgrade depuis l'état du lot 9 (candidat sans avis accepté sur une offre de niveau élevé, refus du permis conservé, note existante conservée, premier avis compté une seule fois) ; `pnpm test:rls`, tests unitaires, typage, lint, formatage et build verts ; contrôle à 375 px en FR et EN.
- **Taille** : moyen.

## Lot 9c — Réputation EasyJob en étoiles

> **Statut (2026-11-09)** : réalisé sur `feat/lot-09c-reputation-stars` (base `origin/main-dev`, 8195e4c, lot 9b intégré), **non commité, non déployé**. Règles, preuves et limites : `AUDIT.md` §26.

- **Périmètre** : migration `20261109120000_reputation_stars.sql` (score de 0 à 5 par demi-étoiles, rejeu déterministe, avis privés, motifs, contestation auditée, échéances des justificatifs et de la CNI par pg_cron) ; étoiles seules pour les tiers ; progression privée, notifications et animations ; fiches admin candidat et entreprise.
> **Avant déploiement** : vérifier que l'extension pg_cron est activée sur le projet et, après la migration, que `cron.job` contient `reputation-expiry-sweep` (`*/15 * * * *`) ; sinon la migration journalise « pg_cron non activé » et la tâche doit être planifiée à la main. Surveiller le premier passage (rappels J−30 et J−7 en cours, aucun historique au-delà de J−1).

- **Exclusions** : production des décisions de manquement (futur lot « Engagements et annulations ») ; règles et délais de versement liés aux étoiles (lot paiement, « Hors plan ») ; formulaire de contestation dans l'application.
- **Décisions ouvertes** :
  - conditions des manquements (futur lot « Engagements et annulations ») ;
  - ~~CNI expirée et candidature : décision produit à confirmer au lot 9d.~~ Tranché le 2026-11-10 (lot 9d).
- **Critères d'acceptation** : `pnpm test:rls` complet (dont `reputation`), montée de version depuis le lot 9b sans notification, contrôle à 375 px en FR et EN.

## Lot 9d — Détail d'offre mobile, tâches et CNI en cours de validité

> **Statut (2026-11-10)** : réalisé sur `fix/lot-09d-offer-details-candidate-tasks` (base `origin/main-dev`, e6729f4, lot 9c intégré), **non commité, non déployé**. Règles, preuves et limites : `AUDIT.md` §27.

- **Décision produit (2026-11-10)** : toute nouvelle candidature exige une CNI vérifiée et en cours de validité, quelle que soit l'offre (contrôle en base dans `apply_to_job`, refus `cni_expired` en 403). L'accès reprend à l'approbation d'une pièce valide ; étoiles acquises conservées.
- **Périmètre** : migration `20261110120000_cni_validity_candidate_tasks.sql` (état de la CNI, renouvellement des photos d'une CNI expirée, approbation avec une date valide, complétude conservée pendant le renouvellement, tâches `candidate_action_tasks`, offres mémorisées après un refus documentaire) ; refus menant à la tâche précise ; point rouge de l'onglet Tâches ; détail d'offre candidat et entreprise réorganisé ; option « urgente » retirée, badge calculé à 24 h.
- **Exclusions** : frais de publication urgente et mise en avant (lot commercial) ; écrans entreprise hors détail (ancienne valeur `urgency`).
> **Avant déploiement** : compter en lecture seule les CNI refusées pour échéance, avec la règle de la candidature (`select count(*) as refusees, count(*) filter (where cni_verified = 'verified') as expirees, count(*) filter (where cni_verified <> 'verified') as en_renouvellement from public.candidate_profiles where cni_expires_at is not null and cni_expires_at::timestamp at time zone 'UTC' < now();`, exactitude vérifiée par la preuve `reputation` I15) : ces candidats seront refusés dès la migration et devront renouveler leur CNI (beaucoup d'approbations antérieures portent la date par défaut « naissance + 10 ans »). Prévenir le support.
- **Critères d'acceptation** : `pnpm test:rls` complet (dont `reputation` I4 à I14 et `admin-cni` D1a), tests unitaires, typage, lint, formatage et build verts ; contrôle à 375 px en FR et EN.

## Lot 10 — Documentation, consignes, nettoyage, journaux, CSP et fiabilité des preuves

> **Statut (2026-11-10)** : réalisé sur `chore/lot-10-maintenance-docs` (base `origin/main-dev`, 31b6c55, lot 9d intégré), **non commité, non déployé**. Aucune migration. Détails, statut de chaque constat et limites : `AUDIT.md` §28.
> - F-22 : README court (démarrage Windows, cible de chaque base, `pnpm env:target`) ; `AGENTS.md` source unique, consignes Copilot et agents réduits à leur domaine, chemins vérifiés.
> - Parcours nouvel arrivant vérifié dans une copie isolée : `bootstrap:local` (étape de types obsolète retirée, sauvegarde de `.env.local` distant), seed honnête et rejouable avec comptes utilisables, commandes PowerShell corrigées.
> - F-27 : Mobile Money mort, `/api/payments/withdraw`, `public/manifest.json`, `next-intl`, `ts-node`, exports morts supprimés ; `handle_new_user()` conservée jusqu'au lot 0. F-26 déjà résolu (lot 7c-bis). F-29 clos.
> - F-23 : toutes les routes passent par le journal structuré ; F-25 : CSP en Report-Only et `/api/csp-report` ; F-31 : `requireAdminPage()` sur les pages admin en clé service ; admin suspendu privé de son grade en base (`is_admin_user`, `is_ops_admin_user`, deux politiques) et dans les routes et pages, prouvé par `admin-centralization` I et `realtime` B5b-B5c.
> - Preuves : échec borné (requêtes SQL et preuves), étape indiquée, processus arrêtés, restes d'une preuve interrompue retirés et protections réactivées au démarrage ; panne reproduite et testée.
>
> **Avant déploiement** : migration `20261110130000_suspended_admin_guard.sql` (compter d'abord les admins suspendus, lot 0) ; vérifier les rapports `security.csp_report` après la mise en ligne (`docs/deployment/production.md` §7).
>
> Reste ouvert : passage de la CSP en mode appliqué (après `z.config({ jitless: true })` côté client), outil de capture d'erreurs, bouton Google non monté (décision produit), F-37.

## Lot 11 — Dossier entreprise vérifié par EasyJob

> **Statut (2026-11-11)** : réalisé sur `feat/lot-11-company-verification` (base `origin/main-dev`, 1e63198), **non commité, non déployé**. Détails, droits appliqués, résultats et limites : `AUDIT.md` §29 ; règle produit : SRS §6.3.1.
> - Décision produit : au lancement, seules les entreprises au dossier vérifié publient. Dossier : RCCM (numéro, document), NIU (numéro, attestation), représentant (identité, pièce d'identité, habilitation : dirigeant mentionné ou mandat).
> - Migration `20261111120000_company_verification_review.sql` : pièces et représentant dans `company_profiles`, versions par élément (`rccm_revision`, `niu_revision`, `representative_revision`) et du dossier, historique en ajout seul `company_verification_checks` (auteur, date, source, référence interne, motif), trigger du lot 5b étendu à tout auteur, RPC `admin_record_company_check`, `admin_review_company`, `submit_company_verification`, `my_company_verification` ; `create_job`, `update_job` et `moderate_job` relisent `company_verification_complete()`.
> - Écrans : trois contrôles séparés sur la fiche admin, aperçu masqué et décisions bloquées si le dossier change ; carte d'état côté entreprise (pièces manquantes, contrôles, motifs, action) sur le tableau de bord, le profil, l'onboarding et dès l'entrée de la création d'offre ; libellé « Dossier vérifié par EasyJob ».
> - Preuve `company-verification` (36 assertions), contrôles négatifs, fixture `scripts/lib/verified-company.ts` pour les preuves qui publient, parcours navigateur en deux sessions (FR/EN, 375 px).
> - Décision du 2026-11-11 appliquée (migration `20261111130000_company_dossier_visibility.sql`) : dossier non valide → offres actives masquées aux nouveaux candidats (liste, détail, lien direct, lecture directe), nouvelles candidatures et sélections refusées en base, candidatures, contrats, missions et avis existants conservés, statut des offres inchangé ; dépendances entre contrôles étendues (identité de l'entreprise → trois contrôles). Preuve `company-dossier-visibility` (19 assertions, courses à ordre imposé) ; `job-moderation` I9 fiabilisée par synchronisation explicite (`scripts/lib/proof-barrier.ts`).
>
> **Avant déploiement** (lecture seule, lot 0) — dossiers touchés par la reprise : toute entreprise `verified` repasse en attente non soumise et `niu_verified` repasse à false (état précédent dans `audit_logs`). Compter d'abord :
> `select verification_status, niu_verified, onboarding_status, count(*) from public.company_profiles group by 1, 2, 3;`
> et les offres actives de ces entreprises : `select count(*) from public.jobs j join public.company_profiles cp on cp.id = j.company_id where cp.verification_status = 'verified' and j.status = 'active';`. Prévenir les entreprises concernées (pièces à ajouter) et le support.
>
> **Décisions prises (2026-11-11)** : retour automatique des offres encore admissibles après validation complète, sans nouvelle modération si leur contenu approuvé n'a pas changé (vérifié : preuve B1-B7, navigateur) ; correction du NIU réservée au support ; source officielle inaccessible → dossier en attente, aucune approbation automatique.
>
> **Reste à cadrer** (AUDIT.md §29) : procédure de relance quand la DGI ou le greffe restent inaccessibles ; conservation des pièces avant l'ouverture publique. L'expiration des offres datées est traitée par le lot 11b.

## Lot 11b — Échéances de candidature et de sélection

> **Statut (2026-11-11)** : réalisé sur `fix/lot-11b-job-deadlines` (base `origin/main-dev`, 891ef2b), **non commité, non déployé**. Détails, résultats et limites : `AUDIT.md` §30 ; règle produit : SRS §5.4.
> - Décisions produit validées : régime normal → candidatures et sélections avant H−24 ; régime urgent → avant H−2 ; refus à l'instant exact ; publication urgente entre moins de 24 h et 4 h avant le début ; publication à exactement H−24 refusée ; badge « Urgente » sans effet sur l'échéance ; aucun frais ni avantage d'abonnement.
> - Migration `20261112120000_job_recruitment_deadlines.sql` : première publication, régime et échéance **figés** à la première publication par un trigger (tout auteur, clé service comprise), jamais recalculés ; **règle de lancement** : dates et horaires figés après la première publication (`job_schedule_locked`, trigger et `update_job`, mêmes valeurs acceptées) ; `apply_to_job` et `select_candidate` refusent `recruitment_closed` (après la relance idempotente) ; `create_job` et `moderate_job` refusent `job_start_too_close` à la première publication ; `job_availability` → `closed` ; champ calculé `recruitment_open` ; offres antérieures marquées `legacy_publication` (closes, dates figées, aucune date inventée).
> - Écrans FR/EN : retrait de la liste, avis et « Voir les autres offres » sur le détail, « Sélectionner » remplacé côté entreprise, à l'échéance sans rechargement ; formulaire de correction avec date et horaires en lecture seule après publication et lien « Créer une nouvelle offre ».
> - Preuve `job-deadlines` (35 assertions, limites exactes à la microseconde, contrôles négatifs) ; preuves existantes adaptées ; parcours navigateur des échéances et du formulaire.
>
> **Avant déploiement** (lecture seule) : compter les offres qui seront marquées `legacy_publication` et resteront closes : `select status, count(*) from public.jobs where status in ('active', 'filled', 'expired', 'cancelled') or published_at is not null group by 1;` (plus les offres en attente déjà approuvées une fois, tracées dans `audit_logs`).
>
> **Règle de lancement à réexaminer** (sans retirer ces lots du plan) : horaires figés après publication, dans le lot « Engagements et annulations » (qui remplace aussi la règle historique SRS « modification jusqu'à 12 h avant le début »). Lot 12 : règle étendue au calendrier entier (ajout et retrait de journées compris).

## Lot 12 — Offres de plusieurs journées

> **Statut (2026-11-11)** : réalisé sur `feat/lot-12-multi-day-jobs` (base `origin/main-dev`, 0a1f381, lot 11b intégré par la PR #56), **non commité, non déployé**. Détails, résultats et limites : `AUDIT.md` §31 ; règles produit : SRS §5.4, §6.6 à §6.8.
> - Dates choisies une à une (1 à 31), horaires communs ou par journée, journée de nuit sur deux dates, aperçu avant envoi ; parcours d'une journée conservé ; catégorie réelle enregistrée et préremplie.
> - **Période complète** : une candidature, un contrat et une mission globale, un montant fixe pour toute la période (jamais divisé), un code par journée et par candidat, réalisation à la dernière journée confirmée. **Journées au choix** : montant et places par journée, candidature tout ou rien sur une ou plusieurs journées, candidature ultérieure aux autres journées, une mission, un contrat et un code par journée.
> - Échéances du lot 11b : premier début (période) ou chaque journée (au choix), fixées à la première publication ; refus de toute l'offre si une journée n'est plus publiable, journées nommées ; calendrier figé après publication pour tout auteur.
> - Sélection sous verrou : places par journée ; conflits d'engagements du candidat (chevauchement ou moins de 3 h, 3 h admis) sous verrou consultatif propre au candidat, sans détail révélé à l'entreprise.
> - Réputation sans double comptage : candidat +1 par mission réalisée, entreprise +1 par offre.
> - Migration `20261113120000_multi_day_jobs.sql` ; preuve `multi-day-jobs` (67 assertions, dont la réputation entreprise, les choix confirmés et le conflit expliqué avant l'envoi) ajoutée à `pnpm test:rls` ; preuves existantes adaptées (dates distinctes : un même candidat ne tient plus deux engagements au même créneau).
>
> **Avant déploiement** (lecture seule) : compter les offres à intervalle, qui ne recevront aucune journée (requête dans `AUDIT.md` §31) ; prévenir les entreprises dont une offre en attente devra être ressaisie, et le support (offres publiées à intervalle : closes depuis le lot 11b, engagements conservés).
>
> **Décision validée (2026-11-11), appliquée** : réputation entreprise : +1 par offre, une seule fois, quand une réalisation au moins est confirmée par code, tous les engagements sont résolus et le recrutement est clos par son échéance ; sans travail, rien ; sanctions indépendantes ; recalcul à l'échéance par la tâche planifiée existante (`AUDIT.md` §31). Seul le travail confirmé est aujourd'hui une résolution : les statuts `no_show` et `cancelled` ne le sont plus.
>
> **Choix confirmés (2026-11-11)**, détail et preuves dans `AUDIT.md` §31 :
> - contrat formalisé dès trois journées prévues dans le même contrat (période complète de trois journées non consécutives comprise ; trois missions journalières indépendantes restent trois contrats simples distincts) — convention produit, sans validation juridique ;
> - 31 journées travaillées au plus par offre (pas une limite de 31 jours calendaires) ;
> - conflits détectés dès la candidature, sur les seuls engagements déjà sélectionnés et avec la marge de 3 h ; les candidatures en attente ne bloquent rien ; contrôle définitif à la sélection, sous verrou.
>
> **Blocage confirmé (2026-11-12)** : les journées incompatibles sont refusées à la candidature, et le conflit est expliqué avant l'envoi (compatibilité calculée par la base, journées incompatibles visibles mais non cochables, période complète désactivée, relecture en temps réel, lecture en échec jamais tenue pour « disponible ») ; le refus en base reste pour un écran périmé (`AUDIT.md` §31).
>
> **Limites conservées** :
> - recalcul planifié de la réputation toutes les 15 minutes (pg_cron) ; passage réel de pg_cron non observé dans la validation (fonction de balayage appelée par la preuve) ; à vérifier après déploiement (`cron.job`, premier passage) ;
> - `tests/proof-db-query.test.ts` (lot 10) intermittent sous charge : 4 échecs sur 25 ; cause de la forme `isAlive` inconnue ; **correction suivie en maintenance**, sans relance ni délai allongé ;
> - absences, remboursements et situations partielles : lots « Engagements et annulations » et paiement ; aucune résolution présumée.

- **Dépendances** : lot 11b (échéances, horaires figés) ; lot 7 (sélection, contrat, codes) ; lot 9c (réputation).
- **Hors lot** : signalement d'une journée non confirmée, absence, contestation, remplacement, sanction, remboursement (lot « Engagements et annulations ») ; résolution « absence validée avec remboursement effectivement confirmé » de la règle de réputation entreprise (lots « Engagements et annulations » et paiement) ; signature de l'entreprise avant sélection (lot 13) ; correction encadrée des horaires (lot dédié).

> **Correctif (2026-11-24, `AUDIT.md` §42)** : sur `fix/job-form-day-schedules` (au-dessus de 17d, `d346aeb`, non intégré à `origin/main-dev`), **non commité**. Cause : horaires par journée bien enregistrés, mais choix présenté par une case cochée par défaut sous la liste, retour aux horaires communs sans confirmation, et résumés (modération, cartes d'offre) affichant les horaires de la première journée comme ceux de toute l'offre. Correction : choix explicite à deux options, horaires communs repris au passage par journée, confirmation avant écrasement, résumé « Horaires selon les journées » ; aucune règle ni SQL modifiés.

## Lot 13 — Contrat signé à la sélection

> **Statut (2026-11-16)** : réalisé sur `feat/lot-13-contracts-selection` (base `origin/main-dev`, 83ace11, lot 12 intégré), **non commité, non déployé**. Détails, résultats et limites : `AUDIT.md` §32 ; règles produit : SRS §6.6 et §6.7.
> - Depuis une candidature, l'entreprise lit le **contrat proposé** (candidat, journées, horaires, montant XAF, clauses exactes) et le signe par « **Signer et sélectionner** » ; fermer l'aperçu ne laisse rien.
> - En base (`contract_selection_preview`, `sign_and_select` / `sign_and_select_observed`) : mêmes verrous et contrôles que la sélection des lots 7a à 12, comparaison de l'empreinte de la proposition, puis sélection, mission, journées, codes, contrat, signature de l'entreprise et notification dans une transaction ; conditions changées → `terms_mismatch`, rien n'est écrit ; relance → résultat d'origine. `select_candidate` est supprimée.
> - Candidat : « Signer mon contrat » dans *Tâches* dès la sélection, mission possible avant signature, tâche retirée de tous ses écrans à sa signature ; mention de signature distincte de l'état de la mission.
> - Confidentialité : chaque partie ne voit que sa propre signature (écrans, API, notifications, Realtime, PDF) ; colonnes de statut et d'horodatage de signature illisibles en session.
> - PDF du contrat (`/api/contracts/[id]/pdf`, FR/EN) produit sans dépendance depuis les conditions figées ; période complète : un contrat ; journées au choix : un contrat par journée.
> - Présélection retirée des écrans et des écritures ; anciennes présélections affichées et traitées comme en attente (sélection, refus, retrait), statut conservé.
> - Migration `20261116120000_contract_selection.sql` ; preuve `contract-selection` ajoutée à `pnpm test:rls` ; preuves existantes passées par l'aperçu signé (`scripts/lib/sign-and-select.ts`).
>
> **Limites** : voir `AUDIT.md` §32 (détail des signatures lisible par le support en clé service seulement, aucun écran admin ; PDF à polices standard, sans signature graphique ni identité civile ; contenu légal du contrat formalisé toujours à valider, SRS §11.1).

- **Dépendances** : lots 7a et 7b (sélection, empreinte, clauses figées), 7d (signaux), 11 et 11b (dossier, échéances), 12 (journées, conflits de 3 h).

## Lot 14 — Incidents de mission par journée

> **Statut (2026-11-17)** : réalisé sur `feat/lot-14-mission-incidents` (base `origin/main-dev`, 63bdaf6, lot 13 intégré), **non commité, non déployé**. Détails, résultats et limites : `AUDIT.md` §33 ; règles produit : SRS §6.8.
> - Candidat (Tâches, détail de mission) : retard, absence prévenue, code de fin non remis ; entreprise (journée du candidat) : retard, absence. Mission et date affichées avant l'envoi.
> - Dossier par journée : fait déclaré, versions des deux parties, justificatifs privés (support seulement ; l'autre partie n'en voit que le nombre), décision motivée du support (`admin_ops`, `admin_founder`), tracée dans `audit_logs`, notifiée, signaux privés `incidents`.
> - Règle par journée : journée confirmée par code → ni absence ni code non remis ; retard toujours signalable ; un code accepté un autre jour n'empêche rien ; absence ou code non remis encore ouverts → clos si la journée est confirmée ensuite. Double envoi → même signalement.
> - **Aucune conséquence** : ni sanction (`reputation_incidents` non écrite), ni annulation, remplacement, remboursement, indemnité ou paiement ; journée, autres journées, contrat et réputation (règle du lot 12) inchangés.
> - Migration `20261117120000_mission_incidents.sql` ; preuve `mission-incidents` ajoutée à `pnpm test:rls`.
>
> **Décision métier à prendre avant d'aller plus loin (code non remis)** : le support peut aujourd'hui instruire et déclarer le travail « établi », sans effet. Confirmer la journée **au nom de l'entreprise** serait un nouveau pouvoir : qui l'exerce (grade), sur quelles preuves minimales, dans quel délai, avec quelle information de l'entreprise et quel recours ; effet sur la mission globale, le forfait, la réputation (+1 mission, +1 offre) et le futur paiement. Rien n'est introduit tant que cette décision n'est pas prise.
>
> **Arbitrée pour un cas au lot 15** : confirmation de la journée par `admin_ops` ou `admin_founder` actif quand l'entreprise confirme explicitement le travail au support (voir « Lot 15 »). Entreprise injoignable ou travail contesté : toujours ouvert (SRS §11.12).

- **Dépendances** : lots 7c et 12 (journées, codes), 9c (grades et contestations, `audit_logs`), 7d (signaux privés), 13 (contrats inchangés).
- **Hors lot** : barèmes de sanction, annulations, remplacements, remboursements et indemnités (lot « Engagements et annulations », à arbitrer ensemble) ; formulaire public de contestation.

## Lot 14b — Contestations historiques : création réservée aux RPC admin

> **Statut (2026-11-18)** : réalisé sur `fix/lot-14b-disputes-permissions` (base `origin/main-dev`, 45d522e, lot 14 intégré), **non commité, non déployé**. Détail : `AUDIT.md` §34.
> - Défaut reproduit : un compte étranger à une mission y créait une contestation (`public.disputes`) lisible par les parties ; la partie et le support en créaient aussi (le support au nom d'un autre), et le support réécrivait une ligne (autre mission, clôture) sans audit.
> - Correctif (migration `20261118120000_disputes_permissions.sql`) : privilèges d'écriture retirés aux sessions (`authenticated` garde SELECT, `anon` rien), politiques INSERT et UPDATE supprimées, trigger refusant toute écriture de session ; table et historique conservés ; écriture légitime inchangée (RPC admin des contestations d'avis).
> - Preuve : `mission-incidents` H1 à H4 ; régression détectée par les deux contrôles négatifs.

## Lot 14c — Dépendances : Next.js 16.4.5

> **Statut (2026-11-17)** : réalisé sur `fix/lot-14c-next-security` (base `origin/main-dev`, 7bb5278, lot 14b intégré), **non commité, non déployé**. Détail : `AUDIT.md` §35.
> - `next` et `eslint-config-next` : 16.4.3 → **16.4.5** (première version corrigée de GHSA-mfr8-8qww-v76h, moderate ; aucun avis publié depuis n'affecte 16.4.5 ; 16.4.6 sans correctif de sécurité, non retenue). Lockfile limité aux paquets `next` / `@next/*` et à cinq doublons transitifs retirés ; `--frozen-lockfile` ✅.
> - `pnpm audit --prod` : GHSA-mfr8-8qww-v76h disparu, aucun nouvel avis ; reste GHSA-866g-f22w-33x8 (low, `@ai-sdk/provider-utils`, hors périmètre). Avertissement de sécurité du build disparu.
> - Validation : typage, lint, formatage, 558 tests, build ; sur `easyjob-proof` (build de production) : `oauth-callback`, `admin-centralization`, `contract-selection`, `essentials-gate` ✅ et 13/13 vérifications navigateur (retour après connexion, refus de `/admin` au candidat). Suite RLS complète laissée à la CI.

## Lot 15 — Fin de journée : code à l'heure de fin et confirmation par le support

> **Statut (2026-11-17)** : réalisé sur `feat/lot-15-mission-completion` (base `origin/main-dev`, 021c5e6, lot 14c intégré), **non commité, non déployé**. Détails, résultats et limites : `AUDIT.md` §36 ; règles produit : SRS §6.8 et §11.12.
> - **Échéance** : le code d'une journée n'est reçu qu'à sa fin prévue (horaire figé, heure de la base, Africa/Douala ; 22 h → 6 h : 6 h le lendemain). Envoi anticipé, même avec le bon code : refusé avant toute lecture du code (code, essais, blocage et réalisation intacts). *Tâches* et le détail de la mission affichent « Valider ma journée » à l'heure dite sur un écran déjà ouvert (minuterie partagée `useDeadlineNow`, extraite de celle du lot 11b ; relecture à la reconnexion inchangée).
> - **Code non remis** : « Contacter le support » à la même échéance, depuis la tâche ou le détail ; dossier du lot 14 de la journée, retrouvé en cas de relance ; même règle en appel direct (début confirmé, fin atteinte). Retard et absence inchangés.
> - **Instruction** : contacts du support avec l'entreprise (`mission_incident_contacts`) : date, canal, demande (envoyée, sans réponse, injoignable) distincte de la réponse obtenue (travail confirmé, contesté, autre), référence privée, note interne ; tout admin actif ; support seulement.
> - **Confirmation manuelle** (`admin_confirm_mission_day`) : ops ou fondateur actif, sur une réponse « travail confirmé » consignée sur le dossier ; provenance `support` de la journée (`mission_days.completion_source`), code jamais consommé ; décision liée au candidat, à la journée et au dossier (`mission_day_confirmations`, motif interne) ; réalisation, décision, audit et notifications dans une transaction. Décision générique refusée sur un « code non remis » (`use_day_confirmation`).
> - **Une seule réalisation** : verrous mission puis journée dans les deux voies ; la seconde opération retrouve le résultat acquis (prouvé dans les deux ordres).
> - **Effets** : journée confirmée par le support = travail effectué (mission, évaluation, réputation candidat et entreprise selon le lot 12, une fois) ; aucun paiement, remboursement ni retrait d'étoiles. Mentions « confirmée par code » des écrans, du SRS et des règles de réputation alignées.
> - Migration `20261119120000_mission_day_completion.sql` ; preuve `mission-completion` (27 assertions) ajoutée à `pnpm test:rls` ; `mission-incidents`, `mission-time-tracking`, `multi-day-jobs` et `reputation` adaptées (journées terminées avant la saisie du code ; fixtures de réalisation portées par la journée).
>
> **Décision ouverte** : entreprise injoignable ou travail contesté (preuves suffisantes, délai, recours, effet sur la réputation et le versement) — SRS §11.12. **Traitée au lot 16** (instruction, délais, double validation, révision interne).

- **Dépendances** : lots 12 (journées, réputation), 14 (signalements, grades), 7d (signaux), 11b (minuterie des échéances).
- **Hors lot** : issue des cas injoignable ou contesté ; effet sur le versement (lot paiement) ; sanctions (lot « Engagements et annulations »).

## Lot 16 — Journées contestées : instruction, double validation et révision interne

> **Statut (2026-11-17)** : réalisé sur `feat/lot-16-completion-disputes` (base `origin/main-dev`, 78331c7, lot 15 intégré), **non commité, non déployé**. Détails, résultats et limites : `AUDIT.md` §37 ; règles produit : SRS §6.8 (encadré « Lot 16 »), §11.12 et §11.13.
> - **Instruction** par journée sur les dossiers des lots 14 et 15 : versions et justificatifs des deux parties ; situation qualifiée par le support (entreprise injoignable, présence ou réalisation contestée, travail partiel, qualité contestée, retard ou comportement) ; compléments demandés à une partie et réponses ; contacts (demande distincte de la réponse obtenue, canal vérifié) ; notes internes.
> - **Délais** depuis l'ouverture (heure de la base) : notification initiale, relance dans l'application à 24 h, examen renforcé à 48 h avec second canal vérifié à consigner ; prolongation motivée et historisée ; balayage idempotent rattaché à la tâche planifiée existante (`reputation-expiry-sweep`) ; le silence ne confirme jamais rien ; aucune notification externe annoncée.
> - **Double validation** : proposition d'un `admin_ops`/`admin_founder` actif sur une version du dossier, décision par un autre ; conflit d'intérêts déclaré à chaque étape et bloquant ; relecture exigée après tout nouvel élément ; `admin_support` sans proposition ni décision. Parcours du lot 15 (confirmation explicite) conservé.
> - **Résultats** : établi (journée « exceptional », mêmes effets que les autres confirmations), non établi (aucune sanction), partiel (identifié, journée et forfait inchangés), désaccord persistant (tentative amiable, orientation). Décision, réalisation, audit et notifications atomiques ; réalisation unique face au code et à la confirmation de l'entreprise.
> - **Révision interne** : sept jours, échéance affichée ; agent distinct du proposant et du décideur ; attente d'affectation sans agent disponible ; décisions successives conservées ; une journée confirmée n'est pas annulée (arbitrage, SRS §11.13).
> - Migration `20261120120000_completion_disputes.sql` ; preuve `mission-disputes` (24 assertions) ajoutée à `pnpm test:rls` ; écrans des parties (chronologie, questions, décisions, révision) et du support (instruction, échéances, propositions, révisions).
>
> **Décisions encore nécessaires** : annulation d'une journée confirmée (SRS §11.13) ; traitement d'une réalisation partielle et effet des décisions sur le versement (lot paiement) ; liste des recours externes à indiquer ; envoi effectif de SMS ou d'e-mails (aucun service branché).

- **Dépendances** : lots 14 (dossiers), 15 (contacts, confirmation, réalisation unique), 9c (réputation), 7d (signaux privés), tâche planifiée du lot 9c.
- **Hors lot** : paiements, sanctions, annulations, Free/Premium, EasyBot, design entreprise, notifications push.

## Futur lot — Correction encadrée des horaires par le support (à numéroter)

> **Statut** : demandé, **non commencé**. Depuis le lot 11b, aucune correction d'horaire n'est possible après la première publication, ni par l'entreprise ni par le support.

- **Périmètre attendu** : corrections limitées d'une offre publiée par un admin habilité, avec motif et trace dans `audit_logs` ; information des candidats concernés ; vérification préalable des engagements (sélections, contrats, missions) et des chevauchements d'horaires des candidats ; règle explicite pour le régime et l'échéance (aucune réouverture silencieuse).
- **Dépendances** : lot 11b ; lot « Engagements et annulations » (sort des engagements existants).

## Futur lot — Particuliers et professionnels non formalisés (reporté)

> **Statut** : reporté par la décision produit du 2026-11-11, **non commencé**. Au lancement, seules les entreprises au dossier vérifié publient (SRS §6.3.1).

- **À cadrer** : pièces exigibles sans RCCM ni NIU (identité, justificatif d'activité), limites de publication, libellé public distinct de « Dossier vérifié par EasyJob », obligations (contrat, déclaration) et responsabilité d'EasyJob.
- **Dépendances** : lot 11 (mêmes contrôles manuels, historique et droit de publier en base).

## Lot 17 — Engagements et annulations

> **Statut (2026-11-19)** : **17a** (`3ae5aff`) et **17b–17c** (`d2f1ecb`) **intégrés à `origin/main-dev`** (constat Git), non déployés ; **17d cadré** (`AUDIT.md` §41, ci-dessous) ; **17d-0 et 17d-1 réalisés** sur `feat/lot-17d-company-job-closure` (base `origin/main-dev`, `d2f1ecb`), **non commités** ; 17d-2 à 17d-5 non commencés. Décisions candidat validées le 2026-11-17 (ci-dessous, SRS §5.2) ; audit préalable des abonnements candidat et options chiffrées : `AUDIT.md` §38.
>
> **Mise à jour (2026-11-19, constat Git)** : 17d-0 et 17d-1 (#57) puis le correctif des horaires (#59) sont **intégrés à `origin/main-dev`** (`7bf9bf8`). **17d-2 est suspendu** avant toute implémentation : il suppose un plan Free/Premium entreprise que le dépôt ne connaît pas (plans stockés `free`, `starter`, `pro`, `business` ; aucune correspondance décidée). Un **cadrage préalable des abonnements entreprise** est placé avant 17d-2 (`AUDIT.md` §43, ci-dessous). Branche `feat/lot-17d2-company-cancellation` créée depuis `7bf9bf8`, sans modification de code.
>
> **17b–17c (2026-11-18)** : réalisés sur `feat/lot-17bc-candidate-cancellations` (base `origin/main-dev`, `3ae5aff`, lot 17a intégré : constat Git), intégrés depuis à `origin/main-dev` (`d2f1ecb`) (`AUDIT.md` §40). Annulation par journées avec récapitulatif, désistement immédiat et entreprise prévenue ; classement sur les conditions figées (48 h, 24 h, sélection + 1 h, limites incluses ; historique sans sanction automatique) ; motif et choix explicite hors délai ; « sans justificatif » → −5 unités et un manquement ; justificatif → décision motivée ops/fondateur, recours par un autre agent ; un manquement par demande ; exclusions 6 mois, 1 an, définitive (faits commis après le retour) ; suspensions par cause ; fraude présumée ; montant acquis au prorata du contrat. Migration `20261122120000_candidate_cancellations.sql` ; preuve `candidate-cancellations` (29 assertions). Montant acquis : journée interrompue ou partielle « en examen », jamais présentée comme nulle (décisions du 2026-11-19 et du 2026-11-20).
>
> **Avant déploiement** (lecture seule) : compter les comptes déjà suspendus, qui recevront une suspension « admin » (`select count(*) from public.users where is_active is false;`) ; vérifier après la migration que `cron.job` contient `account_suspension_sweep` dans `reputation-expiry-sweep`.
>
> **17a, en bref** : plan effectif calculé en un seul endroit (`candidate_effective_plan` : rôle `candidate_premium` et fin future, Free à l'instant exact de la fin) ; Premium attribué, prolongé ou arrêté par `admin_ops`/`admin_founder` actifs avec motif, historique en ajout seul, audit et notification dans une transaction, relances idempotentes, agents concurrents départagés par l'état lu ; aucune ligne de paiement. À chaque journée sélectionnée : plan, délai (Free 48 h, Premium 24 h) et instant de sélection figés (`mission_day_commitment_terms`), immuables et invisibles de l'entreprise. Promesses « priorité » et « offres exclusives » retirées, test `user-facing-claims` étendu. Journées sélectionnées avant le lot marquées `legacy` (plan et délai inconnus). Aucune durée de Premium imposée (borne technique : avant l'an 10000). Fiche admin du candidat derrière `requireAdminPage`. Preuve `candidate-premium` (26 assertions).
>
> **Avant déploiement** (lecture seule) : compter les journées sélectionnées qui seront marquées `legacy` (requête en tête de la migration `20261121120000`) et les candidats Premium en cours (`select count(*) from public.users u join public.candidate_profiles cp on cp.user_id = u.id where u.role = 'candidate_premium' and cp.premium_until > now();`) : leur début de période est inconnu. Le lot 9c applique déjà une décision confirmée (−5 unités ; entreprise : trois décisions en 90 jours → un retrait ; annulation par le support → solde rétabli). Ce lot doit produire ces décisions.

- **Décisions validées (2026-11-17), après sélection** :
  - Free annule sans sanction au moins 48 h avant la journée, Premium au moins 24 h avant ; limites exactes incluses ;
  - une annulation reste signalable après le délai ; la décision du support précède toute sanction ;
  - empêchement reconnu par le support → aucune sanction ; annulation tardive injustifiée ou absence injustifiée confirmée → retrait de 5 unités d'expérience ;
  - un même événement ne produit qu'un manquement ; l'abandon de plusieurs journées dans une même demande est un seul événement ;
  - retrait avant sélection : sans sanction (inchangé) ; retard suivi du travail : mention possible dans l'avis privé, sans sanction automatique ;
  - journées au choix : l'annulation vise les journées désignées ; période complète : le support examine la poursuite de l'engagement et le remplacement éventuel ; réalisations antérieures conservées.
- **Décisions validées ensuite** : le délai dépend du plan effectif **au moment de la sélection réussie** (appliqué en 17a : une activation, une prolongation, un arrêt ou une échéance ultérieurs ne changent pas l'engagement) ; si la sélection intervient après le seuil personnel (48 h ou 24 h), le candidat peut se désister sans sanction jusqu'à **sélection + 1 h inclus** (17b).
- **Arbitrages du 2026-11-18 (validés, `AUDIT.md` §39)** :
  - matching : retrait du bonus Premium de 5 % conservé ; une priorité éventuelle sera définie avec la future grille commerciale ;
  - engagements antérieurs sans plan connu : journées marquées `legacy` en 17a ; aucune sanction automatique d'annulation tardive sur la base d'un plan ou d'un délai supposé ; autres faits examinés par le support selon leurs règles ;
  - délai de réaction : désistement sans sanction jusqu'à sélection + 1 h **inclus**, origine = heure de sélection enregistrée en base ;
  - notification découverte tardivement : le candidat peut la signaler au support, qui l'examine avant toute sanction ; création et consultation de la notification restent deux faits distincts.
- **Décisions du 2026-11-19, du 2026-11-20 et du 2026-11-21 — interruption d'une journée commencée (réalisées, non commitées ; `AUDIT.md` §40)** : remplacent l'accord du 2026-11-18 (montant fixé par l'entreprise, retiré avant tout commit). « Signaler une interruption » pour le candidat et l'entreprise dans un dossier du support. **Validé et réalisé** : support et ops instruisent ; le fondateur actif seul propose un montant motivé, prolonge, clôt et finalise, sans seconde validation ; délais serveur de 72 h par demande, 48 h par proposition, 72 h pour le fondateur (dépassement visible et rappelé, jamais de décision automatique) ; une seule prolongation de 7 jours au plus ; avis distincts « mis à disposition » / « consulté » ; bornes : entier de 0 au plafond lu dans le contrat figé (montant d'une mission d'une journée, sinon part de la journée selon la formule du lot 17c, plafond arrondi à l'entier inférieur), montant nul avec les mêmes garanties ; accord des deux parties → code même avant la fin prévue ; recours et finalisation manuelle (`partial_support`) au montant accepté ; clôtures « non établie » et « désaccord non résolu » ; réexamen par le fondateur (maintenue, rouverte avec historique, traitement distinct), instruction d'un dossier rouvert contrôlée par son état courant (`incident_instruction_open`) ; suivi des montants dans le dossier (« accord finalisé », jamais un versement ; accord entier, plafond arrondi à l'entier inférieur, total exact pouvant rester fractionnaire). Migration `20261123120000_partial_day_agreements.sql` (réécrite, jamais intégrée) ; preuve `mission-interruptions` (31 assertions). **À arbitrer** : suite d'un désaccord non résolu (mission jamais « réalisée »), parcours d'un traitement distinct, prolongation des délais des parties ; arrondi final d'un versement (lot paiement).
- **Arbitrages matériels ouverts après 17b–17c** (`AUDIT.md` §40), avant les opérations qui en dépendent :
  - délai de complément d'un dossier resté sans pièce, et son issue (aucune sanction automatique sur ce fondement) ;
  - traitement opérationnel des engagements futurs d'un candidat suspendu (information de l'entreprise, remplacement, annulation par le support) : **regroupé dans le cadrage 17d** (arbitrage 4) ;
  - manquement annulé dans un cycle déjà suivi d'un autre cycle : renumérotation, durée (arbitrage tracé dans `audit_logs`) ;
  - unité « offre » de la réputation entreprise après un désistement du candidat : **regroupé dans le cadrage 17d** (arbitrage 5). Rectification (`AUDIT.md` §41), **prouvée en 17d-0** (`candidate-cancellations` D1-D2) : seul un abandon de période (candidature restée `selected`) bloque l'unité ; un désistement complet (`withdrawn`) ne la bloque pas ;
  - remplacement après clôture et poursuite d'une période abandonnée (place conservée) : **regroupé dans le cadrage 17d** (arbitrage 3) ;
  - arrondi au franc, pause déduite ou non, durée reconnue d'une journée partielle (parcours du support à créer) ;
  - fraude : durée, critères, recours au-delà de la contestation interne.
- **Arbitrages candidat restants (antérieurs)** (options et exemples horaires : `AUDIT.md` §38) : abandon mêlant journées dans et hors délai ; remplacement après une annulation Premium à J−24 h (sélection normale fermée au même instant, lot 11b) ; justificatifs, délai et grade de décision de l'empêchement ; sort du blocage de 7 jours et du bannissement (SRS §5.3, §11.9).
- **Sous-lots proposés** (ordre d'implémentation) :
  - **17a — réalisé** (§39) : plan effectif candidat unique en base, activation, prolongation et arrêt par RPC admin auditée, conditions figées à la sélection, écrans et matching alignés, promesses Premium non livrées retirées et refusées par `user-facing-claims` ;
  - **17b — réalisé** (§40) — annulation par le candidat après sélection (journées désignées ou période), à partir des conditions figées en 17a (délai et instant de sélection), délai de réaction jusqu'à sélection + 1 h inclus, aucune sanction automatique sur une journée `legacy` ou sans conditions, signalement d'une notification découverte tardivement examiné avant toute sanction, date limite affichée aux deux parties sans révéler le plan, annulation tardive transmise comme signalement ; souplesse d'annulation annoncée à la livraison ;
  - **17c — réalisé** (§40 ; plus exclusions progressives, suspensions par cause, fraude présumée, montant acquis) — décision du support et manquement unique (producteur de `reputation_incidents`, `protect_reputation_incidents` aligné sur la journée). *Écart relevé (§41), **prouvé en 17d-0** (`mission-incidents` N1) : le seul producteur écrit `candidate_late_cancellation`. Depuis le lot 16, un dossier d'absence se tranche par double validation sur la réalisation du travail (« établi » = journée confirmée ; « non établi » = aucune absence fautive) ; aucune issue ne qualifie une absence injustifiée et `candidate_no_show` n'a aucun producteur. À arbitrer avec le constat d'absence (arbitrage 4 de 17d).*
  - **17d** — entreprise : annulation, retrait d'un candidat, place libérée, remplacement, engagements futurs d'un candidat suspendu. **Cadré le 2026-11-19, non commencé** (ci-dessous).

- **Périmètre** : parcours d'annulation après sélection (candidat, entreprise, support), constat d'absence, écriture de `reputation_incidents` avec la décision et ses conditions vérifiées par le producteur, notifications, pénalités financières éventuelles (avec le lot paiement). Lot 12 : produire la résolution « absence validée avec remboursement effectivement confirmé » attendue par `reputation_company_offers` (aujourd'hui seul le travail confirmé résout un engagement), et les décisions du support sur les situations partielles (journée d'une période non confirmée : aucune division du forfait).
- **Lot 14** : les faits (retard, absence, code non remis) et leur examen par le support existent désormais par journée (`mission_incidents`) ; ce lot décidera si et comment une décision « établie » produit une conséquence. `protect_reputation_incidents` raisonne encore à la mission (une journée confirmée, par code ou par le support depuis le lot 15, suffit à refuser une absence) : à aligner sur la journée.
- **Invariant à conserver** : la base applique une décision ; aucun seuil provisoire ne déclenche ni n'écarte une sanction (preuve `reputation`, B0 à B5). Les délais de 48 h et 24 h ne sanctionnent rien par eux-mêmes : ils distinguent l'annulation sans sanction de l'annulation transmise au support.
- **Dépendances** : lot 9c ; lots 14 à 16 (dossiers par journée, double validation, révision interne) ; 11b et 12 (échéances, journées) ; lot paiement pour les pénalités ; lot 12 (journées de mission : une journée non confirmée reste non confirmée, sans sanction ni annulation des suivantes ; `protect_reputation_incidents` refuse aujourd'hui une absence sur une mission globale dont une journée est confirmée, règle à préciser).
- **Taille** : grand (sous-lots 17a à 17d).

### 17d — Annulations par l'entreprise et remplacements (cadrage du 2026-11-19)

> Inventaire, cas A à H avec exemples et effets sur la réputation et les montants : `AUDIT.md` §41. Une journée **commencée** relève de l'interruption livrée en 17b–17c ; 17d ne vise que des journées non commencées.

- **État des lieux** :
  - suppression d'une offre sans engagement (avant 17d-1) : `delete_job`, suppression physique quel que soit le statut ; candidatures en attente effacées par cascade, sans avis ni trace. **Traité en 17d-1** (clôture tracée après publication) ;
  - annulation par l'entreprise après sélection, retrait d'un candidat sélectionné : **aucun parcours** (`update_job`, calendrier figé, `protect_job_application_writes` renvoient au support, qui n'a aucun outil) ;
  - remplacement : seulement la sélection ordinaire avant l'échéance si une place est libre ; après clôture, `recruitment_closed` ; profil, CNI et documents contrôlés à la candidature seulement ; candidature retirée ou refusée jamais réactivée (unicité) ;
  - place libérée par le seul désistement complet ; période interrompue : place conservée ; suspension ou absence signalée : rien n'est libéré, l'entreprise n'est pas informée d'une suspension ;
  - sanctions entreprise : nature `company_late_cancellation` et regroupement par trois en 90 jours prêts, sans producteur ni identifiant d'événement ; aucun versement ; table `cancellation_penalties` vestige, sans producteur.
- **Grille de décisions** (exemples simples ; détail au §41) :

  | Cas | Exemple | Aujourd'hui | À décider |
  |---|---|---|---|
  | A. Avant toute sélection | 3 candidatures en attente, l'entreprise renonce | Offre supprimée, candidatures effacées sans avis (avant 17d-1) | **Livré en 17d-1** : clôture tracée, avis aux candidats, sans sanction |
  | B. Journée future après sélection | Journée du 11 annulée le 9, deux sélectionnés | Impossible | Délai tardif, un événement par demande, information, indemnité prévue |
  | C. Reste d'une période commencée | 2 journées sur 5 confirmées, arrêt des 3 dernières | Impossible | Un seul événement, montant reconnu conservé, unité « offre » |
  | D. Remplacer sans manquement | Préférence pour un autre profil | Impossible | Admis ou non ; si oui, annulation par l'entreprise, jamais manquement du candidat |
  | E. Désistement avant clôture | Désistement le 17, clôture le 19 | Place libérée, sélection ordinaire possible | Confirmer ; avis aux candidats en attente |
  | F. Désistement après clôture | Désistement le 19 à 20 h | Place libérée, sélection refusée | Remplacement limité ou aucun |
  | G. Absence signalée, non établie | Absence signalée le 10, période jusqu'au 11 | Rien ne change | Jamais de remplacement sur le seul signalement ; mesure conservatoire ou non |
  | H. Candidat suspendu, engagements futurs | Exclusion le 5, journées le 8 et le 12 | Début refusé, entreprise non informée | Information sans cause, annulation par le support, remplacement |

- **Arbitrages prioritaires** (à trancher avant 17d-1 ; reprennent tous les « arbitrages attendus » antérieurs) :
  1. **Annulation par l'entreprise** — clôture tracée ou suppression d'une offre publiée ; annulation avant toute sélection (sans sanction recommandé) ; délai d'une annulation tardive (12 h historique, SRS §5.3, à confirmer ou remplacer) ; offre partiellement pourvue ; imputabilité et force majeure (qui décide, sur quelles pièces) ; **une demande portant sur plusieurs journées ou plusieurs candidats = un seul événement** (identifiant unique, comme `cancellation_id`) pour ne pas déclencher à elle seule le regroupement par trois ; contestation d'une décision de manquement (révision interne du lot 16 ou parcours propre) ; remplacement de la règle historique « modification ou suppression jusqu'à 12 h » (SRS §5.4, non appliquée).
  2. **Retrait d'un candidat sans manquement (cas D)** — admis ou non ; si admis, qualifié comme annulation par l'entreprise des journées concernées (mêmes délais et effets), information du candidat sans détail privé, jamais de manquement du candidat.
  3. **Remplacement** — *(désistement enregistré : décidé le 2026-11-20, `ANN-14` ; reste ouvert pour les autres causes)* — avant clôture : confirmer la sélection ordinaire (existant). Après clôture : **proposition à arbitrer, non acquise** : remplacement ouvert par le support sur une place réellement libérée et identifiée, journées futures seulement, motif et `audit_logs`, offre non republiée, calendrier et échéances inchangés, `sign_and_select` conservé (signature, places, conflits de 3 h) avec **contrôles du dossier rejoués à la sélection**, jamais de candidature retirée ou refusée réactivée, au plus un remplacement ouvert par place, aucune garantie annoncée ; alternative : réouverture générale de l'offre (non recommandée) ou aucun remplacement. Période entamée : contrat d'un remplaçant sur les seules journées restantes et base de son montant (aucun montant fixé ici) ; poursuite d'une période abandonnée. Exception explicite à la règle de lancement du lot 11b si la proposition est retenue.
  4. **Candidats indisponibles : suspension et absence signalée (cas G, H)** — information de l'entreprise (« candidat indisponible », sans cause, justificatif ni plan) ; annulation par le support au nom du candidat, sans nouveau manquement automatique (le fait sanctionnable éventuel reste celui de la suspension) ; place libérée et ouverture possible d'un remplacement (arbitrage 3) ; délai avant la journée pour agir ; absence signalée : jamais traitée comme établie, aucun remplacement fondé sur le seul signalement, mesure conservatoire sur les journées futures ou non ; constat d'absence (qui constate, délai et forme du justificatif, grade, SRS §11.9) et producteur `candidate_no_show` (écart du §41).
  5. **Réputation et montants** — unité « offre » quand un engagement est annulé par l'entreprise, retiré ou abandonné en cours de période (aujourd'hui : désistement complet sans effet, période interrompue bloquante sans issue) ; sanctions de l'entreprise (même délai ou non pour le regroupement) ; montants reconnus jamais effacés ; indemnité du candidat et remboursement de l'entreprise décrits comme **prévus, jamais versés**, jusqu'au lot paiement ; sort de `cancellation_penalties` (retrait ou réemploi). Aucun montant, pourcentage, délai, sanction ou avantage Premium n'est fixé par ce cadrage.
- **Dépendance explicite (absence)**, à respecter avant 17d-3, 17d-4 et 17d-5 et avant tout producteur de `candidate_no_show` (non implémentée) :
  1. **constat d'absence injustifiée**, décision distincte de celle du lot 16 sur la réalisation du travail (aujourd'hui « non établi » signifie seulement « travail non démontré », jamais « absence fautive ») : qui constate, sur quelles pièces, dans quel délai, quel grade, quel recours ;
  2. **éventuel manquement**, produit seulement par ce constat (un manquement par événement, règles de 17c pour le retrait de 5 unités et les exclusions) ;
  3. **conséquences** : place libérée et remplacement éventuel (arbitrage 3), résolution de l'engagement et unité « offre » de l'entreprise (arbitrage 5), information des parties. Aucun signalement ni décision « non établi » ne vaut absence établie.
- **Découpage proposé** (dépendances entre parenthèses) :
  - **17d-0 — réalisé** (§41) : constats prouvés sur `easyjob-proof`, sans changer de règle : unité « offre » non bloquée par un désistement complet, bloquée sans issue par un abandon de période (`candidate-cancellations` D1-D2) ; absence sans aucun manquement produit (`mission-incidents` N1) ;
  - **17d-1 — réalisé** (§41 ; règles validées le 2026-11-24, partie de l'arbitrage 1) : suppression réservée aux offres jamais publiées ; offre publiée sans engagement **clôturée** par l'entreprise (motif obligatoire, statut `cancelled` + `closed_at`, `job_closures` en ajout seul, audit, candidats en cours prévenus une fois, candidatures conservées sans refus) ; offre avec engagement : refus et orientation vers le support ; aucune réouverture (revalidation, modération, clé service) ; offre de plusieurs journées close en entier. **Complément (2026-11-24)** : candidatures d'une offre clôturée figées (ni refus par l'entreprise, ni retrait par le candidat) et présentées comme historique ; historique d'une offre publiée (offre, candidatures, clôture) non effaçable par l'application, clé service et cascades comprises (`job_history_protected`), seule une maintenance directe de la base le peut (aucun parcours de purge validé) ; preuves nettoyées par `scripts/lib/proof-purge.ts`. Migration `20261124120000_job_closure.sql` ; preuve `job-closure` ; preuves `job-moderation`, `candidate-selection` et `realtime` adaptées (courses et signal sur la clôture au lieu de la suppression d'une offre publiée) ;
  - **Consolidation préalable — registre des décisions produit : réalisée (2026-11-19, documentaire)** : `docs/product/DECISIONS.md` recense les décisions des domaines sensibles, avec identifiant, statut, source, état technique et contradictions (C-01 à C-13). La grille entreprise rappelée par l'utilisateur y est rattachée aux sources (`ENT-01` à `ENT-07`, toutes à confirmer). Garde-fous ajoutés dans `AGENTS.md` (« Décisions produit »). **Préalable au lot entreprise** : aucun sous-lot entreprise (grille, plan effectif, 17d-2 et suivants) ne commence sans les identifiants applicables ni sans les extraits listés dans « Sources à compléter » du registre pour les décisions qu'il touche ;
  - **Cadrage préalable — abonnements entreprise Free/Premium : audit réalisé (§43, documentaire), grille à valider** : plans, rôles et appellations présents ; avantages annoncés comparés au comportement réel (seule la modification directe des offres actives est contrôlée en base, pour `pro` et `business`) ; aucune activation tracée (clé service seulement) ; grille Free/Premium proposée, qui distingue ce qui est réalisable de ce qui dépend d'un futur lot ; neuf arbitrages (modèle de plans, sort de `starter`/`pro`/`business` et du rôle `company_premium`, attribution, avantages retenus, information du candidat, textes, quota, vestiges, ordre). Aucun prix, aucune durée, aucun quota, aucun frais ni aucune correspondance fixés. Selon l'arbitrage 9, un sous-lot « plan entreprise effectif et attribution tracée » (sur le modèle de 17a) peut précéder 17d-2 ;
  - **Plan entreprise effectif et gestion administrative tracée — intégré à `origin/main-dev` (#60, `88e8a11`, constat Git du 2026-11-22), absent de `origin/main` ; déploiement distant non vérifié ; complément vérifié le 2026-11-22** (écritures directes du plan fermées pour tout auteur, clé service sans exécution des fonctions internes ni écriture de l'historique, journal de l'intervalle, fixtures des preuves par la RPC ; reprise en deux temps répétée ; `company-premium` 44/44, suite complète 40/40 ; `AUDIT.md` §44, suivi du 2026-11-22) (branche `feat/company-premium-plan` ; décisions `ABO-07`, `ABO-08`, `ABO-11`, `ABO-19` des 2026-11-20 ; compte rendu `AUDIT.md` §44 ; migrations `20261125120000` et `20261125130000` ; preuve `company-premium`) : Free/Premium à la place des quatre plans, Free par défaut, attribution, prolongation et arrêt par `admin_ops`/`admin_founder` actifs avec motif et date de fin (lecture pour `admin_support`), historique, audit, notification, échéance exacte, reprise explicite des anciens comptes sans conversion. Ne reprend aucun avantage Pro ou Business sans décision ; modification directe réservée à Premium (`ABO-08`, tranché le 2026-11-20) ; profil limité au plan, à sa fin et à l'attribution (`ABO-19`). **Déploiement** : `db push` applique toutes les migrations en attente (vérifié, CLI 2.117.0) ; si l'inventaire de production trouve d'anciennes valeurs, **deux releases** : la première avec la seule migration 1, puis enregistrement d'un choix par compte, puis la release qui ajoute la migration 2 (elle s'arrête sans effet sinon). Procédure : `docs/deployment/production.md` et `AUDIT.md` §44. Précède 17d-2, dont le figement des conditions entreprise à la sélection reste une dépendance. Hors lot : paiement, prix, avantages validés non livrés, communs aux deux plans (`ABO-12` à `ABO-15`) et Premium (`ABO-16` à `ABO-18`), 17d-2 ;
  - **Écart candidat signalé (2026-11-20), non corrigé** : comme l'entreprise avant le complément, le plan candidat (`users.role` = `candidate_premium`, `candidate_profiles.premium_until`) reste modifiable en clé service sans historique ni audit (`ABO-02`). À traiter par un lot dédié, sur le modèle de `trg_company_plan_write_guard` ;
  - **17d-2 — annulation par l'entreprise après sélection : intégré à `origin/main-dev` (`6167235`, constat Git du 2026-11-23), absent de `origin/main` ; déploiement distant non vérifié (`AUDIT.md` §45)** (branche `feat/lot-17d-2-company-cancellation` depuis `origin/main-dev` `88e8a11` ; l'ancienne branche `feat/lot-17d2-company-cancellation` n'est pas réutilisée ; migration `20261126120000_company_cancellations.sql` ; preuve `company-cancellations` ; test `company-cancellation`). Décisions : `ANN-06` (délai, limites, figement, qualification sans conséquence), `ANN-04` côté entreprise (`[U]` 2026-11-22 : un événement par demande), `ANN-08` en partie (à confirmer). Livré : conditions entreprise figées par journée à « Signer et sélectionner » (Free 48 h, Premium 24 h, `legacy` pour les engagements antérieurs, jamais reconstitué) ; aperçu par date et par candidat avec qualification calculée par la base ; demande de dates entières, futures et non commencées, motif obligatoire, accord explicite si tardive ; un événement, journées bloquées (début, confirmation, signalement, manquement du candidat refusés, clé service comprise), missions sans journée restante annulées par l'entreprise, avis, audit, dans une transaction, relance idempotente ; contrat, candidature, place, journées confirmées et montant reconnu conservés ; écran entreprise et vues candidat FR/EN, temps réel. **Complément du 2026-11-22** (décisions `ANN-15` motif visible par l'entreprise et l'administration, `ANN-16` retrait ciblé réservé au support, `ECH-09` créneau libéré par une annulation effective) : disponibilité recalculée pour les deux origines d'annulation, horaires des engagements figés en clé service (`mission_schedule_locked`, ECH-02), lecture du motif par l'administration ; preuve étendue (34 cas). Non livré, sans décision : parcours support du retrait ciblé (`ANN-16`, à cadrer), producteur `company_late_cancellation`, effet sur l'unité « offre » (`REP-04`, constat : bloquée, ni gain ni retrait), frais et indemnités (`MNT-04`), remplacement (`ANN-14` non déclenché), absences.
  - **17d-3 — interventions du support sur les engagements : réalisé et vérifié localement, non commité (2026-11-23, `AUDIT.md` §47 ; cadrage §46)** (branche `feat/lot-17d-3-support-interventions` depuis `origin/main-dev` `6167235` ; migration `20261127120000_support_interventions.sql` ; preuve `support-interventions` ; test `support-intervention`). Décisions `ANN-17`, `ANN-18`, `SAN-08` (`[UV]` du 2026-11-23). Livré : retrait ciblé décidé par le support et imputé à l'entreprise ; tâche ouverte par une suspension, annulation par le support (troisième origine), demande du candidat suspendu, ancien désistement fermé ; constat d'absence injustifiée distinct, sans effet ; écrans entreprise, candidat et `/admin/interventions`, FR/EN, temps réel. Complément du 2026-11-24 : le constat ne dépend plus d'un dossier du lot 16 décidé ; contestation ouverte bloquante, travail confirmé et situation ambiguë sans absence injustifiée, confirmation refusée sous un constat établi. Finalisé le 2026-11-24 (`[UV]`) : modalités du constat validées (contestation non résolue seule bloquante, issue « absence injustifiée non établie », délais ancrés sur les notifications, historique des décisions, nouveaux éléments, support instructeur) ; réexamen d'un refus de retrait livré. Précisions du 2026-11-24 : élément reçu avant la décision finale → proposition périmée et relecture ; plafonds cumulatifs retirés ; un réexamen par refus (contrôle serveur). Reste à décider : nombre de réexamens après des refus successifs (`ANN-17`). Non livrés : empêchement d'un candidat non suspendu, conséquences d'un constat (SAN-01, SAN-04), remplacement (`ANN-14` non étendu).
  - **17d-4 — remplacement limité à une place libérée** (si retenu ; **pour le désistement enregistré, décidé le 2026-11-20 : `ANN-14`**, réouverture encadrée commune aux deux plans, non par le support ; points à cadrer dans `ANN-14` ; absences, suspensions et annulations par le support restent ouvertes, `ANN-12`) : ouverture tracée par le support, sélection signée avec contrôles du dossier rejoués, période entamée (arbitrage 3 ; 17d-2 et 17d-3) ;
  - **17d-5 — réputation et états financiers prévus** : `reputation_company_offers` aligné sur les décisions, états « prévu, non versé » (arbitrage 5 ; 17d-2 à 17d-4 ; versement : lot paiement).
- **Invariants 17d** : aucun effacement de contrat, décision, journée réalisée ou montant reconnu ; aucun signalement tenu pour une absence établie ; aucun remplacement garanti ni paiement annoncé ; aucun détail privé du candidat (suspension, justificatif, plan) transmis à l'entreprise ; calendrier publié et échéances figés sauf exception validée ; toute nouvelle sélection passe par la signature de l'entreprise, les places, les contrôles du dossier et les conflits de 3 h.
- **Hors 17d, conservés** : arbitrages matériels et candidat de 17b–17c ci-dessus (dossier sans pièce, cycles, arrondi et pauses, journée partielle, fraude, journées mêlées, J−24 Premium, blocage de 7 jours et bannissement) ; suite d'un désaccord non résolu sur une interruption ; annulation d'une journée confirmée (SRS §11.13) ; correction encadrée des horaires (futur lot).

---

## Lots conservés au plan (à cadrer, non commencés)

- **Free / Premium** : parcours d'abonnement (activation, changement, renouvellement, régularisation, essai, quotas d'offres actives) et affichage des seuls avantages livrés (lots 7d et 9, dépendances notées ci-dessus). Audit candidat et grille proposée : `AUDIT.md` §38. Fait en 17a : plan effectif, attribution administrative auditée, page « Mon plan » sans prix ni avantage non livré, FAQ et EasyBot alignés. Restent des **propositions** : relevé d'expérience PDF, alertes dans l'application ; priorité d'affichage seulement dans la future grille commerciale (bonus de matching de 5 % retiré, décision du 2026-11-18) ; souplesse d'annulation annoncée à la livraison du lot 17b. **À décider** : prix (seul existe 1 000 FCFA / mois dans le SRS, retiré des écrans) et durée commerciale ; souscription en libre-service avec le lot paiement. **Entreprise** : audit ciblé et grille proposée au `AUDIT.md` §43 (préalable à 17d-2) ; arbitrages listés en fin de section. Décisions et rappels : `ABO-05` à `ABO-18`, `MNT-09`, `MNT-10`, `ANN-14`, `ENT-01` à `ENT-07` (`docs/product/DECISIONS.md`) ; offres illimitées pour les deux plans (`ABO-10`) et frais de publication urgente (`MNT-09`, encaissement au lot paiement) confirmés le 2026-11-19 ; avantages cibles communs aux deux plans confirmés le même jour, non livrés : duplication en brouillon, modèles, exports PDF/CSV, assistance (`ABO-12` à `ABO-15`, `ENT-02`), soumis aux contrôles de publication ; favoris Premium confirmés le même jour, non livrés (`ABO-16` : candidats ayant déjà réalisé une mission pour l'entreprise, sans priorité ni coordonnée, suspendus à l'expiration ; invitations non validées ; réalisation partielle rattachée à l'arbitrage existant) ; statistiques avancées Premium confirmées le même jour, non livrées (`ABO-17` : activité, recrutement, réalisation, montants distincts des paiements, graphiques et filtres ; Free garde listes, compteurs et exports ; indicateurs peu fiables indisponibles ; paiements intégrés au lot paiement, jamais simulés) ; fourchette de rémunération Premium confirmée le même jour, non livrée (`ABO-18`, `MNT-10` : montant demandé par le candidat dans les bornes, accepté ou refusé sans contre-offre, montant unique figé au contrat, contrats existants inchangés, aucun pouvoir sur les montants partiels ; Premium exigé à la première publication ; bornes modifiables seulement avec Premium actif, sans candidat sélectionné et après nouvelle modération, sans modification automatique d'un montant demandé ; encaissement au lot paiement) ; recrutement de remplacement après désistement décidé le 2026-11-20, **commun aux deux plans** (`ANN-14` : principe et destinataires validés ; fonctionnalité non livrée ; modalités restantes à cadrer : période commencée, règles financières, service d'e-mail, retour du candidat à l'origine du désistement) ; remplacement réservé à Premium non retenu (`ENT-03`) ; la grille d'origine n'est pas remplacée par les seuls avantages codés.
- **Paiement** : voir « Hors plan » ci-dessous (Mobile Money, versements, pénalités, preuve de remboursement).
- **EasyBot** : évolutions de l'assistant (`docs/chatbot.md`, quota du lot 8), sans nouvelle annonce de fonction non livrée.
- **Design entreprise** : écrans entreprise (offres, candidatures, journées, signalements) à harmoniser avec le design candidat.
- **Notifications push** (et SMS, e-mail) : aujourd'hui, notifications en base et signaux Realtime seulement ; rappels hors page ouverte non livrés.
- **Contrats — limites suivies (lot 13)** : PDF à polices standard, non archivé, sans signature graphique ni identité civile figée ; détail des signatures lisible par le support en clé service seulement, sans écran admin.
- **Contestations existantes (`disputes`)** : écritures de session fermées au lot 14b (`AUDIT.md` §34) ; reste à décider si les lignes historiques hors contestation d'avis doivent être migrées vers les signalements du lot 14 ou laissées en lecture.

## Hors plan (à cadrer séparément)

- **Paiement Mobile Money** : choix du fournisseur ou agrégateur, webhooks signés avec protection contre le rejeu, idempotence, rapprochement et gestion des échecs partiels. Aucun code de production n'existe aujourd'hui. À redéfinir dans ce lot : les délais de versement liés aux étoiles (SRS §5.3 : « premium et note ≥ 4 » → 48 h, 50/50 ou 7 jours), fondés sur l'ancienne note moyenne (`AUDIT.md` §26), et les pénalités financières des annulations (avec le futur lot « Engagements et annulations »). Lot 12 : fournir la confirmation effective d'un remboursement, seule preuve admise pour résoudre une absence dans la règle de réputation entreprise (aucun remboursement présumé).
- **Données personnelles** : validation juridique (conservation des CNI, information des personnes, suppression ou export de compte, déclaration à l'autorité compétente). Cela produira des exigences techniques à planifier ensuite.
- **Observabilité** : choisir un outil de capture d'erreurs seulement après le lot 8, si les logs Vercel ne suffisent pas.
