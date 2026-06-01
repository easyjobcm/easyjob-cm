# AGENTS.md — Easyjob CM

Ce fichier configure les agents IA pour le projet Easyjob CM.
Il est lu automatiquement par Copilot CLI, Claude Code et Gemini.

## Projet

Easyjob CM est une plateforme de gig economy pour le Cameroun (Douala, Yaoundé).
Missions temporaires et permanentes. Paiement Mobile Money. PWA installable.

## Stack

Next.js 14 App Router · TypeScript strict · Tailwind · shadcn/ui · Supabase
Framer Motion · Three.js · lottie-react · next-pwa · next-intl · Zod · Vercel

## Agents disponibles

| Agent | Fichier | Usage |
|---|---|---|
| Easyjob Dev | .github/agents/easyjob-dev.agent.md | Développement général |
| Easyjob DB | .github/agents/easyjob-db.agent.md | Base de données Supabase |
| Easyjob Design | .github/agents/easyjob-design.agent.md | UI, 3D, animations |
| Easyjob Review | .github/agents/easyjob-review.agent.md | Code review avant merge |

## Commandes disponibles

```bash
# VS Code Copilot Chat — sélectionner dans le menu agent
# Copilot CLI
/agent easyjob-dev    # développement général
/agent easyjob-db     # base de données
/agent easyjob-design # design et animations
/agent easyjob-review # code review
```

## Règles universelles

- TypeScript strict, jamais de `any`
- Couleur violette #7C3AED sur toute l'interface
- Framer Motion sur tous les éléments interactifs
- Zod validation côté client ET serveur
- Textes via next-intl uniquement
- Mobile-first + safe-area-inset PWA
- Jamais exposer les données candidat aux entreprises
- Jamais utiliser wallets/withdrawal_requests/payment_batches

## Documentation de référence

- SRS v1.1 : SRS_EasyJob_CM_MVP.md
- User Stories : UserStories_EasyJob_CM_MVP.md
- Design : DESIGN_REFERENCE.md
- Instructions Copilot : COPILOT_INSTRUCTIONS.md
