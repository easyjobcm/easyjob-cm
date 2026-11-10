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
| 11 | Validation administrative des entreprises — **prochain lot produit** | Suite de F-41 (lots 5b, 6) | Fonctionnel et sécurité | Moyen |
| — | Engagements et annulations — **futur lot, à numéroter ; arbitrages produit attendus** | Dépendance du lot 9c | Fonctionnel | Moyen |

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

## Lot 11 — Validation administrative des entreprises (prochain lot produit)

> **Statut** : à cadrer. Constat des lots 5b et 6 : aucune RPC, interface ni trace ne valide une entreprise ; `create_job` exige pourtant une entreprise vérifiée.

- **Périmètre** : RPC admin gardée (grade, motif de refus, `audit_logs`), notification et signal Realtime à l'entreprise, écran admin, nouvelle revue après modification du nom, du RCCM ou du document (règle du lot 5b), preuve d'autorisation.
- **Dépendances** : lots 5b et 6.

## Futur lot — Engagements et annulations (à numéroter)

> **Statut** : à arbitrer avec le produit. Le lot 9c applique déjà une décision confirmée (−5 unités ; entreprise : trois décisions en 90 jours → un retrait ; annulation par le support → solde rétabli). Ce lot doit produire ces décisions.

- **Arbitrages attendus** :
  - délai d'une annulation tardive : 24 h pour le candidat et 12 h pour l'entreprise (SRS §5.3), à confirmer ; même délai ou non pour le regroupement par trois de l'entreprise ;
  - offre partiellement pourvue : une annulation compte-t-elle si une partie seulement des places est pourvue, ou si aucune sélection n'a eu lieu ;
  - imputabilité d'une annulation d'entreprise (motif, force majeure) ;
  - absence : qui la constate, délai et forme du justificatif, validation (SRS §11.9) ;
  - qui prononce la décision (support, parcours automatique) et comment elle est contestée.
- **Périmètre** : parcours d'annulation après sélection (candidat, entreprise, support), constat d'absence, écriture de `reputation_incidents` avec la décision et ses conditions vérifiées par le producteur, notifications, pénalités financières éventuelles (avec le lot paiement).
- **Invariant à conserver** : la base applique une décision ; aucun seuil provisoire ne déclenche ni n'écarte une sanction (preuve `reputation`, B0 à B5).
- **Dépendances** : lot 9c ; lot paiement pour les pénalités.
- **Taille** : moyen.

---

## Hors plan (à cadrer séparément)

- **Paiement Mobile Money** : choix du fournisseur ou agrégateur, webhooks signés avec protection contre le rejeu, idempotence, rapprochement et gestion des échecs partiels. Aucun code de production n'existe aujourd'hui. À redéfinir dans ce lot : les délais de versement liés aux étoiles (SRS §5.3 : « premium et note ≥ 4 » → 48 h, 50/50 ou 7 jours), fondés sur l'ancienne note moyenne (`AUDIT.md` §26), et les pénalités financières des annulations (avec le futur lot « Engagements et annulations »).
- **Données personnelles** : validation juridique (conservation des CNI, information des personnes, suppression ou export de compte, déclaration à l'autorité compétente). Cela produira des exigences techniques à planifier ensuite.
- **Observabilité** : choisir un outil de capture d'erreurs seulement après le lot 8, si les logs Vercel ne suffisent pas.
