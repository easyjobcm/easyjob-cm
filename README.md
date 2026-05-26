# EasyJob CM

Plateforme de gig economy pour le Cameroun.

## Stack

- Next.js 16 (App Router)
- TypeScript strict
- Supabase
- Tailwind CSS

## Objectif du repo

Ce projet est organise pour que:

- le developpement quotidien se fasse sur une base Supabase locale;
- la production utilise le projet Supabase cloud;
- un nouveau membre puisse demarrer avec un minimum de commandes;
- la CI valide lint et build a chaque push / pull request.

## Pre-requis

- Node.js 22+
- pnpm 10+
- Docker Desktop (pour Supabase local)
- Git

## 1. Installation locale, rapide

```powershell
pnpm install
Copy-Item .env.example .env.local
```

Puis configurez `.env.local` selon votre cible:

- dev local: `http://127.0.0.1:54321`
- production: URL et cles du projet Supabase cloud

## 2. Demarrage local en une commande

La voie la plus simple pour un nouveau membre:

```powershell
pnpm bootstrap:local
```

Cette commande:

- demarre Supabase local;
- reinitialise la base locale;
- injecte les donnees fictives;
- affiche l'etat de la stack.

Option utile quand vous voulez aller plus vite sans donnees de test:

```powershell
pnpm bootstrap:local -- --skip-seed
```

## 3. Commandes locales utiles

Demarrer Supabase local:

```powershell
pnpm supabase:start
```

Repartir d'une base propre avec migrations locales:

```powershell
pnpm supabase:reset
```

Charger les donnees fictives:

```powershell
pnpm seed
```

Arreter la stack locale:

```powershell
pnpm supabase:stop
```

Verifier la connexion:

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/categories -Method GET | ConvertTo-Json -Depth 6
```

## 4. Supabase local: ce que vous voyez

- Studio: `http://127.0.0.1:54323`
- Mailpit: `http://127.0.0.1:54324`
- MCP: `http://127.0.0.1:54321/mcp`

## 5. Mode production

En production, l'app Next.js pointe vers le projet Supabase cloud via:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`

Pour les operations serveur et seeds admin:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Configurer aussi les variables Mobile Money si activees:

- `MOBILE_MONEY_SANDBOX`
- `MTN_MOMO_API_KEY`
- `MTN_MOMO_API_SECRET`
- `MTN_MOMO_BASE_URL`
- `MTN_MOMO_SUBSCRIPTION_KEY`
- `ORANGE_MONEY_API_KEY`
- `ORANGE_MONEY_MERCHANT_KEY`
- `ORANGE_MONEY_BASE_URL`

## 6. Onboarding d'un nouveau membre

1. Cloner le repo.
2. Lancer `pnpm install`.
3. Copier `.env.example` vers `.env.local`.
4. Demarrer Docker Desktop.
5. Lancer `pnpm bootstrap:local`.
6. Ouvrir l'app avec `pnpm dev`.

## 7. CI GitHub Actions

Le workflow `.github/workflows/ci.yml` execute:

- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm build`

Cela garantit qu'un merge ne casse pas l'app.

## Notes utiles

- Ne jamais commiter `.env.local`.
- Pour la commande PWA, le chemin correct du layout est `./app/layout.tsx` (pas `./src/app/layout.tsx`).
