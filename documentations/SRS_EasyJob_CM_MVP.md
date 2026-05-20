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
- Un candidat ne peut pas postuler à une offre si son profil est incomplet à moins de 60%.
- Les évaluations sont obligatoires après chaque mission terminée (bloquantes pour la mission suivante si non soumises après 48h).

### 5.2 Système Sandbox (niveaux candidat)

Les seuils ci-dessous sont les **valeurs initiales configurables** depuis le dashboard `admin_founder`. Ils peuvent être modifiés à tout moment sans redéploiement.

| Niveau | Condition de déblocage (valeurs initiales) | Types d'offres accessibles |
|---|---|---|
| Niveau 0 — Nouveau | Inscription validée | Missions faible risque (distribution de flyers, aide logistique simple) |
| Niveau 1 — Confirmé | 1 mission réussie + note >= 3.5/5 | Missions intermédiaires (accueil, assistance vente) |
| Niveau 2 — Fiable | 3 missions réussies + note >= 4/5 + profil >= 80% | Missions à responsabilité (caissier, gestion de stock) |
| Niveau 3 — Expert | 10 missions + note >= 4.5/5 + badge vérifié | Toutes missions, priorisation dans le matching |

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
- **Documents requis** (optionnel : casier judiciaire vierge, diplôme, permis de conduire, CNI vérifiée...).
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
3. Compétences et secteurs d'activité (choix guidé + suggestion IA). Le **permis de conduire** est une compétence déclarable : upload du document + date d'expiration enregistrée.
4. Expériences passées (saisie libre + structuration IA).
5. Disponibilités (jours, horaires, mobilité géographique).
6. **Localisation GPS du domicile** : enregistrement de la position GPS depuis le lieu de résidence. Utilisée comme référence pour calculer les distances par rapport aux offres. Peut être mise à jour depuis le profil.
7. Upload **CNI** (recto/verso) + **selfie tenant la CNI** pour validation admin dans les 24h. La date d'expiration de la CNI est enregistrée et surveillée.
8. Vérification numéro **Mobile Money** (MTN ou Orange). Le nom enregistré sur le compte MoMo **doit correspondre au nom complet du candidat**. Les comptes au nom d'un tiers ne sont pas acceptés.
9. Consentement RGPD local.

**Gestion des documents expirés :**
- La plateforme surveille automatiquement les dates d'expiration (CNI, permis de conduire...).
- Notifications envoyées : 30 jours avant, 7 jours avant, et à l'expiration.
- Un document expiré est automatiquement marqué invalide. L'upload du document renouvelé relance la validation.
- Tant qu'un document requis par une offre est expiré, le candidat ne peut pas postuler à cette offre.

**Complétude minimale requise :** 60% pour postuler.

**Critères d'acceptation :**
- L'IA suggère des compétences à partir d'une description libre en moins de 3 secondes.
- La vérification CNI/MoMo affiche un statut clair (en attente / validé / rejeté).
- L'utilisateur peut sauvegarder et reprendre l'onboarding à tout moment.
- Les champs obligatoires sont indiqués visuellement.
- Le nom du compte MoMo est contrôlé pour correspondance avec le nom du candidat.

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
2. Vérification automatique des prérequis (niveau Sandbox, documents valides et non expirés).
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
momo_verified, momo_number, momo_operator, momo_name_match,
home_gps_lat, home_gps_lng,
sandbox_level, average_rating, total_missions,
profile_completion_pct, premium_until,
created_at, updated_at
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

**`document_expirations`**
```
id, candidate_id, document_type (cni/driving_license/other),
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

**Statut :** ✅ Décision prise.

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
