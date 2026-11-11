# Suite d'autorisation et scripts de preuve

`pnpm test:rls` (`scripts/run-security-proofs.ts`) exécute les 30 preuves `scripts/proof-*.ts` l'une après l'autre et se termine en échec si une seule échoue. La CI l'exécute dans le job `test-migrations` (`.github/workflows/ci.yml`) sur une pile préparée de la même façon.

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
# EasyBot : fournisseur SIMULÉ servi par proof-chat-quota (aucun appel LLM).
$env:AI_GATEWAY_API_KEY = "proof-fake-key"
$env:EASYBOT_GATEWAY_URL = "http://127.0.0.1:3199/v3/ai"
if ($env:NEXT_PUBLIC_SUPABASE_URL -ne "http://127.0.0.1:54421") { throw "pile inattendue" }
pnpm build
# pnpm.cmd : sous PowerShell, Start-Process pnpm vise le script sans
# extension (« n'est pas une application Win32 valide »).
$app = Start-Process pnpm.cmd -ArgumentList "start", "-p", "3100" -NoNewWindow -PassThru
# Un ancien `next start` sur le même port ferait tester un ancien build.
Start-Sleep 5; if ($app.HasExited) { throw "next start arrêté : port 3100 déjà occupé ?" }

# 4. Exécuter la suite (ou une preuve : pnpm test:rls admin-cni).
$env:NEXT_APP_URL = "http://localhost:3100"
pnpm test:rls

# 5. Arrêter l'application (arbre cmd → node), puis supprimer la pile.
taskkill /pid $app.Id /t /f
pnpm exec supabase stop --workdir $stack --no-backup
```

Points d'attention :

- **`next build` plutôt que `next dev`.** Next 16 refuse un second serveur de développement dans le même répertoire. Le build lu par `next start` est celui de l'étape 3 : les `NEXT_PUBLIC_*` y sont figées. Ne réutilisez pas un `.next` construit avec une autre configuration, et relancez `pnpm build` en changeant de pile.
- **Contrôle de la cible.** Vérifier `NEXT_APP_URL` prouve seulement que les requêtes partent vers une application locale, pas quelle base son serveur utilise. Le contrôle `throw "pile inattendue"` de l'étape 3 couvre ce point.
- Une preuve qui ne joint pas l'application se termine en échec (et non plus en « ignorée »).
- **Fournisseur simulé d'EasyBot.** `proof-chat-quota` ouvre un serveur HTTP local sur `127.0.0.1:3199` (`FAKE_GATEWAY_PORT`) qui imite la passerelle Vercel AI et compte les appels. Les deux variables de l'étape 3 sont lues à l'exécution : un redémarrage de `pnpm start` suffit, sans nouveau build. Sans elles, la route répond 503 et C4 échoue.
- **Retour OAuth sans Google.** `proof-oauth-callback` crée le vérificateur PKCE par `signInWithOAuth({ skipBrowserRedirect: true })` (aucune requête) et pose en base la ligne `auth.flow_state` que Supabase Auth écrirait au retour de Google.
- **Codes SMS sans SMS.** `proof-phone-verification` pose en base ce que Supabase Auth écrit à l'envoi d'un code (`phone_change`, empreinte sha224, `phone_change_sent_at`), puis vérifie par l'API réelle. La pile est en autoconfirm (`[auth.sms] enable_confirmations = false`) : la preuve s'appuie sur ce réglage pour reproduire H-04, et simule le réglage de production (code exigé) pour la reprise après réponse perdue.
- **Connexions keep-alive mortes.** `execSql` bloque Node plusieurs secondes (`spawnSync`) : la requête suivante vers l'application peut partir sur une connexion que Next a déjà fermée (`ECONNRESET` sous Windows, `UND_ERR_SOCKET` « other side closed » sous Linux). Les preuves passent par `scripts/lib/app-fetch.ts`, qui reprend une seule fois ces erreurs de socket, sans réponse HTTP. Une réponse HTTP, même 5xx, n'est jamais reprise.

- **Échec borné (lot 10).** Chaque requête SQL de preuve passe par `scripts/lib/db-query.ts` : binaire natif de la CLI lancé sans shell, délai `PROOF_SQL_TIMEOUT_MS` (60 s par défaut), erreur qui nomme la preuve et l'étape (`étape « update public.jobs … »`), processus arrêté. Le runner donne à chaque preuve `PROOF_TIMEOUT_SECONDS` (600 s par défaut), arrête tout son arbre de processus au-delà, et la synthèse indique le code de sortie et la dernière ligne affichée. Aucune relance : une preuve hors délai est en échec.

## Panne provoquée (vérifier l'échec borné)

Sur la pile dédiée uniquement : suspendre la base pendant une preuve qui interroge Postgres, puis la reprendre.

```powershell
$env:PROOF_SQL_TIMEOUT_MS = "15000"
Start-Job { Start-Sleep 20; docker pause supabase_db_easyjob-proof } | Out-Null
pnpm test:rls job-moderation   # attendu : assertion en échec, étape nommée dans la synthèse, code de sortie 1
docker unpause supabase_db_easyjob-proof
Remove-Item env:PROOF_SQL_TIMEOUT_MS
pnpm test:rls job-moderation   # attendu : vert (restes de l'exécution interrompue retirés au démarrage)
```

Mesuré au lot 10 : échec après 271 s, synthèse « dernière étape affichée : Error: supabase db query : … failed to connect to postgres », aucun processus `supabase` restant, un trigger temporaire laissé par l'interruption puis retiré par la relance (verte). L'essentiel de l'attente vient des requêtes HTTP vers l'application, qui attendent la base jusqu'aux délais de PostgREST ; le délai par preuve (600 s) reste la borne. `candidate-selection`, `contract-signing`, `job-moderation` et `reputation`, qui modifient temporairement des triggers, retirent leurs restes et réactivent les protections au démarrage.

Avant le lot 10, la même coupure pendant une requête laissait `supabase db query` en attente sans limite (toujours bloqué après 120 s pour une requête de 4 s) : c'est la cause du blocage de plusieurs heures observé au lot 9.

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

`job-moderation` crée aussi, le temps d'une assertion, un trigger qui fait échouer l'écriture dans `audit_logs` pour une seule offre, afin de prouver l'absence d'effet partiel, et deux triggers de ralentissement (`pg_sleep`) pour forcer l'ordre entre une sélection et une suppression ; depuis le lot 11, la seconde opération attend d'avoir observé la première dans son trigger (voir « Courses à ordre imposé »). Ils ne visent que les lignes de la preuve et sont retirés en fin de preuve, même en cas d'échec.

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

Pour la réputation (lot 9c), rouvrir la lecture des avis en session reproduit l'exposition des notes, motifs et commentaires :

```powershell
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "grant select on public.reviews to anon, authenticated; create policy neg_reviews_public on public.reviews for select using (true);"
pnpm test:rls reputation   # attendu : 1 échec (P5 : avis lisibles), code de sortie 1
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "drop policy neg_reviews_public on public.reviews; revoke select on public.reviews from anon, authenticated;"
```

Désactiver `trg_reputation_reviews` (`alter table public.reviews disable trigger trg_reputation_reviews;`) fait échouer R1, R3, R4, R6 et P2 (5 échecs) ; le réactiver ensuite.

`reputation` simule ce qu'aucun parcours ne produit encore : des manquements confirmés (insertions en clé service dans `reputation_incidents`) et l'écoulement du temps jusqu'à l'échéance d'un justificatif. Pour ce dernier, elle suspend `trg_reputation_candidate_documents` le temps de reculer `expires_at` et l'échéance mémorisée (aucun recalcul n'a lieu, comme quand l'heure tourne), puis le réactive, y compris en cas d'échec. Elle appelle ensuite `reputation_expiry_sweep` deux fois (idempotence) au lieu d'attendre pg_cron. Comptes marqués `proofReputation9c`.

Pour la CNI en cours de validité (lot 9d), faire croire à la base que toute CNI est valide reproduit la candidature avec une CNI expirée :

```powershell
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "create or replace function public.candidate_cni_state(p public.candidate_profiles, p_at timestamptz) returns text language sql stable set search_path = '' as `$`$ select 'valid'::text `$`$;"
pnpm test:rls reputation   # attendu : 6 échecs (I4, I5, I6, I7, I9, I10 : refus et tâches CNI), code de sortie 1
Get-Content supabase/migrations/20261110120000_cni_validity_candidate_tasks.sql -Raw | docker exec -i supabase_db_easyjob-proof psql -U postgres -d postgres -v ON_ERROR_STOP=1   # restauration (migration idempotente)
```

Le bloc I de `reputation` simule ce qu'aucun parcours ne produit en quelques secondes : l'échéance d'une CNI (fixture créée avec une date passée) et le dépôt d'un casier judiciaire (insertion en clé service, puis approbation). Le renouvellement, le refus (complément) et l'approbation de la CNI passent par les vraies routes (`/api/profile/documents`, `/api/admin/cni` en session `admin_ops`). La limite exacte d'échéance est évaluée en base aux instants qui l'encadrent (`candidate_cni_state`), puis par deux candidatures réelles (échéance aujourd'hui et demain, en UTC).

Pour l'admin suspendu (lot 10), remettre les anciennes fonctions de grade, qui ne lisent que le rôle, reproduit l'accès d'un admin suspendu avec son jeton :

```powershell
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "create or replace function public.is_admin_user(uid uuid) returns boolean language sql stable as `$`$ select exists (select 1 from public.users u where u.id = uid and u.role::text in ('admin_support','admin_ops','admin_founder')) `$`$; create or replace function public.is_ops_admin_user(uid uuid) returns boolean language sql stable as `$`$ select exists (select 1 from public.users u where u.id = uid and u.role::text in ('admin_ops','admin_founder')) `$`$;"
pnpm test:rls admin-centralization   # attendu : 2 échecs (I3 lecture et URL signée, I4 RPC et notification), code de sortie 1
Get-Content supabase/migrations/20261110130000_suspended_admin_guard.sql -Raw | docker exec -i supabase_db_easyjob-proof psql -U postgres -d postgres -v ON_ERROR_STOP=1   # restauration
```

Les routes et pages restent refusées dans ce contrôle : leur garde applicative est vérifiée par `tests/admin-guard.test.ts` (filtre retiré d'une route → échec). Aucune session ne peut suspendre un admin ; la preuve le vérifie (I2) puis suspend en clé service, comme le support.

Pour le dossier entreprise (lot 11), trois contournements sont reproduits en appliquant sur la pile dédiée une copie modifiée d'une fonction extraite de `supabase/migrations/20261111120000_company_verification_review.sql`, puis les fonctions d'origine (extraites du même fichier) pour restaurer :

| Copie modifiée | Effet reproduit | `pnpm test:rls company-verification` |
|---|---|---|
| `company_verification_complete` réduite à `verification_status = 'verified'` | publication sur un statut forcé sans contrôle valide | 1 échec (J3) |
| `admin_review_company` sans l'exigence des trois contrôles approuvés | approbation avec le RCCM seul, ou un NIU refusé ou invérifiable | 6 échecs (D2, D3, D4, puis E1, E3, E4) |
| `admin_record_company_check` sans le jeton de dernière décision (`check_changed`) | double enregistrement d'un contrôle (double clic, deux admins) | 1 échec (F2) |

```powershell
Get-Content $env:TEMP\neg-copie.sql -Raw | docker exec -i supabase_db_easyjob-proof psql -U postgres -d postgres -v ON_ERROR_STOP=1
pnpm test:rls company-verification   # attendu : échecs ci-dessus, code de sortie 1
Get-Content $env:TEMP\fonctions-origine.sql -Raw | docker exec -i supabase_db_easyjob-proof psql -U postgres -d postgres -v ON_ERROR_STOP=1   # restauration, puis 36/36
```

Ne pas réappliquer la migration entière pour restaurer : sa section 9 (reprise) remettrait en attente les entreprises vérifiées présentes sur la pile.

`company-verification` :

- crée, le temps de l'assertion H1, un trigger qui fait échouer la notification de décision de sa seule entreprise de preuve (absence d'effet partiel) ; il est retiré en fin de preuve et au démarrage suivant ;
- téléverse de **vrais PDF multipages** fictifs (générés par la preuve) dans `company-documents`, supprimés au nettoyage ;
- rejoue telle quelle, instruction par instruction, la section 9 (reprise des anciens dossiers) : sur la pile dédiée, seules ses fixtures existent à ce moment ;
- ne teste **pas** les vérifications réelles auprès de la DGI, du registre ou du greffe : la base enregistre ce que l'admin déclare avoir constaté (source, référence) ; la preuve couvre droits, états, traces et absence de fuite.

`company-dossier-visibility` (offres d'une entreprise qui perd la validation du dossier) :

| Copie modifiée (migration `20261111130000_company_dossier_visibility.sql`) | Effet reproduit | Résultat attendu |
|---|---|---|
| Politique « Published jobs are viewable by all » remise à `status = 'active'` ou propriétaire | offre masquée encore lisible par un nouveau candidat ou l'anonyme | 1 échec (M1) |
| `apply_to_job` sans le contrôle du dossier | candidature acceptée pendant la revue | 5 échecs (M2, puis M3, M4, M6, R2) |
| `select_candidate` sans le verrou partagé de la ligne entreprise | sélection acceptée alors qu'une remise en revue est engagée | 1 échec (R4) |

Restauration : appliquer la politique et les deux fonctions extraites du fichier de migration ; 19/19.

**Courses à ordre imposé.** `scripts/lib/proof-barrier.ts` crée une fonction temporaire `proof_sleeping_backends()` (clé service seulement) qui lit `pg_stat_activity` : la seconde opération ne part qu'après avoir observé la première en attente dans son trigger de ralentissement, donc en possession de ses verrous. Aucun délai fixe côté client ; si la première n'atteint pas le trigger, la preuve échoue (« aucune opération en attente »). Les appels `supabase-js` étant paresseux, la première requête est lancée explicitement (`.then(...)`) avant l'attente. Utilisé par `company-dossier-visibility` (R1-R4) et `job-moderation` (I9, I10). La fonction et les triggers temporaires sont retirés en fin de preuve et au démarrage suivant.

`job-deadlines` (échéances de recrutement, lot 11b) :

| Copie modifiée (migration `20261112120000_job_recruitment_deadlines.sql`) | Effet reproduit | Résultat attendu |
|---|---|---|
| `apply_to_job` et `select_candidate` de `20261111130000_company_dossier_visibility.sql` (sans échéance) | candidature et sélection acceptées à l'échéance ou après | 9 échecs (N1-N6, U1-U6, L3, G1, V1, S2, R3) |
| `alter table public.jobs disable trigger trg_job_publication_guard` | aucun régime ni échéance à la publication | échec dès R0 (preuve interrompue) |
| `job_publication_guard` sans `raise … job_schedule_locked` et `update_job` sans la branche « offre publiée » | dates et horaires d'une offre publiée modifiables | 8 échecs (D2-D9) |
| `job_publication_guard` seul sans le verrou des horaires | écriture privilégiée (clé service) acceptée | D3 en échec, puis D4-D6 et D8 |

Restauration : `supabase db reset --workdir $stack` (ou réappliquer les fonctions extraites de la migration et `enable trigger`) ; 35/35.

**Limites temporelles exactes.** `job-deadlines` crée une fonction temporaire `proof_l11b_case()` (clé service seulement) qui, dans une seule transaction, place l'échéance (ou le début d'une offre en attente) à `now()` + décalage, puis appelle la vraie RPC (`apply_to_job`, `select_candidate`, `moderate_job`) sous l'identité de la session (`request.jwt.claims`). `now()` étant constant dans la transaction, « juste avant », « exactement » et « juste après » sont testés à la microseconde, sans attente ni relance. Un refus est capturé dans un sous-bloc (ses effets sont annulés) et les compteurs d'effets sont relus. Pour une offre publiée, dont horaires et échéance sont figés pour tout auteur, la fonction désactive le trigger de garde le temps du seul déplacement, dans la même transaction (pile jetable uniquement). La fonction est supprimée en fin de preuve et au démarrage suivant.

**Offres « déjà publiées » dans les fixtures.** Depuis le lot 11b, une offre insérée directement au statut `active` reçoit son régime du trigger et doit commencer dans plus de 4 h. Les preuves qui enchaînent une mission le jour même (`company-dossier-visibility`, `mission-time-tracking`, `reputation`, `realtime`) fournissent les trois valeurs de publication (première publication, régime, échéance proche dans le futur) en clé service ; `realtime` crée son offre à J+3 puis recale la mission sur le jour avant de la démarrer.

Les preuves qui publient des offres ou y font postuler (`job-moderation`, `candidate-selection`, `contract-signing`, `mission-time-tracking`, `realtime`, `business-permissions`, `jobs-rls-select`, `essentials-gate`, `reputation` pour ses entreprises au profil complet) complètent le dossier de leurs entreprises par `scripts/lib/verified-company.ts` (pièces fictives, trois contrôles approuvés sur les versions courantes, en clé service) : depuis le lot 11, un statut `verified` seul ne permet plus de publier, et les offres actives d'une entreprise sans dossier valide sont masquées et fermées aux candidatures. `company-permissions` E1 et E2 listent les colonnes ouvertes en session et les trois RPC gardées qui écrivent `company_profiles`.

Pour la vérification du téléphone (lot 8), rétablir l'ancien repli « numéro relu = numéro demandé » dans `findPhoneProof` (`lib/auth/phone-verification.ts`, copie locale non commitée) reproduit H-04 : `pnpm test:rls phone-verification` → 2 échecs (H1 et H7 autoconfirm : code erroné → téléphone vérifié et profil créé). La preuve appelle le module directement : aucun build n'est nécessaire.

Pour le quota d'EasyBot, recréer `consume_chat_quota` sur la pile dédiée sans ses deux `pg_advisory_xact_lock` (et avec un `perform pg_sleep(0.05);` en tête, qui élargit la fenêtre de course) fait passer plus de réservations que la limite : `pnpm test:rls chat-quota` → 3 échecs (C5, C6 ×2). Restauration : réexécuter `supabase/migrations/20261108120000_chat_quota.sql` sur la pile (`psql … < fichier`, idempotent).

## Couverture et limites

Couverture par preuve et résultats : `docs/audit/AUDIT.md`, §9, §10, §13, §15 (onboarding entreprise), §16 (droits des entreprises), §17 (offres et modération) et §18 (sélection et visibilité des candidats), §19 (signature des contrats) §20 (début de mission, code de fin et évaluations), §22 (temps réel), §26 (réputation EasyJob), §27 (CNI en cours de validité, tâches et détail d'offre), §29 (dossier entreprise vérifié par EasyJob) et §23 (vérification du téléphone, retour OAuth, EasyBot, erreurs et journaux). `contracts`, `missions`, `mission_check_ins`, `mission_completion_codes` et `reviews` sont couverts en lecture et en écriture.
