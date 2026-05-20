# User Stories — Easyjob CM MVP v1.1

> **Format :** Conforme aux standards Agile / INVEST (Independent, Negotiable, Valuable, Estimable, Small, Testable)
> **Convention de nommage :** `US-[EPIC]-[NUM]`
> **Statut :** Draft v1.0 — Mai 2025
> **Référence SRS :** SRS_EasyJob_CM_MVP v1.1

---

## Conventions et légende

### Format standard de chaque user story

```
ID        : US-[EPIC]-[NUM]
Titre     : Courte description de la fonctionnalité
Rôle      : En tant que [rôle]
Action    : Je veux [action]
Bénéfice  : Afin de [valeur métier]
Priorité  : P0 (critique) | P1 (important) | P2 (utile)
Complexité: XS | S | M | L | XL
Épique    : Nom de l'épique parent
Dépend de : IDs des stories prérequises
```

### Critères d'acceptation (format Gherkin)

```gherkin
GIVEN  [contexte initial]
WHEN   [action de l'utilisateur]
THEN   [résultat attendu]
AND    [résultat complémentaire]
```

### Priorités

| Priorité | Signification |
|---|---|
| P0 | Bloquant — le MVP ne peut pas fonctionner sans cette story |
| P1 | Important — fort impact sur l'adoption et la valeur |
| P2 | Utile — améliore l'expérience mais non bloquant au lancement |

### Complexité (en points de story)

| Valeur | Durée estimée |
|---|---|
| XS | < 2h |
| S | 2h – 1j |
| M | 1j – 3j |
| L | 3j – 1 sem |
| XL | > 1 sem |

---

## Épiques

| Code | Nom | Description |
|---|---|---|
| AUTH | Authentification | Création de compte, connexion, OTP |
| ONBC | Onboarding Candidat | Parcours de configuration du profil candidat |
| ONBE | Onboarding Entreprise | Parcours de configuration du compte entreprise |
| PROF | Profil & Documents | Gestion du profil, badges, documents, expiration |
| JOB | Publication d'offres | Création, modération, multi-jours |
| MATCH | Matching & Candidature | Algorithme, scoring, candidature en un clic |
| CONT | Contrat | Génération et signature électronique |
| MISS | Suivi de mission | Statuts, code de validation, no-show |
| EVAL | Évaluations | Avis réciproques, modération, impact score |
| PAY | Paiement | Blocage, libération, remboursement, délais |
| SAND | Sandbox | Niveaux de confiance, déblocage, sanctions |
| SUB | Abonnements | Plans candidat et entreprise |
| ADMIN | Dashboard Admin | Gestion 3 niveaux, modération, KPIs |
| BOT | Chatbot IA | Support automatisé, escalade humaine |
| NOTIF | Notifications | Push, SMS, email, rappels |
| I18N | Internationalisation | FR/EN, localisation des formats |
| PERF | Performance & Sécurité | Temps de chargement, RLS, audit |

---

## ÉPIQUE 1 — AUTH : Authentification

---

### US-AUTH-01

| Champ | Valeur |
|---|---|
| **ID** | US-AUTH-01 |
| **Titre** | Création de compte candidat par email |
| **Rôle** | visiteur non connecté |
| **Action** | créer un compte avec mon email et un mot de passe |
| **Bénéfice** | accéder à la plateforme pour rechercher des missions |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | AUTH |
| **Dépend de** | — |

**Critères d'acceptation :**

```gherkin
GIVEN je suis sur la page d'inscription
WHEN je saisis un email valide, un mot de passe conforme (8 car. min, 1 maj, 1 chiffre)
  AND je sélectionne le type de compte "Candidat"
  AND je soumets le formulaire
THEN un email de vérification est envoyé à mon adresse
  AND je suis redirigé vers une page de confirmation

GIVEN je reçois l'email de vérification
WHEN je clique sur le lien de vérification
THEN mon compte est activé
  AND je suis redirigé vers l'onboarding candidat

GIVEN je saisis un mot de passe non conforme (ex : "abc")
WHEN je soumets le formulaire
THEN un message d'erreur explicite s'affiche sous le champ mot de passe
  AND le formulaire n'est pas soumis
```

**Règles de validation (Zod) :**
- Email : format RFC 5322 valide
- Mot de passe : minimum 8 caractères, 1 majuscule, 1 chiffre
- Type de compte : obligatoire (candidat / entreprise)

---

### US-AUTH-02

| Champ | Valeur |
|---|---|
| **ID** | US-AUTH-02 |
| **Titre** | Création de compte entreprise par email |
| **Rôle** | visiteur non connecté |
| **Action** | créer un compte entreprise avec mon email |
| **Bénéfice** | accéder à la plateforme pour publier des offres |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | AUTH |
| **Dépend de** | — |

**Critères d'acceptation :**

```gherkin
GIVEN je suis sur la page d'inscription
WHEN je sélectionne "Entreprise" et je saisis un email + mot de passe conformes
  AND je soumets le formulaire
THEN un email de vérification est envoyé
  AND je suis redirigé vers l'onboarding entreprise après vérification

GIVEN un email déjà utilisé
WHEN je tente de m'inscrire avec cet email
THEN un message "Cet email est déjà utilisé" s'affiche
  AND je suis proposé de me connecter ou de réinitialiser mon mot de passe
```

---

### US-AUTH-03

| Champ | Valeur |
|---|---|
| **ID** | US-AUTH-03 |
| **Titre** | Connexion par OTP SMS |
| **Rôle** | utilisateur inscrit |
| **Action** | me connecter via un code OTP envoyé sur mon téléphone |
| **Bénéfice** | accéder à mon compte sans retenir un mot de passe |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | AUTH |
| **Dépend de** | US-AUTH-01, US-AUTH-02 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis sur la page de connexion
WHEN je choisis "Connexion par SMS" et je saisis mon numéro camerounais (+237XXXXXXXXX)
THEN un OTP à 6 chiffres est envoyé par SMS dans les 30 secondes

WHEN je saisis le bon OTP dans les 10 minutes
THEN je suis connecté et redirigé vers mon tableau de bord

WHEN l'OTP expire (après 10 min)
THEN un message "Code expiré" s'affiche
  AND je peux demander un nouveau code

WHEN je saisis un OTP incorrect 3 fois de suite
THEN un délai de 5 minutes est imposé avant la prochaine tentative
```

---

### US-AUTH-04

| Champ | Valeur |
|---|---|
| **ID** | US-AUTH-04 |
| **Titre** | Connexion via Google ou Facebook |
| **Rôle** | utilisateur inscrit ou nouveau visiteur |
| **Action** | me connecter ou créer un compte via Google ou Facebook |
| **Bénéfice** | réduire la friction d'inscription et d'accès |
| **Priorité** | P1 |
| **Complexité** | M |
| **Épique** | AUTH |
| **Dépend de** | US-AUTH-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis sur la page de connexion
WHEN je clique sur "Continuer avec Google" ou "Continuer avec Facebook"
THEN je suis redirigé vers le flux OAuth du provider choisi

WHEN l'authentification OAuth réussit
THEN si c'est un nouveau compte : mon profil est prérempli avec les données OAuth (nom, email, photo)
  AND je suis invité à saisir et valider mon numéro de téléphone par OTP avant de continuer
THEN si c'est un compte existant : je suis connecté et redirigé vers mon tableau de bord
  AND la validation téléphone OTP est requise si le numéro n'est pas encore vérifié

GIVEN un compte Google/Facebook avec un email déjà utilisé par email/mdp
WHEN je me connecte via OAuth
THEN les comptes sont fusionnés si l'email correspond
  AND la validation téléphone est requise si non encore effectuée
```

**Note :** Le numéro de téléphone camerounais (+237XXXXXXXXX) est obligatoire et doit être validé par OTP dans tous les cas, indépendamment de la méthode de connexion.

---

### US-AUTH-05

| Champ | Valeur |
|---|---|
| **ID** | US-AUTH-05 |
| **Titre** | Validation obligatoire du numéro de téléphone |
| **Rôle** | tout utilisateur lors de l'inscription |
| **Action** | valider mon numéro de téléphone camerounais par OTP |
| **Bénéfice** | sécuriser mon compte et permettre la réception de notifications SMS |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | AUTH |
| **Dépend de** | US-AUTH-01, US-AUTH-02 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis en cours d'inscription ou de connexion OAuth
WHEN je saisis mon numéro de téléphone au format +237XXXXXXXXX
THEN un OTP est envoyé par SMS à ce numéro

WHEN je saisis le bon OTP dans les 10 minutes
THEN mon numéro est marqué comme vérifié (phone_verified = true)
  AND je peux continuer vers l'onboarding

GIVEN un numéro déjà associé à un autre compte
WHEN je tente de valider ce numéro
THEN un message d'erreur "Ce numéro est déjà utilisé" s'affiche
  AND je suis invité à utiliser un autre numéro ou contacter le support
```

---

### US-AUTH-06

| Champ | Valeur |
|---|---|
| **ID** | US-AUTH-06 |
| **Titre** | Réinitialisation du mot de passe |
| **Rôle** | utilisateur inscrit |
| **Action** | réinitialiser mon mot de passe via un lien envoyé par email |
| **Bénéfice** | retrouver l'accès à mon compte si j'ai oublié mon mot de passe |
| **Priorité** | P1 |
| **Complexité** | S |
| **Épique** | AUTH |
| **Dépend de** | US-AUTH-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis sur la page de connexion
WHEN je clique sur "Mot de passe oublié" et je saisis mon email
THEN un email de réinitialisation est envoyé dans les 60 secondes

WHEN je clique sur le lien dans l'email (valide 1 heure)
THEN je peux saisir un nouveau mot de passe conforme
  AND mon compte est sécurisé avec le nouveau mot de passe

WHEN le lien a expiré
THEN un message explicite s'affiche avec un bouton pour demander un nouveau lien
```

---

## ÉPIQUE 2 — ONBC : Onboarding Candidat

---

### US-ONBC-01

| Champ | Valeur |
|---|---|
| **ID** | US-ONBC-01 |
| **Titre** | Saisie des informations personnelles |
| **Rôle** | candidat nouvellement inscrit |
| **Action** | renseigner mes informations personnelles de base |
| **Bénéfice** | créer un profil identifiable et crédible pour les entreprises |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | ONBC |
| **Dépend de** | US-AUTH-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis à l'étape 1 de l'onboarding candidat
WHEN je renseigne nom, prénom, date de naissance, ville de résidence
  AND je soumets l'étape
THEN mes informations sont sauvegardées
  AND je passe à l'étape suivante
  AND ma progression onboarding est mise à jour

GIVEN je ferme l'application en cours d'onboarding
WHEN je reviens plus tard
THEN je reprends à l'étape où je m'étais arrêté
  AND mes données précédemment saisies sont conservées

GIVEN une date de naissance invalide (futur, mineur de moins de 16 ans)
WHEN je soumets le formulaire
THEN un message d'erreur adapté s'affiche
```

---

### US-ONBC-02

| Champ | Valeur |
|---|---|
| **ID** | US-ONBC-02 |
| **Titre** | Suggestion de compétences par l'IA |
| **Rôle** | candidat en onboarding |
| **Action** | décrire mon expérience en texte libre et recevoir des suggestions de compétences de l'IA |
| **Bénéfice** | remplir mon profil rapidement sans connaître les catégories exactes |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | ONBC |
| **Dépend de** | US-ONBC-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis à l'étape "Compétences" de l'onboarding
WHEN je saisis une description libre ("J'ai travaillé 2 ans comme caissier dans une supérette")
  AND je clique sur "Analyser"
THEN l'IA me propose une liste de compétences structurées en moins de 3 secondes
  (ex : Caisse enregistreuse, Gestion de la monnaie, Relation client, Logistique de surface)

WHEN je coche ou décoche des compétences suggérées
  AND j'ajoute manuellement des compétences non suggérées
  AND je valide
THEN la liste finale de compétences est sauvegardée dans mon profil

GIVEN l'IA est indisponible (timeout)
WHEN je clique sur "Analyser"
THEN un message "Analyse temporairement indisponible" s'affiche
  AND je peux sélectionner mes compétences manuellement dans une liste prédéfinie
```

---

### US-ONBC-03

| Champ | Valeur |
|---|---|
| **ID** | US-ONBC-03 |
| **Titre** | Déclaration du permis de conduire |
| **Rôle** | candidat en onboarding |
| **Action** | déclarer et uploader mon permis de conduire avec sa date d'expiration |
| **Bénéfice** | accéder aux offres requérant le permis de conduire |
| **Priorité** | P1 |
| **Complexité** | S |
| **Épique** | ONBC |
| **Dépend de** | US-ONBC-02 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis à l'étape "Compétences"
WHEN je coche "Permis de conduire" dans ma liste de compétences
THEN un champ d'upload du document et un champ "Date d'expiration" apparaissent

WHEN j'uploade une photo du permis et saisis la date d'expiration
THEN le document est enregistré en attente de validation admin
  AND la date d'expiration est sauvegardée dans document_expirations

GIVEN mon permis est expiré (date d'expiration < aujourd'hui)
WHEN je tente de postuler à une offre requérant le permis
THEN un message "Permis de conduire expiré — veuillez uploader votre nouveau permis" s'affiche
  AND ma candidature est bloquée pour ces offres
```

---

### US-ONBC-04

| Champ | Valeur |
|---|---|
| **ID** | US-ONBC-04 |
| **Titre** | Enregistrement de la localisation GPS du domicile |
| **Rôle** | candidat en onboarding |
| **Action** | enregistrer ma position GPS depuis chez moi |
| **Bénéfice** | recevoir des offres filtrées par distance réelle depuis mon domicile |
| **Priorité** | P1 |
| **Complexité** | S |
| **Épique** | ONBC |
| **Dépend de** | US-ONBC-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis à l'étape "Localisation" de l'onboarding
WHEN je clique sur "Enregistrer ma position"
  AND j'autorise l'accès à ma géolocalisation
THEN ma position GPS (lat/lng) est sauvegardée comme adresse de référence (home_gps_lat, home_gps_lng)
  AND un message de confirmation s'affiche avec le quartier détecté

GIVEN je refuse l'accès à la géolocalisation
WHEN je saisis manuellement mon quartier/ville
THEN une position approximative est utilisée comme fallback
  AND je peux mettre à jour la position précise plus tard depuis mon profil

GIVEN j'ai déjà enregistré ma position
WHEN je souhaite la mettre à jour depuis mon profil
THEN je peux re-cliquer sur "Mettre à jour ma position" et le GPS est relancé
```

---

### US-ONBC-05

| Champ | Valeur |
|---|---|
| **ID** | US-ONBC-05 |
| **Titre** | Upload CNI et selfie pour vérification |
| **Rôle** | candidat en onboarding |
| **Action** | uploader ma CNI recto/verso et prendre un selfie tenant ma CNI |
| **Bénéfice** | vérifier mon identité et gagner la confiance des entreprises |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | ONBC |
| **Dépend de** | US-ONBC-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis à l'étape "Vérification d'identité"
WHEN j'uploade une photo recto de ma CNI, une photo verso, et un selfie tenant la CNI
THEN les 3 documents sont envoyés en attente de validation admin
  AND mon statut cni_verified passe à "pending"
  AND un message "Vérification en cours — délai 24h" s'affiche

GIVEN l'admin valide ma CNI dans les 24h
WHEN la validation est approuvée
THEN cni_verified = true
  AND cni_expires_at est enregistrée
  AND je reçois une notification "Identité vérifiée"

GIVEN l'admin rejette ma CNI (document illisible, photo floue)
WHEN la validation est rejetée
THEN je reçois une notification avec le motif de rejet
  AND je peux uploader de nouveaux documents

GIVEN ma CNI est expirée
WHEN l'admin détecte la date d'expiration lors de la vérification
THEN le statut est marqué "expiré"
  AND je suis notifié d'uploader une CNI renouvelée
```

---

### US-ONBC-06

| Champ | Valeur |
|---|---|
| **ID** | US-ONBC-06 |
| **Titre** | Vérification du compte Mobile Money |
| **Rôle** | candidat en onboarding |
| **Action** | renseigner mon numéro Mobile Money et le faire vérifier |
| **Bénéfice** | recevoir mes paiements de mission directement sur mon compte MoMo |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | ONBC |
| **Dépend de** | US-ONBC-05 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis à l'étape "Compte Mobile Money"
WHEN je renseigne mon opérateur (MTN ou Orange) et mon numéro MoMo
THEN le système vérifie que le nom enregistré sur le compte MoMo correspond à mon nom CNI

GIVEN la correspondance nom MoMo / nom CNI est confirmée
WHEN la vérification réussit
THEN momo_verified = true, momo_name_match = true
  AND je reçois une confirmation "Compte MoMo vérifié"

GIVEN le nom du compte MoMo ne correspond pas à mon nom CNI
WHEN la vérification échoue
THEN un message explicite s'affiche : "Le nom du compte MoMo doit correspondre à votre nom sur la CNI"
  AND je ne peux pas valider cet étape avec un compte au nom d'un tiers
  AND une option "Contacter le support" est proposée

GIVEN mon numéro MoMo est invalide ou inactif
WHEN la vérification échoue
THEN un message d'erreur s'affiche avec les instructions pour corriger
```

---

### US-ONBC-07

| Champ | Valeur |
|---|---|
| **ID** | US-ONBC-07 |
| **Titre** | Indicateur de complétude du profil |
| **Rôle** | candidat en onboarding ou sur son profil |
| **Action** | voir en temps réel le pourcentage de complétude de mon profil |
| **Bénéfice** | savoir ce qui me manque pour atteindre le seuil de 60% et pouvoir postuler |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | ONBC |
| **Dépend de** | US-ONBC-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis sur mon profil ou en cours d'onboarding
WHEN j'affiche mon tableau de bord ou mon profil
THEN je vois une barre de progression indiquant mon % de complétude (ex : "55%")
  AND les sections manquantes sont listées avec leur impact sur le % (ex : "+10% en ajoutant une photo")

GIVEN mon profil atteint 60%
WHEN j'essaie de postuler à une offre
THEN je peux soumettre ma candidature normalement

GIVEN mon profil est en dessous de 60%
WHEN j'essaie de postuler
THEN un message "Complétez votre profil à 60% pour postuler" s'affiche
  AND je suis redirigé vers les sections incomplètes
```

---

## ÉPIQUE 3 — ONBE : Onboarding Entreprise

---

### US-ONBE-01

| Champ | Valeur |
|---|---|
| **ID** | US-ONBE-01 |
| **Titre** | Configuration du profil entreprise |
| **Rôle** | représentant d'entreprise nouvellement inscrit |
| **Action** | renseigner les informations de mon entreprise (nom, secteur, NIU, adresse, logo) |
| **Bénéfice** | créer un compte entreprise crédible pour attirer des candidats de qualité |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | ONBE |
| **Dépend de** | US-AUTH-02 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis à l'étape "Profil entreprise" de l'onboarding
WHEN je renseigne : nom, secteur, NIU, adresse, villes d'opération, logo, description, contact
  AND je soumets le formulaire
THEN les informations sont sauvegardées
  AND le NIU est vérifié par regex (format valide)
  AND mon compte est placé en attente de validation admin pour le NIU (délai 24h)

GIVEN je ferme l'application en cours d'onboarding
WHEN je reviens
THEN je reprends à l'étape où je m'étais arrêté avec les données conservées

GIVEN le NIU saisi ne respecte pas le format attendu
WHEN je soumets le formulaire
THEN un message "Format NIU invalide" s'affiche sous le champ
```

---

### US-ONBE-02

| Champ | Valeur |
|---|---|
| **ID** | US-ONBE-02 |
| **Titre** | Acceptation des conditions générales d'utilisation |
| **Rôle** | représentant d'entreprise en onboarding |
| **Action** | lire et accepter les CGU avant de finaliser mon compte |
| **Bénéfice** | m'assurer de comprendre les règles de la plateforme avant de publier des offres |
| **Priorité** | P0 |
| **Complexité** | XS |
| **Épique** | ONBE |
| **Dépend de** | US-ONBE-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis à l'étape finale de l'onboarding entreprise
WHEN je clique sur "Lire les CGU"
THEN les CGU s'affichent dans une modale ou page dédiée

WHEN je coche "J'accepte les conditions générales d'utilisation" et je finalise
THEN mon compte entreprise est créé
  AND l'acceptation est horodatée et sauvegardée

GIVEN je ne coche pas la case CGU
WHEN je tente de finaliser
THEN le bouton de finalisation est désactivé
  AND un message "Vous devez accepter les CGU pour continuer" s'affiche
```

---

## ÉPIQUE 4 — PROF : Profil & Documents

---

### US-PROF-01

| Champ | Valeur |
|---|---|
| **ID** | US-PROF-01 |
| **Titre** | Alerte d'expiration de document candidat |
| **Rôle** | candidat avec un document proche de l'expiration |
| **Action** | recevoir une notification d'alerte avant que mon document n'expire |
| **Bénéfice** | mettre à jour mes documents à temps et ne pas perdre l'accès aux offres |
| **Priorité** | P1 |
| **Complexité** | S |
| **Épique** | PROF |
| **Dépend de** | US-ONBC-05, US-ONBC-03 |

**Critères d'acceptation :**

```gherkin
GIVEN un document candidat (CNI ou permis) a une date d'expiration enregistrée
WHEN la date d'expiration est dans 30 jours
THEN le candidat reçoit une notification push + SMS : "Votre CNI expire dans 30 jours"

WHEN la date d'expiration est dans 7 jours
THEN une seconde notification est envoyée avec un niveau d'urgence plus élevé

WHEN la date d'expiration est atteinte
THEN le document est automatiquement marqué comme invalide (statut = expired)
  AND une notification finale est envoyée : "Votre CNI a expiré — mettez-la à jour pour continuer à postuler"
  AND le candidat ne peut plus postuler aux offres requérant ce document

GIVEN le candidat uploade un nouveau document après expiration
WHEN l'admin valide le nouveau document
THEN le statut repasse à "verified" avec la nouvelle date d'expiration
  AND le candidat peut de nouveau postuler
```

---

### US-PROF-02

| Champ | Valeur |
|---|---|
| **ID** | US-PROF-02 |
| **Titre** | Consultation et mise à jour du profil candidat |
| **Rôle** | candidat inscrit |
| **Action** | consulter et modifier les informations de mon profil à tout moment |
| **Bénéfice** | maintenir mon profil à jour pour maximiser mes chances de sélection |
| **Priorité** | P1 |
| **Complexité** | S |
| **Épique** | PROF |
| **Dépend de** | US-ONBC-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis connecté en tant que candidat
WHEN j'accède à la page "Mon profil"
THEN je vois toutes mes informations, ma note moyenne, mes badges, ma complétude, mon niveau Sandbox

WHEN je modifie une information (compétences, disponibilités, photo, GPS domicile)
  AND je sauvegarde
THEN les modifications sont enregistrées immédiatement
  AND le % de complétude est recalculé

GIVEN je modifie mon numéro MoMo
WHEN je soumets le nouveau numéro
THEN la vérification de correspondance nom/MoMo est relancée
  AND mon statut momo_verified repasse à "pending" jusqu'à nouvelle validation
```

---

### US-PROF-03

| Champ | Valeur |
|---|---|
| **ID** | US-PROF-03 |
| **Titre** | Consultation du profil entreprise par le candidat |
| **Rôle** | candidat |
| **Action** | consulter la fiche publique d'une entreprise avant de postuler |
| **Bénéfice** | évaluer la fiabilité de l'entreprise et décider de postuler en connaissance de cause |
| **Priorité** | P1 |
| **Complexité** | S |
| **Épique** | PROF |
| **Dépend de** | US-ONBE-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je consulte une offre
WHEN je clique sur le nom de l'entreprise
THEN je vois la fiche publique de l'entreprise :
  nom, secteur, villes, description, logo, score de confiance, note moyenne, nombre de missions publiées, avis reçus

GIVEN l'entreprise a un score de confiance faible
WHEN je consulte sa fiche
THEN le score est clairement affiché avec une couleur d'alerte (rouge/orange)

GIVEN l'entreprise a des avis de candidats
WHEN je clique sur "Voir les avis"
THEN la liste des évaluations s'affiche avec critères, notes et commentaires
```

---

## ÉPIQUE 5 — JOB : Publication d'offres

---

### US-JOB-01

| Champ | Valeur |
|---|---|
| **ID** | US-JOB-01 |
| **Titre** | Création d'une offre assistée par IA |
| **Rôle** | entreprise connectée |
| **Action** | décrire ma mission en texte libre et laisser l'IA générer les champs structurés |
| **Bénéfice** | publier une offre professionnelle rapidement sans expertise RH |
| **Priorité** | P0 |
| **Complexité** | L |
| **Épique** | JOB |
| **Dépend de** | US-ONBE-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis sur la page "Publier une offre"
WHEN je saisis une description libre ("J'ai besoin de 2 caissiers pour le samedi 15 juin de 8h à 17h")
  AND je clique sur "Générer avec l'IA"
THEN en moins de 5 secondes, l'IA génère :
  - Titre : "Caissier(ère) — Mission d'une journée"
  - Catégorie : "Commerce / Retail"
  - Type de mission : Temporaire
  - Niveau Sandbox requis : Niveau 2
  - Compétences : Caisse enregistreuse, Gestion monnaie, Relation client
  - Durée de pause : 30 min (pour 9h de travail)
  - Durée effective : 8h30

WHEN je valide ou ajuste les champs générés
  AND je complète les champs restants (lieu, nombre de personnes, salaire)
THEN je passe à l'étape de validation du salaire par l'IA

GIVEN l'IA est temporairement indisponible
WHEN je clique sur "Générer"
THEN un message d'erreur s'affiche et tous les champs restent éditables manuellement
```

---

### US-JOB-02

| Champ | Valeur |
|---|---|
| **ID** | US-JOB-02 |
| **Titre** | Validation du salaire par l'IA |
| **Rôle** | entreprise en cours de publication d'offre |
| **Action** | recevoir un avertissement de l'IA si mon salaire proposé est incohérent avec le marché |
| **Bénéfice** | éviter de publier une offre sous-payée qui n'attirerait pas de candidats |
| **Priorité** | P1 |
| **Complexité** | M |
| **Épique** | JOB |
| **Dépend de** | US-JOB-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je saisis un salaire de 500 FCFA/jour pour une mission de caissier de 9h
WHEN l'IA analyse le montant
THEN un avertissement s'affiche : "Ce salaire semble bas pour ce type de mission (référence marché : 3 000 – 5 000 FCFA/jour)"
  AND je peux ignorer l'avertissement et continuer ou ajuster le montant

GIVEN je saisis un salaire conforme aux standards du marché
WHEN l'IA analyse le montant
THEN aucun avertissement n'est affiché
  AND je continue normalement

GIVEN la durée effective (brute - pause) est inférieure à la durée attendue pour le salaire proposé
WHEN l'IA détecte l'incohérence
THEN un message explicatif s'affiche : "Durée effective : 8h30 (après 30 min de pause obligatoire)"
```

---

### US-JOB-03

| Champ | Valeur |
|---|---|
| **ID** | US-JOB-03 |
| **Titre** | Définition du lieu de la mission avec référence et photo |
| **Rôle** | entreprise en cours de publication d'offre |
| **Action** | renseigner le lieu exact de la mission avec une référence populaire et une photo optionnelle |
| **Bénéfice** | aider les candidats à se repérer facilement et arriver au bon endroit |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | JOB |
| **Dépend de** | US-JOB-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis à l'étape "Lieu" de la création d'offre
WHEN je saisis l'adresse complète
THEN un lien Google Maps est généré automatiquement
  AND les coordonnées GPS sont extraites et sauvegardées (location_lat, location_lng)

WHEN je renseigne une référence populaire ("En face de Total Akwa")
THEN cette référence est incluse dans l'offre visible par les candidats

WHEN j'uploade une photo du lieu (optionnel)
THEN la photo est affichée dans l'offre pour aider les candidats à identifier le lieu

GIVEN les coordonnées GPS sont invalides ou introuvables
WHEN je soumets le lieu
THEN un message m'invite à corriger l'adresse ou à saisir les coordonnées manuellement
```

---

### US-JOB-04

| Champ | Valeur |
|---|---|
| **ID** | US-JOB-04 |
| **Titre** | Définition des équipements et avantages de la mission |
| **Rôle** | entreprise en cours de publication d'offre |
| **Action** | préciser l'équipement requis des candidats, l'équipement fourni, et les avantages offerts |
| **Bénéfice** | attirer les bons profils et éviter les malentendus le jour de la mission |
| **Priorité** | P1 |
| **Complexité** | S |
| **Épique** | JOB |
| **Dépend de** | US-JOB-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis à l'étape "Conditions" de la création d'offre
WHEN je sélectionne des équipements requis (ex : "chaussures fermées", "tenue noire")
  AND des équipements fournis (ex : "tablier", "badge entreprise")
  AND des avantages (ex : "repas offert", "remboursement taxi")
THEN ces informations sont sauvegardées et affichées dans la fiche de l'offre

GIVEN aucun équipement requis
WHEN je ne sélectionne rien dans cette section
THEN le champ reste vide et l'offre peut être soumise sans ce détail

GIVEN un avantage de type "remboursement taxi"
WHEN ce champ est coché
THEN il est mis en avant visuellement sur la fiche de l'offre
```

---

### US-JOB-05

| Champ | Valeur |
|---|---|
| **ID** | US-JOB-05 |
| **Titre** | Paiement du montant bloqué avant soumission |
| **Rôle** | entreprise ayant finalisé la création d'une offre |
| **Action** | effectuer un virement Mobile Money du montant total de la mission avant de soumettre l'offre |
| **Bénéfice** | garantir que les fonds sont disponibles pour payer les candidats |
| **Priorité** | P0 |
| **Complexité** | L |
| **Épique** | JOB |
| **Dépend de** | US-JOB-01, US-AUTH-05 |

**Critères d'acceptation :**

```gherkin
GIVEN j'ai finalisé tous les champs de mon offre
WHEN j'arrive à l'étape "Paiement"
THEN le système affiche le montant total à bloquer :
  (nombre de personnes × salaire/jour × nombre de jours) + frais Easyjob CM
  ET le détail est clairement affiché (montant mission + frais séparés)

WHEN je confirme et effectue le virement via MTN MoMo ou Orange Money
  AND le paiement est confirmé par l'agrégateur
THEN le montant est bloqué sur le compte plateforme
  AND l'offre passe en statut "pending_review" (soumise à la modération admin)
  AND je reçois une confirmation : "Paiement reçu — votre offre est en cours de modération"

GIVEN le paiement échoue (fonds insuffisants, timeout)
WHEN la transaction est rejetée
THEN un message d'erreur s'affiche avec l'option de réessayer
  AND l'offre reste en statut "draft" (non soumise)
```

---

### US-JOB-06

| Champ | Valeur |
|---|---|
| **ID** | US-JOB-06 |
| **Titre** | Soumission de l'offre à la modération admin |
| **Rôle** | entreprise ayant effectué le paiement bloqué |
| **Action** | soumettre mon offre à la validation de l'équipe Easyjob CM |
| **Bénéfice** | m'assurer que mon offre respecte les standards avant d'être publiée |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | JOB |
| **Dépend de** | US-JOB-05 |

**Critères d'acceptation :**

```gherkin
GIVEN mon paiement a été confirmé
WHEN l'offre passe en statut "pending_review"
THEN elle apparaît dans la file d'attente de modération de l'admin_ops
  AND je ne peux plus modifier l'offre tant qu'elle est en attente

GIVEN l'admin approuve l'offre
WHEN la validation est effectuée
THEN l'offre passe en statut "active"
  AND je reçois une notification "Votre offre a été approuvée et est maintenant visible"
  AND si l'offre couvre plusieurs jours, elle est décomposée en sous-offres journalières

GIVEN l'admin rejette l'offre avec un motif
WHEN la décision de rejet est prise
THEN je reçois une notification avec le motif détaillé
  AND je peux corriger et republier (nouveau paiement requis si le montant change)
  AND si le rejet est dû à une offre malveillante, mon compte est signalé

GIVEN l'admin demande une correction (offre modifiable)
WHEN je reçois la demande
THEN l'offre repasse en statut "draft" avec les commentaires de l'admin visibles
  AND je peux modifier et resoumettre
```

---

### US-JOB-07

| Champ | Valeur |
|---|---|
| **ID** | US-JOB-07 |
| **Titre** | Décomposition automatique d'une offre multi-jours |
| **Rôle** | système (automatique après validation admin) |
| **Action** | décomposer une offre couvrant plusieurs journées en sous-offres journalières |
| **Bénéfice** | permettre aux candidats de postuler uniquement aux jours qui les conviennent |
| **Priorité** | P1 |
| **Complexité** | M |
| **Épique** | JOB |
| **Dépend de** | US-JOB-06 |

**Critères d'acceptation :**

```gherkin
GIVEN une offre couvrant 3 jours (15, 16, 17 juin) avec 5 personnes/jour est approuvée
WHEN la validation admin est effectuée
THEN 3 sous-offres sont créées automatiquement :
  - Sous-offre J1 : 15 juin, 5 postes
  - Sous-offre J2 : 16 juin, 5 postes
  - Sous-offre J3 : 17 juin, 5 postes
  AND chaque sous-offre hérite de tous les paramètres de l'offre parent

WHEN un candidat consulte l'offre principale
THEN il voit les 3 journées disponibles avec le nombre de postes restants pour chaque

WHEN un candidat postule à la sous-offre J1 uniquement
THEN sa candidature est enregistrée uniquement pour le 15 juin
  AND il peut postuler indépendamment aux autres sous-offres
```

---

### US-JOB-08

| Champ | Valeur |
|---|---|
| **ID** | US-JOB-08 |
| **Titre** | Marquage d'une offre comme urgente |
| **Rôle** | entreprise lors de la publication d'une offre |
| **Action** | marquer mon offre comme urgente pour qu'elle apparaisse en premier |
| **Bénéfice** | trouver des candidats rapidement pour un besoin de dernière minute |
| **Priorité** | P1 |
| **Complexité** | S |
| **Épique** | JOB |
| **Dépend de** | US-JOB-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis en cours de création d'offre avec un compte standard
WHEN je coche l'option "Urgente"
THEN un montant supplémentaire est ajouté à mon total de paiement
  AND l'option est incluse dans le récapitulatif

GIVEN je suis en cours de création d'offre avec un compte premium
WHEN je coche l'option "Urgente"
THEN aucun frais supplémentaire n'est ajouté
  AND l'option est gratuite et activée

GIVEN mon offre urgente est approuvée par l'admin
WHEN elle est publiée
THEN elle apparaît en tête des listes de résultats pour les candidats éligibles
  AND un badge "Urgent" est affiché sur la fiche de l'offre
```

---

### US-JOB-09

| Champ | Valeur |
|---|---|
| **ID** | US-JOB-09 |
| **Titre** | Réutilisation d'une ancienne offre |
| **Rôle** | entreprise |
| **Action** | dupliquer une ancienne offre en modifiant uniquement les éléments variables |
| **Bénéfice** | gagner du temps en évitant de recréer une offre identique à chaque fois |
| **Priorité** | P1 |
| **Complexité** | S |
| **Épique** | JOB |
| **Dépend de** | US-JOB-01 |

**Critères d'acceptation :**

```gherkin
GIVEN j'ai une offre passée dans mon historique
WHEN je clique sur "Republier cette offre"
THEN une nouvelle offre est créée en mode draft avec tous les champs préremplis depuis l'offre source

WHEN je modifie les éléments variables (date, heure, nombre de personnes, salaire)
  AND je soumets
THEN la nouvelle offre suit le flux normal (paiement + modération admin)
  AND l'offre source reste dans mon historique

GIVEN l'offre source avait une option urgente
WHEN je duplique l'offre
THEN l'option urgente n'est pas activée par défaut (choix explicite requis)
```

---

### US-JOB-10

| Champ | Valeur |
|---|---|
| **ID** | US-JOB-10 |
| **Titre** | Modification ou suppression d'une offre active |
| **Rôle** | entreprise |
| **Action** | modifier ou supprimer une offre tant que le quota de candidats n'est pas atteint |
| **Bénéfice** | corriger une erreur ou annuler une offre si mes besoins ont changé |
| **Priorité** | P1 |
| **Complexité** | M |
| **Épique** | JOB |
| **Dépend de** | US-JOB-06 |

**Critères d'acceptation :**

```gherkin
GIVEN mon offre est active et le quota de candidats n'est pas atteint
  AND il reste plus de 12h avant le début
WHEN je clique sur "Modifier l'offre"
THEN je peux modifier les champs autorisés
  AND les modifications sont soumises à une nouvelle validation admin si elles impactent le contenu

GIVEN le quota de candidats est atteint
WHEN je tente de modifier l'offre (compte standard)
THEN un message s'affiche : "Le nombre requis de candidats est atteint — contactez le service client pour toute modification"

GIVEN mon compte est premium
WHEN je modifie une offre dont le quota est atteint
THEN je peux modifier directement (date, nombre de personnes, salaire)
  AND les candidats déjà sélectionnés sont notifiés des changements

GIVEN je supprime une offre avant le début
WHEN la suppression est confirmée
THEN le montant bloqué est remboursé (hors frais déjà engagés)
  AND les candidats éventuellement sélectionnés sont notifiés
```

---

## ÉPIQUE 6 — MATCH : Matching & Candidature

---

### US-MATCH-01

| Champ | Valeur |
|---|---|
| **ID** | US-MATCH-01 |
| **Titre** | Consultation des offres filtrées et classées |
| **Rôle** | candidat connecté |
| **Action** | voir la liste des offres disponibles, triées par pertinence et filtrées selon mon niveau Sandbox |
| **Bénéfice** | trouver rapidement des missions qui correspondent à mon profil |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | MATCH |
| **Dépend de** | US-ONBC-01, US-JOB-06 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis connecté et mon profil est complété à >= 60%
WHEN j'accède à la liste des offres
THEN je vois uniquement les offres dont le niveau Sandbox requis <= mon niveau actuel
  AND les offres sont triées par score de pertinence (IA) décroissant

WHEN je clique sur une offre
THEN je vois : titre, catégorie, lieu (+ référence + photo), date, durée, pause obligatoire, salaire,
  compétences, équipements demandés, équipements fournis, avantages, niveau requis, nombre de postes, instruction de ponctualité (30 min avant)

GIVEN une offre urgente est disponible pour mon niveau
WHEN j'affiche la liste
THEN l'offre urgente apparaît en tête avec un badge "Urgent" visible

GIVEN mon profil est incomplet (< 60%)
WHEN j'accède à la liste des offres
THEN un message s'affiche invitant à compléter le profil avant de postuler
```

---

### US-MATCH-02

| Champ | Valeur |
|---|---|
| **ID** | US-MATCH-02 |
| **Titre** | Score de pertinence affiché côté entreprise |
| **Rôle** | entreprise consultant ses candidatures |
| **Action** | voir le score de pertinence IA de chaque candidat avec les raisons du classement |
| **Bénéfice** | identifier rapidement les candidats les plus adaptés sans lire chaque profil en détail |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | MATCH |
| **Dépend de** | US-JOB-06 |

**Critères d'acceptation :**

```gherkin
GIVEN une offre est active et des candidatures ont été reçues
WHEN j'accède à la liste des candidatures
THEN chaque candidat est affiché avec :
  - Son score de pertinence en % (ex : "87% de correspondance")
  - Les raisons du classement (ex : "Compétences ✓ | Distance 3 km | Déjà travaillé ici ✓")
  - Son niveau Sandbox, sa note moyenne, ses badges

WHEN je filtre par "Niveau Sandbox >= 2" ou "Distance < 5 km"
THEN la liste est actualisée en temps réel selon mes filtres

GIVEN un candidat a déjà travaillé pour mon entreprise avec une bonne note
WHEN il postule à ma nouvelle offre
THEN il est mis en avant avec un badge distinctif "A déjà travaillé ici"
  AND il est priorisé dans le classement par rapport à un candidat au même score

GIVEN c'est ma deuxième offre ou plus
WHEN l'offre est créée
THEN l'IA affiche automatiquement une section "Recommandations" avec d'anciens travailleurs suggérés
```

---

### US-MATCH-03

| Champ | Valeur |
|---|---|
| **ID** | US-MATCH-03 |
| **Titre** | Candidature en un clic |
| **Rôle** | candidat |
| **Action** | postuler à une offre ou une sous-offre journalière en un seul clic |
| **Bénéfice** | postuler rapidement sans friction inutile |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | MATCH |
| **Dépend de** | US-MATCH-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je consulte une offre et je remplis tous les prérequis (Sandbox, documents valides, profil >= 60%)
WHEN je clique sur "Postuler"
THEN ma candidature est enregistrée immédiatement (statut = pending)
  AND un message de confirmation s'affiche : "Candidature envoyée"
  AND l'entreprise est notifiée d'une nouvelle candidature

GIVEN j'ai déjà postulé à cette offre ou sous-offre
WHEN j'essaie de repostuler
THEN le bouton "Postuler" est remplacé par "Candidature envoyée" (désactivé)
  AND aucune seconde candidature n'est enregistrée

GIVEN un document requis par l'offre est expiré dans mon profil
WHEN j'essaie de postuler
THEN un message "Document requis expiré — mettez à jour votre [CNI/permis] pour postuler" s'affiche
  AND ma candidature est bloquée

GIVEN mon niveau Sandbox est insuffisant pour cette offre
WHEN j'essaie de postuler
THEN un message "Niveau Sandbox insuffisant — cette offre requiert le Niveau X" s'affiche
  AND ma candidature est bloquée
```

---

### US-MATCH-04

| Champ | Valeur |
|---|---|
| **ID** | US-MATCH-04 |
| **Titre** | Sélection d'un ou plusieurs candidats par l'entreprise |
| **Rôle** | entreprise |
| **Action** | sélectionner les candidats que je souhaite engager pour ma mission |
| **Bénéfice** | confirmer mon équipe et déclencher la génération des contrats |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | MATCH |
| **Dépend de** | US-MATCH-02, US-MATCH-03 |

**Critères d'acceptation :**

```gherkin
GIVEN j'ai des candidatures reçues pour mon offre
WHEN je clique sur "Sélectionner" sur le profil d'un candidat
THEN le candidat reçoit une notification immédiate (push + SMS) : "Vous avez été sélectionné pour la mission [Titre] le [Date]"
  AND son statut de candidature passe à "accepted"
  AND la génération du contrat est déclenchée automatiquement

WHEN j'ai sélectionné le nombre requis de candidats pour une journée
THEN le quota de cette sous-offre est atteint
  AND les candidatures restantes sont automatiquement notifiées par une file d'attente

GIVEN je veux refuser un candidat
WHEN je clique sur "Refuser" (avec un motif optionnel)
THEN le candidat est notifié : "Votre candidature n'a pas été retenue"
  AND son statut passe à "rejected"

GIVEN j'accède au profil d'un candidat sélectionnable
WHEN je consulte sa fiche
THEN je vois uniquement ses informations professionnelles (compétences, Sandbox, note, historique)
  AND son numéro de téléphone, email et CNI ne sont jamais affichés
```

---

## ÉPIQUE 7 — CONT : Contrat

---

### US-CONT-01

| Champ | Valeur |
|---|---|
| **ID** | US-CONT-01 |
| **Titre** | Génération automatique du contrat de mission |
| **Rôle** | système (déclenché après sélection candidat) |
| **Action** | générer automatiquement un contrat de mission adapté à la durée |
| **Bénéfice** | formaliser la mission légalement avant le début du travail |
| **Priorité** | P0 |
| **Complexité** | L |
| **Épique** | CONT |
| **Dépend de** | US-MATCH-04 |

**Critères d'acceptation :**

```gherkin
GIVEN un candidat vient d'être sélectionné pour une mission de moins de 3 jours
WHEN la sélection est confirmée
THEN un contrat simple est généré en moins de 10 secondes contenant :
  identité des parties, description de la mission, date/horaires/lieu, durée effective, rémunération nette, conditions d'annulation, section de consentement électronique

GIVEN une mission de 3 jours ou plus
WHEN la sélection est confirmée
THEN un contrat formalisé (conforme Code du travail camerounais) est généré avec les mêmes champs + clauses légales supplémentaires

WHEN le contrat est généré
THEN les deux parties reçoivent une notification avec le lien de signature
  AND le contrat est disponible en PDF téléchargeable
  AND la mission reste en statut "pending_signature" jusqu'à double signature
```

---

### US-CONT-02

| Champ | Valeur |
|---|---|
| **ID** | US-CONT-02 |
| **Titre** | Signature électronique du contrat |
| **Rôle** | candidat et entreprise |
| **Action** | signer électroniquement le contrat de mission avant le début de la mission |
| **Bénéfice** | formaliser mon engagement de façon traçable et légalement reconnue |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | CONT |
| **Dépend de** | US-CONT-01 |

**Critères d'acceptation :**

```gherkin
GIVEN le contrat a été généré
WHEN j'accède au contrat depuis ma notification ou mon tableau de bord
THEN je peux lire l'intégralité du contrat
  AND je vois un bouton "Signer et accepter"

WHEN je clique sur "Signer et accepter" et confirme
THEN ma signature est enregistrée avec horodatage (timestamp) et adresse IP
  AND l'autre partie est notifiée qu'elle doit signer

GIVEN les deux parties ont signé
WHEN la double signature est complète
THEN le statut de la mission passe à "confirmed"
  AND les deux parties reçoivent une confirmation et le PDF signé

GIVEN une partie ne signe pas dans les 24h
WHEN le délai expire
THEN un rappel automatique est envoyé
  AND si non signé dans les 48h, la mission est annulée et le paiement remboursé
```

---

## ÉPIQUE 8 — MISS : Suivi de mission

---

### US-MISS-01

| Champ | Valeur |
|---|---|
| **ID** | US-MISS-01 |
| **Titre** | Mise à jour du statut de mission par le candidat |
| **Rôle** | candidat le jour de la mission |
| **Action** | mettre à jour mon statut en temps réel (en route, arrivé, commencé, terminé) |
| **Bénéfice** | informer l'entreprise de ma progression et prouver ma présence |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | MISS |
| **Dépend de** | US-CONT-02 |

**Critères d'acceptation :**

```gherkin
GIVEN ma mission est confirmée et signée
WHEN le jour de la mission arrive
THEN mon tableau de bord affiche les actions disponibles selon l'heure :
  "Je suis en route" (disponible H-2 avant début)

WHEN je clique sur "Je suis en route"
THEN l'entreprise reçoit une notification "Votre candidat est en route"
  AND mon statut passe à EN_ROUTE avec horodatage

WHEN je clique sur "Je suis arrivé"
THEN l'horodatage d'arrivée est enregistré
  AND l'entreprise est notifiée
  AND si j'arrive plus de 30 min après l'heure requise (= début - 30 min), un flag "retard" est enregistré

WHEN je clique sur "J'ai commencé"
THEN le statut passe à EN_COURS avec horodatage de début réel
  AND l'entreprise est notifiée

WHEN je clique sur "J'ai terminé" et je saisis le code de validation
THEN le statut passe à TERMINÉ
  AND l'entreprise est notifiée pour valider
```

---

### US-MISS-02

| Champ | Valeur |
|---|---|
| **ID** | US-MISS-02 |
| **Titre** | Génération et saisie du code de validation |
| **Rôle** | entreprise (génération) et candidat (saisie) |
| **Action** | générer un code de validation unique et le remettre au candidat en fin de mission |
| **Bénéfice** | confirmer de manière sécurisée que la mission a bien été effectuée |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | MISS |
| **Dépend de** | US-MISS-01 |

**Critères d'acceptation :**

```gherkin
GIVEN la mission est en cours (statut EN_COURS)
WHEN l'entreprise accède à l'interface de suivi de mission
  AND clique sur "Générer le code de validation"
THEN un code de 6 chiffres unique à usage unique est généré
  AND le code expire dans 2 heures
  AND l'entreprise voit le code et peut le communiquer au candidat physiquement

WHEN le candidat saisit le bon code dans l'application
THEN le statut passe à TERMINÉ (en attente de validation définitive)
  AND l'entreprise est notifiée

WHEN le candidat saisit un code incorrect
THEN un message "Code incorrect" s'affiche
  AND après 3 tentatives incorrectes, le système alerte l'admin_support

WHEN le code expire sans avoir été saisi
THEN un nouveau code peut être généré par l'entreprise
```

---

### US-MISS-03

| Champ | Valeur |
|---|---|
| **ID** | US-MISS-03 |
| **Titre** | Validation finale de la mission par l'entreprise |
| **Rôle** | entreprise |
| **Action** | valider la fin de mission pour déclencher la libération du paiement |
| **Bénéfice** | confirmer que la mission s'est bien déroulée et libérer le paiement au candidat |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | MISS |
| **Dépend de** | US-MISS-02 |

**Critères d'acceptation :**

```gherkin
GIVEN le candidat a soumis le code de validation correct
WHEN l'entreprise reçoit la notification de fin de mission
  AND clique sur "Valider la mission"
THEN la mission passe en statut VALIDATED
  AND le processus de libération du paiement est déclenché selon les règles section 5.3
  AND les deux parties reçoivent une notification invitant à s'évaluer mutuellement

GIVEN l'entreprise ne valide pas dans les 24h après la fin supposée
WHEN le délai expire
THEN un rappel automatique est envoyé
  AND si toujours non validé après 48h, l'admin_ops est alerté

GIVEN l'entreprise signale un problème (mission non conforme)
WHEN elle clique sur "Signaler un problème"
THEN un ticket de litige est automatiquement ouvert
  AND le paiement reste bloqué jusqu'à résolution
```

---

### US-MISS-04

| Champ | Valeur |
|---|---|
| **ID** | US-MISS-04 |
| **Titre** | Déclaration de no-show par l'entreprise |
| **Rôle** | entreprise |
| **Action** | signaler l'absence injustifiée d'un candidat dans les 30 minutes suivant l'heure prévue |
| **Bénéfice** | déclencher la sanction appropriée et obtenir un remboursement partiel |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | MISS |
| **Dépend de** | US-MISS-01 |

**Critères d'acceptation :**

```gherkin
GIVEN un candidat ne s'est pas présenté 30 minutes après l'heure de début de mission
WHEN l'entreprise clique sur "Déclarer une absence" dans l'interface de suivi
THEN un ticket no-show est créé pour ce candidat
  AND le candidat est notifié immédiatement
  AND le compte du candidat est automatiquement bloqué pendant 7 jours
  AND le compteur no_show_count du candidat est incrémenté

GIVEN c'est le 3ème no-show du candidat sans justificatif validé
WHEN le no-show est enregistré
THEN le compte du candidat est banni définitivement
  AND un email de notification est envoyé au candidat
  AND admin_ops est alerté

GIVEN le candidat soumet un justificatif valable dans le délai imparti
WHEN admin_ops valide le justificatif
THEN le compteur no_show_count n'est pas incrémenté
  AND le blocage éventuel est levé
```

---

## ÉPIQUE 9 — EVAL : Évaluations

---

### US-EVAL-01

| Champ | Valeur |
|---|---|
| **ID** | US-EVAL-01 |
| **Titre** | Soumission d'une évaluation par le candidat |
| **Rôle** | candidat après validation de la mission |
| **Action** | évaluer l'entreprise sur des critères spécifiques après la mission |
| **Bénéfice** | contribuer à la transparence de la plateforme et aider les autres candidats |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | EVAL |
| **Dépend de** | US-MISS-03 |

**Critères d'acceptation :**

```gherkin
GIVEN ma mission est validée
WHEN je reçois la notification d'évaluation
  AND j'accède au formulaire
THEN je peux noter l'entreprise de 1 à 5 étoiles sur :
  clarté des instructions, respect du candidat, conformité aux conditions de l'offre
  AND ajouter un commentaire libre optionnel

WHEN je soumets l'évaluation
THEN elle est sauvegardée et contribue immédiatement au score de confiance de l'entreprise
  AND elle est visible publiquement sur la fiche de l'entreprise

GIVEN je n'ai pas soumis mon évaluation après 48h
WHEN j'essaie de postuler à une nouvelle offre
THEN un message "Vous devez évaluer votre dernière mission avant de postuler" s'affiche
  AND ma candidature est bloquée jusqu'à soumission de l'évaluation

GIVEN mon commentaire contient des insultes ou propos offensants
WHEN le commentaire est soumis
THEN l'IA le masque automatiquement et le soumet à la modération de admin_ops
  AND la note numérique est enregistrée normalement
```

---

### US-EVAL-02

| Champ | Valeur |
|---|---|
| **ID** | US-EVAL-02 |
| **Titre** | Soumission d'une évaluation par l'entreprise |
| **Rôle** | entreprise après validation de la mission |
| **Action** | évaluer le candidat sur des critères spécifiques après la mission |
| **Bénéfice** | améliorer la qualité du vivier et aider les autres entreprises à recruter les bons profils |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | EVAL |
| **Dépend de** | US-MISS-03 |

**Critères d'acceptation :**

```gherkin
GIVEN j'ai validé la fin de mission
WHEN je reçois la notification d'évaluation
THEN je peux noter le candidat de 1 à 5 étoiles sur :
  ponctualité, compétence technique, communication, présentation
  AND ajouter un commentaire optionnel

WHEN je soumets l'évaluation
THEN la note contribue immédiatement à la moyenne du candidat
  AND si la moyenne du candidat >= 4, le candidat bénéficiera d'un délai de paiement accéléré pour les futures missions
  AND l'évaluation est visible publiquement sur le profil du candidat

GIVEN l'évaluation est soumise
WHEN le candidat consulte son profil
THEN il voit la nouvelle évaluation avec la note et le commentaire (si non modéré)
  AND son niveau Sandbox est recalculé si les conditions sont remplies
```

---

## ÉPIQUE 10 — PAY : Paiement

---

### US-PAY-01

| Champ | Valeur |
|---|---|
| **ID** | US-PAY-01 |
| **Titre** | Libération du paiement selon le profil du candidat |
| **Rôle** | système (automatique après validation de mission) |
| **Action** | libérer le paiement au candidat selon les règles de délai définies par son profil |
| **Bénéfice** | garantir que les candidats sont payés dans les délais convenus |
| **Priorité** | P0 |
| **Complexité** | L |
| **Épique** | PAY |
| **Dépend de** | US-MISS-03, US-EVAL-02 |

**Critères d'acceptation :**

```gherkin
GIVEN la mission est validée et l'évaluation donne une note moyenne >= 4
  AND le candidat est abonné premium
WHEN le système calcule le délai de paiement
THEN 100% du montant (après déduction des frais Easyjob CM) est libéré vers le MoMo du candidat dans les 48h

GIVEN la mission est validée et le candidat est premium MAIS note moyenne < 4
  OU note moyenne >= 4 MAIS non premium
WHEN le système calcule le délai
THEN 50% est libéré dans les 48h
  AND 50% restant est libéré dans les 7 jours

GIVEN la mission est validée et le candidat n'est ni premium ou a ni une note moyenne >= 4
WHEN le système calcule le délai
THEN 100% est libéré dans les 7 jours

GIVEN un litige est ouvert sur cette mission
WHEN le litige est créé
THEN tout paiement est suspendu jusqu'à résolution par admin_ops
  AND le candidat est notifié de la suspension

WHEN chaque tranche est libérée
THEN le candidat reçoit une notification avec le montant et la référence de transaction
  AND un reçu est généré
```

---

### US-PAY-02

| Champ | Valeur |
|---|---|
| **ID** | US-PAY-02 |
| **Titre** | Remboursement automatique du surplus à l'entreprise |
| **Rôle** | système (automatique en cas de mission incomplète) |
| **Action** | rembourser l'entreprise pour les postes non pourvus ou les absences |
| **Bénéfice** | ne payer que pour les candidats ayant effectivement travaillé |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | PAY |
| **Dépend de** | US-MISS-03 |

**Critères d'acceptation :**

```gherkin
GIVEN une offre prévoyait 5 candidats mais seulement 3 ont travaillé
WHEN les missions des 3 candidats sont validées
THEN le surplus correspondant à 2 postes non pourvus est calculé
  AND le remboursement est effectué automatiquement sur le même compte MoMo ayant fait le virement initial
  AND l'entreprise reçoit une notification avec le montant remboursé et la référence de transaction

GIVEN une mission a été annulée par l'entreprise à moins de 12h du début
WHEN l'annulation est confirmée
THEN 80% du montant bloqué est remboursé à l'entreprise
  AND 20% est versé au candidat à titre de pénalité d'annulation
  AND les deux parties sont notifiées

GIVEN une mission est annulée par le candidat à moins de 24h du début
WHEN l'annulation est confirmée
THEN 100% est remboursé à l'entreprise (hors frais)
  AND le candidat perd son accès aux missions de niveau supérieur pendant 7 jours et ca note moyenne est affectée négativement
```

---

## ÉPIQUE 11 — SAND : Système Sandbox

---

### US-SAND-01

| Champ | Valeur |
|---|---|
| **ID** | US-SAND-01 |
| **Titre** | Montée automatique de niveau Sandbox |
| **Rôle** | système (automatique après évaluation) |
| **Action** | faire monter automatiquement le niveau Sandbox d'un candidat quand les conditions sont remplies |
| **Bénéfice** | débloquer progressivement l'accès à des missions de plus haute responsabilité |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | SAND |
| **Dépend de** | US-EVAL-02 |

**Critères d'acceptation :**

```gherkin
GIVEN un candidat vient de valider sa 1ère mission avec une note >= 3.5
WHEN le système recalcule les conditions de niveau
THEN le sandbox_level passe à 1
  AND le candidat reçoit une notification "Félicitations ! Vous êtes maintenant Niveau 1 — de nouvelles missions sont disponibles"
  AND les offres de Niveau 1 apparaissent dans sa liste

GIVEN un candidat atteint 3 missions validées + note >= 4 + profil >= 80%
WHEN le recalcul est effectué
THEN le sandbox_level passe à 2
  AND les offres de Niveau 2 sont débloquées

GIVEN un candidat atteint 10 missions + note >= 4.5 + badge vérifié
WHEN le recalcul est effectué
THEN le sandbox_level passe à 3
  AND toutes les offres sont débloquées et le candidat est priorisé dans le matching
```

---

### US-SAND-02

| Champ | Valeur |
|---|---|
| **ID** | US-SAND-02 |
| **Titre** | Configuration des seuils Sandbox par l'admin |
| **Rôle** | admin_founder |
| **Action** | modifier les seuils de progression du Sandbox depuis le dashboard sans redéploiement |
| **Bénéfice** | ajuster la stratégie de confiance en temps réel selon les données du marché |
| **Priorité** | P1 |
| **Complexité** | M |
| **Épique** | SAND |
| **Dépend de** | US-ADMIN-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis connecté en tant qu'admin_founder
WHEN j'accède à "Paramètres > Système Sandbox"
THEN je vois les seuils actuels pour chaque niveau (missions, note, complétude)

WHEN je modifie le seuil du Niveau 2 de "3 missions" à "5 missions" et sauvegarde
THEN la modification prend effet immédiatement sans redéploiement
  AND les candidats déjà au Niveau 2 conservent leur niveau
  AND uniquement les futures progressions sont soumises aux nouveaux seuils

GIVEN une modification invalide (ex : Niveau 2 seuil < Niveau 1 seuil)
WHEN je tente de sauvegarder
THEN un message d'erreur s'affiche : "Les seuils doivent être croissants par niveau"
```

---

## ÉPIQUE 12 — SUB : Abonnements

---

### US-SUB-01

| Champ | Valeur |
|---|---|
| **ID** | US-SUB-01 |
| **Titre** | Souscription à un abonnement candidat premium |
| **Rôle** | candidat |
| **Action** | souscrire à l'abonnement premium à 1 000 FCFA/mois |
| **Bénéfice** | être priorisé dans les candidatures et recevoir mes paiements plus rapidement |
| **Priorité** | P1 |
| **Complexité** | M |
| **Épique** | SUB |
| **Dépend de** | US-AUTH-05 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis candidat connecté
WHEN j'accède à la page "Premium" et clique sur "S'abonner — 1 000 FCFA/mois"
THEN le récapitulatif des avantages est affiché (priorisation, paiement accéléré, accès offres exclusives)
  AND je confirme le paiement via Mobile Money

WHEN le paiement est confirmé
THEN mon rôle passe à candidate_premium
  AND le badge premium s'affiche sur mon profil
  AND les avantages sont activés immédiatement
  AND la date d'expiration (premium_until) est définie à J+30

GIVEN mon abonnement arrive à expiration
WHEN la date premium_until est atteinte
THEN un rappel est envoyé 3 jours avant
  AND si le renouvellement Mobile Money échoue, mon statut repasse à candidate
  AND je suis notifié avec un lien de renouvellement
```

---

### US-SUB-02

| Champ | Valeur |
|---|---|
| **ID** | US-SUB-02 |
| **Titre** | Souscription à un abonnement entreprise |
| **Rôle** | entreprise |
| **Action** | choisir et souscrire à un plan d'abonnement (Starter, Pro, Business) |
| **Bénéfice** | débloquer des fonctionnalités avancées pour recruter plus efficacement |
| **Priorité** | P1 |
| **Complexité** | M |
| **Épique** | SUB |
| **Dépend de** | US-ONBE-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis connecté en tant qu'entreprise
WHEN j'accède à la page "Abonnements"
THEN je vois un tableau comparatif des plans (Gratuit / Starter 5k / Pro 12k / Business 25k)
  AND chaque plan détaille clairement ses avantages

WHEN je sélectionne le plan Pro et confirme le paiement Mobile Money
THEN mon abonnement Pro est activé immédiatement
  AND un essai gratuit de 14 jours est appliqué automatiquement si c'est la première souscription Pro
  AND les avantages Pro sont disponibles immédiatement (urgences gratuites, modification directe...)

GIVEN mon paiement d'abonnement mensuel échoue
WHEN le renouvellement automatique échoue
THEN je suis notifié avec un message "Votre abonnement n'a pas pu être renouvelé"
  AND j'ai 3 jours pour régulariser avant la suspension des avantages premium
  AND mon compte repasse au plan Gratuit si non régularisé dans les 3 jours
```

---

## ÉPIQUE 13 — ADMIN : Dashboard Admin

---

### US-ADMIN-01

| Champ | Valeur |
|---|---|
| **ID** | US-ADMIN-01 |
| **Titre** | Modération d'une offre par admin_ops |
| **Rôle** | admin_ops |
| **Action** | examiner, approuver, rejeter ou demander la correction d'une offre soumise |
| **Bénéfice** | s'assurer que seules des offres légitimes et conformes sont publiées sur la plateforme |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | ADMIN |
| **Dépend de** | US-JOB-06 |

**Critères d'acceptation :**

```gherkin
GIVEN une offre est en statut "pending_review"
WHEN elle apparaît dans ma file d'attente de modération
THEN je peux consulter tous les détails (titre, lieu, salaire, durée, équipements, documents requis, avantages, montant bloqué)

WHEN je clique sur "Approuver"
THEN l'offre passe en statut "active"
  AND l'entreprise est notifiée
  AND si multi-jours, la décomposition en sous-offres est déclenchée

WHEN je clique sur "Rejeter" avec un motif
THEN l'offre passe en statut "rejected"
  AND l'entreprise est notifiée avec le motif
  AND le montant bloqué est remboursé à l'entreprise

WHEN je clique sur "Demander une correction" avec des commentaires
THEN l'offre repasse en statut "draft" côté entreprise avec mes commentaires visibles
  AND l'entreprise peut corriger et resoumettre
  AND le paiement reste bloqué

GIVEN l'IA a flaggé l'offre comme potentiellement malveillante
WHEN je consulte l'offre
THEN un badge d'alerte "Offre signalée par l'IA" est visible avec les raisons du flag
```

---

### US-ADMIN-02

| Champ | Valeur |
|---|---|
| **ID** | US-ADMIN-02 |
| **Titre** | Gestion d'un litige par admin_ops |
| **Rôle** | admin_ops |
| **Action** | examiner un litige, recueillir les preuves et rendre une décision de paiement |
| **Bénéfice** | résoudre les conflits équitablement et libérer ou rembourser les fonds bloqués |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | ADMIN |
| **Dépend de** | US-MISS-03 |

**Critères d'acceptation :**

```gherkin
GIVEN un litige est ouvert sur une mission
WHEN il apparaît dans ma file d'attente admin
THEN je peux consulter : les détails de la mission, les statuts horodatés, les preuves soumises par les deux parties, l'historique de la conversation

WHEN les deux parties ont soumis leurs preuves (ou le délai de 48h est écoulé)
THEN je peux prendre une décision :
  - Paiement total au candidat
  - Paiement partiel (montant à définir)
  - Remboursement total à l'entreprise
  - Autre (avec note interne justificative)

WHEN je valide la décision
THEN le paiement correspondant est déclenché automatiquement
  AND les deux parties sont notifiées de la décision et du montant
  AND la décision est loguée dans audit_logs

GIVEN le litige est escaladé et dépasse mes compétences
WHEN je clique sur "Escalader à admin_founder"
THEN le litige est transféré avec toutes les notes internes
```

---

### US-ADMIN-03

| Champ | Valeur |
|---|---|
| **ID** | US-ADMIN-03 |
| **Titre** | Vue KPIs temps réel pour admin_ops et admin_founder |
| **Rôle** | admin_ops / admin_founder |
| **Action** | consulter les indicateurs clés de performance en temps réel |
| **Bénéfice** | piloter la plateforme avec des données fiables et détecter les anomalies rapidement |
| **Priorité** | P1 |
| **Complexité** | M |
| **Épique** | ADMIN |
| **Dépend de** | US-ADMIN-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis connecté en tant qu'admin_ops ou admin_founder
WHEN j'accède au tableau de bord
THEN je vois en temps réel :
  - Missions actives en ce moment
  - Missions du jour (confirmées, en cours, terminées)
  - Offres en attente de modération
  - Litiges ouverts
  - Comptes signalés ou suspendus

GIVEN je suis admin_founder
WHEN j'accède au tableau de bord
THEN je vois en plus :
  - CA du jour / du mois
  - Revenus par type (frais de mission, abonnements)
  - Taux de conversion offre → mission
  - Taux de rétention PME à 30 jours

WHEN une alerte critique se produit (litige non traité > 48h, erreur de paiement)
THEN une notification rouge s'affiche dans le dashboard
  AND un email est envoyé à l'admin concerné
```

---

### US-ADMIN-04

| Champ | Valeur |
|---|---|
| **ID** | US-ADMIN-04 |
| **Titre** | Configuration des paramètres financiers par admin_founder |
| **Rôle** | admin_founder |
| **Action** | modifier les taux de commission et paramètres financiers sans redéploiement |
| **Bénéfice** | ajuster la rentabilité de la plateforme en temps réel |
| **Priorité** | P1 |
| **Complexité** | M |
| **Épique** | ADMIN |
| **Dépend de** | US-ADMIN-03 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis connecté en tant qu'admin_founder
WHEN j'accède à "Paramètres > Commissions"
THEN je vois les taux actuels (frais fixe par mission + % du montant)

WHEN je modifie le taux et clique sur "Sauvegarder"
THEN une confirmation à deux facteurs (2FA) est demandée
  AND après confirmation, le nouveau taux s'applique aux prochaines missions (pas aux missions en cours)
  AND la modification est loguée dans audit_logs avec timestamp, IP et valeurs avant/après

GIVEN admin_ops tente d'accéder à cette section
WHEN il navigue vers "Paramètres > Commissions"
THEN un message "Accès non autorisé — section réservée à admin_founder" s'affiche
```

---

## ÉPIQUE 14 — BOT : Chatbot IA Support

---

### US-BOT-01

| Champ | Valeur |
|---|---|
| **ID** | US-BOT-01 |
| **Titre** | Réponse automatique aux FAQ par le chatbot |
| **Rôle** | candidat ou entreprise |
| **Action** | poser une question au chatbot et recevoir une réponse instantanée |
| **Bénéfice** | obtenir de l'aide à tout moment sans attendre un agent humain |
| **Priorité** | P1 |
| **Complexité** | L |
| **Épique** | BOT |
| **Dépend de** | US-AUTH-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis connecté sur la plateforme
WHEN j'ouvre le chatbot et je pose une question standard
  ("Comment fonctionne le paiement ?" / "Comment monter de niveau ?" / "Comment publier une offre ?")
THEN le chatbot répond en moins de 3 secondes en français ou en anglais selon ma langue

WHEN je pose une question sur les délais de paiement
THEN le chatbot m'explique le système à 3 paliers (premium + note >= 4 / l'un ou l'autre / aucun)
  AND me donne mon délai personnalisé selon mon profil actuel

GIVEN le chatbot ne comprend pas ma question après 2 échanges
WHEN je pose une troisième question sans réponse satisfaisante
THEN le chatbot propose automatiquement : "Je ne parviens pas à répondre à votre question — souhaitez-vous parler à un agent ?"
  AND un bouton "Parler à un agent" est affiché

WHEN je clique sur "Parler à un agent"
THEN le ticket est créé et assigné à la file d'attente d'admin_support
  AND je reçois une confirmation avec le délai de réponse estimé
  AND l'historique de ma conversation avec le chatbot est transmis à l'agent
```

---

## ÉPIQUE 15 — NOTIF : Notifications

---

### US-NOTIF-01

| Champ | Valeur |
|---|---|
| **ID** | US-NOTIF-01 |
| **Titre** | Notification de sélection en temps réel |
| **Rôle** | candidat |
| **Action** | être notifié immédiatement quand je suis sélectionné pour une mission |
| **Bénéfice** | réagir rapidement (signer le contrat) et ne pas rater l'opportunité |
| **Priorité** | P0 |
| **Complexité** | S |
| **Épique** | NOTIF |
| **Dépend de** | US-MATCH-04 |

**Critères d'acceptation :**

```gherkin
GIVEN une entreprise vient de me sélectionner
WHEN la sélection est enregistrée
THEN je reçois une notification push ET un SMS dans les 60 secondes :
  "Vous avez été sélectionné pour la mission [Titre] le [Date] chez [Entreprise]"
  AND la notification inclut un lien direct vers le contrat à signer

GIVEN mon téléphone est hors ligne au moment de la notification
WHEN je me reconnecte
THEN la notification push est livrée dès la reconnexion
  AND le SMS a déjà été livré si la connexion n'était coupée que côté app
```

---

### US-NOTIF-02

| Champ | Valeur |
|---|---|
| **ID** | US-NOTIF-02 |
| **Titre** | Rappel automatique d'évaluation |
| **Rôle** | candidat et entreprise après une mission |
| **Action** | recevoir un rappel si je n'ai pas soumis mon évaluation dans les 24h |
| **Bénéfice** | ne pas oublier d'évaluer et éviter le blocage de ma prochaine candidature |
| **Priorité** | P1 |
| **Complexité** | S |
| **Épique** | NOTIF |
| **Dépend de** | US-EVAL-01 |

**Critères d'acceptation :**

```gherkin
GIVEN une mission est terminée et validée
WHEN 24h se sont écoulées sans évaluation soumise
THEN un rappel push + SMS est envoyé : "N'oubliez pas d'évaluer votre mission — vous avez encore 24h"

WHEN 48h se sont écoulées sans évaluation soumise
THEN un dernier rappel est envoyé
  AND le blocage partiel est activé (ne peut plus postuler à de nouvelles offres)

WHEN l'évaluation est soumise
THEN le blocage est levé immédiatement
```

---

## ÉPIQUE 16 — I18N : Internationalisation

---

### US-I18N-01

| Champ | Valeur |
|---|---|
| **ID** | US-I18N-01 |
| **Titre** | Basculement entre français et anglais |
| **Rôle** | tout utilisateur |
| **Action** | choisir ma langue d'interface (français ou anglais) |
| **Bénéfice** | utiliser la plateforme dans ma langue préférée |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | I18N |
| **Dépend de** | US-AUTH-01 |

**Critères d'acceptation :**

```gherkin
GIVEN je suis sur n'importe quelle page de la plateforme
WHEN je clique sur le sélecteur de langue et choisis "English"
THEN toute l'interface bascule en anglais immédiatement (labels, messages, notifications)
  AND ma préférence de langue est sauvegardée dans mon profil

GIVEN ma langue système est l'anglais lors de l'inscription
WHEN je crée un compte
THEN l'interface s'affiche automatiquement en anglais

GIVEN les dates et montants
WHEN j'utilise la plateforme en français
THEN les dates sont au format JJ/MM/AAAA et les montants en FCFA
WHEN je bascule en anglais
THEN les dates sont au format MM/DD/YYYY (ou standard anglophone)
```

---

## ÉPIQUE 17 — PERF : Performance & Sécurité

---

### US-PERF-01

| Champ | Valeur |
|---|---|
| **ID** | US-PERF-01 |
| **Titre** | Chargement rapide sur connexion 3G |
| **Rôle** | tout utilisateur sur réseau mobile lent |
| **Action** | accéder aux pages principales en moins de 3 secondes sur une connexion 3G |
| **Bénéfice** | utiliser la plateforme sans frustration même avec une connexion limitée |
| **Priorité** | P0 |
| **Complexité** | L |
| **Épique** | PERF |
| **Dépend de** | — |

**Critères d'acceptation :**

```gherkin
GIVEN je suis sur une connexion 3G simulée (1 Mbps)
WHEN j'accède à la page d'accueil, la liste des offres, ou mon tableau de bord
THEN le chargement initial est inférieur à 3 secondes (First Contentful Paint)

GIVEN une image de profil ou une photo de lieu est affichée
WHEN la page charge
THEN les images sont compressées et servies en format WebP avec lazy loading activé

GIVEN la connexion est perdue pendant la consultation d'une offre
WHEN la connexion s'interrompt
THEN la page reste lisible en mode lecture (cache partiel activé)
  AND un bandeau "Hors ligne — certaines données peuvent ne pas être à jour" s'affiche
```

---

### US-PERF-02

| Champ | Valeur |
|---|---|
| **ID** | US-PERF-02 |
| **Titre** | Protection des données personnelles du candidat |
| **Rôle** | système |
| **Action** | s'assurer qu'aucune donnée sensible du candidat n'est exposée aux entreprises |
| **Bénéfice** | protéger la vie privée des candidats et respecter la réglementation |
| **Priorité** | P0 |
| **Complexité** | M |
| **Épique** | PERF |
| **Dépend de** | US-MATCH-04 |

**Critères d'acceptation :**

```gherkin
GIVEN une entreprise consulte le profil d'un candidat via l'interface de candidatures
WHEN elle affiche la fiche du candidat
THEN elle ne voit pas : numéro de téléphone, adresse email, numéro CNI, numéro MoMo, adresse GPS domicile
  AND elle voit uniquement : compétences, niveau Sandbox, note, badges, disponibilités, distance approximative, historique de missions (sans détails personnels)

GIVEN une requête API tente d'accéder aux données sensibles d'un candidat via une session entreprise
WHEN la requête est effectuée
THEN la RLS Supabase bloque l'accès et retourne une erreur 403

GIVEN des données sensibles sont loguées par erreur
WHEN les logs sont consultés
THEN les champs sensibles (téléphone, email, CNI) sont masqués ou absents des logs
```

---

## Récapitulatif du backlog

### Par priorité

| Priorité | Nombre de stories |
|---|---|
| P0 — Critique | 28 |
| P1 — Important | 18 |
| P2 — Utile | 0 (à définir en sprint planning) |
| **Total** | **46** |

### Par épique

| Épique | Stories | Priorité max |
|---|---|---|
| AUTH | 6 | P0 |
| ONBC | 7 | P0 |
| ONBE | 2 | P0 |
| PROF | 3 | P1 |
| JOB | 10 | P0 |
| MATCH | 4 | P0 |
| CONT | 2 | P0 |
| MISS | 4 | P0 |
| EVAL | 2 | P0 |
| PAY | 2 | P0 |
| SAND | 2 | P0 |
| SUB | 2 | P1 |
| ADMIN | 4 | P0 |
| BOT | 1 | P1 |
| NOTIF | 2 | P0 |
| I18N | 1 | P0 |
| PERF | 2 | P0 |

### Ordre de développement recommandé (sprints)

| Sprint | Épiques | Objectif |
|---|---|---|
| Sprint 1 | AUTH, I18N | Inscription, connexion, multilingue |
| Sprint 2 | ONBC, ONBE | Onboarding candidat et entreprise |
| Sprint 3 | PROF, JOB (01-06) | Profil, documents, publication d'offre, modération |
| Sprint 4 | MATCH, CONT | Matching, candidature, contrat |
| Sprint 5 | MISS, EVAL | Suivi de mission, validation, évaluations |
| Sprint 6 | PAY, SAND | Paiement, remboursement, Sandbox |
| Sprint 7 | ADMIN, BOT | Dashboard admin, chatbot |
| Sprint 8 | SUB, NOTIF, JOB (07-10), PERF | Abonnements, notifications, multi-jours, performance |

---

*Document vivant — les stories P2 seront définies lors des sprint plannings après validation des P0/P1.*
*Référence SRS : SRS_EasyJob_CM_MVP v1.1*
*Prochaine étape : estimation en points de story en équipe (planning poker)*
