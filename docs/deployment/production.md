# Déploiement production et reprise après échec

Ce document décrit la chaîne de mise en production (`.github/workflows/release.yml`, puis `deploy.yml`), ses réglages manuels et la conduite à tenir quand une étape échoue. La CI est décrite dans le [README](../../README.md#7-ci-github-actions).

Environnement actuel : Supabase Free, aucune donnée à préserver, previews Vercel activées.

## 1. Chaîne de déploiement

```
PR main-dev -> main (mergée, version déjà incrémentée dans la PR)
  -> ci.yml (push sur main) sur le commit mergé
  -> release.yml (workflow_run : CI réussie) : tag vX.Y.Z sur ce commit, poussé avec GH_PAT, puis GitHub Release
  -> deploy.yml (push du tag) :
       resolve-release  tag -> SHA unique, commit présent dans main, CI (push) réussie sur ce SHA
       deploy-database  supabase link, db push --dry-run, db push
       deploy-vercel    vercel pull, build, deploy --prebuilt --prod   (seulement si deploy-database a réussi)
       notify           résumé, échec si un job a échoué
```

- **Commit déployé.** `resolve-release` résout le tag une seule fois en SHA. Les deux jobs de déploiement extraient ce SHA, et non le tag : un tag déplacé entre deux jobs ne change rien. Sur un push de tag, le déploiement est refusé si le tag ne désigne plus `github.sha`. Le commit doit appartenir à l'historique de `main`.
- **CI du commit.** `release.yml` ne tague qu'après une CI réussie, mais un tag peut aussi être poussé à la main ou relancé : un tag seul ne prouve rien. `resolve-release` interroge l'API GitHub pour les exécutions de `ci.yml` déclenchées par un **push** sur ce SHA exact. Il attend jusqu'à 50 minutes, puis échoue si la dernière n'est pas `success`. Les runs de PR sont ignorés : ils testent le commit de merge temporaire de la PR, pas le commit tagué. Pour que chaque commit poussé garde son run complet, la CI n'annule plus les runs obsolètes que sur les PR.
- **Sélection du run CI.** La requête filtre sur `ci.yml`, l'événement `push`, la branche `main` et le SHA exact. L'API ne documente pas l'ordre des résultats : le run le plus récent (`created_at`, puis `id`) est choisi explicitement, et une relance prime donc sur un ancien run. Échecs : run terminé autrement qu'en `success` (`failure`, `cancelled`, `timed_out`…), aucun run après 10 minutes, run non terminé après 50 minutes, ou erreur de l'API (code de sortie non nul de `gh`). Le job lit les runs avec `actions: read` et les refs et comparaisons avec `contents: read`. Toute permission non déclarée vaut `none`.
- **Concurrence.** Groupe `deploy-production`, `cancel-in-progress: false`, `queue: max`. Une exécution en cours n'est jamais annulée par une nouvelle. Avec `queue: max`, jusqu'à 100 exécutions peuvent attendre au lieu de se remplacer. Elles sont traitées une à une, en principe dans l'ordre d'arrivée, sans garantie stricte. Au-delà de 100, les suivantes sont refusées ([concurrence](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs), [limites](https://docs.github.com/en/actions/reference/limits), [changelog du 7 mai 2026](https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/)). Ne pas annuler à la main une exécution pendant l'étape `Apply production migrations`.
- **Lancement manuel.** `workflow_dispatch` n'accepte qu'un tag `vX.Y.Z`. Le fichier `deploy.yml` exécuté est celui de la branche choisie dans « Use workflow from » (en principe `main`). Le code déployé est celui du tag. Voir le §5.4 avant de redéployer un ancien tag.

### Déploiement Git Vercel et déploiement par GitHub Actions

Le projet Vercel est relié au dépôt, avec `main` comme branche de production. Deux mécanismes coexistent :

| | Déploiement Git automatique (intégration Vercel) | Déploiement par GitHub Actions (`deploy.yml`) |
|---|---|---|
| Déclencheur | Chaque push sur une branche du dépôt | Tag `vX.Y.Z` ou lancement manuel |
| Build | Sur l'infrastructure Vercel, à partir du commit poussé | Sur le runner : `vercel build`, puis envoi du résultat (`--prebuilt`) |
| Contrôles préalables | Aucun : ni CI, ni migrations | CI réussie sur le SHA, puis migrations appliquées |
| Usage | **Previews** des branches autres que `main` | **Production**, chemin unique |

`vercel.json` désactive le déploiement Git automatique de `main` seulement (`git.deploymentEnabled`, [Git configuration](https://vercel.com/docs/project-configuration/git-configuration)). Une branche absente de la règle reste à `true` : les previews de `main-dev`, `feat/*`, `fix/*`… sont inchangées. Le motif est comparé au nom exact de la branche : `maintenance` ou `main-dev` ne sont pas concernées.

Cette règle ne bloque pas `deploy.yml`, pour trois raisons :
- la documentation la limite aux déploiements « upon commits » ;
- le [guide Vercel pour GitHub Actions](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel) recommande précisément `deploymentEnabled` avec `vercel deploy --prebuilt` ;
- la CLI 64.5.0 n'évalue pas cette clé (absente de son code). Elle transmet comme branche celle du checkout, qui vaut `HEAD` dans `deploy.yml`, puisque le SHA est extrait en tête détachée.

**Comportement attendu, à confirmer à distance :** un push ou un merge sur `main` ne crée **aucun** déploiement Git (pas même un déploiement annulé). La production n'est mise à jour que par le job `deploy-vercel`.

### Activation initiale (premier merge contenant `vercel.json`)

La documentation Vercel ne précise pas si la règle s'applique déjà au push qui introduit `vercel.json`, ni si elle est lue dans le commit poussé. Des signalements publics font état de règles non respectées ([vercel#11176](https://github.com/vercel/vercel/issues/11176)). Le premier merge `main-dev` → `main` **n'est donc pas garanti** sans déploiement Git automatique. Or il apporte les migrations des lots 1 à 4 : un déploiement Git de ce commit mettrait en ligne une application qui suppose un schéma pas encore migré.

Action manuelle avant ce merge, dans Vercel → Settings → Build and Deployment → **Ignored Build Step** → **Custom** :

```bash
[ "$VERCEL_GIT_COMMIT_REF" = "main" ]
```

Le code de sortie 0 annule le build ([Ignored Build Step](https://vercel.com/docs/project-configuration/project-settings#ignored-build-step)). Seuls les builds de `main` sont donc annulés, et les previews continuent, puisque la commande sort en 1 pour toute autre branche. N'utilisez pas « Don't build anything » ni « Only build preview » : ces options visent tous les builds, ou l'environnement de production en entier, et pourraient annuler aussi le déploiement de `deploy.yml`. Pour celui-ci, la branche transmise vaut `HEAD`, et la commande laisserait passer le build si elle était évaluée ; ce point reste à confirmer à distance.

Après le merge, dans Vercel → Deployments :
1. **Aucun déploiement** pour le commit de merge : `vercel.json` a été appliqué dès le premier push. Supprimez alors la commande, en revenant à « Automatic ».
2. **Un déploiement « Canceled »** sur ce commit : seule la commande a agi. Gardez-la, et recommencez la vérification au push suivant sur `main`.
3. Le déploiement de production attendu est celui créé par `deploy-vercel`, après `deploy-database`. S'il était annulé, retirez la commande, puis « Re-run failed jobs ».

Les builds annulés comptent dans les quotas de déploiement Vercel.

## 2. Versions

| Outil | Version | Source unique |
|---|---|---|
| pnpm | 11.1.3, celle qui produit `pnpm-lock.yaml` | `packageManager` dans `package.json`, lu par `pnpm/action-setup` (CI, deploy) |
| Node.js | 22.x | `engines.node` dans `package.json`, lu par `actions/setup-node` (`node-version-file`) |
| CLI Supabase | 2.117.0 | `devDependencies.supabase`, installée par `pnpm install --frozen-lockfile` et appelée par `pnpm exec supabase`, comme dans `test-migrations` |
| CLI Vercel | 64.5.0 | `VERCEL_CLI_VERSION` dans `deploy.yml` |

**Choix de la CLI Vercel.** Vercel publie plusieurs versions par semaine, dont une majeure presque chaque semaine. La 64.5.0 (16 octobre 2026) est la plus récente publiée depuis au moins deux semaines. Les notes de version des majeures 63 à 65 ([CHANGELOG](https://github.com/vercel/vercel/blob/main/packages/cli/CHANGELOG.md)) ne touchent pas `pull`, `build --prod` et `deploy --prebuilt --prod`. La 64.6.0 renomme `--target` en `--environment` pour `deploy` et `build`, sans modifier `--prod`. Les trois options utilisées ont été vérifiées dans l'aide de la 64.5.0. La CLI est installée par `npm install --global` : sa version est figée, mais pas ses dépendances transitives, contrairement au lockfile. Pour monter de version : relire le CHANGELOG depuis la version actuelle, vérifier ces trois commandes, puis modifier `VERCEL_CLI_VERSION`.

## 3. Secrets et réglages manuels

Aucune valeur n'est écrite dans le dépôt. Les secrets se gèrent dans GitHub → Settings → Secrets and variables → Actions.

| Secret | Utilisé par | Contenu attendu |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | `supabase link`, `db push --linked` | Jeton personnel Supabase (Account → Access Tokens). `link` lit les clés API du projet : un jeton à portée restreinte doit au moins lire les réglages du projet, les clés API et leurs secrets ([guide Supabase](https://supabase.com/docs/guides/deployment/managing-environments)). |
| `SUPABASE_PROJECT_ID` | `supabase link --project-ref` | Reference ID du projet de production (Settings → General) |
| `SUPABASE_DB_PASSWORD` | `db push` (variable lue par la CLI) | Mot de passe de la base (Settings → Database). Il n'est plus inséré dans une URL : aucun encodage requis. |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | `deploy-vercel` | Jeton Vercel, et identifiants présents dans `.vercel/project.json` après `vercel link` ([guide Vercel](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel)) |
| `GH_PAT` | `release.yml` (push du tag uniquement) | Jeton capable de pousser un tag sur ce dépôt. Il ne pousse plus rien sur `main`. Droits détaillés au §9. |

À faire soi-même :
- **`SUPABASE_DB_HOST` n'est plus lu.** L'hôte du pooler est désormais obtenu par `supabase link`. Ne supprimez ce secret qu'après un premier déploiement réussi. Aucun autre secret ne change de valeur.
- **Avant le premier déploiement**, vérifiez que le projet Supabase n'est pas en pause : un projet Free inactif est suspendu, et `supabase link` échoue alors avant toute écriture. Vérifiez aussi la portée de `SUPABASE_ACCESS_TOKEN`.

## 4. Migrations : connexion et vérification préalable

### Méthode de connexion

| Mode | Hôte : port | Utilisateur | Réseau | Pour les migrations |
|---|---|---|---|---|
| Directe | `db.<ref>.supabase.co:5432` | `postgres` | IPv6 (IPv4 avec l'add-on payant) | Recommandée si IPv6 disponible |
| Pooler, mode session | `<pooler>.pooler.supabase.com:5432` | `postgres.<ref>` | IPv4 | Recommandée sans IPv6 |
| Pooler, mode transaction | `<pooler>.pooler.supabase.com:6543` | `postgres.<ref>` | IPv4 | À éviter : l'état de session est perdu entre transactions |

Source : [Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres). Avant le lot 4b, `deploy.yml` utilisait une URL construite avec le port 6543, donc le mode transaction. Changer seulement le port ne suffit pas : selon l'hôte, on obtient la connexion directe (`db.<ref>`, IPv6) ou le mode session (`pooler`).

Les runners GitHub hébergés n'ont pas d'IPv6. Le workflow suit donc la méthode du [guide Supabase](https://supabase.com/docs/guides/deployment/managing-environments) : `supabase link` puis `db push --linked`. Comportement de la CLI 2.117.0, vérifié dans son code source :
- `link` enregistre l'URL du pooler en forçant le mode session : 6543 est remplacé par 5432, sauf si le pooler est déjà en mode session ;
- `db push --linked` tente d'abord la connexion directe, avec un délai de 5 s, puis bascule sur ce pooler en mode session ;
- l'utilisateur est `postgres.<ref>` et le mot de passe vient de `SUPABASE_DB_PASSWORD`.

### Ce que vérifie `db push --dry-run`

Le dry-run se connecte, lit l'historique distant `supabase_migrations.schema_migrations`, le compare aux fichiers de `supabase/migrations` et affiche les migrations en attente, **sans lire ni exécuter leur SQL**. Il échoue avant toute écriture dans les cas suivants :
- connexion ou identifiants refusés ;
- version présente à distance mais absente du dépôt (`ErrMissingLocal`) ;
- migration locale plus ancienne que la dernière appliquée (`ErrMissingRemote`). Le workflow n'utilise pas `--include-all`.

Il **ne prouve pas** que les migrations réussiront : erreurs SQL, contraintes violées par des données existantes, verrous, délais. La garantie d'exécution vient de la CI (`test-migrations` applique toutes les migrations sur une base vierge), sans les données de production.

### Atomicité

La CLI applique les fichiers un par un, sans transaction globale. Chaque fichier est envoyé en un lot qui se termine par l'insertion de sa ligne d'historique. Dans le cas général, un fichier en échec est donc annulé en entier, mais les fichiers précédents restent appliqués. Deux exceptions :
- un fichier qui contient `CREATE INDEX CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM`, etc. est découpé : ce qui précède l'échec reste appliqué, sans ligne d'historique ([notes de la CLI](https://github.com/supabase/cli/blob/v2.117.0/apps/cli/src/commands/db/push/SIDE_EFFECTS.md)) ;
- un fichier qui contient ses propres `begin;` / `commit;` (comme `20260526120000_srs_v11_enum_hardening.sql`) valide chaque bloc séparément.

Évitez ces deux formes dans les nouvelles migrations, ou isolez-les dans un fichier dédié et idempotent.

## 5. Reprise après échec

Règle générale : on ne revient pas en arrière sur la base par un script générique. Une correction passe par une nouvelle migration, testée en CI, puis par un nouveau tag. La convention « rollback en commentaire » des migrations (`.github/instructions/database.instructions.md`) est une aide à la rédaction d'un correctif, pas une procédure automatique.

### 5.1 Échec avant l'application des migrations

Jobs concernés : `resolve-release`, et dans `deploy-database` les étapes jusqu'à `Pending migrations (dry run)`. Aucune écriture en base : `link` n'écrit que des fichiers locaux au runner. Vercel n'est pas déployé.

1. Lire l'erreur. Causes typiques : CI échouée ou introuvable, tag invalide, projet en pause, secret erroné, historique divergent.
2. Corriger la cause. Historique divergent : examiner la situation en lecture avec `supabase migration list --linked`. Ne jamais exécuter `supabase migration repair` sans avoir compris l'écart.
3. Relancer avec « Re-run failed jobs », ou par `workflow_dispatch` avec le même tag.

### 5.2 Échec pendant l'application des migrations

L'étape `Apply production migrations` échoue. Le log indique le fichier et le numéro de l'instruction. Vercel n'est pas déployé : l'application en production reste la version précédente.

1. Constater l'état réel, en lecture : `supabase migration list --linked`, et le schéma depuis le Studio. Les fichiers antérieurs au fichier en échec sont appliqués et enregistrés.
2. Vérifier que l'application en production fonctionne avec ce schéma partiellement migré. C'est pourquoi une migration doit rester compatible avec la version précédente de l'application (ajouts d'abord, suppressions dans une release ultérieure).
3. Corriger :
   - si le fichier en échec n'apparaît pas dans l'historique distant (cas général), le corriger, ou le remplacer, par une PR, puis créer une nouvelle release ;
   - si un état partiel sans historique est resté (exceptions du §4), la remise en cohérence est une **opération manuelle distincte**, à valider avant toute exécution.
4. Ne relancez pas le même tag sans correction : il échouerait au même endroit.

### 5.3 Migrations réussies, déploiement Vercel échoué

La base est au nouveau schéma, l'application à la version précédente. Vercel ne promeut pas un déploiement en échec.

1. Vérifier que l'application en place supporte le nouveau schéma (même règle de compatibilité).
2. Panne passagère (réseau, jeton, quota) : « Re-run failed jobs ». `deploy-database` n'est pas rejoué et, s'il l'était, `db push` constaterait que tout est à jour.
3. Erreur de build ou de code : corriger par une nouvelle release. Les migrations déjà appliquées ne sont pas rejouées.

### 5.4 Revenir à une version précédente de l'application

Un ancien tag ne restaure pas la base. Son commit doit aussi avoir un run CI de push réussi. Avant le lot 4b, un run pouvait être annulé par le push suivant : relancez-le alors (« Re-run all jobs ») avant le redéploiement. Deux cas :

- **Aucune migration depuis ce tag** : `workflow_dispatch` avec l'ancien tag. Le dry-run n'a rien à appliquer, et l'ancien build est redéployé.
- **Des migrations ont été appliquées depuis** : le redéploiement par tag **échoue volontairement** au dry-run (`ErrMissingLocal` : l'ancien dépôt ne connaît pas ces versions), avant Vercel. Deux options :
  - privilégier une correction progressive : nouvelle release qui corrige l'application ou le schéma ;
  - si l'ancienne application est compatible avec le schéma actuel (à vérifier), utiliser l'[Instant Rollback Vercel](https://vercel.com/docs/instant-rollback). Sur le plan Hobby, il ne permet de revenir qu'au déploiement immédiatement précédent. Après un rollback, Vercel désactive l'attribution automatique des domaines de production : les déploiements suivants ne sont pas mis en ligne tant que le rollback n'est pas annulé (« Undo Rollback » ou `vercel promote`).

## 6. Environnement actuel sans données

L'absence de données ne change pas la chaîne normale : les migrations s'appliquent de façon incrémentale, comme plus tard en présence d'utilisateurs.

Si l'historique distant devient incohérent au point de vouloir repartir d'une base vierge, la reconstruction est une **opération manuelle distincte**, hors workflow, qui exige une nouvelle confirmation explicite. Options, de la moins à la plus intrusive :
1. corriger l'historique après analyse (`migration list`, puis `migration repair` ciblé) ;
2. réinitialiser le schéma applicatif du projet existant, puis réappliquer les migrations ;
3. créer un nouveau projet Supabase, ce qui impose de changer tous les secrets et variables qui pointent vers l'ancien.

La suppression du projet Supabase n'est pas une procédure normale.

Une base vide ne signifie pas un projet vide. Avant toute reconstruction, inventorier ce qui n'est pas dans les migrations :
- configuration Auth (fournisseurs, SMS, URL de redirection, modèles d'e-mails) ;
- buckets Storage, leurs politiques et leurs objets ;
- secrets, clés API, réglages réseau et extensions activées à la main.

## 7. Point de contrôle avant les premiers utilisateurs réels

À trancher avant d'ouvrir l'accès, et non dans ce lot. Aucun dispositif payant ni stockage externe n'est activé ici.

- **Choisir un dispositif de sauvegarde.** Le [plan Free](https://supabase.com/docs/guides/platform/backups) n'inclut ni sauvegardes quotidiennes ni PITR (réservés aux plans payants). Supabase recommande d'y exporter régulièrement les données avec `supabase db dump`. Options : passage à un plan payant, avec PITR si la perte de données tolérée est faible, ou exports planifiés vers un stockage externe protégé.
- **Couvrir la base et Storage séparément.** Les sauvegardes de base ne contiennent que les métadonnées Storage, pas les fichiers (photos CNI, documents). La [procédure de sauvegarde par CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) produit trois fichiers (rôles, schéma, données) et ne couvre ni les objets Storage, ni la configuration Auth, ni la clé racine de Vault. Un dump SQL seul ne sauvegarde pas tout le projet.
- **Fixer la conservation et la protection.** Durée de rétention, chiffrement, accès restreint : les exports contiennent des données personnelles et des documents d'identité.
- **Tester la restauration.** Restaurer au moins une fois vers un projet de test et vérifier les données, les fichiers et les connexions Auth. Une sauvegarde jamais restaurée n'est pas une sauvegarde vérifiée.
- **Ordonner sauvegarde et `db push`.** Décider si une sauvegarde doit précéder chaque `db push` en production, et l'ajouter alors au workflow.

## 8. Previews Vercel

Les previews restent activées : `vercel.json` n'exclut que `main` (§1). Elles sont construites par l'intégration Git de Vercel avec les variables de l'environnement **Preview**, sans passer par ce workflow ni appliquer de migration.

À vérifier soi-même dans Vercel → Settings → Environment Variables, sans présumer d'isolation : la base visée par `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_URL` en Preview. Si c'est le projet de production, une preview peut écrire dans la base de production, avec la clé `service_role`, depuis une branche non relue. Son code peut aussi supposer un schéma que la production n'a pas encore.

## 9. Release et protections de branches

### Fonctionnement de `release.yml`

La version est fixée dans la PR, et la release se contente de la taguer. Aucun commit n'est poussé sur `main`.

1. **Déclencheur.** `workflow_run` sur la fin de `CI`, retenu seulement si la CI a réussi, sur un `push`, pour la branche `main`. Le commit traité est `workflow_run.head_sha`, celui que la CI a testé, et non le dernier commit de `main`. `workflow_run` ne s'exécute que si le workflow existe sur la branche par défaut (`main`) ([événements](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)).
2. **Version.** Elle est lue dans le `package.json` de ce commit et doit être au format `X.Y.Z`. Une préversion (`1.0.0-beta.1`), un préfixe `v` ou une métadonnée de build sont refusés, sans conversion. Le tag vaut `vX.Y.Z`.
3. **Commit sur `main`.** Le commit doit appartenir à l'historique de `main`.
4. **Tag.**
   - S'il est absent, il est créé sur ce commit, avec un tag léger et un `git push` sans force. Le numéro doit être supérieur à la dernière release `vX.Y.Z`.
   - S'il est déjà sur ce commit, il est réutilisé : la reprise est idempotente.
   - S'il est sur un autre commit, la release **échoue sans rien modifier**.

   Le tag distant est relu après chaque tentative. Si deux exécutions le créent en même temps, Git refuse le second push, et la relecture tranche : même commit, succès ; autre commit, échec. Le tag n'est jamais déplacé ni supprimé.
5. **GitHub Release.** Elle est créée avec `GITHUB_TOKEN` (`gh release create --verify-tag`, donc jamais sans tag). Une release déjà présente n'est pas recréée.
6. **Concurrence.** `cancel-in-progress: false` et `queue: max` : les releases s'exécutent une à une, sans s'annuler.

La version affichée dans l'application vient de ce même `package.json` (`app/admin/admin-dashboard-client.tsx`, `app/profile/settings/settings-client.tsx`, `components/profile/profile-menu.tsx`).

### Jetons et déclenchement du déploiement

Un événement provoqué par `GITHUB_TOKEN` ne crée pas de nouvelle exécution de workflow, sauf `workflow_dispatch` et `repository_dispatch` ([documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)). Un tag poussé avec `GITHUB_TOKEN` ne lancerait donc pas `deploy.yml`.

Le tag est poussé par `git push`, avec `GH_PAT`. La création d'une référence par l'API REST n'est pas documentée comme un `push`, et n'est donc pas utilisée.

| Jeton | Usage | Droits minimaux |
|---|---|---|
| `GH_PAT` | Checkout du commit testé et push du tag. Aucun code du dépôt n'est exécuté dans ce job. | Accès en écriture au contenu de ce seul dépôt : jeton fin avec « Contents: Read and write », ou jeton classique `repo`. Aucun contournement de `main`. Le PAT actuel (`repo` et `workflow`) suffit. La nécessité de `workflow` pour pousser un tag sur un commit qui contient des workflows n'a pas été vérifiée : ne la retirez qu'après un essai. |
| `GITHUB_TOKEN` | Vérification « commit sur `main` » et création de la GitHub Release | `contents: write`, déclaré au niveau du job |

`deploy.yml` est inchangé : il exige toujours une CI réussie, par push, sur le SHA exact du tag.

Règles de tags, à configurer soi-même (facultatif) : un ruleset sur `refs/tags/v*` qui restreint les **mises à jour** et les **suppressions**, mais pas les créations. Les tags de release deviennent ainsi immuables, et le PAT n'a besoin d'aucun contournement. Restreindre aussi la création imposerait d'ajouter le compte du PAT à la liste de contournement des tags.

### Préparer une version

Dans une branche destinée à `main-dev`, avant la PR `main-dev` → `main` :

1. Choisir la version, au format `X.Y.Z` et supérieure au dernier tag :
   `git fetch --tags origin`, puis `git tag -l "v*" --sort=-v:refname | head -n 1`.
2. `npm version X.Y.Z --no-git-tag-version`. Cette commande modifie seulement `package.json`, sans commit ni tag.
3. Vérifier que `git diff` ne montre que la ligne `"version"`. `pnpm-lock.yaml` ne contient pas la version du projet : il ne change pas.
4. Commiter, ouvrir la PR vers `main-dev`, puis la PR `main-dev` → `main`.
5. Avant le merge : checks de la PR au vert, et tag encore absent (`git ls-remote --tags origin vX.Y.Z` ne renvoie rien).

**Merge sans nouvelle version.** Le tag `vX.Y.Z` existe déjà sur un autre commit : la release échoue, sans tag, sans GitHub Release et sans déploiement. Le tag existant n'est pas déplacé. Une version inférieure à la dernière release est refusée de la même façon. Correction : nouvelle PR qui incrémente la version, puis merge.

### Reprise en cas d'échec de la release

| Situation | Effet | Reprise |
|---|---|---|
| CI échouée sur `main` | Release non lancée | Corriger, ou relancer la CI. Sa réussite déclenche la release. |
| Version invalide, déjà taguée ailleurs ou inférieure | Rien n'est créé | Nouvelle PR avec une version correcte |
| Push du tag refusé (PAT expiré, droits, règle de tag) | Rien n'est créé | Corriger le secret ou la règle, puis « Re-run failed jobs » : même SHA, même version |
| Tag créé, GitHub Release en échec | `deploy.yml` est déjà déclenché par le tag | « Re-run failed jobs » : le tag est reconnu, la release est créée |
| Tag créé, déploiement en échec | Voir §5 | — |

### Avant le premier merge vers `main` avec ce lot

1. **Version.** `main` est en 0.1.10, à cause des anciens commits `chore(release)`, et `main-dev` en 0.1.0. Une PR qui modifie la version entrerait en conflit sur cette ligne. Intégrez d'abord `main` dans `main-dev`, par une branche de synchronisation et une PR vers `main-dev`. Préparez ensuite une version supérieure à 0.1.10. À défaut, la release échouera sur le tag `v0.1.10` existant.
2. **Vercel.** Ignored Build Step temporaire (§1, activation initiale).
3. **`GH_PAT`.** Vérifier qu'il est valide et n'a pas expiré. Il n'a plus besoin de pousser sur `main`.

### Protections recommandées

Rien n'est activé à distance par ce lot. Noms des checks : identifiants des jobs de `ci.yml` (aucun n'a de `name:`).

| Branche | Checks requis (PR) | Pourquoi |
|---|---|---|
| `main-dev` | `lint-and-types`, `test-migrations`, `build` | Exécutés sur toute PR. `enforce-main-pr-source` n'est pas exigé : il ne s'exécute que pour une PR vers `main`. |
| `main` | `enforce-main-pr-source`, `lint-and-types`, `test-migrations`, `build` | `enforce-main-pr-source` refuse toute PR vers `main` qui ne vient pas de `main-dev`. |

Points d'attention :
- choisir GitHub Actions comme source attendue des checks : un check nommé `build` émis par une autre application ne doit pas suffire ;
- `main` peut exiger une PR sans contournement : `release.yml` n'y écrit plus ;
- `deploy.yml` et `release.yml` ne sont pas des checks de PR : ils ne doivent pas figurer parmi les checks requis ;
- les règles distantes actuelles n'ont pas été lues depuis ce poste. Les comparer avant d'appliquer cette recommandation.

## 10. Validation : locale ou confirmée à distance

**Configuration validée localement** (outils officiels téléchargés hors du dépôt, sommes de contrôle vérifiées) :

| Contrôle | Outil | Résultat |
|---|---|---|
| Syntaxe, expressions, `needs`, permissions des trois workflows | actionlint 1.7.12, avec shellcheck 0.11.0 | Aucun problème, sauf `unexpected key "queue"`. Ce message vient d'actionlint, en retard sur GitHub ([issue actionlint#657](https://github.com/rhysd/actionlint/issues/657), PR #654 ouverte), et non d'une option non prise en charge : `queue` est documenté par GitHub. |
| Filtres `--jq` | gojq 0.12.19, la version embarquée par `gh` 2.103.3 | Tags annotés et légers, comparaison (`ahead`, `identical`, `behind`, `diverged`, statut absent). Runs CI : liste vide, champ absent (erreur, donc échec du job), `queued`, `in_progress`, `success`, `failure`, `cancelled`, runs multiples non triés, égalité de date. |
| Étapes `resolve-release` de bout en bout | bash, faux `gh` renvoyant du JSON réaliste filtré par gojq | 2 acceptations, 13 refus attendus : tag invalide ou injectable, tag déplacé, hors de `main`, introuvable, CI échouée, annulée, plus récente en échec, absente, trop longue, erreur API. Les délais de 10 et 50 minutes ont été ramenés à 0 pour ces tests. |
| Même SHA dans tous les jobs | analyse YAML | Les deux `actions/checkout` utilisent `needs.resolve-release.outputs.sha`. |
| Étapes de `release.yml` (version, tag) de bout en bout | vrai `git` contre un dépôt nu local, `main` avancé au-delà du commit traité | Tag absent : créé sur le SHA de l'événement, et non sur la tête de `main`. Reprise sur le même SHA, y compris avec un tag annoté : succès sans modification. Tag sur un autre SHA, version inférieure, préversion, version mal formée ou absente : échec, tag inchangé. Course forcée entre lecture et push : rival sur un autre SHA, échec et tag du rival conservé ; rival sur le même SHA, succès. Cinq courses réelles en parallèle : toujours un seul gagnant. Push refusé par un hook (droits ou règle de tag) et dépôt injoignable : échec explicite. |
| Étapes `Ensure commit is on main` et `Create GitHub Release` | faux `gh` | `ahead` et `identical` acceptés ; `behind`, `diverged` et erreur 403 refusés. Release : création, reprise sans doublon, création concurrente, permission refusée (échec). |
| `npm version X.Y.Z --no-git-tag-version` | npm, sur une copie hors du dépôt | Seul `package.json` change : ni commit, ni tag, lockfile identique, même après `pnpm install --lockfile-only`. |
| `vercel.json` | schéma officiel `openapi.vercel.sh/vercel.json` | Clés et types conformes. Les témoins négatifs sont rejetés. Seule `main` est exclue, selon minimatch. |
| Options des CLI Supabase 2.117.0 et Vercel 64.5.0, `pnpm install --frozen-lockfile` | aide des CLI, pnpm 11.1.3 | ✅ |

**À confirmer à distance**, au premier merge et au premier déploiement autorisés :
- absence de déploiement Git Vercel pour `main`, avec les previews maintenues (§1, activation initiale) ;
- déclenchement de `release.yml` par `workflow_run` après la CI du merge, puis de `deploy.yml` par le tag poussé avec `GH_PAT` ;
- droits effectifs de `GH_PAT` pour le push du tag (portée `workflow` nécessaire ou non) ;
- `queue: max` accepté à l'exécution ;
- `pnpm/action-setup` lisant `packageManager` ;
- bascule de `db push --linked` vers le pooler en mode session ;
- droits de `SUPABASE_ACCESS_TOKEN` pour `link` ;
- lecture des runs CI avec `actions: read` ;
- durée réelle de l'attente de la CI ;
- `deploy-vercel` non affecté par l'Ignored Build Step temporaire.
