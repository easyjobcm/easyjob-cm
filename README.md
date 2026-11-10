# EasyJob CM

Plateforme de missions temporaires au Cameroun (candidats, entreprises,
administration). Next.js (App Router) et Supabase ; versions dans
`package.json`.

Consignes de code, emplacements et règles communes (développeurs et agents) :
[AGENTS.md](AGENTS.md).

## Démarrage rapide (Windows, PowerShell)

Prérequis : Node.js et pnpm aux versions de `package.json` (`engines.node`,
`packageManager`), Docker Desktop démarré, Git.

```powershell
pnpm install                       # installe aussi les hooks Git (Husky)
Copy-Item .env.example .env.local  # si .env.local n'existe pas encore
pnpm bootstrap:local               # pile Supabase locale + données fictives
pnpm env:target                    # doit afficher « pile de développement locale »
pnpm dev                           # http://localhost:3000
```

`pnpm bootstrap:local` :

- démarre la pile Supabase de développement (`easyjob-cm`, API
  `127.0.0.1:54321`, Studio `:54323`, Mailpit `:54324`) ;
- **réécrit** dans `.env.local` l'URL et les clés Supabase vers cette pile. Si
  `.env.local` visait un projet distant, il est d'abord copié dans
  `.env.local.remote.bak` ;
- **réinitialise** la base de développement (migrations rejouées, données
  effacées), puis charge les données fictives (`pnpm seed`).
  `pnpm bootstrap:local --skip-seed` saute le seed.

Connexion : les comptes du seed et leur mot de passe sont affichés à la fin
du seed (`seed-0001@easyjob.local` candidat, `seed-0004@easyjob.local`
entreprise…). Le seed suppose une base réinitialisée : sur une base déjà
remplie il échoue et liste les étapes en cause (`pnpm supabase:reset` puis
`pnpm seed`). Pour une nouvelle inscription, les emails arrivent dans
Mailpit ; en développement, les numéros `+237600000000` et `+237699999999`
acceptent le code `123456`.

Vérification rapide :

```powershell
Invoke-RestMethod http://localhost:3000/api/categories | ConvertTo-Json -Depth 3
```

## Quelle base ?

| Cible | Adresse | Usage |
|---|---|---|
| Pile de développement `easyjob-cm` | `http://127.0.0.1:54321` | `pnpm dev`, seed, essais manuels |
| Pile de preuve `easyjob-proof` | `http://127.0.0.1:54421`, hors du dépôt | `pnpm test:rls` seulement ; ses données sont effacées |
| Projet distant | `https://<ref>.supabase.co` | Production (Vercel) ; jamais de seed ni de preuve |

`pnpm env:target` lit `.env.local` et la session, et indique la base visée
sans afficher de clé. Les variables définies dans la session PowerShell
(`$env:NEXT_PUBLIC_SUPABASE_URL`…) priment sur `.env.local` : c'est ainsi
que la procédure de preuve relie l'application à sa pile.

Variables (`.env.example`) :

| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (ou `…_PUBLISHABLE_KEY`) | Client navigateur et serveur ; écrites par `bootstrap:local` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Opérations serveur en clé service et seed ; jamais côté client |
| `NEXT_PUBLIC_APP_URL` | URL publique de l'application |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_*` | Connexion Google (facultative) |
| `SUPABASE_AUTH_SMS_TWILIO_*` | SMS réels (production) |
| `AI_GATEWAY_API_KEY` | EasyBot ([docs/chatbot.md](docs/chatbot.md)) ; sans clé, `/api/chat` répond 503 |

Autres commandes de la pile de développement : `pnpm supabase:start`,
`pnpm supabase:stop`, `pnpm supabase:reset` (efface les données),
`pnpm seed`.

## Architecture

```
app/            pages (App Router) et routes HTTP app/api/**
components/     ui/ (base) et composants par domaine
lib/            supabase/ (clients typés), i18n/ (FR/EN), realtime/,
                validations/ (Zod), api/ et observability/ (erreurs, journaux)
supabase/       config.toml et migrations (schéma, RLS, RPC, triggers)
scripts/        bootstrap, seed, preuves d'autorisation (proof-*.ts)
tests/          tests unitaires Vitest
docs/           audit, procédures de test et de déploiement
```

Le navigateur parle directement à Supabase : les droits sont appliqués en
base (RLS, privilèges de colonnes, triggers, RPC). Détail et règles :
[AGENTS.md](AGENTS.md).

## Tests et contrôles

```powershell
pnpm typecheck                 # tsc --noEmit
pnpm lint                      # ESLint
pnpm exec prettier --check .   # format
pnpm test                      # tests unitaires (Vitest)
pnpm build                     # build de production
pnpm test:rls                  # suite d'autorisation, sur la pile de preuve
```

`pnpm test:rls` écrit dans la base : il refuse toute cible non locale, ne lit
jamais `.env.local`, et s'exécute sur une pile dédiée créée hors du dépôt,
avec l'application construite pour cette pile :
[docs/testing/local-proofs.md](docs/testing/local-proofs.md). Chaque preuve a
un délai (`PROOF_TIMEOUT_SECONDS`, 600 s) et chaque requête SQL de preuve
aussi (`PROOF_SQL_TIMEOUT_MS`, 60 s) ; un dépassement arrête les processus
et indique l'étape.

Hooks Git (Husky) : `pre-commit` lance ESLint et Prettier sur les fichiers
modifiés, `pre-push` le typage, le lint et le format. Ne pas les contourner
(`--no-verify`).

CI (`.github/workflows/ci.yml`, chaque PR et push vers `main-dev` et `main`) :
typage, lint, format et tests unitaires ; migrations rejouées sur une pile
jetable, types générés comparés à `lib/database.types.ts`, build relié à
cette pile et `pnpm test:rls` ; build final avec une configuration factice.

## Procédures

- Preuves d'autorisation et contrôles négatifs : [docs/testing/local-proofs.md](docs/testing/local-proofs.md)
- Mise en production, secrets, reprise : [docs/deployment/production.md](docs/deployment/production.md)
- EasyBot : [docs/chatbot.md](docs/chatbot.md)
- Audit et suivi des lots : [docs/audit/AUDIT.md](docs/audit/AUDIT.md), [docs/audit/PLAN_ACTION.md](docs/audit/PLAN_ACTION.md)

Ne jamais commiter `.env.local`, ni ses copies `.env.local.*`.
