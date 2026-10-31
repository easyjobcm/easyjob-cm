# Exécuter les scripts de preuve en local

Les scripts `scripts/proof-*.ts` créent, modifient et suppriment des comptes et des données. Deux garanties différentes s'appliquent :

- **Cible locale (imposée par le code).** `scripts/lib/local-supabase.ts` refuse, avant toute écriture, tout hôte autre que `localhost`, `127.0.0.1` ou `[::1]` (analyse par `URL`, sans contournement). Les scripts ne lisent jamais `.env.local`, qui vise le projet distant. Ils lisent `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` (noms produits par `supabase status -o env`) et `NEXT_APP_URL` (défaut : `http://localhost:3000`). `proof-license-gate` lit aussi `DB_URL` et le passe en `--db-url` à `supabase db query`, car `--local` viserait la pile du dépôt.
- **Pile dédiée (assurée par la procédure, pas par le code).** Une adresse locale peut aussi être celle de la pile de développement (`easyjob-cm`, port 54321), dont les données doivent être préservées. Le garde-fou ne fait pas la différence. Seule la procédure ci-dessous garantit l'usage de la pile `easyjob-proof` (API sur le port **54421**) : elle charge les identifiants depuis `supabase status --workdir $stack`.

## Procédure (PowerShell, depuis la racine du dépôt)

Prérequis : Docker Desktop démarré, `pnpm install` effectué.

```powershell
# 1. Préparer la pile dédiée (hors du dépôt) puis la démarrer.
#    À relancer après tout ajout de migration.
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

# 3. Preuves sans application Next (exemple) :
pnpm exec tsx scripts/proof-account-security.ts
```

Les autres preuves appellent aussi l'application. Démarrez-la sur la **même** pile, dans un second terminal où vous avez exécuté l'étape 2. Les variables du processus priment sur `.env.local` :

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = $env:API_URL
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $env:ANON_KEY
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = $env:ANON_KEY
$env:SUPABASE_URL = $env:API_URL
$env:SUPABASE_SERVICE_ROLE_KEY = $env:SERVICE_ROLE_KEY
$env:MOBILE_MONEY_SANDBOX = "true"
pnpm exec next dev -p 3100
```

Puis, dans le premier terminal :

```powershell
$env:NEXT_APP_URL = "http://localhost:3100"
pnpm exec tsx scripts/proof-admin-centralization.ts
```

Vérifier `NEXT_APP_URL` prouve seulement que les requêtes partent vers une app locale. Cela ne dit pas quelle base son serveur utilise. Un `next dev` lancé sans ces variables lit `.env.local` et vise le projet distant. Avant de lancer `next dev`, contrôlez dans ce terminal que `$env:NEXT_PUBLIC_SUPABASE_URL` vaut `http://127.0.0.1:54421`.

```powershell
# 4. Supprimer la pile dédiée (conteneurs et données) à la fin.
pnpm exec supabase stop --workdir $stack --no-backup
```

## État connu des preuves

Voir `docs/audit/AUDIT.md`, §9 et §10. `proof-admin-cni` (9 assertions en échec, antérieures au lot 1) et `proof-essentials-gate` (fixture absente et code `essentials_incomplete` obsolète depuis T8.3) sont des échecs préexistants. `proof-business-permissions` (lot 2) appelle aussi l'application (sections E et H) ; l'option `--skip-route` permet de l'exécuter sans elle.
