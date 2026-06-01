---
applyTo: "**/*.tsx,**/*.jsx,**/components/**"
---

# Instructions Frontend — Easyjob CM

## Toujours appliquer sur les fichiers .tsx/.jsx

- Couleur violette #7C3AED sur tous les accents, icônes, titres de section
- Framer Motion obligatoire sur tous les éléments cliquables (whileTap scale-0.98)
- Cartes : rounded-[20px] border border-[#E5E7EB] bg-white shadow-sm
- Bouton CTA : rounded-full h-14 bg-[#5B21B6] text-white font-bold
- Textes via useTranslations() de next-intl — jamais de string en dur
- Images : next/image avec WebP, lazy loading activé
- Icons : lucide-react uniquement
- Composants Three.js : dynamic import obligatoire avec { ssr: false }
- Fallback 2D si WebGL non disponible
- safe-area-inset sur fixed bottom : mb-[calc(1rem+env(safe-area-inset-bottom))]
- mobile-first — commencer par les classes base (sm: md: lg: optionnel)
- Pas de `any` TypeScript — toujours typer les props
