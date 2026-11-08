# EasyBot — assistant `/api/chat`

Assistant conversationnel affiché sur l'accueil et sur `/help` (`components/chatbot/chatbot.tsx`). Le lot 8 l'a sécurisé (audit F-15, `docs/audit/AUDIT.md` §23).

## Lancer EasyBot en local

1. Appliquer les migrations, dont `20261108120000_chat_quota.sql` (table `chat_request_log`, RPC `consume_chat_quota`).
2. Dans `.env.local`, renseigner une clé de la passerelle Vercel AI :

   ```env
   AI_GATEWAY_API_KEY=...   # Vercel → AI Gateway → API keys
   ```

   Sur Vercel, la clé est facultative : le jeton OIDC du projet est utilisé.
   Sans clé ni Vercel, la route répond `503 chat_unavailable` **sans** appel ni consommation de quota.
3. Se connecter avec un compte **ouvert** (téléphone vérifié, ou administrateur) et **actif** (non suspendu). Sinon : `401` (pas de session) ou `403` (compte inactif), et l'écran l'explique.

Variables serveur (jamais `NEXT_PUBLIC_*`) :

| Variable | Rôle |
|---|---|
| `AI_GATEWAY_API_KEY` | Clé de la passerelle Vercel AI. Facultative sur Vercel (OIDC). |
| `EASYBOT_GATEWAY_URL` | Facultative. Remplace l'URL de la passerelle (`https://ai-gateway.vercel.sh/v3/ai`). Sert au fournisseur **simulé** des preuves locales ; ne jamais la définir en production. |

## Ce que le serveur impose

Tout est fixé côté serveur. Le client ne choisit ni le modèle, ni les instructions, ni le budget : un champ `system`, `model` ou `maxOutputTokens` envoyé est ignoré, un message de rôle `system` est refusé.

- **Modèle** : `CHAT_MODEL` (`openai/gpt-5-mini`), effort de raisonnement `minimal`, aucune nouvelle tentative automatique (`maxRetries: 0`) : une requête acceptée = au plus un appel payant.
- **Instructions système** : `lib/chat/system-prompt.ts`, alignées sur les parcours livrés (montant fixe en XAF par candidat et par mission, fin confirmée par le code à six chiffres, signature depuis Tâches). Aucune promesse de versement, de délai, de retrait Mobile Money ou de frais. À relire à chaque changement de parcours ; `tests/chat-request.test.ts` vérifie l'absence des promesses retirées.
- **Ordre des contrôles**, tous avant l'appel payant (`lib/chat/handler.ts`) : session (401) → compte actif (403) → taille du corps (413) → forme, rôles, nombre et longueur des messages (400 ou 413) → fournisseur configuré (503) → quota (429, en-tête `Retry-After`) → modèle.

## Seuils (source unique : `lib/chat/config.ts`)

| Paramètre | Valeur | Raison |
|---|---|---|
| `maxBodyBytes` | 32 Kio | Refus avant lecture JSON (Content-Length puis flux réel). |
| `maxMessages` | 12 | Historique borné ; le client n'en envoie que 10 (`clientHistoryMessages`), texte seul. |
| `maxUserMessageChars` | 1 000 | Une question ; même limite dans le champ de saisie (Zod client `lib/validations/chat.ts`). |
| `maxAssistantMessageChars` | 4 000 | Une réponse de 500 jetons fait environ 2 000 caractères. |
| `maxConversationChars` | 12 000 | Plafond de l'entrée par requête. |
| `maxOutputTokens` | 500 | Budget de sortie par réponse. |
| `userPerHour` | 20 | Quota par compte, heure glissante. |
| `userPerDay` | 60 | Quota par compte, 24 h glissantes. |
| `ipPerHour` | 120 | Par IP **fiable** seulement (Vercel, `observedClientIp`) ; élevé car les opérateurs mobiles partagent une même IP publique (CGNAT). Hors Vercel, pas de limite par IP : les en-têtes seraient falsifiables. |

Plafond d'usage qui en découle, par compte et par jour : 60 requêtes, chacune d'au plus environ 3 500 jetons d'entrée (instructions de 1 900 caractères + 12 000 caractères de conversation) et 500 jetons de sortie. Le coût monétaire dépend du tarif du modèle sur la passerelle au moment de l'appel ; le vérifier sur le tableau de bord Vercel AI Gateway avant d'ajuster les seuils.

## Quota

`consume_chat_quota(p_user_id, p_user_per_hour, p_user_per_day, p_ip_per_hour, p_ip)` (clé service uniquement) prend un verrou consultatif transactionnel par compte, puis par IP, compte les requêtes des fenêtres et enregistre la réservation dans la même transaction. N requêtes simultanées à la limite ne passent donc pas toutes, quel que soit le nombre d'instances serveur. Une requête refusée en 4xx ne consomme rien ; une requête acceptée est comptée même si le fournisseur échoue (pas de relance gratuite en boucle). Une erreur de la RPC donne `503`, jamais un appel non compté. `chat_request_log` ne contient ni contenu ni réponse ; il est purgé à 2 jours (pg_cron).

## Confidentialité et journaux

- Aucun contenu de conversation n'est journalisé ni stocké.
- Une erreur du fournisseur est journalisée (`op: "chat.provider"`, catégorie `provider`, code) et l'écran reçoit seulement `chat_unavailable`.
- Refus journalisés en `warn` avec une raison sûre (`body_too_large`, `invalid_role`, `chat_quota_user_hourly`…) et l'identifiant de requête Vercel.

## Tests

- `tests/chat-request.test.ts`, `tests/chat-handler.test.ts` : validation, ordre des refus, fournisseur simulé `MockLanguageModelV3` qui compte les appels.
- `pnpm test:rls chat-quota` : route réelle, sessions réelles, quota en base, fournisseur simulé HTTP local (procédure : `docs/testing/local-proofs.md`).
