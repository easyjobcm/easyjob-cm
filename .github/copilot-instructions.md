# Easyjob CM — Instructions Copilot globales

Tu travailles sur **Easyjob CM**, une plateforme de gig economy pour le Cameroun.
Inspirée de Zenjob (Allemagne), adaptée au marché camerounais.

## Stack

Next.js 14 App Router · TypeScript strict · Tailwind CSS · shadcn/ui · Supabase
Framer Motion · Three.js + @react-three/fiber · lottie-react · next-pwa · next-intl
Zod · React Hook Form · Vercel

## Couleur signature

Violet #7C3AED. CTA : bg-[#5B21B6] rounded-full h-14 text-white shadow violet.
Fond : #FAFAFA. Cartes : bg-white border border-[#E5E7EB] rounded-[20px].
Titres section : text-[#7C3AED] text-[11px] uppercase tracking-wide.

## Règles absolues

- TypeScript strict — jamais de `any`
- Validation Zod côté client ET serveur
- Vérification de rôle côté serveur sur chaque requête sensible
- Textes via next-intl — jamais de chaîne en dur
- Framer Motion sur toutes les interactions
- Mobile-first, base 375px, safe-area-inset sur éléments fixes bas
- Données candidat (tél/email/CNI) jamais exposées aux entreprises
- Jamais utiliser wallets, withdrawal_requests, payment_batches
- Jamais de logique paiement côté client

## Rôles

candidate | candidate_premium | company | company_premium
admin_support (pas de finances) | admin_ops | admin_founder (accès total)

## Règles métier clés

Sandbox niveaux : 0=nouveau | 1=1mission+3.5★ | 2=3missions+4★+80% | 3=10+4.5★
Paiement délais : premium+4★→100% en 48h | premium OU 4★→50%+50% | sinon→7j
Sanctions : annulation<24h=perd niveau 7j | 1er no-show=bloqué 7j | 3ème=banni
Pause auto : <6h=aucune | 6h-8h30=30min | >8h30=45min
Paiement par mission uniquement, remboursement surplus automatique, pas de wallet
Offres : modération admin avant publication, multi-jours=sous-offres journalières
Candidature : un clic, sans message, profil>=60%, documents valides requis
Contrats : <3j=simple(checkbox+IP+timestamp) | >=3j=formalisé

## Architecture dossiers

src/app/[locale]/(auth|candidate|company|admin)/
src/components/3d/ · animations/ · pwa/ · candidate/ · company/ · admin/ · shared/
lib/supabase/server.ts · client.ts · lib/validations/ · lib/hooks/
messages/fr.json · en.json

## PWA

next-pwa, theme_color=#7C3AED, background_color=#1A0A2E.
safe-area-inset obligatoire. SW actif uniquement en production (build).
