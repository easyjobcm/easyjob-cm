---
applyTo: "**/app/api/**,**/actions/**,**/*.action.ts,**/lib/supabase/**"
---

# Instructions Backend — Easyjob CM

## Toujours appliquer sur les Server Actions et Route Handlers

- Toujours vérifier auth avec supabase.auth.getUser() en premier
- Toujours vérifier le rôle depuis la table users côté serveur
- Toujours valider les données avec Zod avant traitement
- Utiliser createClient() depuis lib/supabase/server.ts (avec cookies)
- Jamais de logique de paiement côté client
- Jamais exposer tel/email/CNI candidat à l'entreprise
- Jamais utiliser les tables wallets, withdrawal_requests, payment_batches
- Idempotency keys obligatoires sur toutes les opérations de paiement
- Logguer les actions admin dans audit_logs (actor_id, action, resource, ip)
- Transactions Supabase pour les opérations multi-tables

## Pattern obligatoire

```typescript
'use server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const schema = z.object({ /* champs */ })

export async function action(formData: FormData) {
  const supabase = createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: 'Non autorisé' }

  const { data: userData } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!allowedRoles.includes(userData?.role)) return { error: 'Accès refusé' }

  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.flatten() }

  // logique métier...
}
```
