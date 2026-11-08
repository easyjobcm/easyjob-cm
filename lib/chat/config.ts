/**
 * Paramètres d'EasyBot (`/api/chat`, audit F-15, lot 8). Source UNIQUE des
 * seuils : la route, le client (historique envoyé) et la RPC
 * `consume_chat_quota` (seuils passés en paramètres) les lisent ici.
 * Choix et coût estimé : docs/chatbot.md.
 */
export const CHAT_LIMITS = {
  /** Corps HTTP maximal (octets), contrôlé avant toute lecture JSON. */
  maxBodyBytes: 32 * 1024,
  /** Messages par requête (historique compris). */
  maxMessages: 12,
  /** Messages d'historique envoyés par le client (< maxMessages). */
  clientHistoryMessages: 10,
  /** Longueur d'un message utilisateur (caractères). */
  maxUserMessageChars: 1_000,
  /**
   * Longueur d'un message assistant renvoyé dans l'historique. Une réponse
   * de `maxOutputTokens` jetons fait environ 2 000 caractères.
   */
  maxAssistantMessageChars: 4_000,
  /** Somme des longueurs de tous les messages. */
  maxConversationChars: 12_000,
  /** Budget de sortie par réponse (jetons), fixé par le serveur. */
  maxOutputTokens: 500,
  /** Requêtes acceptées par utilisateur sur une heure glissante. */
  userPerHour: 20,
  /** Requêtes acceptées par utilisateur sur 24 h glissantes. */
  userPerDay: 60,
  /**
   * Requêtes acceptées par IP sur une heure glissante, uniquement quand
   * l'IP est fiable (Vercel). Élevé : les opérateurs mobiles camerounais
   * partagent une même IP publique entre de nombreux abonnés (CGNAT).
   */
  ipPerHour: 120,
} as const;

/** Modèle choisi par le serveur (passerelle Vercel AI : `fournisseur/modèle`). */
export const CHAT_MODEL = "openai/gpt-5-mini";

// Durée maximale de la fonction : `maxDuration = 30` dans
// app/api/chat/route.ts (Next exige un littéral dans le fichier de route).

/** Rôles de message acceptés depuis le client (jamais `system` ni `tool`). */
export const CHAT_CLIENT_ROLES = ["user", "assistant"] as const;
