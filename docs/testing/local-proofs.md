# Suite d'autorisation et scripts de preuve

`pnpm test:rls` (`scripts/run-security-proofs.ts`) exécute les 43 preuves `scripts/proof-*.ts` l'une après l'autre et se termine en échec si une seule échoue. La CI l'exécute dans le job `test-migrations` (`.github/workflows/ci.yml`) sur une pile préparée de la même façon.

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

- **Offres de plusieurs journées (lot 12).** `proof-multi-day-jobs` place l'échéance d'une journée relativement à `now()` puis appelle la vraie RPC dans la même transaction (fonction temporaire `proof_l12_case`, clé service), et impose l'ordre de deux sélections concurrentes par un trigger ralenti (`scripts/lib/proof-barrier.ts`). Les fixtures de plusieurs journées passent par `scripts/lib/job-days-fixture.ts` (brouillon, journées, puis publication) : après publication, le calendrier est figé pour tout auteur. Depuis ce lot, un même candidat ne peut plus tenir deux engagements au même créneau : chaque offre d'une preuve qui réutilise un candidat a sa propre date.

- **Fin de journée (lot 15).** Le code d'une journée et le « code non remis » ne sont reçus qu'à sa fin prévue. Les preuves qui saisissent un code (`mission-time-tracking`, `multi-day-jobs`, `mission-incidents`, `realtime`, `company-dossier-visibility`) recalent donc la journée sur une date passée et terminée, en clé service et avant tout début. `proof-mission-completion` place la fin prévue à `now()` + décalage puis appelle la vraie RPC sous l'identité voulue, dans la même transaction (fonction temporaire `proof_l15_case`, clé service), pour tester juste avant l'échéance et l'instant exact. Les journées de nuit et celles qui finissent après minuit utilisent les horaires réels calculés par la base. Les courses code / support passent par la barrière du lot 11, avec un trigger de ralentissement sur la réalisation d'une seule journée. La panne en cours de transaction est provoquée par un trigger qui fait échouer la trace `confirm_mission_day` de cette seule journée. Fonctions et triggers sont retirés en fin de preuve et au démarrage suivant. Une fixture qui marque une mission réalisée en clé service doit aussi confirmer ses journées (`completion_source`), comme le fait `submit_completion_code` : la réputation compte les journées confirmées.

- **Journées contestées (lot 16).** `proof-mission-disputes` rejoue le balayage des échéances à un instant exact : la fonction temporaire `proof_l16_sweep(dossier, décalage)` appelle `incident_deadline_sweep(created_at + décalage)`, calculé par la base à la microseconde (un calcul côté client tronquerait à la milliseconde). La fin du délai de révision est placée à `now()` + décalage dans la même transaction que la demande (`proof_l16_review`). Les courses code / décision passent par la barrière du lot 11 ; la panne fait échouer la trace `decide_incident_double_validation` d'un seul dossier. Fonctions et triggers sont retirés en fin de preuve et au démarrage suivant. Une fixture de déclaration de conflit doit passer une valeur explicite (`null` pour « absente ») : un `undefined` réactiverait la valeur par défaut d'un paramètre.

- **Plan candidat (lot 17a).** `proof-candidate-premium` place la fin de Premium à `now()` + décalage puis appelle la vraie fonction dans la même transaction : `proof_l17a_state` (état du compte, plan à l'instant exact) et `proof_l17a_select` (« Signer et sélectionner » sous l'identité de l'entreprise, échéance à l'instant exact ou 1 µs plus tard). `proof_l17a_messages` relit les signaux émis (`realtime.messages`) pour vérifier qu'aucun ne porte le plan. Fonctions retirées en fin de preuve et au démarrage suivant ; l'historique `candidate_premium_grants`, en ajout seul, est supprimé avec les comptes de preuve.

- **Plan entreprise : fixtures (ABO-07).** Le plan d'une entreprise ne s'écrit plus directement, clé service comprise (`trg_company_plan_write_guard`). Une preuve qui a besoin d'une entreprise Premium appelle `grantCompanyPremium` (`scripts/lib/company-premium-fixture.ts`) : la vraie RPC `admin_manage_company_premium`, sous l'identité d'un `admin_ops` actif de la preuve, en connexion directe à la pile dédiée (historique, audit et notification produits). Seules les fonctions temporaires de `proof-company-premium` qui placent une fin à l'instant exact posent l'indicateur `easyjob.company_plan_write`, sur la pile de preuve.
- **Plan entreprise (ABO-07, ABO-08).** `proof-company-premium` place la fin de Premium à `now()` + décalage puis lit l'état du compte (`proof_abo07_state`) ou appelle `update_job` sous l'identité de l'entreprise (`proof_abo07_edit`), dans la même transaction (Free à l'instant exact, Premium 1 µs avant). La reprise des anciens plans se prouve sur une **connexion directe** (`supabase db query`, `session_user` postgres : voie de maintenance) : `proof_abo07_transition` retire les contraintes Free/Premium, pose des valeurs `starter`/`pro`/`business` sur des fixtures locales, rejoue refus, choix, panne et reprise, puis annule tout dans un bloc qui se termine toujours en exception. La garde réelle de la migration `20261125130000` est lue dans le fichier et exécutée dans un seul bloc `do`, toujours annulé : la CLI n'accepte qu'une commande (instruction préparée) et n'affiche que le message d'erreur, d'où la relance « GUARD:message | détail ». Aucune pile de développement ni projet distant n'est lu.

- **Annulations (lots 17b–17c).** `proof-candidate-cancellations` place le début des journées à `now()` + décalage puis appelle la vraie demande sous l'identité du candidat, dans la même transaction (`proof_l17bc_cancel`) ; `proof_l17bc_classify` évalue le classement à la limite exacte et 1 µs après. Une sélection récente rend toute journée proche « délai de réaction » : `proof_l17bc_age` antidate la sélection de 3 jours pour les cas hors délai. `proof_l17bc_end_suspension` place la fin d'une suspension à `now()` − 1 ms : une marge plus grande ferait précéder le retour de faits commis pendant la suspension, toute la séquence tenant en moins d'une seconde. Fonctions retirées en fin de preuve et au démarrage suivant.

- **Annulation par l'entreprise (lot 17d-2 ; ANN-06, ANN-04, ANN-08).** `proof-company-cancellations` sélectionne par « Signer et sélectionner » en session (conditions entreprise figées par la base) et change le plan par la vraie RPC `admin_manage_company_premium` (activation, prolongation, arrêt). `proof_l17d2_cancel` place le début des journées à `now()` + décalage puis appelle `request_company_cancellation` sous l'identité de l'entreprise, dans la même transaction (48 h et 24 h exactement, puis 1 µs de moins) ; `proof_l17d2_classify` évalue la qualification à la limite exacte et 1 µs après ; `proof_l17d2_legacy` remplace les conditions d'une journée par « legacy » (voie de maintenance) ; `proof_l17d2_tamper` tente une modification par le propriétaire (refusée). Les courses (début / annulation, désistement du candidat / annulation) partent en parallèle et n'acceptent qu'une seule issue ; la panne fait échouer la seule trace `company_cancellation` d'une offre (`proof_l17d2_fail_audit`). Fonctions et trigger retirés en fin de preuve et au démarrage suivant. Les cas F (décision ECH-09) vérifient le créneau libéré par une annulation enregistrée, de l'une ou l'autre origine, sur une période complète partiellement annulée, et la course avec une sélection définitive (trigger temporaire `proof_l17d2_slow_cancel` et barrière du lot 11). **Horaires figés (ECH-02)** : depuis ce lot, la clé service ne modifie plus les horaires d'une mission ou d'une journée de mission (`mission_schedule_locked`) ; les preuves qui recalent une journée passent par `rescheduleFixture` (`scripts/lib/mission-schedule-fixture.ts`), connexion Postgres directe à la pile dédiée, comme `purgeProofJobs`. Les tables `mission_day_company_terms`, `company_cancellations` et `company_cancellation_days` refusent toute écriture de session et de clé service (lecture seule en clé service, ni TRUNCATE) : leurs lignes partent par cascade avec les fixtures.
- **Interventions du support (lot 17d-3 ; ANN-17, ANN-18, SAN-08).** `proof-support-interventions` passe par les vraies routes et RPC sous des sessions réelles (entreprise, candidats, `admin_support`, deux `admin_ops`, `admin_founder`, un ops suspendu après connexion). Instants exacts : `proof_17d3_decide` (début de journée à `now()` + décalage puis décision), `proof_17d3_answer` (échéance de 72 h) et `proof_17d3_review` (échéance de recours), dans la même transaction que la vraie RPC. Les cas I imposent les deux ordres de la course dépôt / seconde validation par la barrière du lot 11 (déclencheurs temporaires `proof_17d3_slow_element`, `proof_17d3_slow_decision`). Les cas H vérifient les modalités du 2026-11-24 (délais égaux à l'instant de création des notifications, support instructeur, historique après infirmation, nouveaux éléments sans réouverture, réexamen d'un refus et début franchi pendant son traitement) ; les fixtures d'horloge déplacent l'échéance et l'instant de notification ensemble (contraintes « + 72 h » et « + 7 jours »). Les cas F posent la décision du lot 16 par la voie de maintenance (`proof_17d3_realization`) pour les instants exacts ; les cas G passent par les vrais parcours du lot 16 (signalement, début, proposition et revue par deux agents, demande de révision), seule l'échéance de révision étant déplacée (`proof_17d3_review_window`). `proof_17d3_suspend` pose une suspension (cause fraude, fin choisie) comme la base. Panne : la seule trace `decide_engagement_request` d'une demande échoue (`proof_17d3_fail_audit`). Depuis ce lot, un compte suspendu ne se désiste plus lui-même : `candidate-cancellations` dépose son « dossier ancien décidé tard » avant la suspension et vérifie le refus pendant la suspension (X2b). Les tables du lot refusent toute écriture de session et de clé service ; leurs lignes partent par cascade avec les fixtures (une cascade `SET NULL` reste admise, déclencheur imbriqué).
- **Recrutement de remplacement (lot 17d-4a ; ANN-14, ANN-20).** `proof-replacement-cycles` passe par les vraies RPC et routes sous des sessions réelles (entreprise, neuf candidats) : candidature, « Signer et sélectionner », désistement (`request_candidate_cancellation`), confirmation d'intérêt (`POST /api/replacement-cycles/[id]/interest`), retrait (`DELETE /api/jobs/[id]/apply?application=…`), liste publique (`GET /api/jobs`). Instants exacts : `proof_17d4_cancel` place le début des journées à `now()` + décalage puis appelle le désistement sous l'identité du candidat, dans la même transaction (4 h exactement, puis 1 µs de moins) ; la garde `trg_protect_job_day_writes` reste suspendue pendant cet appel, car elle recalcule le début depuis la date et l'heure à chaque écriture de la journée (compteur des places). `proof_17d4_at` place la fermeture d'un cycle à `now()` + décalage puis appelle la confirmation ou la sélection (H−2 exactement, puis 1 µs avant), et sert aussi à replacer la fenêtre (`shift`). `proof_17d4_close_initial` fait passer l'échéance initiale (journées au choix seulement pour `job_days`, une période n'a pas d'échéance par journée). `proof_17d4_cni` change l'échéance de la CNI d'un profil vérifié : la clé service ne le peut pas (protections du profil). Panne : un déclencheur temporaire fait échouer l'avis d'un seul candidat (`proof_17d4_fail_notice`). Fonctions et déclencheur retirés en fin de preuve et au démarrage suivant. Relances (§50) : trois envois simultanés d'une même demande de désistement retrouvent tous le résultat initial (une seule réponse `already_recorded = false`) ; des demandes différentes restent refusées (`mission_not_active`). Annulation par l'entreprise d'une date couverte (cas A1 à A6) : `proof_17d4_fail_event` fait échouer la neutralisation (rien ne doit être enregistré). Course annulation / sélection (R2, R3) : `proof_17d4_company_cancel_hold` et `proof_17d4_select_hold` appellent la vraie RPC sous l'identité de l'entreprise puis tiennent la transaction ouverte 2,5 s ; l'opération concurrente, lancée pendant l'attente, s'exécute après elle. Entreprise non autorisée (S1 à S4) : dossier repassé `pending` puis revalidé par `approveCompanyDossier`, compte suspendu puis rétabli par `users.is_active`, toujours restaurés dans un `finally`. Date annulée, échéance initiale ouverte (O1 à O8, §51) : candidature et sélection ordinaires par la route et par appel direct, état lu, autre journée, période complète, retrait ciblé accepté par un compte `admin_ops` de la preuve (date non annulée), concurrence avec la sélection dans les deux ordres et avec la candidature (mêmes fonctions de maintien de transaction). Réputation de l'entreprise (Q1 à Q4, §52) : `proof_17d4_offers` lit les unités « offre » à un instant donné, `proof_17d4_sweep_due` replace la fermeture du cycle et l'échéance du score juste avant l'instant courant puis lance `reputation_expiry_sweep`. 61 cas.
- **Clôture des offres (lot 17d-1).** `proof-job-closure` crée ses offres par `scripts/lib/job-days-fixture.ts` (brouillon, en attente jamais approuvée, publiée, publiée puis revenue en modération par une écriture en clé service, historique `legacy_publication` insérée directement) et passe par les vraies routes (`DELETE /api/jobs/[id]`, `POST /api/jobs/[id]/close`, candidature) et les vraies RPC sous des sessions réelles. Les courses clôture/candidature et clôture/sélection suivent la barrière du lot 11 : triggers temporaires `proof_l17d1_slow_close` (avant la mise à jour qui pose `closed_at`), `proof_l17d1_slow_apply` (après l'insertion de la candidature) et `proof_l17d1_slow_select` (après le passage à `selected`). La panne fait échouer la seule trace `close_job` d'une offre (`proof_l17d1_fail_audit`). `proof_l17d1_messages` relit `realtime.messages`. Fonctions et triggers sont retirés en fin de preuve et au démarrage suivant. **Nettoyage** : l'historique d'une offre publiée (offre, candidatures, clôture) ne s'efface plus par l'application, clé service et cascades comprises (`job_history_protected`) ; les preuves qui créent des offres purgent donc leurs fixtures par `scripts/lib/proof-purge.ts` (`purgeProofJobs`), une connexion Postgres directe à la pile dédiée (`readLocalDbUrl`, hôte local imposé, session `postgres`), appelée en tête de leur nettoyage ; aucune voie n'est ouverte à l'application. Depuis ce lot, une offre publiée ne se supprime plus : `job-moderation` (I3, I8-I10), `candidate-selection` (C4) et `realtime` (J12) testent la clôture à la place de la suppression d'une offre publiée. Les constats du lot 17d-0 sont dans `candidate-cancellations` (D1, D2 : unité « offre » évaluée à un instant postérieur à toutes les échéances, fonction `proof_l17d_realize` pour une mission entièrement réalisée) et `mission-incidents` (N1 : dossier d'absence tranché par la double validation du lot 16).

- **Interruptions.** `proof-mission-interruptions` place une journée en cours (commencée il y a 1 h, fin prévue à `now()` + décalage) par `proof_lip_progress`, puis passe par les vraies routes (signalement, demandes du support, décisions du fondateur, réponses des parties, recours) et la vraie réception du code, sous des sessions réelles. Les délais ne sont jamais attendus : `proof_lip_opened`, `proof_lip_request_due`, `proof_lip_proposal_due` et `proof_lip_age_proposal` déplacent les instants en ne levant que la protection d'écriture de la table concernée ; `proof_lip_open` et `proof_lip_state` lisent les bornes et l'étape calculées par la base ; les rappels sont rejoués par `interruption_deadline_sweep(p_at)`. La preuve utilise les bornes réelles de la migration (plafond lu dans le contrat figé) et ne remplace aucune fonction de bornes ; propositions et acceptations passent toujours par les routes. `proof_lip_force` tente une confirmation support ou exceptionnelle en ne levant que la protection des écritures de session. Fonctions retirées en fin de preuve et au démarrage suivant.

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

Pour la suppression : `grant delete on public.jobs to authenticated; alter table public.jobs disable trigger trg_protect_job_writes; create policy neg_owner_delete on public.jobs for delete to authenticated using (company_id in (select id from public.company_profiles where user_id = auth.uid())); alter table public.jobs disable trigger trg_job_history_guard;`, puis `pnpm test:rls job-moderation` (attendu : 4 échecs, B10, I1, I2, I3 ; remesuré le 2026-11-19). Depuis le lot 17d-1, sans désactiver `trg_job_history_guard`, la garde de l'historique compense les autres couches : 1 seul échec (B10, catalogue), à juste titre. Si `db reset` échoue ensuite, recréer la pile : `supabase stop --workdir $stack --no-backup`, puis l'étape 1.

`job-moderation` crée aussi, le temps d'une assertion, un trigger qui fait échouer l'écriture dans `audit_logs` pour une seule offre, afin de prouver l'absence d'effet partiel, et deux triggers de ralentissement (`pg_sleep`) pour forcer l'ordre entre une sélection et une suppression ; depuis le lot 11, la seconde opération attend d'avoir observé la première dans son trigger (voir « Courses à ordre imposé »). Ils ne visent que les lignes de la preuve et sont retirés en fin de preuve, même en cas d'échec.

Pour la clôture (lot 17d-1), remettre l'ancien `delete_job` (extrait de `supabase/migrations/20261101140000_job_moderation.sql`, sans le refus `job_published`) et désactiver la garde de réouverture reproduit la suppression d'une offre publiée et la réouverture d'une offre clôturée :

```powershell
# neg-17d1.sql : delete_job de 20261101140000
#   + « alter table public.jobs disable trigger trg_job_closure_guard; »
#   + « alter table public.jobs disable trigger trg_job_history_guard; »
Get-Content $env:TEMP\neg-17d1.sql -Raw | docker exec -i supabase_db_easyjob-proof psql -U postgres -d postgres -v ON_ERROR_STOP=1
pnpm test:rls job-closure   # attendu : 7 échecs (S2, S3 offres publiées effacées ; D3 réouverture en clé service ; H1 historique effacé en clé service ; D2, D4, D5 en conséquence), code de sortie 1
pnpm exec supabase db reset --workdir $stack   # restauration, puis 28/28
# Contrôle étroit : seules les gardes de l'historique désactivées
# (trg_job_history_guard sur jobs, trg_job_application_history_guard sur job_applications)
# → 2 échecs (H1 effacement en clé service et cascades ; D4 en conséquence).
```

Pour l'annulation par l'entreprise (lot 17d-2), quatre relâchements indépendants, chacun détecté (mesuré le 2026-11-22) :

```powershell
# N1 : journée annulée de nouveau commençable et confirmable
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "alter table public.mission_days disable trigger trg_block_cancelled_day;"
pnpm test:rls company-cancellations   # attendu : 1 échec (R3), code de sortie 1 ; puis « enable trigger »
# N2 : conditions figées réécrivables en clé service
docker exec supabase_db_easyjob-proof psql -U postgres -d postgres -c "grant insert, update, delete on public.mission_day_company_terms to service_role; alter table public.mission_day_company_terms disable trigger trg_protect_mission_day_company_terms;"
pnpm test:rls company-cancellations   # attendu : 1 échec (T4) ; puis revoke et « enable trigger »
# N3 : protect_reputation_incidents remis à sa version 17b (sans l'annulation de l'entreprise)
pnpm test:rls company-cancellations   # attendu : 1 échec (R3 : absence et annulation tardive imputées au candidat) ; puis db reset
# N4 : candidate_schedule_conflicts remis à sa version du lot 12 (journée annulée encore bloquante)
pnpm test:rls company-cancellations   # attendu : 3 échecs (F1, F3b, F4) ; puis db reset
```

Pour les interventions du support (lot 17d-3), quatre relâchements, chacun détecté (mesuré le 2026-11-23, restauration en réappliquant la migration `20261127120000`) : N1 `request_candidate_cancellation` sans contrôle de suspension → S2 à S5 ; N2 décision ouverte à tout admin actif (`is_admin_user`) → R2 à R4 ; N3 déclencheur qui produirait un `candidate_no_show` sur un constat établi → F5 ; N5 garde `trg_guard_confirmation_vs_absence_finding` désactivée → G2, G5 ; N7 élément reçu avant la décision seulement journalisé, sans révision → I1, I3 ; N6 `absence_finding_check` réduit à la contestation → G4 ; N4 `engagement_requests` réécrivable en clé service (privilège et garde levés) → D1 (premier essai non détecté : D1 tentait une modification invalide au regard des contraintes ; corrigé pour viser une modification valide sur une colonne réelle de chaque table).

Pour le recrutement de remplacement (lot 17d-4a), cinq relâchements, chacun détecté (mesuré le 2026-11-25 ; copie modifiée lue par `pg_get_functiondef` sur la pile dédiée, restauration en réappliquant la migration `20261128120000`, puis réinitialisation, car une contrainte supprimée n'est pas recréée sur une table existante) : N1 `replacement_cycle_on_withdrawal` sans le seuil de 4 h → T1, T2b ; N2 `selection_prepare` sans `replacement_candidate_blocker` → E1 (puis E3, T4, K2) ; N3 `selection_prepare` sans le contrôle des places du cycle et contrainte `replacement_cycles_places_chk` supprimée → K1, R1 ; N4 `trg_guard_replacement_application` désactivé → X2 ; N5 `replacement_cycle_alert` étendu aux candidatures retirées → D2, D3. Compléments du §50, cinq autres relâchements, chacun détecté (mesuré le 2026-11-25, copie modifiée produite depuis la migration, restauration en la réappliquant) : N6 `replacement_cycles_on_company_cancellation` sans effet → A1, A2, A4, A5, R2, R3 ; N7 `replacement_cycle_remaining` et `selection_prepare` sans prise en compte de l'annulation → A2, A4, A5, R2 ; N8 `request_candidate_cancellation` contrôlant l'état des missions avant de relire la demande → P2 ; N9 `replacement_cycle_alert` retenant les avis en cas de suspension → S3, S4 ; N10 `replacement_cycle_on_withdrawal` sans la garde des dates annulées → A6. Correction du §51, deux autres relâchements, chacun détecté (mesuré le 2026-11-25) : N11 contrôles `date_cancelled` retirés de `apply_to_job_core` et de `selection_prepare` (contournement réintroduit) → O1, O4, O6, O8 ; N12 `request_company_cancellation` reprenant l'offre en partage → O8. Réputation (§52) : N13 `reputation_company_offers` sans la condition du cycle ouvert → Q1, Q2 ; N14 `reputation_company_next_close` sans la fermeture du cycle → Q1.

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

Pour la reprise des anciens plans entreprise (ABO-07), recréer sur la pile dédiée `company_plan_transition_report` et `company_plan_transition_apply` avec un tri du choix le plus récent par `created_at desc, id desc` (au lieu de `seq desc`) : `pnpm test:rls company-premium` → 4 échecs (T3 et T7 : plusieurs choix enregistrés dans une même transaction ont la même `created_at`, l'ordre retombe sur un identifiant aléatoire et un choix caduc peut être retenu ; T0 et T0b en conséquence, la garde du fichier lisant `seq`). Mesuré le 2026-11-20 sur l'ancienne version des migrations (34 PASS, 4 FAIL), avant le correctif. Restauration : `supabase db reset --workdir $stack`.

Pour la garde d'écriture du plan entreprise (ABO-07), `alter table public.company_profiles disable trigger trg_company_plan_write_guard;` sur la pile dédiée : `pnpm test:rls company-premium` → 6 échecs (P4, S1, S2, S3, S6 ; S4 en conséquence). Mesuré le 2026-11-22 (38 PASS, 6 FAIL). Restauration : `enable trigger`, puis `supabase db reset --workdir $stack`.

Pour le quota d'EasyBot, recréer `consume_chat_quota` sur la pile dédiée sans ses deux `pg_advisory_xact_lock` (et avec un `perform pg_sleep(0.05);` en tête, qui élargit la fenêtre de course) fait passer plus de réservations que la limite : `pnpm test:rls chat-quota` → 3 échecs (C5, C6 ×2). Restauration : réexécuter `supabase/migrations/20261108120000_chat_quota.sql` sur la pile (`psql … < fichier`, idempotent).

## Couverture et limites

Couverture par preuve et résultats : `docs/audit/AUDIT.md`, §9, §10, §13, §15 (onboarding entreprise), §16 (droits des entreprises), §17 (offres et modération) et §18 (sélection et visibilité des candidats), §19 (signature des contrats) §20 (début de mission, code de fin et évaluations), §22 (temps réel), §26 (réputation EasyJob), §27 (CNI en cours de validité, tâches et détail d'offre), §29 (dossier entreprise vérifié par EasyJob) et §23 (vérification du téléphone, retour OAuth, EasyBot, erreurs et journaux). `contracts`, `missions`, `mission_check_ins`, `mission_completion_codes` et `reviews` sont couverts en lecture et en écriture.
