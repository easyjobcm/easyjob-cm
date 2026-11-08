# Suite d'autorisation et scripts de preuve

`pnpm test:rls` (`scripts/run-security-proofs.ts`) exécute les 23 preuves `scripts/proof-*.ts` l'une après l'autre et se termine en échec si une seule échoue. La CI l'exécute dans le job `test-migrations` (`.github/workflows/ci.yml`) sur une pile préparée de la même façon.

Les preuves créent, modifient et suppriment des comptes et des données. Deux garanties différentes s'appliquent :

- **Cible locale (imposée par le code).** `scripts/lib/local-supabase.ts` refuse, avant toute écriture, tout hôte autre que `localhost`, `127.0.0.1` ou `[::1]` (analyse par `URL`, sans contournement). Les scripts ne lisent jamais `.env.local`, qui vise le projet distant. Ils lisent `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DB_URL` (noms produits par `supabase status -o env`) et `NEXT_APP_URL` (défaut : `http://localhost:3000`). `test:rls` refuse aussi de démarrer si `DB_URL` n'est pas locale ou si l'application ne répond pas sur `NEXT_APP_URL`. `proof-license-gate` passe `DB_URL` en `--db-url` à `supabase db query`, car `--local` viserait la pile du dépôt.
- **Pile dédiée (assurée par la procédure, pas par le code).** Une adresse locale peut aussi être celle de la pile de développement (`easyjob-cm`, port 54321), dont les données doivent être préservées. Le garde-fou ne fait pas la différence. Seule la procédure ci-dessous garantit l'usage de la pile `easyjob-proof` (API sur le port **54421**) : elle charge les identifiants depuis `supabase status --workdir $stack`.

## Procédure (PowerShell, depuis la racine du dépôt)

Prérequis : Docker Desktop démarré, `pnpm install` effectué.

```powershell
# 1. Préparer la pile dédiée (hors du dépôt) puis la démarrer.
#    init-proof-stack copie migrations et configuration, décale les ports
#    et coupe les fournisseurs externes (SMS, OAuth). À relancer après
#    tout ajout de migration.
$stack = Join-Path $env:TEMP "easyjob-proof-stack"
pnpm exec tsx scripts/init-proof-stack.ts $stack
pnpm exec supabase start --workdir $stack -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta
# Pile déjà démarrée et nouvelle migration : réappliquer sur CETTE pile uniquement
# pnpm exec supabase db reset --workdir $stack

# 2. Charger ses identifiants dans la session courante, sans les afficher.
pnpm exec supabase status -o env --workdir $stack | ForEach-Object {
  if ($_ -match '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY|DB_URL)="?([^"]*)"?$') {
    Set-Item "env:$($Matches[1])" $Matches[2]
  }
}

# 3. Construire et servir l'application reliée à CETTE pile.
#    Les variables du processus priment sur .env.local.
$env:NEXT_PUBLIC_SUPABASE_URL = $env:API_URL
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $env:ANON_KEY
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $env:ANON_KEY
$env:SUPABASE_URL = $env:API_URL
$env:SUPABASE_SERVICE_ROLE_KEY = $env:SERVICE_ROLE_KEY
$env:NEXT_PUBLIC_APP_URL = "http://localhost:3100"
$env:MOBILE_MONEY_SANDBOX = "true"
if ($env:NEXT_PUBLIC_SUPABASE_URL -ne "http://127.0.0.1:54421") { throw "pile inattendue" }
pnpm build
Start-Process pnpm -ArgumentList "start", "-p", "3100" -NoNewWindow

# 4. Exécuter la suite (ou une preuve : pnpm test:rls admin-cni).
$env:NEXT_APP_URL = "http://localhost:3100"
pnpm test:rls

# 5. Arrêter l'application, puis supprimer la pile (conteneurs et données).
pnpm exec supabase stop --workdir $stack --no-backup
```

Points d'attention :

- **`next build` plutôt que `next dev`.** Next 16 refuse un second serveur de développement dans le même répertoire. Le build lu par `next start` est celui de l'étape 3 : les `NEXT_PUBLIC_*` y sont figées. Ne réutilisez pas un `.next` construit avec une autre configuration, et relancez `pnpm build` en changeant de pile.
- **Contrôle de la cible.** Vérifier `NEXT_APP_URL` prouve seulement que les requêtes partent vers une application locale, pas quelle base son serveur utilise. Le contrôle `throw "pile inattendue"` de l'étape 3 couvre ce point.
- Une preuve qui ne joint pas l'application se termine en échec (et non plus en « ignorée »).

## Fixtures et nettoyage

- **Fixtures autonomes.** Chaque preuve crée ses comptes (emails propres à la preuve, souvent horodatés), profils, entreprises et offres avec la clé service. Aucune ne dépend de données préexistantes ni du seed.
- **Vraies sessions.** Les tentatives non privilégiées passent par `signInWithPassword` avec la clé anon, ou par les cookies de session `@supabase/ssr` envoyés à l'application. Les résultats sont vérifiés en relisant l'état persisté avec la clé service.
- **Nettoyage.** Chaque preuve supprime en fin d'exécution les lignes et comptes qu'elle a créés. Plusieurs preuves suppriment aussi, au démarrage, les restes d'une exécution interrompue **de la même preuve** (comptes marqués par un drapeau `user_metadata` ou un préfixe d'email qui lui est propre). Elles ne touchent à aucune autre donnée. Supprimer la pile (étape 5) efface tout.
- **Exécution séquentielle.** Les preuves partagent des tables (`users`, `candidate_profiles`, `jobs`…) et leurs nettoyages par préfixe. Elles ne sont pas isolées entre elles et ne doivent pas tourner en parallèle.
- **Logs.** Aucune preuve n'affiche de clé. Le jeton des URL signées de stockage est masqué.

## Contrôle négatif (vérifier que la suite détecte une régression)

Sur la pile dédiée uniquement, relâcher les **deux** couches de protection de `users.role` (lot 1) reproduit F-01 :

```powershell
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "grant update (role) on public.users to authenticated; alter table public.users disable trigger trg_protect_user_account_columns;"
pnpm test:rls account-security   # attendu : 9 FAIL, code de sortie 1
pnpm exec supabase db reset --workdir $stack   # restauration
```

Relâcher une seule couche ne suffit pas : le trigger compense le privilège de colonne, et la preuve reste verte à juste titre. Après le reset, vérifier que `has_column_privilege('authenticated','public.users','role','UPDATE')` vaut `false` et que le trigger est actif, puis relancer la suite.

Le même contrôle s'applique à `company_profiles` (F-41, lot 5b). Il faut relâcher les privilèges, le trigger et la politique INSERT :

```powershell
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "grant insert, update, delete on public.company_profiles to authenticated; alter table public.company_profiles disable trigger trg_protect_company_profile_columns; create policy neg_insert on public.company_profiles for insert to authenticated with check (user_id = auth.uid());"
pnpm test:rls company-permissions   # attendu : 32 échecs (dont A1, B, C1), code de sortie 1
pnpm exec supabase db reset --workdir $stack   # restauration
```

Pour `jobs` (F-09, lot 6), rouvrir l'écriture, désactiver le trigger et recréer une politique d'écriture du propriétaire reproduit la publication directe :

```powershell
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "grant insert, update on public.jobs to authenticated; alter table public.jobs disable trigger trg_protect_job_writes; create policy neg_owner_write on public.jobs for all to authenticated using (company_id in (select id from public.company_profiles where user_id = auth.uid())) with check (company_id in (select id from public.company_profiles where user_id = auth.uid()));"
pnpm test:rls job-moderation   # attendu : 18 échecs (dont B2, publication directe), code de sortie 1
pnpm exec supabase db reset --workdir $stack   # restauration
```

Pour la suppression : `grant delete on public.jobs to authenticated; alter table public.jobs disable trigger trg_protect_job_writes; create policy neg_owner_delete on public.jobs for delete to authenticated using (company_id in (select id from public.company_profiles where user_id = auth.uid()));`, puis `pnpm test:rls job-moderation` (attendu : 4 échecs, dont I1). Si `db reset` échoue ensuite, recréer la pile : `supabase stop --workdir $stack --no-backup`, puis l'étape 1.

`job-moderation` crée aussi, le temps d'une assertion, un trigger qui fait échouer l'écriture dans `audit_logs` pour une seule offre, afin de prouver l'absence d'effet partiel, et deux triggers de ralentissement (`pg_sleep`) pour forcer l'ordre entre une sélection et une suppression. Ils ne visent que les lignes de la preuve et sont retirés en fin de preuve, même en cas d'échec.

Pour la sélection (lot 7a), désactiver le trigger des candidatures et recréer la politique F-16 :

```powershell
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "alter table public.job_applications disable trigger trg_protect_job_application_writes; create policy neg_f16 on public.company_profiles for select using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'company'));"
pnpm test:rls candidate-selection   # attendu : 6 échecs (dont R1 et F1), code de sortie 1
pnpm exec supabase stop --workdir $stack --no-backup   # puis l'étape 1 : pile recréée
```

`candidate-selection` utilise le même procédé : un trigger qui fait échouer la notification d'une candidature, et des ralentissements pour ordonner sélection, retrait et suppression. Il téléverse aussi une photo de test dans `candidate-documents`, supprimée au nettoyage.

Pour les contrats (lot 7b), rouvrir l'UPDATE, désactiver le trigger et recréer l'ancienne politique :

```powershell
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "grant select, update on public.contracts to authenticated; alter table public.contracts disable trigger trg_protect_contract_writes; create policy neg_f07 on public.contracts for update using (candidate_id in (select id from public.candidate_profiles where user_id = auth.uid()) or company_id in (select id from public.company_profiles where user_id = auth.uid()));"
pnpm test:rls contract-signing   # attendu : 19 échecs (dont R1, S4, R5), code de sortie 1
pnpm exec supabase db reset --workdir $stack   # restauration
```

`contract-signing` désactive aussi le trigger des contrats le temps d'une écriture, pour simuler une signature antérieure au lot ; il le réactive aussitôt, et dans le bloc `finally` en cas d'échec.

Pour les missions (lot 7c), ouvrir en session la lecture des codes de fin et l'écriture des évaluations :

```powershell
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "grant select on public.mission_completion_codes to authenticated; create policy neg_codes on public.mission_completion_codes for select to authenticated using (true); grant insert, update on public.reviews to authenticated; alter table public.reviews disable trigger trg_protect_review_writes; create policy neg_reviews on public.reviews for insert to authenticated with check (true);"
pnpm test:rls mission-time-tracking   # attendu : 3 échecs (E1, R6, X3), code de sortie 1
pnpm exec supabase db reset --workdir $stack   # restauration
```

`mission-time-tracking` crée des offres du jour en heure de Douala (00:00-23:59) et une offre du lendemain pour le refus « trop tôt ».

Pour le temps réel (lot 7d), autoriser la lecture de tous les canaux privés reproduit le suivi de l'activité d'un tiers :

```powershell
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "create policy neg_rt on realtime.messages for select to authenticated using (true);"
pnpm test:rls realtime   # attendu : 4 échecs (Z2, Z4, B3, S1 : canaux d'un tiers, admin, des offres et d'un compte déconnecté rejoints), code de sortie 1
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "drop policy neg_rt on realtime.messages;"
```

Désactiver un trigger de signal fait échouer les assertions du domaine concerné : `alter table public.contracts disable trigger trg_rt_contracts;` → 3 échecs (J9, M1, M2). Le réactiver ensuite (`enable trigger`).

`realtime` ouvre de vraies connexions WebSocket vers Realtime (une par session, plus un second onglet pour l'entreprise et pour un candidat). Elle attend l'échéance réelle d'un plan (environ 15 s) et d'un premium (environ 5 s), et simule une coupure réseau en fermant brutalement la WebSocket d'une session : `realtime-js` rejoint alors le canal de lui-même. Comptes marqués `proofRealtime`.

**Ports réservés par Windows.** Si `supabase start` échoue avec « ports are not available » et que `netsh interface ipv4 show excludedportrange protocol=tcp` montre une plage réservée couvrant 544xx, décaler les ports dans `$stack/supabase/config.toml` (copie temporaire, par exemple 554xx) et adapter le contrôle `pile inattendue` de l'étape 3.

## Couverture et limites

Couverture par preuve et résultats : `docs/audit/AUDIT.md`, §9, §10, §13, §15 (onboarding entreprise), §16 (droits des entreprises), §17 (offres et modération) et §18 (sélection et visibilité des candidats), §19 (signature des contrats) §20 (début de mission, code de fin et évaluations) et §22 (temps réel). `contracts`, `missions`, `mission_check_ins`, `mission_completion_codes` et `reviews` sont couverts en lecture et en écriture.
