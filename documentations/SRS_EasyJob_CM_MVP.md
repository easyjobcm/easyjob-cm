# Software Requirements Specification (SRS)
# Easyjob CM — MVP v1.1

> **Statut :** Draft v1.1
> **Dernière mise à jour :** Mai 2025
> **Auteur :** Fondateur Easyjob CM
> **Stack cible :** Next.js 14+ · TypeScript · Supabase · Tailwind CSS · shadcn/ui · next-intl
> **Langues supportées :** Français (par défaut) · Anglais

---

## Table des matières

1. [Introduction](#1-introduction)
2. [Parties prenantes et utilisateurs](#2-parties-prenantes-et-utilisateurs)
3. [Périmètre du MVP](#3-périmètre-du-mvp)
4. [Hypothèses et contraintes](#4-hypothèses-et-contraintes)
5. [Règles métier](#5-règles-métier)
6. [Fonctionnalités détaillées](#6-fonctionnalités-détaillées)
7. [Flux utilisateurs principaux](#7-flux-utilisateurs-principaux)
8. [Modèle de données](#8-modèle-de-données)
9. [Exigences non fonctionnelles](#9-exigences-non-fonctionnelles)
10. [Sécurité et conformité](#10-sécurité-et-conformité)
11. [Points ambigus et décisions ouvertes](#11-points-ambigus-et-décisions-ouvertes)
12. [Hors périmètre MVP](#12-hors-périmètre-mvp)
13. [Critères d'acceptation globaux](#13-critères-dacceptation-globaux)

---

## 1. Introduction

### 1.1 Présentation du produit

Easyjob CM est une plateforme bilatérale de mise en relation entre **chercheurs d'emploi** (candidats) et **entreprises** (PME, commerces, événementiel, restauration, logistique) pour des missions de travail **temporaires** (courte ou longue durée, sans limite maximale fixée) et **permanentes** au Cameroun.

Le modèle s'inspire de Zenjob (Allemagne) et Instaff (UK), adapté aux réalités du marché camerounais : paiement Mobile Money, économie informelle dominante, faible confiance initiale, connectivité variable.

### 1.2 Problèmes résolus

| Problème | Côté candidat | Côté entreprise |
|---|---|---|
| Accès à l'emploi | Canaux informels, non fiables, lents | Recrutement opaque, coûteux, chronophage |
| Confiance | Pas de preuve de fiabilité | Pas de garantie de présence ou de compétence |
| Paiement | Retard, non-paiement | Gestion de paie complexe pour petites missions |
| Traçabilité | Aucune preuve de mission | Pas d'historique RH structuré |

### 1.3 Objectifs MVP

- Valider la liquidité du marché sur Douala et Yaoundé.
- Prouver que le paiement sécurisé via séquestre réduit les litiges.
- Atteindre 1 500 missions/mois d'ici le mois 10.
- Générer un revenu brut de **500 à 1 000 FCFA** par mission confirmée.

### 1.4 Vision long terme (hors MVP)

Assurance mission automatisée, expansion multi-pays (Côte d'Ivoire, Sénégal), marketplace de formations, payroll intégré, application native iOS/Android.

---

## 2. Parties prenantes et utilisateurs

### 2.1 Rôles système

| Rôle | Description | Permissions clés |
|---|---|---|
| `candidate` | Chercheur d'emploi inscrit | Postuler, suivre missions, noter employeurs |
| `candidate_premium` | Candidat abonné premium | Priorisation dans les candidatures, badges avancés, paiement accéléré |
| `company` | Compte entreprise standard | Publier offres, gérer candidatures, valider missions |
| `company_premium` | Compte entreprise abonné | Tout company + options urgentes gratuites, reporting, support prioritaire |
| `admin_support` | Agent service client Easyjob CM | Lire et répondre aux tickets, escalader, consulter profils |
| `admin_ops` | Haut cadre Easyjob CM | Gérer utilisateurs, offres, litiges, paramètres opérationnels |
| `admin_founder` | Fondateur | Accès total, logs complets, configuration système, paramètres financiers |

> **Note :** Les trois groupes admin ont des niveaux d'accès strictement séparés. `admin_support` ne voit jamais les données financières. `admin_ops` ne peut pas modifier les paramètres financiers. Seul `admin_founder` a accès aux taux de commission, aux virements et aux logs de sécurité critiques.

### 2.2 Profils utilisateurs types

**Candidat type A — Étudiant 20-25 ans, Douala**
- Cherche des missions ponctuelles pour compléter ses revenus.
- Utilise un Android d'entrée de gamme, connexion MTN 4G.
- Sensible à la vitesse d'inscription et à la clarté des offres.

**Candidat type B — Demandeur d'emploi 25-35 ans**
- Cherche un emploi permanent ou des missions régulières.
- Dispose de compétences spécifiques (caissier, magasinier, agent d'accueil).
- Veut pouvoir prouver son expérience avec un historique vérifiable.

**Entreprise type A — PME commerciale, Yaoundé**
- Besoin ponctuel de 2-5 agents pour un événement ou une période de pointe.
- Pas de service RH dédié. Décision prise par le gérant.
- Sensible au coût et à la garantie de présence.

**Entreprise type B — Entreprise structurée, Douala**
- Besoins récurrents (remplacement, renfort hebdomadaire).
- Veut un outil de reporting simple.
- Prête à payer un abonnement si la valeur est prouvée.

---

## 3. Périmètre du MVP

### 3.1 Inclus dans le MVP

- [x] Authentification (email/mot de passe, OTP SMS, Google/Facebook comme option secondaire)
- [x] Onboarding guidé par IA pour candidats et entreprises
- [x] Profil candidat avec système de complétude et badges
- [x] Gestion des dates d'expiration des documents candidat
- [x] Profil entreprise avec vérification NIU
- [x] Publication d'offres assistée par IA avec modération admin obligatoire
- [x] Système d'offres multi-jours décomposées par journée
- [x] Catégorisation et paramétrage automatique des offres par l'IA
- [x] Matching IA candidats/offres avec priorité aux anciens travailleurs
- [x] Système de candidature simplifié (sans message) et sélection
- [x] Contrat de mission généré automatiquement (format simple < 3 jours / formalisé >= 3 jours)
- [x] Suivi de mission (statuts candidat + validation entreprise)
- [x] Code de validation de fin de mission
- [x] Système d'évaluations réciproques
- [x] Paiement sécurisé par mission sans portefeuille permanent (Mobile Money MTN/Orange)
- [x] Remboursement automatique du surplus à l'entreprise
- [x] Système de délai de paiement candidat selon profil (premium + note)
- [x] Système Sandbox (niveaux de confiance progressifs, configurable admin)
- [x] Sanctions automatiques pour absences et annulations tardives
- [x] Abonnements entreprise et candidat premium
- [x] Dashboard admin complet avec 3 niveaux d'accès
- [x] Chatbot IA support + escalade humaine
- [x] Multilingue FR/EN
- [x] Notifications (push, SMS, email)
- [x] Système de litiges basique

### 3.2 Hors périmètre MVP

Voir section 12.

---

## 4. Hypothèses et contraintes

### 4.1 Hypothèses produit

- Les utilisateurs ont accès à un smartphone Android avec connexion data.
- Mobile Money (MTN MoMo / Orange Money) est le moyen de paiement principal.
- La langue principale est le français, l'anglais est nécessaire pour Buéa et certains candidats.
- Les missions peuvent être de courte durée (1 jour) ou de longue durée (plusieurs semaines ou mois), sans limite maximale.

### 4.2 Contraintes techniques

- L'application doit fonctionner correctement sur des connexions 3G lentes.
- Les pages doivent se charger en moins de 3 secondes sur mobile.
- Le backend est hébergé sur Supabase + Vercel (infrastructure serverless).
- Pas d'application native au MVP — PWA ou web responsive uniquement.

### 4.3 Contraintes réglementaires

- Respect de la loi camerounaise sur la protection des données personnelles.
- Les contrats générés doivent être conformes au Code du travail camerounais.
- La collecte du NIU implique une vérification minimale de l'existence légale de l'entreprise.
- Les règles de pause obligatoires s'inspirent des standards européens (voir section 5.4).

---

## 5. Règles métier

### 5.1 Règles générales

- Toute mission doit être contractualisée avant le début du travail.
- Le paiement doit être confirmé (fonds bloqués) avant que l'offre ne soit soumise à la modération admin.
- Un candidat ne peut pas postuler à une offre si son profil est incomplet à moins de 60%. En plus du seuil de 60%, trois champs dits **essentiels** (identité complète, CNI vérifiée non expirée, compte Mobile Money vérifié) sont bloquants en propre : ils doivent être validés même si le pourcentage global atteint 60% (voir §6.2 et §6.6).
- Les évaluations sont obligatoires après chaque mission terminée (bloquantes pour la mission suivante si non soumises après 48h).

#### 5.1.1 Verrouillage des informations vérifiées — mise à jour initiée par l'admin

Pour éviter qu'un candidat ne contrevienne aux informations personnelles et documents **déjà vérifiés** (intégrité de l'identité vérifiée côté CNI), les données vérifiées sont **verrouillées** pour le candidat :

- **Scope verrouillé** (si `cni_verified = verified`) : identité (`first_name`, `last_name`, `date_of_birth`) + documents CNI (recto/verso/selfie). Hors périmètre : bio, ville, quartier, géolocalisation, compétences, photo de profil, Mobile Money.
- **Déverrouillage** : uniquement si un administrateur (`admin_ops` / `admin_founder`) a initié une **demande de mise à jour** (`profile_update_requests` en statut `pending` couvrant le groupe `identity` et/ou `cni_documents`).
- **Canaux d'information** : la demande se matérialise **à la fois** (1) en **notification** (centre `notifications`, type `document_status`) et (2) en **tâche** (page *Tâches*, carte dédiée + modal détaillant le motif de l'admin).
- **Exécution** : le candidat ouvre la page *Modifier mes informations* ; les champs déverrouillés y sont actifs ; l'admin peut suivre le motif (colonne `reason`) ; la date d'initiation (colonne `created_at`) est tracée.
- **Révérification obligatoire** : la résoumission d'un champ déverrouillé repasse `cni_verified` à `pending` (même mécanisme que T1 — SRS §6.2/§6.6). Le candidat ne peut pas contourner la révérification en changeant uniquement la DOB ou un nom partiel sans déclencher la ré-évaluation.
- **Clôture automatique** : la demande `pending` passe `done` dès que le candidat exécute la mise à jour (seules les lignes couvrant un groupe effectivement modifié sont clôturées, jamais celles qui se contentent de rester `pending`).
- **Garde-fou RLS** : la RLS garantit (1) que le candidat ne peut lire que ses propres demandes `pending`, (2) que seul un admin `admin_ops/admin_founder` peut créer/annuler une demande, (3) que le candidat ne peut la clôturer qu'en `done`. Le serveur reste la source de vérité (masquage client = confort seulement, jamais le seul contrôle).
- **UI admin d'initiation** : incluse en **T8** (refonte dashboard admin) ; l'endpoint `POST /api/admin/profile-update-requests` est disponible depuis T2.

### 5.2 Système Sandbox (niveaux candidat)

Les seuils ci-dessous sont les **valeurs initiales configurables** depuis le dashboard `admin_founder`. Ils peuvent être modifiés à tout moment sans redéploiement.

| Niveau | Condition de déblocage (valeurs initiales) | Types d'offres accessibles |
|---|---|---|
| Niveau 0 — Nouveau | Inscription validée | Missions faible risque (distribution de flyers, aide logistique simple) |
| Niveau 1 — Confirmé | 1 mission réussie + note >= 3.5/5 | Missions intermédiaires (accueil, assistance vente) |
| Niveau 2 — Fiable | 3 missions réussies + note >= 4/5 + profil >= 80% | Missions à responsabilité (caissier, gestion de stock) |
| Niveau 3 — Expert | 10 missions + note >= 4.5/5 + badge vérifié | Toutes missions, priorisation dans le matching |

> **Badge vérifié (Niveau 3)** — voir décision formalisée en §11.11 : le badge vérifié désigne exclusivement l'**identité vérifiée** (CNI validée par un admin, `cni_verified = verified`). La vérification de compétences par documents (§6.14) n'élargit pas cette condition tant qu'une évolution du Sandbox n'est pas explicitement validée par `admin_founder`.

### 5.3 Règles de paiement candidat

Le délai de paiement dépend du profil du candidat, après validation de la mission par l'entreprise :

| Situation | Délai de paiement |
|---|---|
| Candidat premium **ET** note >= 4 étoiles | **100%** du montant dans les **48h** |
| Candidat premium **OU** note >= 4 étoiles (mais pas les deux) | **50%** dans les **48h** + **50%** dans les **7 jours** |
| Ni premium, ni note >= 4 étoiles | **100%** du montant dans les **7 jours** |

**Règles complémentaires :**
- En cas de litige non résolu sous 48h, le paiement est suspendu et escaladé vers `admin_ops`.
- Les frais de service Easyjob CM sont prélevés automatiquement sur le montant bloqué avant libération.
- En cas d'annulation par l'entreprise à moins de 12h du début, une pénalité de 20% du montant est due au candidat.
- En cas d'annulation par le candidat à **moins de 24h** du début, il perd son accès aux missions de niveau supérieur pendant **7 jours**.
- En cas d'**absence sans justificatif** (no-show), le compte du candidat est **bloqué temporairement pendant 7 jours**.
- Si le candidat cumule **3 absences sans justificatif valable**, son compte est **banni définitivement**.

> ⚠️ **Point ambigu #3** — Voir section 11.3 sur l'agrégateur de paiement (décision encore à prendre).

### 5.4 Règles d'offres

Une offre doit obligatoirement contenir les éléments suivants :

- **Titre** de la mission.
- **Catégorie** (attribuée automatiquement par l'IA).
- **Nombre de personnes requises** (par journée).
- **Lieu** : adresse précise + lien Google Maps + référence à un lieu populaire proche + photo du lieu si disponible.
- **Date(s)** de la mission.
- **Durée** journalière (en heures).
- **Durée de pause obligatoire** (calculée automatiquement selon les règles suivantes) :
  - Moins de 6h de travail : pas de pause obligatoire.
  - Entre 6h et 8h30 de travail : **30 minutes** de pause.
  - Plus de 8h30 de travail : **45 minutes** de pause.
- **Salaire** par jour et par personne. Le total par date = nombre de personnes × prix journalier. L'IA vérifie que le montant est raisonnable selon la durée effective (brute moins pause) et le marché camerounais.
- **Compétences requises** (générées et validées par l'IA).
- **Documents requis** (optionnel : casier judiciaire vierge, diplôme, permis de conduire, CNI vérifiée...). Lorsqu'un diplôme ou certificat est exigé pour une **compétence précise**, l'exigence précise le type de document et la compétence concernée (voir §6.14 et §8.1). Le candidat ne peut postuler que si le justificatif correspondant est présent, validé et non expiré (vérification serveur, pas seulement frontend).
- **Équipement demandé au candidat** (ex : chaussures fermées, tenue noire).
- **Équipement mis à disposition par l'entreprise** (ex : tablier, badge).
- **Avantages** (optionnels) : repas offert, remboursement de taxi, prime de présence, etc.
- **Niveau Sandbox minimum requis** (déterminé automatiquement par l'IA selon le type de mission).
- **Type de mission** (temporaire / permanent) — déterminé automatiquement par l'IA.
- **Instruction de ponctualité** : message automatique rappelant aux candidats d'être présents **30 minutes avant le début** de la mission.

**Règles de validité et modération :**
- Toute offre est soumise à **validation admin** avant publication. Elle ne peut être visible par les candidats qu'après approbation.
- Toute offre détectée comme malveillante (fausse offre, arnaque, demande de frais de dossier) est automatiquement signalée à l'équipe admin et à l'entreprise pour correction. Elle ne sera jamais publiée sans correction validée.
- Une offre expire automatiquement si elle n'est pas pourvue **2 heures avant** la date de début.
- Une offre peut être marquée **"urgente"** : visible en premier dans les résultats. Option **gratuite pour les comptes premium**, **payante pour les comptes standard**.
- **Visibilité RLS** : une offre n'est lisible et postulable par un candidat qu'au statut `active` (après approbation admin). Les statuts `draft`, `pending_review`, `pending_moderation`, `rejected`, `filled`, `expired`, `cancelled` sont masqués aux candidats via la policy de lecture `jobs` (seul l'état `active`, ainsi que les offres de l'entreprise propriétaire, sont exposés). Cette règle est appliquée côté base (RLS), pas seulement côté frontend.

**Gestion des offres multi-jours :**
- Une offre couvrant plusieurs journées est automatiquement décomposée en **sous-offres journalières** après validation admin.
- Chaque candidat peut postuler à **une ou plusieurs journées** selon ses disponibilités.
- Chaque journée est traitée comme une mission indépendante pour la contractualisation, le suivi et le paiement.

**Modification et réutilisation des offres :**
- L'entreprise peut modifier ou supprimer une offre jusqu'à **12h avant le début**, à condition que le nombre de candidats requis ne soit **pas encore atteint**.
- Si le quota est atteint, toute modification nécessite de contacter le service client (sauf comptes premium qui ont accès à la modification directe).
- Une entreprise peut **réutiliser une ancienne offre** en modifiant uniquement les éléments variables (date, heure, nombre de personnes, rémunération) sans repartir de zéro.

### 5.5 Règles de confiance entreprise

Un score de confiance entreprise est calculé à partir de :
- Taux de confirmation des missions publiées.
- Taux d'annulation à moins de 12h.
- Note moyenne reçue des candidats.
- Rapidité de validation de fin de mission.
- Litiges résolus vs. escaladés.

Le score est visible par les candidats sur la fiche entreprise.

---

## 6. Fonctionnalités détaillées

### 6.1 Authentification

**Description :** Création de compte et connexion sécurisée.

**Flux :**
1. Choix du type de compte (Candidat / Entreprise).
2. Méthode principale : email + mot de passe OU OTP SMS.
3. Méthode secondaire disponible : connexion Google ou Facebook.
4. Dans **tous les cas** : le numéro de téléphone camerounais doit être saisi et validé par OTP.
5. Vérification email obligatoire.
6. Redirection vers onboarding.

**Critères d'acceptation :**
- Un utilisateur peut créer un compte en moins de 2 minutes.
- L'OTP SMS expire après 10 minutes.
- Un compte inactif depuis 90 jours reçoit une notification de relance.
- Le mot de passe doit contenir au minimum 8 caractères, une majuscule, et un chiffre.
- Le numéro de téléphone est toujours validé par OTP, même via Google ou Facebook.

**Validations Zod côté serveur :**
- Email format valide.
- Mot de passe conforme.
- Numéro de téléphone camerounais (format +237XXXXXXXXX).

---

### 6.2 Onboarding candidat

**Description :** Parcours guidé pour compléter le profil avec l'aide de l'IA.

**Étapes :**
1. Informations personnelles (nom, prénom, date de naissance, ville).
2. Photo de profil.
3. Compétences et secteurs d'activité (choix guidé + suggestion IA). Le **permis de conduire** est une compétence déclarable : upload du document + date d'expiration enregistrée. Toute compétence déclarée peut, de façon **facultative**, être justifiée par un document probant (diplôme, certificat, attestation de formation ou de travail) pour obtenir le statut « Vérifiée » — voir §6.14. Le CV, lui, reste un document général du profil et ne vérifie jamais une compétence à lui seul.
4. Expériences passées (saisie libre + structuration IA).
5. Disponibilités (jours, horaires, mobilité géographique).
6. **Localisation GPS du domicile** : enregistrement de la position GPS depuis le lieu de résidence. Utilisée comme référence pour calculer les distances par rapport aux offres. Peut être mise à jour depuis le profil.
   - **T5 — flux de permission** : le navigateur ne réclame la permission d'accès à la localisation qu'après un geste utilisateur. Le candidat clique sur « Utiliser ma position » → la demande de permission du navigateur s'affiche à ce moment (un indice le rappelle tant que la position n'est pas enregistrée). Le badge « GPS enregistré » (précision ± m quand fournie par l'appareil) confirme le fix ; aucun chiffre lat/lng n'est affiché (principe de confidentialité : l'entreprise ne voit jamais le GPS domicile — US-ONBC, §12).
   - **T5 — coordonnées validées** : les coordonnées lat/lng sont bornées à leurs plages géographiques légales (±90/±180) côté API `identity` et côté onboarding (règle double AGENTS).
   - **T5 — ville** : le catalogue partagé `CAMEROON_CITIES` porte la graphie accentuée « Yaoundé » ; une migration (20260909150000) remplit les anciennes lignes sans accent.
   - **T5.1 — zone de service** : la position GPS du domicile est **référencée aux centres de service** (Douala 4.04°N / 9.69°E, Yaoundé 3.87°N / 11.51°E) et **rejetée** si elle est à plus de 20 km du centre le plus proche (règle `isNearCityZone`, bornes géographiques + zone, côté **API** `identity` ET **onboarding**) — le MVP ne sert que Douala et Yaoundé. Un fix **dans la zone** **auto-remplit** la ville (centre le plus proche) **et le quartier** (reverse geocoding OpenStreetMap Nominatim, 1 seule requête déclenchée par le geste utilisateur) ; en cas d'échec du reverse geocoding, le fix reste valable et le quartier est laissé à saisir. Les villes saisies manuellement sont **bornées au catalogue** `CAMEROON_CITIES` (règle `cityNotServed`).
   - **T5.1 — confidentialité GPS** : les coordonnées lat/lng n'existent que côté candidat ; aucune n'est journalisée ni exposée (badge « GPS enregistré » + précision ± m uniquement).
7. Upload **CNI** (recto/verso) + **selfie tenant la CNI** pour validation admin dans les 24h. La date d'expiration de la CNI est enregistrée et surveillée.
8. Vérification numéro **Mobile Money** (MTN ou Orange). Le nom enregistré sur le compte MoMo **doit correspondre au nom complet du candidat**. Les comptes au nom d'un tiers ne sont pas acceptés.
9. Consentement RGPD local.

**Gestion des documents expirés :**
- La plateforme surveille automatiquement les dates d'expiration (CNI, permis de conduire...).
- Notifications envoyées : 30 jours avant, 7 jours avant, et à l'expiration.
- Un document expiré est automatiquement marqué invalide. L'upload du document renouvelé relance la validation.
- Tant qu'un document requis par une offre est expiré, le candidat ne peut pas postuler à cette offre.

**Complétude minimale requise :** 60% pour postuler, **et** trois champs essentiels obligatoires :
- **Identité complète** — nom, prénom et date de naissance (déduit de l'âge) ;
- **CNI vérifiée** — `cni_verified = verified` et non expirée (`cni_expires_at` > aujourd'hui) ;
- **Compte Mobile Money vérifié** — `momo_verified = true`.

Ces trois critères sont évalués **indépendamment** du pourcentage global de complétude : un profil à 100% mais sans CNI vérifiée ne peut pas postuler. La vérification est faite côté serveur à chaque soumission de candidature (masquage côté client insuffisante) — voir §6.6.

**Modifier le profil candidat (post-onboarding) :** le candidat édite ses informations depuis *Profil → Modifier mes informations* : prénom, nom, **date de naissance**, ville, quartier, bio, géolocalisation, photo de profil et CNI. (Depuis T3, les **compétences ne sont plus éditables** sur cette page : elles vivent dans la page dédiée *Mes compétences* — voir §6.14.1. La carte compétences qui y existait faisait un delete-all + insert-all à chaque sauvegarde, ce qui remet `verification_status` à `unverified` et détruisait les liens `candidate_skill_documents` : la suppression de la carte corrige ce bug structurellement.) La **date de naissance** est modifiable (elle fait partie de l'identité complète exigée à la postulation) ; un changement de prénom, nom ou date de naissance sur un CNI déjà `verified` déclenche la **révérification** (modal de confirmation, CNI → `pending`, poste bloqué tant que non re-vérifiée). Les champs vérifiés sont **verrouillés** et ne peuvent être modifiés qu'après une demande de mise à jour initiée par l'admin — voir §5.1.1.

**Critères d'acceptation :**
- L'IA suggère des compétences à partir d'une description libre en moins de 3 secondes.
- La vérification CNI/MoMo affiche un statut clair (en attente / validé / rejeté).
- L'utilisateur peut sauvegarder et reprendre l'onboarding à tout moment.
- Les champs obligatoires sont indiqués visuellement.
- Le nom du compte MoMo est contrôlé pour correspondance avec le nom du candidat.
- Un changement de prénom/nom/date de naissance sur un CNI `verified` déclenche la révérification (modal + `cni_verified = pending`) et, en l'absence de demande admin `pending`, la modification est refusée côté serveur (`403 field_locked`, §5.1.1).

---

### 6.3 Onboarding entreprise

**Description :** Parcours guidé pour configurer le compte entreprise.

**Étapes :**
1. Nom de l'entreprise et secteur d'activité.
2. NIU (Numéro d'Identifiant Unique fiscal).
3. Adresse et villes d'opération.
4. Logo et description.
5. Contact principal et rôle.
6. Acceptation des CGU.

> Note : il n'y a pas de portefeuille permanent. Le paiement se fait mission par mission au moment de la publication d'une offre (voir section 6.10).

**Critères d'acceptation :**
- Le NIU est vérifié par regex (format valide) + validation manuelle admin dans les 24h.
- L'onboarding est sauvegardable et reprennable.

---

### 6.4 Publication d'offre assistée par IA

**Description :** Création d'une offre de mission en quelques étapes simples, avec modération admin obligatoire avant publication.

**Étapes :**
1. Description libre de la mission (texte court).
2. L'IA génère automatiquement : titre, catégorie, type de mission (temporaire/permanent), niveau Sandbox minimum requis, compétences requises, description structurée, durée de pause obligatoire.
3. L'entreprise complète et valide : lieu (adresse + référence populaire + photo optionnelle + lien map), date(s), durée journalière, nombre de personnes par jour, salaire par jour et par personne.
4. **L'IA valide le salaire** : cohérence avec la durée effective de travail et les standards du marché camerounais. Un avertissement est affiché si le montant semble incohérent ou insuffisant.
5. Définition des documents requis (optionnel).
6. Définition des équipements demandés et mis à disposition.
7. Définition des avantages éventuels (repas, taxi, prime...).
8. Option "Urgente" : gratuite pour les comptes premium, payante pour les comptes standard.
9. Prévisualisation + confirmation.
10. **Paiement du montant bloqué** (voir section 6.10) : l'offre ne peut être soumise à l'admin sans confirmation du paiement.
11. **Soumission à l'admin pour modération** : l'offre passe en statut "en attente de validation". Elle n'est pas visible par les candidats tant qu'elle n'est pas approuvée.
12. Après validation admin, si l'offre couvre plusieurs jours, elle est automatiquement décomposée en sous-offres journalières.

**Critères d'acceptation :**
- La génération IA prend moins de 5 secondes.
- L'entreprise peut modifier tous les champs avant soumission.
- Toute offre détectée comme malveillante est automatiquement bloquée et signalée.
- L'admin peut approuver, rejeter ou demander une correction avec commentaire.
- Une offre approuvée est visible sur la plateforme dans les 2 minutes suivant l'approbation.
- Une offre urgente approuvée apparaît en premier dans les résultats.

---

### 6.5 Matching IA

**Description :** Algorithme de classement des candidats pour chaque offre.

**Critères de scoring (pondération indicative, configurable depuis admin) :**

| Critère | Poids |
|---|---|
| Compétences correspondantes | 30% |
| Niveau Sandbox | 20% |
| Note moyenne | 15% |
| Complétude du profil | 10% |
| Disponibilité déclarée | 10% |
| Proximité géographique (GPS domicile -> lieu de mission) | 10% |
| Statut premium | 5% |

**Priorité aux anciens travailleurs :**
- Les candidats ayant déjà travaillé pour l'entreprise avec une note satisfaisante sont **priorisés** et affichés avec un **badge distinctif** visible par l'entreprise.
- Lors de la création d'une nouvelle offre (hors première offre), l'IA propose une **liste de recommandations** basée sur l'historique de l'entreprise.

**Critères d'acceptation :**
- Le score de pertinence est visible par l'entreprise (ex : 87% de correspondance).
- Les raisons du classement sont affichées (ex : "Compétences : caisse ✓ | Distance : 3 km | Déjà travaillé ici ✓").
- Le candidat peut voir son positionnement dans une offre (ex : "Vous êtes dans le top 10").
- L'entreprise peut filtrer par niveau Sandbox, distance, disponibilité.

---

### 6.6 Candidature et sélection

**Description :** Le candidat postule en un clic, l'entreprise sélectionne.

**Flux candidat :**
1. Consultation de l'offre (ou de la sous-offre journalière).
2. Vérification automatique des prérequis (profil complet ≥ 60%, **champs essentiels**, niveau Sandbox, documents valides et non expirés). Les champs essentiels (identité complète, CNI vérifiée non expirée, Mobile Money vérifié) sont contrôlés côté serveur avant toute création de candidature. En cas d'échec, la candidature est refusée (HTTP 403), le candidat est notifié de la liste précise des critères manquants et redirigé vers la page de complétion.
3. Soumission de la candidature en un clic (sans message libre).
4. Suivi du statut : **en attente** / **accepté** / **refusé**.

**Flux entreprise :**
1. Consultation des candidatures triées par score IA.
2. Consultation du profil **partiel** du candidat : compétences, niveau Sandbox, note, badges, disponibilités, distance, expériences, historique avec l'entreprise. Les données personnelles sensibles (téléphone, email, CNI) ne sont **jamais visibles** pour l'entreprise.
3. Les candidats ayant déjà travaillé pour cette entreprise avec une bonne note sont mis en avant avec un badge distinctif.
4. Sélection d'un ou plusieurs candidats (jusqu'au nombre requis par journée).
5. Déclenchement automatique de la génération du contrat.
6. Notification au candidat.

**Critères d'acceptation :**
- Une candidature est enregistrée en moins de 60 secondes.
- L'entreprise peut refuser une candidature avec motif optionnel.
- Le candidat est notifié immédiatement (push + SMS).
- Un candidat ne peut postuler qu'une seule fois à la même offre ou sous-offre.
- Les données sensibles du candidat ne sont jamais exposées à l'entreprise.
- **Lecture RLS de l'offre** : le candidat ne peut lire ni postuler qu'à une offre au statut `active`. Une offre non active est inexistante pour lui via RLS (HTTP 404 à la lecture) : la postulation d'un candidat exige donc une offre lisible, ce qui garantit qu'une offre jamais approuvée ne peut générer de candidature.
- **Gate des champs essentiels** : la soumission est refusée (403) si l'identité complète, la CNI vérifiée non expirée ou le Mobile Money vérifié manque, même si la complétude globale est ≥ 60%. La réponse indique la liste des critères manquants. **Depuis T8.3** (`code: "profile_not_verified"`) : la décision repose sur le flag de synthèse `users.is_verified` (source de vérité en base, posé par `recompute_user_verification` — §11.5) ; le calcul client des champs manquants reste fourni en liste informationnelle pour guider le candidat, mais ne suffit plus à autoriser — le serveur lit le flag.

---

### 6.7 Contrat de mission

**Description :** Génération automatique d'un contrat avant le début de la mission.

**Format selon la durée (décision 11.1 — Option C) :**
- **Moins de 3 jours** : contrat simple avec consentement électronique (checkbox + horodatage + IP).
- **3 jours et plus** : contrat formalisé conforme au Code du travail camerounais, validé par un cabinet juridique.

**Contenu du contrat :**
- Identité candidat et entreprise.
- Description de la mission.
- Date, horaires, lieu.
- Durée effective (brute moins pause obligatoire).
- Rémunération nette.
- Obligations des deux parties.
- Conditions d'annulation et pénalités.
- Consentement électronique avec horodatage et adresse IP.

**Critères d'acceptation :**
- Le contrat est généré en moins de 10 secondes après sélection.
- Les deux parties doivent signer avant que la mission ne démarre officiellement.
- Le contrat est archivé et consultable à tout moment.
- Le contrat est disponible en PDF téléchargeable.

---

### 6.8 Suivi de mission

**Description :** Traçabilité complète du déroulement de la mission.

**Statuts candidat :**

```
CONFIRMÉ → EN ROUTE → ARRIVÉ → EN COURS → TERMINÉ (en attente validation)
```

**Actions candidat :**
- "Je suis en route" (déclenche notification à l'entreprise).
- "Je suis arrivé" (horodatage). Le candidat est attendu **30 minutes avant le début** de la mission.
- "J'ai commencé" (démarrage officiel de la mission).
- "J'ai terminé" (soumission du code de validation reçu de l'entreprise).

**Actions entreprise :**
- Génération du code de validation (4-6 chiffres, usage unique).
- Validation de la fin de mission.
- Signalement d'un problème.

**Critères d'acceptation :**
- Chaque changement de statut est horodaté et sauvegardé.
- Le code de validation expire 2 heures après génération.
- L'entreprise est notifiée à chaque étape importante.
- En cas de non-présentation, l'entreprise peut déclencher un "no-show" dans les 30 minutes suivant l'heure de début.

---

### 6.9 Système d'évaluations

**Description :** Avis réciproques après chaque mission.

**Flux :**
1. Mission terminée et validée.
2. Les deux parties reçoivent une notification pour évaluer.
3. Délai : 48h pour soumettre l'évaluation.
4. Passé 48h : rappel + blocage partiel (pas de nouvelle mission sans évaluation soumise).

**Structure de l'évaluation :**
- Note globale (1 à 5 étoiles).
- Critères spécifiques pour le candidat : ponctualité, compétence, communication, présentation.
- Critères spécifiques pour l'entreprise : clarté des instructions, respect, conformité aux conditions de l'offre.
- Commentaire libre (optionnel, modéré par l'IA avant publication).

**Critères d'acceptation :**
- Une évaluation soumise ne peut pas être modifiée.
- Un commentaire offensant est automatiquement masqué et soumis à modération.
- Les notes contribuent immédiatement au score de confiance et impactent le délai de paiement.
- Les évaluations sont visibles publiquement sur les profils.

---

### 6.10 Paiement sécurisé par mission (sans portefeuille permanent)

**Description :** Mécanisme de paiement sécurisé sans wallet permanent côté entreprise. Chaque paiement est directement lié à une offre spécifique.

**Flux de paiement :**
1. Lors de la soumission d'une offre, l'entreprise effectue un **virement Mobile Money** du montant total : (nombre de personnes × salaire journalier × nombre de jours) + frais Easyjob CM.
2. Ce montant est **bloqué sur le compte de la plateforme** et affiché dans le tableau de bord de l'entreprise comme "montant réservé pour cette offre".
3. Si, à la fin de la mission, le nombre de candidats ayant effectivement travaillé est inférieur au nombre prévu, la plateforme **rembourse automatiquement le surplus** sur le même compte Mobile Money ayant effectué le virement, dans les meilleurs délais.
4. À la validation de fin de mission par l'entreprise :
   - Les frais Easyjob CM sont prélevés.
   - Le solde est libéré vers le compte Mobile Money du candidat selon le délai défini en section 5.3.
5. En cas de litige, le montant reste bloqué jusqu'à résolution par `admin_ops`.

**Critères d'acceptation :**
- Le montant bloqué est visible par l'entreprise dans son tableau de bord (par offre, par journée, par candidat).
- Les transactions sont listées avec statut (réservé / libéré / remboursé / litige).
- Le remboursement du surplus est automatique, sans action de l'entreprise.
- Les frais Easyjob CM sont détaillés de façon transparente avant confirmation du paiement.
- Un reçu est généré pour chaque transaction.

---

### 6.11 Abonnements

**Description :** Plans payants pour candidats et entreprises.

**Plans entreprise :**

| Plan | Prix / mois | Avantages |
|---|---|---|
| Gratuit | 0 FCFA | Publication d'offres soumises à modération, matching standard, options urgentes payantes, 2 offres actives max |
| Starter | 5 000 FCFA | Jusqu'à 5 offres actives simultanées, légère mise en avant dans les résultats, support standard |
| Pro | 12 000 FCFA | Offres illimitées, options urgentes gratuites, modification directe des offres actives, recommandations IA d'anciens travailleurs, reporting basique |
| Business | 25 000 FCFA | Tout Pro + remplacement garanti sous 2h, SLA support prioritaire, bulk hiring, reporting avancé, gestionnaire de compte dédié |

**Plans candidat :**

| Plan | Prix / mois | Avantages |
|---|---|---|
| Gratuit | 0 FCFA | Accès aux offres standard, paiement dans les 7 jours |
| Premium | 1 000 FCFA | Priorisation dans les candidatures, badge premium visible par les entreprises, accès aux offres exclusives, paiement accéléré selon règle section 5.3 |

**Critères d'acceptation :**
- Un essai gratuit de 14 jours est disponible pour le plan Pro.
- L'abonnement est géré via Mobile Money avec renouvellement automatique.
- En cas d'échec de paiement, l'entreprise est notifiée et a 3 jours pour régulariser avant suspension des avantages.
- Les avantages premium sont activés immédiatement après paiement confirmé.

---

### 6.12 Dashboard admin

**Description :** Interface de gestion à trois niveaux d'accès distincts.

**Niveau `admin_support` (service client) :**
- Consultation et réponse aux tickets de support.
- Consultation des profils utilisateurs (sans données financières ni logs admin).
- Escalade vers `admin_ops` pour les cas complexes.

**Niveau `admin_ops` (haut cadre) :**
- Tout `admin_support` +
- KPIs temps réel : missions actives, CA du jour/mois, taux de conversion, alertes.
- Gestion des utilisateurs : suspension, modification du niveau Sandbox, vérification manuelle CNI/NIU.
- Modération des offres : approbation, rejet, demande de correction.
- Suivi et intervention sur les missions en cours.
- Gestion des litiges : décision, libération ou remboursement.
- Gestion des abonnements et essais gratuits.
- Paramètres dynamiques : seuils Sandbox, règles de matching, base de connaissances chatbot.

**Niveau `admin_founder` (fondateur) :**
- Tout `admin_ops` +
- Taux de commission (configurable).
- Accès aux logs d'audit complets.
- Configuration des paramètres financiers et de sécurité.
- Gestion des permissions par membre de l'équipe admin.
- Confirmation à deux facteurs pour les modifications de montants de transaction.

**Vue centralisée des comptes (T8.4a) — `/admin/candidates` + `/admin/companies`** :
le menu admin remplace l'ancien « Utilisateurs » par **Candidats** et
**Entreprises**, deux pages de pilotage centralisé (objectif produit : avec
beaucoup d'utilisateurs, se repérer vite d'un seul écran).

- **Sections** (une seule visible à la fois, badges compteurs) :
  - **Candidats** : *En attente* (non `is_verified`, **y compris les rejetés** —
    ils restent en attente avec le motif affiché et peuvent ré-émettre, flux
    T8.3), *Validés* (`users.is_verified = true`), *Suspendus*
    (`users.is_active = false`).
  - **Entreprises** : *En attente* (`company_profiles.verification_status =
    'pending'`, rejetées incluses), *Validées* (`'verified'`),
    *Suspendues* (`is_active = false`).
- **Recherche libre** (nom / e-mail / téléphone) au-dessus des sections.
- **Carte par utilisateur** : photo de profil (URL **signée** de courte durée
  via `GET /api/admin/profiles/[profileId]/photo-url`, jamais de chemin raw),
  nom complet, e-mail, compte MoMo (opérateur + numéro, en clair à l'admin
  seulement), téléphone, statut + badge ⭐ vérifié, badges d'état CNI/MoMo,
  motif de rejet si applicable.
- **Boutons de la carte** : *Voir le profil* → `/admin/candidates/[id]`
  (T8.4b), *CNI* → `/admin/cni?userId=`, *MoMo* → `/admin/momo?userId=`,
  *Documents* → `/admin/skill-documents?userId=` (reprise de contexte par
  paramètre, T8.4c) ; *Suspendre* / *Réactiver* (grades `admin_ops` /
  `admin_founder` uniquement — `admin_support` est en lecture seule ;
  confirmation native avant action).
- **Suspension** (`users.is_active`, levier baseline — **jamais** de colonne
  dédiée) : RPC `admin_set_user_active(p_user_id, boolean)` SECURITY DEFINER.
  Gardes RPC : admin uniquement → grade ops/founder → pas sur soi-même →
  cible candidat/entreprise uniquement (pas les comptes admin) → inconnu →
  404 ; idempotent si même état. Écrit `audit_logs`
  (`suspend_user`/`activate_user`, acteur = admin réel) + **notification**
  `system` (« Compte suspendu » / « Compte réactivé »).
- **Gates de suspension** : candidat `is_active = false` →
  `POST /api/jobs/[id]/apply` et `POST /api/jobs` (candidature / création de
  mission côté entreprise) retournent **403 `code: "account_suspended"`** —
  contrôlé **avant** tout autre gate (vérification, profil complet) ; une
  entreprise suspendue ne peut plus publier d'offre. La réactivation restaure
  l'ancien comportement (les autres gates redevenant applicables).
- **Lecture de liste en `service_role`** : `users` et `company_profiles` n'ont
  aucune policy SELECT admin — les APIs GET utilisent `createAdminClient()`
  (deux requêtes séparées + merge sur `user_id` : PostgREST refuse l'embed
  `users → candidate_profiles`, deux FK ; la recherche est faite côté serveur
  sur le lot). Les mutations passent par le RPC en session admin pour que
  l'audit loggue l'admin réel.
- **Décision produit — comptes rejetés « Conserver et ré-émettre »** : les
  candidats/entreprises **refusés ne sont PAS supprimés** ni de la base ni de
  l'UI : le compte reste en « En attente », le motif de rejet est affiché sur
  la carte et le formulaire, et la ré-émission passe par les flux existants
  (T8.3). **Seuls les fichiers rejetés** (photos CNI, documents de
  compétences) sont **supprimés immédiatement et automatiquement** du bucket
  `candidate-documents` (T8.4c), le candidat pouvant ré-envoyer.

**Profil candidat admin (T8.4b) — `/admin/candidates/[id]`** : page
complète d'un candidat (atteinte via le bouton *Voir le profil* de la
carte T8.4a).
- **Lecture seule** pour les 3 grades (`GET /api/admin/candidates/[id]`,
  lecture `service_role` : identité, contact, statuts CNI/MoMo,
  compétences + statuts, documents + statuts, historique missions,
  statistiques). Jamais de chemin de fichier renvoyé (photo via l'URL
  signée T8.4a).
- **Édition de l'identité** (prénom / nom / date de naissance) réservée à
  **`admin_founder` UNIQUEMENT** (décision produit « juste modifiable par
  l'admin founder » — plus strict que le gate ops/founder) :
  `POST /api/admin/candidates/[id]/identity` → RPC
  `admin_edit_candidate_identity` (SECURITY DEFINER, en session admin pour
  que l'audit loggue le vrai admin). Le RPC re-vérifie le grade et refuse
  soi-même / compte admin / inconnu / prénom-ou-nom vide.
- **Ré-vérification CNI** : sur un candidat dont
  `cni_verified='verified'`, tout changement de prénom/nom/date de
  naissance **remet `cni_verified='pending'`** (+ `cni_rejection_reason`
  NULL) — le nom déclaré sur la CNI/MoMo ne correspond plus. Le RPC appelle
  `recompute_user_verification` : `users.is_verified` retombe à `false` et
  le candidat est de nouveau bloqué au gate de postulation (T8.3) jusqu'à
  re-vérification. Notification `document_status` + audit
  `admin_edit_identity` (avant/après logués). Si le CNI n'était **pas**
  vérifié, l'édition se fait sans reset (simple mise à jour + notification
  « informations mises à jour »).

**Critères d'acceptation (vue centralisée + suspension + profil) :**
- `GET /admin/candidates` / `/admin/companies` → 200 pour les 3 grades
  (`admin_support` lecture seule), 403 pour un candidat ; la liste ne renvoie
  **jamais** de chemin de fichier (photo/logo en booléen, URL signée dédiée).
- Un candidat suspendu est bloqué sur l'application d'offre
  (`403 account_suspended`) ; l'entreprise suspendue sur la publication
  d'offre ; la réactivation restaure le flux.
- La suspension/réactivation écrit `audit_logs` (acteur admin réel) + une
  notification `system` au compte concerné ; la modification de son propre
  compte ou d'un compte admin est refusée par le RPC.
- La recherche et les compteurs de sections se mettent à jour sans rechargement.

---

### 6.13 Chatbot IA support

**Description :** Assistant IA de première ligne pour les utilisateurs.

**Capacités :**
- Répondre aux FAQ (inscription, paiement, mission, litiges).
- Guider l'onboarding étape par étape.
- Expliquer le fonctionnement du Sandbox et des niveaux.
- Aider à publier une offre.
- Expliquer les délais de paiement selon le profil du candidat.
- Détecter les questions hors périmètre et escalader vers `admin_support`.

**Critères d'acceptation :**
- Le chatbot répond en moins de 3 secondes.
- L'escalade vers un humain est proposée si le chatbot ne peut pas résoudre en 2 échanges.
- L'historique de conversation est conservé 30 jours.
- Le chatbot répond en français et en anglais selon la langue de l'utilisateur.

---

### 6.14 Vérification des compétences par documents

**Description :** Un candidat peut justifier une compétence déclarée en joignant un document probant (diplôme, certificat professionnel, attestation de formation, attestation de travail/expérience, permis de conduire, ou autre justificatif professionnel pertinent). Un CV général peut également être stocké sur le profil, mais ne vaut jamais preuve d'une compétence.

**Statuts d'une compétence déclarée :**

| Statut | Signification |
|---|---|
| Déclarée | Compétence ajoutée sans justificatif |
| Justificatif manquant | Un document requis par une offre est absent pour cette compétence |
| Vérification en attente | Document envoyé, en attente de traitement admin |
| Vérifiée | Document validé par un administrateur autorisé |
| Justificatif rejeté | Document refusé (motif obligatoire) |
| Justificatif expiré | Document validé mais dont la date d'expiration est dépassée |

**Ajout d'un document :**
- Types acceptés : CV, diplôme, certificat professionnel, attestation de formation, attestation de travail/expérience, permis de conduire, autre justificatif professionnel.
- Champs demandés : type, titre, organisme émetteur (facultatif pour le CV), date d'obtention, date d'expiration (facultative — non exigée pour les documents qui n'expirent normalement pas, comme un diplôme ; **obligatoire pour le permis de conduire** depuis T3.1), **catégorie du permis** (obligatoire pour `permis_conduire`, T3.1 — §6.14.2), compétence(s) associée(s) (le CV reste un document général, non rattaché à une compétence), fichier.
- Formats acceptés : PDF, JPEG, PNG, WebP — réutilisation du bucket privé `candidate-documents` existant (limite 5 Mio, extension de `allowed_mime_types` pour inclure `application/pdf`).
- Un même document peut être associé à plusieurs compétences réellement couvertes, sans dupliquer le fichier.
- Après envoi, le statut passe à "Vérification en attente". Aucune compétence n'est marquée "Vérifiée" avant validation admin — un CV seul ne suffit jamais à vérifier une compétence.

**Validation administrateur :**
- Rôle autorisé à valider/refuser : `admin_ops` (et `admin_founder` par accès total). `admin_support` dispose d'un accès **lecture seule** aux justificatifs (consultation des métadonnées et du document via URL signée), sans droit de validation ni de refus.
- Validation : le document passe à "verified" ; les compétences associées et couvertes par ce document passent à "Vérifiée" ; le badge "Compétence vérifiée" s'affiche ; le candidat est notifié ; un audit log est enregistré ; les offres exigeant ce justificatif deviennent accessibles si les autres conditions sont remplies.
- Refus : motif obligatoire ; le candidat est notifié avec le motif ; le document ne vérifie aucune compétence ; le candidat peut le remplacer ; un audit log est enregistré.
- Toute transition de statut est effectuée côté serveur. Un candidat ne peut jamais valider son propre document.

**Expiration et remplacement :**
- Réutilisation de la table `document_expirations` (alertes J-30 / J-7 / expiré), dont la contrainte de types est étendue au-delà de `cni`/`driving_license`.
- À expiration, le statut "Vérifiée" de la compétence repasse à "Justificatif expiré" ; seules les offres exigeant ce justificatif précis sont bloquées, jamais l'ensemble des candidatures du candidat.
- Le remplacement d'un document relance une nouvelle vérification admin (statut "Vérification en attente").

**Documents requis par une offre (par compétence) :**
- Une entreprise peut exiger, pour une compétence donnée, un type de justificatif précis (diplôme, certificat, permis de conduire, CNI vérifiée, casier judiciaire, autre document professionnel validé).
- Avant candidature, le serveur vérifie que le document correspondant est présent, validé, non expiré et associé à la compétence exigée. Le masquage du bouton côté frontend seul ne suffit pas : un appel API direct à la candidature doit être bloqué de la même façon.
- L'entreprise ne voit jamais le fichier privé : uniquement un statut ("Compétence vérifiée"), le type de preuve validée, et l'organisme émetteur si cette donnée est autorisée.

**Récompense (strictement fonctionnelle) :**

Après validation d'un justificatif, le candidat obtient uniquement :
1. le badge "Compétence vérifiée" sur la ou les compétences validées ;
2. une notification de confirmation ;
3. l'accès aux offres exigeant ce justificatif (si les autres conditions sont remplies) ;
4. la prise en compte normale de la compétence dans le matching existant (§6.5), sans pondération additionnelle.

Cette validation n'ajoute **aucun point de score**, n'augmente pas la note moyenne, n'augmente pas automatiquement le niveau Sandbox, n'accorde pas Premium, et ne modifie pas les pondérations du matching. Voir §11.11 pour la définition du "badge vérifié" du Sandbox Niveau 3, qui reste **distinct** de cette fonctionnalité.

**Confidentialité :**
- Bucket Storage privé existant réutilisé (`candidate-documents`), policies RLS fondées sur `auth.uid()` pour le candidat propriétaire, plus une policy dédiée de lecture pour les administrateurs autorisés.
- URLs signées de courte durée uniquement, jamais de lien public permanent.
- Aucune donnée sensible (ex : numéro complet de diplôme) exposée aux entreprises.

**Critères d'acceptation :**
- Un candidat peut déclarer une compétence sans justificatif (statut "Déclarée", ou "Justificatif manquant" si une offre l'exige).
- Un CV seul ne vérifie jamais une compétence ni ne débloque une offre exigeant un diplôme.
- Un document peut être associé à plusieurs compétences sans duplication de fichier.
- Un candidat ne peut pas valider son propre document (contrôle serveur systématique).
- Un refus nécessite un motif obligatoire, visible par le candidat.
- Un document expiré retire uniquement le statut vérifié des compétences concernées et bloque uniquement les offres qui l'exigent.
- `admin_support` peut consulter un justificatif mais ne peut ni le valider ni le refuser.

### 6.14.1 Page « Mes compétences » (candidat) — T3

**Description :** page dédiée `GET /profile/skills` (menu *Profil → Mes compétences*) consolidant sur une seule vue : (1) la **section CV + permis de conduire** au-dessus de la liste, (2) la **liste des compétences** du candidat avec leur statut de vérification (§6.14) et les actions de justificatif, (3) l'**ajout de compétences depuis un catalogue** structuré et recherché. Elle **absorbe la page** `GET /profile/skill-documents` (T0), qui devient un **redirect serveur 307** vers `/profile/skills` (les deep links et anciens liens restent fonctionnels).

**Section CV / permis (documents « généraux ») :** le CV et le permis de conduire sont gérés comme des documents généraux du profil (`document_type = cv` / `permis_conduire`, **non rattachés à une compétence** — `skill_ids = []`) :
- deux cartes (CV, permis) affichant le statut du dernier document (`pending` / `rejected` / `verified` / `expired`) et permettant la **suppression** quand le document est `pending` ou `rejected` (RLS T0) ;
- l'upload utilise le même endpoint et la même validation Zod que §6.14 (`POST /api/profile/skill-documents`), en verrouillant le `document_type` ; la contrainte Zod « au moins une compétence » est exemptée **exclusivement** pour `GENERAL_DOC_TYPES` (`cv`, `permis_conduire`) ;
- le permis est saisi **avec date d'expiration et catégorie** depuis T3.1 (document général) ; le contrôle d'expiration exigé par les offres le lit depuis `candidate_documents.expires_at` (§6.14) et le verrou des compétences de conduite depuis `license_category` (§6.14.2) — le flag mort `candidate_profiles.driving_license_verified` n'est alimenté par aucune UI et sera corrigé en **T8** (refonte admin).

**Ajout de compétences (catalogue) :**
- **Catalogue** (`lib/data/skill-catalog.ts`) : 14 groupes thématiques (services, vente, restauration, manutention, transport, artisanat, nettoyage, sécurité, événementiel, bureautique, digital, beauté, soins, langues) couvrant les compétences fréquentes camerounaises (Douala / Yaoundé). Noms des compétences non accentués, **identiques** à l'existant (`COMMON_SKILLS` de l'onboarding) : un candidat existant retrouve ses compétences cochées dans l'UI.
- **Recherche** : filtre sous-chaîne insensible à la casse sur les noms du catalogue ; sans saisie, la vue affiche les 14 groupes.
- **Ajout** : insertion unitaire dans `candidate_skills` (une ligne, `skill_level = 3`) — plus de delete-all/insert-all côté candidat (bug de remise à zéro du statut de vérification, §6.2). Un modal « Certifier maintenant / Plus tard » propose immédiatement de joindre un justificatif.
- **Suppression** : modal de confirmation puis `.delete()` sur la ligne `candidate_skills` (les liens documents sont en cascade, T0) ; `router.refresh()` pour resynchroniser.
- Les compétences saisies hors catalogue (historiques) restent affichées dans un bloc « Vos autres compétences ».

**Navigation mise à jour :** menu profil *Mes compétences* → `/profile/skills` ; l'entrée *Documents et compétences vérifiées* (`/profile/skill-documents`) est retirée du menu (doublon) ; le CTA de complétion « critère compétences manquant » pointe vers `/profile/skills` ; la page `candidate` (carte compétences) et le lien « Modifier » pointent vers `/profile/skills`.

**Autorisations :** accès candidat / `candidate_premium` uniquement (redirect sinon) ; sans `candidate_profiles` → `/onboarding/candidate`. RLS et écritures inchangées par rapport à T0 (RLS candidat propriétaire sur `candidate_skills` / `candidate_documents` ; recompute RPC + trigger de protection du statut).

**Critères d'acceptation :**
- `/profile/skill-documents` redirige (307) vers `/profile/skills`.
- L'ajout d'une compétence ne remet **jamais** à zéro `verification_status` d'une autre compétence (pas de delete-all du côté candidat).
- Le CV et le permis peuvent être uploadés **sans sélectionner de compétence** ; tout autre type exige au moins une compétence (client **et** serveur).
- Un candidat retrouve ses compétences de l'onboarding cochées dans le catalogue.
- Les compétences vérifiées conservent leur badge émeraude après un save de profil (bug T1 corrigé).

### 6.14.2 Catégories de permis + verrou des compétences de conduite — T3.1

**Description :** le permis de conduire est désormais saisi **avec une catégorie** (`candidate_documents.license_category`), et un candidat ne peut déclarer une **compétence de conduite** que s'il détient un permis **vérifié** couvrant la catégorie requise. La règle s'applique dans **tous** les points d'entrée des compétences : la page `/profile/skills` **et** l'onboarding (step 3).

**Catégories** (CHECK DB `candidate_documents_license_category_chk` + Zod `licenseCategorySchema`) : `moto`, `voiture`, `fourgon`, `camion`, `bus`, `tous_types` (wildcard côté document — couvre **toute** exigence).

**Mapping compétences → catégorie requise** (fonction SQL `public.skill_requires_license` **et** miroir TS `lib/utils/license-requirements.ts` — les deux doivent rester synchrones, verrouillé par vitest + preuve E2E) :

| Compétence(s) | Catégorie requise |
|---|---|
| Conduite moto · Taxi moto · Livraison moto | `moto` |
| Conduite voiture · Livraison voiture | `voiture` |
| Conduite fourgon | `fourgon` (satisfaite par `fourgon` **ou** `camion`) |
| Conduite camion | `camion` |
| Conduite bus | `bus` (compétence ajoutée au catalogue en T3.1) |
| Toute autre compétence | aucune exigence |

**Modèle de satisfaction (sets) :** un permis vérifié satisfait l'exigence si sa catégorie appartient au set requis (`fourgon ← {fourgon, camion}`) **ou** si sa catégorie est `tous_types` (wildcard). Implémenté de façon identique côté SQL (`public.has_verified_license_for`, sets en `VALUES`) et côté TS (`SATISFIES_SETS`).

**Trigger Postgres :** `BEFORE INSERT` sur `candidate_skills` (`trg_enforce_license_for_driving_skill`) — si la compétence requiert un permis que le candidat ne possède pas vérifié, l'insertion est **refusée** avec un message préfixé `EASYJOB_LICENSE_REQUIRED:` (préfixe stable détecté côté client, pas de SQLSTATE). Exonération système via `set_config('easyjob.system_update','on',true)` (même mécanisme que la recompute T0) — service role uniquement.

**UI :**
- **`/profile/skills`** : le modal « Ajouter mon permis » exige la **catégorie** (select obligatoire) **et** la date d'expiration ; la carte permis affiche un **badge de catégorie** (« Catégorie : Moto ») ; les chips de compétences de conduite sans permis couvrant vérifié sont **désactivées** (verrou visuel + tooltip) et l'insertion est bloquée côté client également (double défense avec le trigger) ; un échec d'insertion préfixé `EASYJOB_LICENSE_REQUIRED:` affiche le message dédié.
- **Onboarding (step 3)** : les chips de conduite (`Conduite moto`, `Conduite voiture` dans `COMMON_SKILLS`) sont **désactivées** tant que le candidat n'a pas de permis vérifié couvrant la catégorie (liste calculée côté serveur à l'ouverture de la page depuis `candidate_documents`) + hint « Les compétences de conduite nécessitent un permis de conduire vérifié. Ajoutez-les dans votre profil après vérification. ». La règle « minimum 2 compétences » ne compte que les compétences réellement sélectionnables.

**Conséquence assumée :** le permis étant validé *a posteriori* par un administrateur, le candidat qui termine son onboarding sans permis vérifié **ajoute ses compétences de conduite ensuite, dans `/profile/skills`**, après la vérification du permis.

**Critères d'acceptation :**
- INSERT `candidate_skills` sans permis vérifié → **refusé** (session candidat réelle) avec un message préfixé `EASYJOB_LICENSE_REQUIRED` ; aucune ligne créée.
- Permis `moto` vérifié → « Conduite moto » OK ; « Conduite voiture » **refusée** (catégories distinctes).
- Permis `tous_types` vérifié → « Conduite camion » **OK** (wildcard).
- Permis `camion` vérifié → « Conduite fourgon » **OK** (set de satisfaction).
- Compétence non-conduite (ex. « Cuisine ») : toujours insérable, quel que soit le permis.
- Onboarding (HTML rendu) : les chips de conduite sont `disabled` sans permis vérifié couvrant.
- Bypass système : avec `easyjob.system_update = on` (service role), l'INSERT passe malgré l'absence de permis.

### 6.14.3 Page « Mes documents » (candidat) — T4

**Description :** page dédiée `GET /profile/documents` (menu *Profil → Mes documents*) qui liste **uniquement et exhaustivement** tous les justificatifs `candidate_documents` du candidat (CV, permis, diplôme, certificat, attestations de formation/travail, casier judiciaire, autre). Elle est une vue **lecture seule** de consultation : chaque document expose son **statut effectif** et permet de **Voir** (aperçu) et **Télécharger** le fichier. L'ajout de justificatif reste la responsabilité de la page « Mes compétences » (§6.14.1) et le **remplacement** est géré côté **administrateur** (§6.14.4, T8) — la page n'expose donc ni bouton d'ajout inline ni de suppression côté candidat.

**Périmètre (lecture seule, décidé avec le produit) :**
- **Liste** : tous les `candidate_documents` du candidat, triés par date de création décroissante. Chaque ligne affiche : type (`document_type`), titre, organisme émetteur, catégorie du permis (si `permis_conduire`, T3.1), dates d'obtention et d'expiration, **compétences associées** (via `candidate_skill_documents`), et le **motif de refus** si `rejected`.
- **Statut effectif « au vol »** : la base n'a pas de job qui passe `status` de `verified` à `expired` (point ouvert : pas de cron). Comme §6.5 / `lib/matching/skill-document-requirements.ts`, le statut affiché est **dérivé en lecture** : un document `verified` dont `expires_at` est dépassé s'affiche **Expiré** (`lib/utils/document-status.ts` : `effectiveDocStatus`). Un `rejected`/`pending`/`expired` brut s'affiche tel quel. C'est la **même source de vérité** que le matching des offres.
- **Voir** : ouvre un modal de consultation du fichier via **URL signée de courte durée** (`GET /api/profile/skill-documents/[id]/url`, TTL 60 s, bucket privé `candidate-documents`) — jamais de lien public permanent (confidentialité §6.14). PDF affiché en `<iframe>`, images en `<img>`.
- **Télécharger** : même URL signée, déclenche le téléchargement du fichier avec un nom lisible dérivé du titre.
- **Aucune écriture côté candidat** sur cette page : pas de suppression (la RLS `candidate_documents_delete_own_pending_or_rejected` reste la garante du retrait par le candidat, utilisée par la page compétences), pas de remplacement. L'ajout d'`expires_at`/métadonnées passe par le flow d'upload existant.

**Navigation :** menu profil *Mes documents* → `/profile/documents` (remplace l'ancien pointeur vers *Modifier mes informations → focus photo*, qui reste accessible via celle-ci). Accès candidat / `candidate_premium` uniquement ; sans `candidate_profiles` → `/onboarding/candidate`.

**Autorisations / confidentialité :** lecture `candidate_documents_select_own_or_admin` ; URL signée (TTL 60 s) ; le candidat ne voit **que ses** documents ; l'entreprise ne voit jamais de fichier (uniquement un statut, §6.14).

**Remplacement — décision produit (implémenté côté admin en T8) :** lorsqu'un document doit être **remplacé ou mis à jour**, c'est l'administrateur qui le **signale au candidat via une notification et la page « Mes tâches »** (pas un bouton de remplacement côté candidat). La **règle de rétention** : **l'ancien document (ligne `candidate_documents` + fichier Storage) n'est supprimé que si le nouveau document est `verified` par l'admin** ; tant que le nouveau est `pending`/`rejected`, l'ancien reste en place. Cette règle est portée par l'UI/canale admin (T8) et n'implique **aucun** changement de RLS candidat ni d'écriture côté candidat.

**Critères d'acceptation :**
- `GET /profile/documents` → 200, liste tous les `candidate_documents` du candidat (CV, permis, diplôme, attestations…), triés par création décroissante.
- Un document `verified` en cours de validité s'affiche **Vérifié** ; un `verified` dont la date d'expiration est dépassée s'affiche **Expiré** (détection au vol, sans écriture DB).
- « Voir » charge l'aperçu via une URL **signée** (TTL ≈ 60 s) ; PDF en `iframe`, images en `img` ; « Télécharger » télécharge le fichier via la même URL signée.
- La page n'expose **aucun** bouton d'ajout inline ni de suppression côté candidat (l'ajout est en `/profile/skills` ; le remplacement via notif/admin est en T8).
- Motif de refus affiché pour un document `rejected` ; compétences associées listées via `candidate_skill_documents`.
- Candidat sans document → état vide dédié.
- Non connecté → redirect login ; rôle non-candidat → redirect `/profile`.

---

## 7. Flux utilisateurs principaux

### 7.1 Flux complet candidat

```
Inscription (email/SMS ou Google/Facebook + validation téléphone obligatoire)
    ↓
Onboarding IA (profil, GPS domicile, CNI + selfie, MoMo au nom du candidat)
    ↓
Consultation des offres (filtrées par niveau Sandbox, distance, disponibilité)
    ↓
Candidature en un clic (pour une offre ou une journée spécifique)
    ↓
Notification de sélection
    ↓
Signature du contrat (simple < 3j / formalisé >= 3j)
    ↓
Suivi de mission (En route → Arrivé 30 min avant → En cours)
    ↓
Soumission du code de validation
    ↓
Évaluation de l'entreprise
    ↓
Réception du paiement selon profil :
  - Premium + note >= 4 : 100% en 48h
  - Premium OU note >= 4 : 50% en 48h + 50% en 7j
  - Aucun des deux : 100% en 7j
    ↓
Montée de niveau Sandbox (si applicable)
```

### 7.2 Flux complet entreprise

```
Inscription + NIU (validation admin 24h)
    ↓
Onboarding entreprise
    ↓
Publication offre (assistée par IA)
    ↓
Paiement du montant bloqué (Mobile Money)
    ↓
Soumission à l'admin pour modération
    ↓
Validation admin -> Publication + décomposition multi-jours si applicable
    ↓
Réception et tri des candidatures (matching IA + priorité anciens travailleurs)
    ↓
Sélection du/des candidat(s)
    ↓
Génération et signature du contrat
    ↓
Suivi de la mission
    ↓
Génération du code de validation
    ↓
Validation de fin de mission
    ↓
Évaluation du candidat
    ↓
Libération automatique du paiement (selon profil candidat)
    ↓
Remboursement automatique du surplus si moins de personnes que prévu
```

### 7.3 Flux litige

```
Fin de mission non validée / problème signalé
    ↓
Ouverture d'un ticket litige (par l'une ou l'autre partie)
    ↓
Notification aux deux parties (48h pour soumettre preuves)
    ↓
Examen par admin_ops
    ↓
Décision (paiement total / partiel / remboursement)
    ↓
Notification de la décision
    ↓
Libération ou remboursement du montant bloqué
```

---

## 8. Modèle de données

### 8.1 Tables principales

**`users`**
```
id, email, phone, phone_verified, role, locale,
created_at, updated_at, is_active, is_verified,
ban_reason, ban_expires_at, no_show_count
```

**`candidate_profiles`**
```
id, user_id, first_name, last_name, date_of_birth, city,
photo_url, bio, skills[], sectors[], availability{},
driving_license_verified, driving_license_expires_at,
cni_verified, cni_expires_at, cni_selfie_url,
momo_verified, momo_number, momo_provider, momo_name_match,
momo_account_name, momo_reject_reason,
momo_verified_by, momo_verified_at,   ← T6 : cycle de vie de la vérification MoMo — `momo_provider` ∈ (mtn, orange) ; `momo_account_name` = nom déclaré sur le compte (optionnel, ≤ 100) ; **validation admin MANUELLE** (pas de preuve de possession OTP au lancement — décision produit 2026-09-10) : l'admin `admin_ops`/`admin_founder` approuve ou refuse (motif requis ≥ 3 car) en confrontant le nom déclaré au nom CNI (comptes familiaux / au nom d'un tiers refusés), revue ≤ 24 h ; `momo_reject_reason` = motif de refus ; `momo_verified_by` / `momo_verified_at` écrits exclusivement par l'admin (RPC `apply_momo_verification`). Les 5 colonnes de vérification (`momo_verified`, `momo_name_match`, `momo_verified_by`, `momo_verified_at`, `momo_reject_reason`) sont **protégées par un trigger** (`easyjob.system_update`) : un candidat ne peut se marquer `momo_verified=true` — seules les fonctions SECURITY DEFINER (`candidate_update_momo`, `apply_momo_verification`) les écrivent.
quartier, address, latitude, longitude, max_travel_distance_km,   ← T5 : alignement codebase (la base utilise latitude/longitude, pas home_gps_ ; `quartier` est saisi librement ou **auto-rempli par le GPS** depuis T5.1, `address` n'est pas collectée par l'UI candidat) ; T5.1 : les paires lat/lng sont **validées à l'intérieur de la zone de service** (≤ 20 km du centre de Douala ou de Yaoundé) — `latitude: null` / `longitude: null` = fallback « même ville ».
sandbox_level, average_rating, total_missions,
profile_completion_pct, premium_until,
created_at, updated_at
```

**`profile_update_requests`** (T2 — verrou des infos vérifiées, §5.1.1)
```
id, candidate_id, fields[] (identity | cni_documents),
status (pending / done / cancelled),
reason, requested_by (uuid -> users),
created_at, updated_at, completed_at
```

**`company_profiles`**
```
id, user_id, name, niu, niu_verified, sector, cities[],
logo_url, description, contact_name, contact_phone,
trust_score, average_rating, total_missions_posted,
subscription_plan, subscription_expires_at,
created_at, updated_at
```

**`jobs`**
```
id, company_id, parent_job_id,
title, description, category, required_skills[],
required_documents[], sandbox_level_required,
job_type (temp/permanent), date, duration_hours,
break_duration_minutes, effective_hours,
location_address, location_lat, location_lng,
location_reference, location_photo_url, location_map_url,
required_candidates_count, salary_per_person_per_day,
required_equipment[], provided_equipment[], benefits[],
status (draft/pending_review/active/filled/expired/cancelled/rejected),
is_urgent, rejection_reason,
views_count, applications_count,
created_at, updated_at
```

**`applications`**
```
id, job_id, candidate_id,
status (pending/accepted/rejected),
ai_score, has_worked_here_before, previous_rating,
created_at, updated_at
```

**`missions`**
```
id, job_id, application_id, candidate_id, company_id,
status (confirmed/en_route/arrived/in_progress/
        completed/validated/cancelled/disputed/no_show),
contract_url, contract_type (simple/formal),
validation_code, validation_code_expires_at,
started_at, ended_at, validated_at,
salary_amount, platform_fee,
payment_status (pending/partial/full/failed),
payment_first_tranche_at, payment_second_tranche_at,
created_at, updated_at
```

**`reviews`**
```
id, mission_id, reviewer_id, reviewee_id,
reviewer_type (candidate/company),
overall_rating, criteria_ratings{}, comment,
is_moderated, created_at
```

**`transactions`**
```
id, company_id, candidate_id, mission_id, job_id,
type (block/release/refund/surplus_refund/fee/subscription),
amount, currency, status (pending/completed/failed),
momo_reference, momo_account_name,
created_at
```

**`subscriptions`**
```
id, user_id, plan, price, started_at, expires_at,
is_trial, auto_renew, status (active/cancelled/expired)
```

**`disputes`**
```
id, mission_id, opened_by, type, description, evidence_urls[],
status (open/under_review/resolved/escalated),
resolution, resolved_by, created_at, resolved_at
```

**`notifications`**
```
id, user_id, type, title, body, data{},
channel (push/sms/email), is_read, sent_at, created_at
```

**`candidate_skills`** *(étendue)*
```
id, candidate_id, skill_name, skill_level, is_ai_suggested,
verification_status (unverified/pending/verified/rejected/expired),
created_at
```

**`candidate_documents`** *(nouveau)*
```
id, candidate_id, document_type
  (cv/diplome/certificat/attestation_formation/attestation_travail/
   permis_conduire/casier_judiciaire/autre),
title, issuing_organization, reference_number,
issued_at, expires_at, storage_path,
status (pending/verified/rejected/expired),
rejection_reason, verified_by, verified_at,
license_category (moto/voiture/fourgon/camion/bus/tous_types ; T3.1 —
  nulle sauf pour document_type = permis_conduire),
created_at, updated_at
```

**`candidate_skill_documents`** *(nouveau — table de liaison compétence ↔ document)*
```
id, candidate_skill_id, candidate_document_id, created_at
```

**`job_required_skill_documents`** *(nouveau — exigence de document par compétence sur une offre)*
```
id, job_id, skill_name, document_type, created_at
```

**`document_expirations`**
```
id, candidate_id, candidate_document_id (nullable),
document_type (cni/driving_license/skill_document/other),
expires_at, notified_30d, notified_7d, notified_expired,
updated_at
```

**`audit_logs`**
```
id, actor_id, actor_role, action, resource_type, resource_id,
metadata{}, ip_address, created_at
```

---

## 9. Exigences non fonctionnelles

### 9.1 Performance

- Temps de chargement initial < 3 secondes sur 3G.
- API response time < 500ms pour 95% des requêtes.
- Disponibilité cible : 99.5% (hors maintenance planifiée).

### 9.2 Scalabilité

- L'architecture doit supporter 10 000 utilisateurs actifs sans refactoring majeur.
- Les jobs Supabase doivent être configurés pour : expiration d'offres, rappels évaluation, alertes documents expirés, remboursements automatiques, sanctions absences.

### 9.3 Accessibilité

- Contraste minimum WCAG AA sur les éléments clés.
- Textes lisibles sans zoom sur mobile (minimum 16px).
- Messages d'erreur explicites et actionnables.

### 9.4 Internationalisation

- Français par défaut.
- Anglais complet requis pour le MVP.
- Les dates, montants et formats de téléphone sont localisés.

### 9.5 Offline / connectivité dégradée

- Les pages consultées restent accessibles en lecture partielle si la connexion est coupée.
- Les formulaires affichent un message clair en cas de perte de connexion avant soumission.

---

## 10. Sécurité et conformité

### 10.1 Authentification et autorisation

- Supabase Auth avec JWT.
- Row Level Security (RLS) sur toutes les tables sensibles.
- Les rôles sont vérifiés côté serveur sur chaque requête.
- Les tokens expirent après 1 heure (refresh token : 7 jours).
- Validation OTP téléphone obligatoire, quelle que soit la méthode de connexion.

### 10.2 Données sensibles

- Les numéros de CNI et données biométriques ne sont jamais stockés en clair.
- Les numéros Mobile Money sont masqués dans l'interface (ex : +237 *** *** 45).
- Les données personnelles des candidats (téléphone, email, CNI) ne sont jamais exposées aux entreprises.
- Les justificatifs de compétences (diplôme, certificat, attestation, permis, CV) sont stockés dans le bucket privé `candidate-documents` : accès restreint au candidat propriétaire et aux administrateurs autorisés (`admin_ops`, `admin_founder`, `admin_support` en lecture seule), jamais d'URL publique permanente.
- Les secrets sont uniquement dans les variables d'environnement.
- Aucune donnée sensible dans les logs.

### 10.3 Protection des paiements

- Toute logique de blocage et libération de fonds est gérée côté serveur uniquement.
- Chaque transaction est signée et horodatée.
- Les tentatives de double débit sont détectées et bloquées (idempotency keys).
- Les remboursements de surplus sont déclenchés automatiquement par un job serveur.

### 10.4 Audit

- Toutes les actions admin sont loguées dans `audit_logs` avec rôle, IP et horodatage.
- Les modifications de montants de transaction nécessitent une confirmation à deux facteurs pour `admin_founder`.
- Les logs financiers ne sont accessibles qu'à `admin_founder`.

---

## 11. Points ambigus et décisions ouvertes

---

### 11.1 — Valeur légale des contrats générés

**Décision : Option C appliquée.**
- Contrat simple (consentement + horodatage + IP) pour les missions < 3 jours.
- Contrat formalisé validé par un cabinet juridique camerounais pour les missions >= 3 jours.
- Budget à prévoir : 200 000 à 500 000 FCFA pour la validation juridique.

**Statut :** ✅ Décision prise — consultation juridique à planifier avant lancement.

---

### 11.2 — Seuils exacts du Sandbox

**Décision : Option C appliquée (configurable admin + valeurs initiales basses).**
- Seuils configurables depuis `admin_founder` sans redéploiement.
- Valeurs initiales : Niveau 1 après 1 mission, Niveau 2 après 3 missions, Niveau 3 après 10 missions.
- Révision prévue après 2 mois de données réelles.

**Statut :** ✅ Décision prise.

---

### 11.3 — Agrégateur de paiement Mobile Money

**Question :** Quel agrégateur pour connecter MTN MoMo et Orange Money ?

**Options à évaluer :**
- A) CinetPay — frais ~2-3%.
- B) Campay — spécialisé Cameroun.
- C) NotchPay — API moderne.
- D) Intégration directe MTN MoMo API.

**Questions critiques à répondre avant décision :**
- Délai d'activation du compte marchand ?
- Limites de transaction journalières ?
- Frais sur les payouts vers les candidats ?
- Support des remboursements automatiques vers l'expéditeur original ?

**Recommandation :** Campay ou NotchPay pour la rapidité MVP.

**Statut :** ☐ Décision à prendre — **priorité critique, bloque tout le flux de paiement.**

---

### 11.4 — Connexion sociale (Google / Facebook)

**Décision appliquée.**
- Email + OTP SMS en méthode principale.
- Google et Facebook disponibles comme méthode secondaire dès le MVP.
- Le numéro de téléphone camerounais reste obligatoire et doit être validé par OTP dans tous les cas.

**Statut :** ✅ Décision prise.

---

### 11.5 — Processus de vérification CNI / MoMo

**Décision : Option D appliquée.**
- Upload CNI (recto/verso) + selfie tenant la CNI.
- Validation admin dans les 24h.
- Le nom du compte MoMo doit correspondre au nom complet de la CNI. Comptes familiaux refusés.
- Option KYC automatisé (Smile Identity) envisagée pour V1.1.

**Implémentation T6 (MoMo) — validation admin MANUELLE (Option D) :**
1. **Déclaration (candidat)** : le candidat déclare opérateur (`MTN MoMo` /
   `Orange Money`) + numéro (format téléphone camerounais, 9 chiffres préfixe 6)
   + nom du compte (optionnel, ≤ 100 chars) via `PUT /api/profile/payment` → RPC
   `candidate_update_momo` (SECURITY DEFINER). Tout changement de numéro/opérateur
   **réinitialise le cycle** (vérification remise à zéro : l'admin re-voit).
   **Pas de preuve de possession par OTP SMS au lancement** — l'étape est jugée
   superflue et coûteuse (1 SMS par numéro) pour le MVP ; le numéro est la
   responsabilité du candidat, l'admin arbitre.
2. **Validation admin** (`POST /api/admin/momo`, rôles `admin_ops`/`admin_founder`,
   `admin_support` en lecture seule via `GET` + filtre `?verified=true|false`) :
   l'admin approuve ou refuse en **confrontant le nom du compte déclaré au nom
   de la CNI** — les comptes familiaux / au nom d'un tiers sont **refusés** avec
   un motif obligatoire (3..300 car, `momo_reject_reason`). L'opération est
   transactionnelle (RPC `apply_momo_verification`, SECURITY DEFINER) : écriture
   protégée de `momo_verified`/`momo_name_match`/`momo_verified_by`/`momo_verified_at`
   (+ motif au rejet), **notification** `momo_status` au candidat (« Mobile Money
   vérifié » / « … refusé » + motif) et **audit log** (`approve_momo`/`reject_momo`,
   acteur = l'admin réel, jamais `service_role`). La revue est **manuelle ≤ 24 h**.
   La page candidat `/profile/payment` montre le statut : non configuré →
   formulaire ; « En attente de vérification » (déclaré, pas encore vu) ; refus
   avec motif affiché (+ bouton Modifier) ; « Vérifié » seulement après
   l'approbation admin (le numéro y est **masqué**, affiché en clair dans
   l'interface admin).

   **Implémentation T8.2 (UI admin de revue)** : la page `/admin/momo` liste les
   déclarations MoMo par statut (en attente / vérifié / refusé) avec filtres ;
   le numéro est affiché **en clair** à l'admin (jamais au candidat). Le
   panneau de revue (modal) confronte le **nom du compte déclaré** au **nom de
   la CNI** (`cni_front_url`/`cni_back_url`/`cni_selfie_url`, bucket privé
   `candidate-documents`) via des **URLs signées** de courte durée
   (`GET /api/admin/momo/[profileId]/cni-url?field=…`). Rôles : `admin_support`
   en **lecture seule** (consulter la liste + le CNI, pas de mutation) ;
   `admin_ops`/`admin_founder` peuvent approuver/refuser (motif de refus
   obligatoire ≥ 3 car). Toute action passe par `POST /api/admin/momo`
   (opérationnel depuis T6, infra déjà prouvée).

   **Implémentation T8.3 (revue CNI + `users.is_verified`)** : la page
   `/admin/cni` liste les candidats ayant soumis une CNI par statut
   (en attente / vérifiée / refusée) avec les 3 photos (recto/verso/selfie)
   affichées via les **URLs signées** T8.2. Toute action passe par
   `POST /api/admin/cni` → RPC `moderate_cni` (SECURITY DEFINER) :
   approbation → `cni_verified='verified'` + `cni_expires_at` (défaut =
   date de naissance **+ 10 ans**, CNI camerounaise, overridable par l'admin)
   + ligne `document_expirations` (type `'cni'`) ; rejet → motif obligatoire
   ≥ 3 car. Notification `document_status` (« CNI vérifiée » / « CNI refusée »
   + motif) + audit (`approve_cni`/`reject_cni`, acteur = admin réel).
   **Suppression des photos** : à l'approbation, les 3 objets sont retirés
   du bucket privé `candidate-documents` (service role) et les URLs du
   profil NULLifiées — la certification `cni_verified='verified'` est la
   source de vérité, les photos ne sont conservées que le temps de la
   revue (SRS §8.4).
   **Protection trigger** : un trigger `BEFORE UPDATE` sur
   `candidate_profiles` (pattern `easyjob.system_update` du T6) restaure
   `cni_verified`/`cni_rejection_reason`/`cni_expires_at` si le GUC
   transactionnel n'est pas posé — **un candidat ne peut plus s'auto-marquer
   `cni_verified='verified'`** via la RLS « update own profile » (avant T8.3,
   la colonne était librement écritable).
   **Flag `users.is_verified`** — nouveau flag de synthèse, **source de
   vérité du gate de postulation** (§6.6). Posé UNIQUEMENT par le RPC
   `recompute_user_verification` (SECURITY DEFINER, appelé par
   `moderate_cni` et `apply_momo_verification`) : `is_verified = true` si et
   seulement si `cni_verified='verified'` **ET** `momo_verified=true` **ET**
   infos personnelles complètes (prénom, nom, date de naissance) **ET**
   téléphone présent.
   La recompute porte sur l'**état de certification** (pas la présence des
   photos, qui sont supprimées après approbation). Notification
   `document_status` « Profil vérifié » à la bascule `false → true`.
   **Protection trigger** `users` : `is_verified` n'est écrit QUE par le
   recompute (un candidat ne peut ni forcer ni verrouiller le flag).

   **Rattachement à la vue centralisée (T8.4a → T8.4c, SRS §6.12)** : les
   revues CNI / MoMo / documents de compétences sont accessibles depuis la
   carte de chaque utilisateur de `/admin/candidates` (boutons *CNI*, *MoMo*,
   *Documents* passants `?userId=`). Décision produit de la refonte T8.4 :
   ces pages de revue ne conservent que la section **En attente** — l'état
   de chaque document (vérifié / refusé + motif / expiré) s'affiche désormais
   sur la section de l'utilisateur dans la vue centralisée. Les **fichiers
   rejetés** sont supprimés **immédiatement et automatiquement** du bucket
   `candidate-documents` (service role) : le compte reste « En attente »
   (pas de suppression de compte) et le candidat ré-émet via le formulaire
   existant (T8.4c).

**Automatisation future (T6.1 — à l'étude, non implémentée)** : un agrégateur
« get account name » (API B2B opérateur : *MTN MoMo for Business*, *Orange
Money API Developer* ; ou agrégateur local : *eTrazact*, *Flutterwave*,
*Hubtel*…) retourne le nom opérateur du numéro pour une auto-confrontation au
nom déclaré / CNI (auto-approve sur match exact normalisé). Référence produit
comparable : **Taptap Send** (envoi d'argent Europe → Afrique) qui affiche le
nom du destinataire avant validation. Coût ≈ 10–200 F CFA par lookup. À
reprendre comme spike (RFP opérateur + sandbox) une fois le MVP en prod.

**Statut :** ✅ Décision prise — **implémenté (T6)** : déclaration + validation
admin MANUELLE + notification/audit. Preuve OTP **retirée** au lancement
(décision produit 2026-09-10) ; T6.1 à l'étude.

---

### 11.6 — Vérification automatique du NIU

**Décision : Option A + B appliquée.**
- Vérification du format par regex à la saisie.
- Validation manuelle par `admin_ops` dans les 24h.
- Surveillance de l'évolution des APIs gouvernementales.

**Statut :** ✅ Décision prise.

---

### 11.7 — Modèle IA de matching

**Décision : Option A appliquée.**
- Algorithme de scoring simple basé sur règles et pondération, configurable admin.
- Embeddings sémantiques envisagés pour V1.1.

**Statut :** ✅ Décision prise.

---

### 11.8 — Valeur légale de la signature électronique

**Décision : Recommandation appliquée.**
- Consentement explicite avec horodatage et adresse IP pour le MVP.
- Consultation juridique (droit du travail camerounais) à planifier avant lancement commercial.
- Base légale provisoire : loi camerounaise n°2010/021 sur le commerce électronique.

**Statut :** ✅ Décision prise — consultation juridique à planifier.

---

### 11.9 — Gestion des absences répétées (nouveau)

**Question :** Comment valider techniquement les justificatifs d'absence ?

**Règle métier définie :**
- 1ère absence : blocage du compte 7 jours.
- 2ème absence : blocage 7 jours + avertissement formel.
- 3ème absence ou plus : bannissement définitif.
- Un justificatif valable (hospitalisation, décès, force majeure) soumis dans un délai défini peut annuler le comptage si validé par `admin_ops`.

**Questions ouvertes :**
- Quel format de justificatif accepté (photo, document PDF, déclaration texte) ?
- Quel délai pour soumettre le justificatif après l'absence ?
- Qui valide : `admin_support` ou `admin_ops` ?

**Statut :** ☐ Décision à prendre.

---

### 11.10 — Délai de modération des offres (nouveau)

**Question :** Quel délai maximum pour la modération admin ? Que se passe-t-il si l'admin ne répond pas dans ce délai ?

**Options :**
- A) Délai de 4h en heures ouvrées. Au-delà, approbation automatique (risque de publications non contrôlées).
- B) Délai de 4h en heures ouvrées. Au-delà, alerte escaladée vers `admin_founder`.
- C) Délai de 2h pour les offres urgentes, 12h pour les offres standard. Au-delà, alerte escaladée.

**Recommandation :** Option C avec escalade automatique si dépassement.

**Statut :** ☐ Décision à prendre.

---

### 11.11 — Définition du "badge vérifié" du Sandbox Niveau 3

**Question :** Le §5.2 exige un "badge vérifié" pour débloquer le Niveau 3, sans préciser sa nature exacte (identité vérifiée, compétence vérifiée, ou profil professionnel globalement vérifié).

**Décision : Option A appliquée pour le MVP.**
- Le "badge vérifié" du Sandbox Niveau 3 désigne exclusivement l'**identité vérifiée** (`cni_verified = verified`), inchangé par rapport au comportement actuel. Aucune modification du calcul Sandbox n'est appliquée par la fonctionnalité de vérification des compétences (§6.14).
- La vérification de compétences par documents introduit un badge **distinct** "Compétence vérifiée", qui **n'entre pas** dans le calcul du Sandbox Niveau 3 pour le MVP.
- Toute évolution (ex : exiger en plus au moins une compétence vérifiée pour le Niveau 3) devra être explicitement validée par `admin_founder` et documentée ici avant toute implémentation.

**Statut :** ✅ Décision prise (périmètre MVP).

---

## 12. Hors périmètre MVP

Les éléments suivants ne seront pas développés dans le MVP :

- Application native iOS / Android (React Native ou Flutter).
- Gestion multi-pays (Côte d'Ivoire, Sénégal, etc.).
- Assurance mission automatisée avec intégration assureur.
- Marketplace de formations et certifications.
- Payroll complet (fiche de paie, cotisations sociales).
- Système de parrainage avec récompenses.
- Vérification de casier judiciaire automatisée.
- Messagerie interne en temps réel (WebSocket).
- Géolocalisation en temps réel pendant la mission (seul le GPS domicile est enregistré à l'onboarding).
- Facturation automatique pour les entreprises.
- Intégration avec des logiciels RH tiers (Sage, etc.).
- KYC automatisé via partenaire type Smile Identity — prévu V1.1.
- Embeddings sémantiques pour le matching — prévu V1.1.

---

## 13. Critères d'acceptation globaux

Le MVP est considéré comme terminé et prêt pour le lancement si :

- [ ] Un candidat peut s'inscrire, compléter son profil et postuler en moins de 10 minutes.
- [ ] Une entreprise peut publier une offre, effectuer le paiement bloqué et attendre la modération admin.
- [ ] L'admin peut modérer une offre (approuver / rejeter / demander correction) depuis le dashboard.
- [ ] Le paiement bloqué fonctionne de bout en bout (blocage -> libération selon délai profil -> remboursement surplus automatique).
- [ ] Le code de validation de mission fonctionne correctement.
- [ ] Les évaluations sont enregistrées et visibles sur les profils, et impactent le délai de paiement.
- [ ] Le système de niveaux Sandbox est configurable depuis `admin_founder` sans redéploiement.
- [ ] Les sanctions (blocage, bannissement) sont déclenchées automatiquement selon les règles.
- [ ] Les documents expirés sont détectés et notifiés automatiquement aux candidats.
- [ ] L'admin peut gérer les utilisateurs, offres et litiges avec les 3 niveaux d'accès distincts.
- [ ] L'application est fonctionnelle en français et en anglais.
- [ ] Les temps de chargement sont conformes aux exigences de performance.
- [ ] Aucune donnée personnelle sensible du candidat n'est exposée côté entreprise.
- [ ] Les RLS Supabase sont actives sur toutes les tables sensibles.
- [ ] Le chatbot IA répond aux questions fréquentes et escalade correctement vers `admin_support`.
- [ ] Les notifications (push + SMS) sont délivrées dans les 60 secondes.

---

*Document vivant — à mettre à jour à chaque décision prise sur les points ambigus.*
*Version suivante : SRS v1.2 après décisions sur les points 11.3, 11.9 et 11.10.*
