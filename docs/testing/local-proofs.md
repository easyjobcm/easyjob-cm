# Suite d'autorisation et scripts de preuve

`pnpm test:rls` (`scripts/run-security-proofs.ts`) exécute les 18 preuves `scripts/proof-*.ts` l'une après l'autre et se termine en échec si une seule échoue. La CI l'exécute dans le job `test-migrations` (`.github/workflows/ci.yml`) sur une pile préparée de la même façon.

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

## Couverture et limites

Couverture par preuve et résultats : `docs/audit/AUDIT.md`, §9, §10, §13, §15 (onboarding entreprise) et §16 (droits des entreprises). Les tables `contracts` et `missions` n'ont pas encore de preuve dédiée (lot 7).
