export const fr = {
  // Common
  common: {
    loading: "Chargement...",
    error: "Une erreur est survenue",
    retry: "Réessayer",
    cancel: "Annuler",
    confirm: "Confirmer",
    save: "Enregistrer",
    delete: "Supprimer",
    edit: "Modifier",
    back: "Retour",
    close: "Fermer",
    next: "Suivant",
    previous: "Précédent",
    search: "Rechercher",
    filter: "Filtrer",
    sort: "Trier",
    all: "Tout",
    none: "Aucun",
    yes: "Oui",
    no: "Non",
    or: "ou",
    and: "et",
  },

  // App name
  app: {
    name: "EasyJob CM",
    tagline: "Trouvez votre prochain job flexible",
    description:
      "La plateforme de mise en relation entre candidats et entreprises pour des missions flexibles au Cameroun.",
  },

  // Administration (T8)
  admin: {
    dashboard: {
      title: "Administration",
      subtitle: "Gestion de la plateforme",
    },
    stats: {
      users: "Utilisateurs",
      candidates: "candidats",
      companies: "entreprises",
      totalJobs: "Offres totales",
      activeJobs: "actives",
      applications: "Candidatures",
      pending: "En attente de revue",
    },
    quickActions: {
      users: "Candidats",
      jobs: "Offres",
      momo: "Mobile Money",
      skillProofs: "Justificatifs",
    },
    moderation: {
      pendingJobsTitle: "Offres à modérer",
      viewAll: "Tout voir",
      view: "Voir",
      approve: "Approuver",
      reject: "Rejeter",
      empty: "Aucune offre en attente de modération",
      pendingStatus: "En attente",
      urgent: "Urgent",
      reasonLabel: "Motif du refus",
      reasonPlaceholder: "Expliquez à l'entreprise ce qu'elle doit corriger",
      confirmReject: "Confirmer le refus",
      approvedToast: "Offre approuvée : elle est visible par les candidats.",
      rejectedToast: "Offre refusée : l'entreprise a été notifiée.",
      errorTitle: "Décision non enregistrée",
      errors: {
        forbidden:
          "Seuls les grades ops et fondateur peuvent modérer une offre.",
        reason_required:
          "Le motif du refus est obligatoire (3 caractères minimum).",
        reason_too_long: "Motif trop long (500 caractères maximum).",
        job_not_pending:
          "Cette offre a déjà été modérée. La liste a été actualisée.",
        job_changed:
          "L'entreprise a modifié l'offre entre-temps. Relisez-la avant de décider.",
        company_not_eligible:
          "Entreprise suspendue ou non vérifiée : l'offre ne peut pas être publiée.",
        job_start_too_close:
          "Début trop proche ou passé : une offre se publie plus de 24 h avant son début, ou en urgence entre 24 h et 4 h avant.",
        job_days_missing:
          "Offre antérieure sans dates de travail précises : l'entreprise doit indiquer ses journées avant publication.",
        job_not_found: "Offre introuvable.",
        not_authenticated: "Session expirée. Veuillez vous reconnecter.",
        invalid_action: "Action invalide.",
        moderation_failed:
          "La décision n'a pas pu être enregistrée. Réessayez.",
      },
    },
    jobPreview: {
      company: "Entreprise",
      description: "Description",
      date: "Date",
      time: "Horaires",
      location: "Lieu",
      pay: "Rémunération par candidat",
      positions: "Personnes recherchées",
      positionsValue: "{count} personne(s)",
    },
    momo: {
      title: "Révue Mobile Money",
      subtitle:
        "Confrontez le nom déclaré sur le compte MoMo au nom du CNI. Les comptes au nom d'un tiers ou familiaux sont refusés (motif obligatoire).",
      pending: "En attente",
      verified: "Vérifié",
      rejected: "Refusé",
      accountName: "Nom du compte déclaré",
      number: "Numéro",
      cniName: "Nom d'identité (CNI)",
      cniVerified: "CNI vérifié",
      cniStatus: "Statut CNI",
      cniNotProvided: "CNI non fourni ou non vérifié",
      rejectionReason: "Motif du refus",
      verifiedLabel: "Vérifié le",
      empty: "Aucune déclaration Mobile Money sur ce filtre",
      emptyVerified: "Aucun compte vérifié",
      emptyRejected: "Aucun compte refusé",
      review: "Examiner",
      approve: "Valider",
      reject: "Refuser",
      rejectReasonPlaceholder: "Motif du refus (obligatoire)",
      rejectReasonRequired:
        "Un motif de refus est obligatoire (min. 3 caractères).",
      readOnly:
        "Accès en lecture seule — seuls admin_ops et admin_founder peuvent valider ou refuser.",
      actionFailed: "L'action a échoué. Réessayez.",
      cniLoadFailed:
        "Impossible de charger le CNI. Ce candidat n'a peut-être pas de document encore.",
      mtn: "MTN MoMo",
      orange: "Orange Money",
    },
    cni: {
      title: "Révue CNI",
      subtitle:
        "Vérifiez les pièces d'identité (recto / verso / selfie) soumises par les candidats. L'approbation déclenche la suppression des photos du stockage privé (SRS §8.4).",
      pending: "En attente",
      verified: "Vérifiée",
      rejected: "Refusée",
      notProvided: "Non fournie",
      front: "Recto",
      back: "Verso",
      selfie: "Selfie",
      name: "Nom d'identité",
      cniNumber: "N° CNI",
      dob: "Date de naissance",
      expiresAt: "Expire le",
      rejectionReason: "Motif du refus",
      verifiedLabel: "Vérifiée le",
      empty: "Aucun CNI en attente",
      emptyVerified: "Aucune CNI vérifiée",
      emptyRejected: "Aucune CNI refusée",
      emptyNotProvided: "Aucun candidat sans CNI fournie",
      review: "Examiner",
      approve: "Valider",
      reject: "Refuser",
      rejectReasonPlaceholder: "Motif du refus (obligatoire)",
      rejectReasonRequired:
        "Un motif de refus est obligatoire (min. 3 caractères).",
      readOnly:
        "Accès en lecture seule — seuls admin_ops et admin_founder peuvent valider ou refuser.",
      actionFailed: "L'action a échoué. Réessayez.",
      loadDocFailed: "Impossible de charger le document.",
      noCni: "Ce candidat n'a pas encore soumis de CNI.",
      deletionNote:
        "Les photos seront supprimées du stockage privé après validation.",
      expiresHint:
        "Obligatoire si la date de naissance + 10 ans est déjà passée : saisissez la date d'échéance inscrite sur la pièce.",
      expiryInvalid:
        "Date d'échéance absente ou déjà passée : saisissez la date inscrite sur la nouvelle CNI.",
    },
    candidates: {
      title: "Candidats",
      subtitle:
        "Vue centralisée : identité, Mobile Money, statuts CNI / MoMo et état du compte de chaque candidat. Recherche par nom, e-mail ou téléphone.",
      searchPlaceholder: "Rechercher (nom, e-mail, téléphone)",
      sectionPending: "En attente",
      sectionVerified: "Validés",
      sectionSuspended: "Suspendus",
      emptyPending: "Aucun candidat en attente de vérification",
      emptyVerified: "Aucun candidat validé",
      emptySuspended: "Aucun candidat suspendu",
      noResults: "Aucun candidat ne correspond à cette recherche",
      momo: "Mobile Money",
      noMomo: "Mobile Money non déclaré",
      momoLabel: "N° MoMo",
      emailLabel: "E-mail",
      verifiedBadge: "Profil vérifié",
      viewProfile: "Voir le profil",
      btnCni: "CNI",
      btnMomo: "MoMo",
      btnDocuments: "Documents",
      suspend: "Suspendre",
      activate: "Réactiver",
      suspendConfirm:
        "Suspendre ce candidat ? Il ne pourra plus postuler ni travailler.",
      activateConfirm: "Réactiver ce candidat ?",
      readOnly:
        "Accès en lecture seule — seuls admin_ops et admin_founder peuvent suspendre ou réactiver.",
    },
    companies: {
      title: "Entreprises",
      subtitle:
        "Vue centralisée : raison sociale, contact et statut de vérification de chaque entreprise. Recherche par nom, e-mail ou téléphone.",
      searchPlaceholder: "Rechercher (nom, e-mail, téléphone)",
      sectionPending: "En attente",
      sectionVerified: "Validées",
      sectionSuspended: "Suspendues",
      emptyPending: "Aucune entreprise en attente de vérification",
      emptyVerified: "Aucune entreprise validée",
      emptySuspended: "Aucune entreprise suspendue",
      noResults: "Aucune entreprise ne correspond à cette recherche",
      emailLabel: "E-mail de contact",
      phoneLabel: "Téléphone",
      noContact: "Informations de contact non renseignées",
      verifiedBadge: "Dossier vérifié par EasyJob",
      viewProfile: "Voir le profil",
      suspend: "Suspendre",
      activate: "Réactiver",
      suspendConfirm:
        "Suspendre cette entreprise ? Elle ne pourra plus publier d'offres ni recevoir de candidatures.",
      activateConfirm: "Réactiver cette entreprise ?",
      readOnly:
        "Accès en lecture seule — seuls admin_ops et admin_founder peuvent suspendre ou réactiver.",
      sectionReview: "À examiner",
      emptyReview: "Aucun dossier à examiner",
      sectionPendingHint:
        "Dossiers incomplets ou en attente d'une correction de l'entreprise.",
      submittedOn: "Soumis le {date}",
      openDossier: "Examiner le dossier",
      reviewStates: {
        incomplete: "Dossier incomplet",
        in_review: "À examiner",
        correction: "Correction demandée",
        verified: "Vérifiée",
      },
      review: {
        title: "Dossier entreprise",
        subtitle:
          "Contrôlez séparément le RCCM, le NIU et le représentant auprès des sources officielles, puis décidez.",
        state: "État du dossier",
        version: "Version {n}",
        fields: {
          companyName: "Raison sociale",
          legalName: "Nom légal",
          sector: "Secteur",
          size: "Taille",
          website: "Site web",
          rccm: "Numéro RCCM",
          niu: "NIU",
          address: "Adresse",
          contact: "Contact",
          onboarding: "Onboarding",
          description: "Description",
        },
        onboardingDone: "Terminé",
        onboardingOpen: "Non terminé",
        niuVerified: "NIU certifié (contrôle DGI)",
        niuNotVerified: "NIU non certifié",
        document: "Document RCCM",
        viewDocument: "Voir la pièce",
        hideDocument: "Masquer",
        noDocument: "Aucun document déposé",
        documentLinkHint: "Lien temporaire (60 secondes), non partageable.",
        documentError: "Le document n'a pas pu être ouvert.",
        accountSuspended: "Compte suspendu",
        lastReason: "Dernier motif communiqué",
        reviewedOn: "Décision du {date}",
        approve: "Approuver le dossier",
        requestCorrection: "Demander une correction",
        reasonLabel: "Motif communiqué à l'entreprise",
        reasonPlaceholder:
          "Ex. : le RCCM est illisible, envoyez un scan complet de la page.",
        reasonHint: "10 à 500 caractères. L'entreprise le verra tel quel.",
        sendCorrection: "Envoyer la demande",
        cancel: "Annuler",
        confirmApprove:
          "Approuver ce dossier ? Il sera affiché « Dossier vérifié par EasyJob » et l'entreprise pourra publier des offres.",
        approved: "Dossier approuvé",
        correctionSent: "Correction demandée à l'entreprise",
        readOnly:
          "Lecture seule : seuls admin_ops et admin_founder décident d'un dossier.",
        notPending:
          "Aucune décision attendue : ce dossier n'est pas à examiner.",
        changed:
          "Le dossier a été modifié depuis son ouverture. Relisez-le avant de décider.",
        reload: "Relire le dossier",
        loadError: "Le dossier n'a pas pu être chargé.",
        sections: {
          rccm: "Contrôle RCCM",
          niu: "Contrôle NIU",
          representative: "Contrôle du représentant",
        },
        checkHints: {
          rccm: "Vérifiez le numéro et la raison sociale auprès d'une source officielle accessible, ou du greffe compétent si nécessaire.",
          niu: "Vérifiez le NIU auprès du service officiel de la DGI : il doit correspondre à cette entreprise. Un fichier envoyé ou un format valide ne suffit pas.",
          representative:
            "Vérifiez l'identité du représentant et son habilitation : dirigeant mentionné dans les justificatifs, ou mandat de l'entreprise.",
        },
        checkStatus: {
          approved: "Validé",
          rejected: "Refusé",
          unverifiable: "Vérification impossible",
          pending: "À contrôler",
        },
        decisions: {
          approved: "Valider",
          rejected: "Refuser",
          unverifiable: "Vérification impossible",
        },
        sourceLabel: "Source de vérification",
        sourcePlaceholder: "Choisir la source consultée",
        sources: {
          official_registry: "Registre officiel (consultation)",
          court_registry: "Greffe compétent",
          dgi_online: "Service en ligne de la DGI",
          dgi_office: "Centre des impôts (DGI)",
          rccm_extract: "Dirigeant mentionné dans les justificatifs",
          mandate: "Mandat de l'entreprise",
        },
        referenceLabel: "Référence ou note interne",
        referenceHint:
          "Visible par l'équipe EasyJob seulement (3 à 300 caractères). Évitez d'y recopier des données personnelles.",
        referencePlaceholder:
          "Ex. : consultation DGI du 11/11, attestation n° …",
        checkReasonLabel: "Motif communiqué à l'entreprise",
        saveCheck: "Enregistrer le contrôle",
        checkSaved: "Contrôle enregistré",
        unverifiableHint:
          "Le dossier reste en attente : aucune approbation sans vérification externe.",
        history: "Historique des contrôles",
        historyEmpty: "Aucun contrôle enregistré.",
        historyOutdated: "version précédente",
        historyBy: "par {who}",
        representativeName: "Représentant",
        representativeTitle: "Fonction",
        representativeAuthority: "Habilitation",
        documentsLabels: {
          rccm: "Document RCCM",
          niu: "Attestation NIU",
          representative_id: "Pièce d'identité",
          mandate: "Mandat",
        },
        missing: "Pièces manquantes",
        finalTitle: "Décision finale",
        finalHint:
          "L'approbation exige les trois contrôles validés sur la version actuelle du dossier.",
      },
    },
    // Lot 17a : attribution administrative de Premium (aucun paiement).
    candidatePremium: {
      title: "Premium (attribution administrative)",
      plan: "Plan effectif",
      free: "Free",
      premium: "Premium",
      until: "Fin",
      since: "Début",
      unknown: "Inconnu",
      endedOn: "Dernière fin : {date}",
      noPayment:
        "Attribution par l'équipe EasyJob : aucun paiement n'est enregistré.",
      readOnly:
        "Lecture seule : seuls admin_ops et admin_founder modifient Premium.",
      activate: "Activer",
      extend: "Prolonger",
      stop: "Arrêter",
      operation: "Opération",
      endLabel: "Fin (heure de Douala)",
      reasonLabel: "Motif",
      reasonHint: "10 à 500 caractères, visible dans l'historique.",
      submit: "Enregistrer",
      history: "Historique",
      noHistory: "Aucune opération enregistrée.",
      opActivate: "Activation",
      opExtend: "Prolongation",
      opStop: "Arrêt",
      by: "par {who}",
      periodLine: "Période : {start} → {end}",
      previousEnd: "Fin précédente : {date}",
      success: "Opération enregistrée.",
      already: "Opération déjà enregistrée.",
      errors: {
        forbidden: "Action réservée à admin_ops et admin_founder.",
        candidate_not_found: "Candidat introuvable.",
        reason_invalid: "Motif requis (10 à 500 caractères).",
        period_invalid:
          "Date de fin invalide : elle doit être future et, pour prolonger, postérieure à la fin actuelle.",
        premium_already_active: "Premium est déjà actif.",
        premium_not_active: "Premium n'est pas actif.",
        premium_state_changed:
          "Premium a changé entre-temps : relisez la fiche avant de recommencer.",
        request_conflict: "Envoi en conflit : recommencez.",
        generic: "Opération impossible. Réessayez.",
      },
    },
    candidateProfile: {
      title: "Profil candidat",
      back: "Tous les candidats",
      identitySection: "Identité",
      filteredByUser:
        "Vue restreinte au candidat de la carte « Candidats ». Pour revenir à la liste globale, cliquez sur « Tous les candidats ».",
      suspended: "Compte suspendu",
      readOnly:
        "Lecture seule — l'édition de l'identité est réservée à admin_founder.",
      notFound: "Profil introuvable",
      genderLabel: "Genre",
      genderMale: "Masculin",
      genderFemale: "Féminin",
      genderOther: "Autre",
      bioLabel: "Bio",
      noBio: "Aucune bio renseignée",
      locationLabel: "Localisation",
      noLocation: "Localisation non renseignée",
      cniSection: "CNI",
      momoSection: "Mobile Money",
      momoAccountName: "Nom du compte",
      noMomoAccountName: "Nom du compte non renseigné",
      skillsSection: "Compétences",
      noSkills: "Aucune compétence déclarée",
      documentsSection: "Documents",
      noDocuments: "Aucun document",
      missionsSection: "Missions",
      noMissions: "Aucune mission",
      statsSection: "Statistiques",
      statTotal: "Missions totales",
      statCompleted: "Complétées",
      statNoShows: "Absences",
      statReliability: "Fiabilité",
      statRating: "Note moyenne",
      createdAt: "Inscrit le",
      updatedAt: "Mis à jour le",
      editTitle: "Modifier l'identité",
      editHint:
        "Seul admin_founder peut modifier le prénom, le nom et la date de naissance.",
      editResetNotice:
        "Ce changement remet la CNI en « En attente » : le candidat devra re-vérifier son identité.",
      firstNameLabel: "Prénom",
      lastNameLabel: "Nom",
      dobLabel: "Date de naissance",
      save: "Enregistrer",
      saved: "Identité enregistrée",
      saveFailed: "L'enregistrement a échoué. Réessayez.",
      missionStatuses: {
        pending: "En attente",
        confirmed: "Confirmée",
        in_progress: "En cours",
        completed: "Complétée",
        cancelled: "Annulée",
        no_show: "Absence",
        en_route: "En route",
        arrived: "Arrivée",
        validated: "Validée",
        disputed: "En litige",
      },
      paymentStatuses: {
        pending: "En attente",
        processing: "En cours",
        completed: "Réglée",
        failed: "Échouée",
        refunded: "Remboursée",
        cancelled: "Annulée",
        partial: "Partielle",
        full: "Complète",
      },
      // T8.5 — Section « Mises à jour de profil » du profil candidat.
      updateRequestsSection: "Mises à jour de profil",
      noUpdateRequests: "Aucune demande de mise à jour pour ce candidat",
      requestUpdateButton: "Demander une mise à jour",
      requestReadOnly:
        "Lecture seule — seuls admin_ops et admin_founder peuvent demander une mise à jour.",
    },
    // T8.5 — Mises à jour de profil initiées par l'admin (SRS §5.1.1).
    // Le modèle T2 n'a pas d'« approbation/refus » : l'admin initie, le
    // candidat exécute (fermeture `done` automatique) ; l'admin annule
    // (`cancelled`) ou purge l'historique clôturé (`DELETE`).
    updateRequests: {
      title: "Mises à jour de profil",
      subtitle:
        "Demandes de déverrouillage des champs vérifiés (identité / CNI) initiées par l'administration. Le candidat exécute la mise à jour, la demande se clôture automatiquement.",
      back: "Tableau de bord",
      pending: "En attente",
      done: "Exécutée",
      cancelled: "Annulée",
      all: "Toutes",
      empty: "Aucune demande de mise à jour",
      fieldsLabel: "Champs concernés",
      reasonLabel: "Motif",
      noReason: "Aucun motif renseigné",
      requestedBy: "Demandée par",
      requestedAt: "Demandée le",
      completedAt: "Exécutée le",
      fieldIdentity: "Identité",
      fieldCniDocuments: "Documents CNI",
      cancel: "Annuler",
      cancelConfirm:
        "Annuler cette demande ? Le candidat ne pourra plus modifier les champs concernés et ils redeveniront verrouillés.",
      delete: "Supprimer",
      deleteConfirm:
        "Supprimer définitivement cette demande ? Cette action est irréversible.",
      readOnly:
        "Accès en lecture seule — seuls admin_ops et admin_founder peuvent annuler ou supprimer.",
      actionFailed: "L'action a échoué. Réessayez.",
      createdTitle: "Mise à jour de profil requise",
      createTitle: "Demander une mise à jour",
      createHint:
        "Déverrouille temporairement les champs vérifiés du candidat le temps qu'ils soient resoumis puis re-vérifiés.",
      candidateLabel: "Candidat",
      searchPlaceholder: "Rechercher un candidat…",
      noCandidate:
        "Recherchez un candidat (nom ou e-mail) pour demander une mise à jour.",
      fieldsLabelHint: "Au moins un groupe à déverrouiller",
      reasonPlaceholder:
        "Ex. : changement de nom sur acte à jour, CNI périmée à remplacer…",
      reasonRequired: "Un motif de 5 caractères minimum est requis.",
      submit: "Demander la mise à jour",
      submitting: "Envoi…",
      created: "Demande envoyée au candidat.",
    },
  },

  // Auth
  auth: {
    oauthError: {
      title: "Connexion interrompue",
      description:
        "Nous n'avons pas pu terminer la connexion avec Google. Le lien a peut-être expiré ou la connexion a été annulée.",
      retry: "Reprendre la connexion",
      signup: "Créer un compte",
      home: "Retour à l'accueil",
    },
    welcome: "Bienvenue sur EasyJob CM",
    welcomeBack: "Bon retour !",
    signIn: "Se connecter",
    signUp: "Créer un compte",
    signOut: "Se déconnecter",
    phone: "Numéro de téléphone",
    phonePlaceholder: "6XX XXX XXX",
    phoneHint: "Entrez votre numéro camerounais",
    invalidPhone: "Numéro de téléphone invalide",
    otp: "Code de vérification",
    otpSent: "Un code a été envoyé au",
    otpPlaceholder: "000000",
    otpHint: "Entrez le code à 6 chiffres",
    otpInvalid: "Code invalide",
    otpExpired: "Code expiré",
    resendOtp: "Renvoyer le code",
    resendIn: "Renvoyer dans",
    verifying: "Vérification...",
    selectRole: "Je suis...",
    candidate: "Un candidat",
    candidateDesc: "Je cherche des missions flexibles",
    company: "Une entreprise",
    companyDesc: "Je propose des missions",
    termsAgree: "En continuant, vous acceptez nos",
    terms: "Conditions générales",
    privacy: "Politique de confidentialité",
    loginPage: {
      title: "Bon retour !",
      subtitle: "Connectez-vous pour continuer",
      email: "Adresse email",
      emailPlaceholder: "vous@email.com",
      password: "Mot de passe",
      forgot: "Mot de passe oublié ?",
      submit: "Se connecter",
      noAccount: "Pas encore de compte ?",
      createAccount: "Créer un compte",
      errors: {
        invalidCredentials: "Email ou mot de passe incorrect.",
        generic: "Une erreur est survenue. Réessayez.",
      },
    },
    forgotPage: {
      title: "Mot de passe oublié ?",
      subtitle:
        "Entrez votre adresse email pour recevoir un code à 6 chiffres.",
      email: "Adresse email",
      emailPlaceholder: "vous@email.com",
      submit: "Envoyer le code",
      sending: "Envoi en cours…",
      backToLogin: "Retour à la connexion",
      errors: {
        generic: "Une erreur est survenue. Réessayez.",
      },
      otp: {
        title: "Vérifiez votre email",
        subtitle: "Un code à 6 chiffres a été envoyé à",
        checkSpam: "Vérifiez vos spams si vous ne le recevez pas.",
        verify: "Vérifier le code",
        didntReceive: "Pas reçu le code ?",
        resend: "Renvoyer",
        resendIn: "Renvoyer dans {seconds}s",
      },
    },
    resetPage: {
      title: "Nouveau mot de passe",
      subtitle: "Choisissez un mot de passe sécurisé pour votre compte.",
      password: "Nouveau mot de passe",
      passwordPlaceholder: "8 caractères minimum",
      confirm: "Confirmer le mot de passe",
      confirmPlaceholder: "Répétez votre mot de passe",
      submit: "Enregistrer le mot de passe",
      saving: "Enregistrement…",
      backToLogin: "Retour à la connexion",
      successTitle: "Mot de passe mis à jour !",
      successMessage:
        "Votre mot de passe a été modifié avec succès. Vous pouvez maintenant vous connecter.",
      goToLogin: "Se connecter",
      sessionExpiredTitle: "Lien expiré",
      requestNewCode: "Demander un nouveau code",
      showPassword: "Afficher le mot de passe",
      hidePassword: "Masquer le mot de passe",
      errors: {
        mismatch: "Les mots de passe ne correspondent pas.",
        tooShort: "8 caractères minimum requis.",
        sessionExpired:
          "Le lien a expiré ou est invalide. Demandez un nouveau code.",
        generic: "Une erreur est survenue. Réessayez.",
      },
    },
  },

  // Signup wizard (parcours d'inscription)
  signup: {
    chooseRole: {
      title: "Créer mon compte",
      subtitle: "Choisissez votre profil pour commencer",
      candidateTitle: "Je cherche des missions",
      candidateDesc: "Trouvez des missions flexibles et soyez payé rapidement.",
      companyTitle: "Je recrute",
      companyDesc:
        "Publiez vos offres et trouvez des candidats fiables en 24h.",
      alreadyAccount: "J'ai déjà un compte",
      start: "Commencer",
      recruit: "Recruter",
    },
    steps: {
      account: "Compte",
      company: "Société",
      email: "Email",
      phone: "Téléphone",
      verify: "Vérification",
    },
    candidate: {
      heroTitle: "Bienvenue future star d'EasyJob",
      heroSubtitle: "Des missions près de chez vous, à montant fixe en XAF.",
    },
    company: {
      heroTitle: "Recrutez les meilleurs talents",
      heroSubtitle: "Postez en 2 minutes, recevez des candidatures qualifiées.",
      companyName: "Nom de la société",
      companyNamePlaceholder: "Ex : Boulangerie Akwa",
      niu: "Numéro d'Identifiant Unique (NIU)",
      niuPlaceholder: "M123456789012X",
      niuHelp: "14 caractères alphanumériques fournis par la DGI.",
    },
    account: {
      title: "Créez votre compte",
      subtitle: "Email et mot de passe sécurisé.",
      email: "Adresse email",
      emailPlaceholder: "vous@email.com",
      password: "Mot de passe",
      passwordHint:
        "Au moins 8 caractères avec des lettres minuscules, des lettres majuscules, des chiffres et des symboles (!@#$%^&*).",
      confirmPassword: "Confirmez le mot de passe",
      orContinueWith: "Ou continuer avec",
      continueGoogle: "Continuer avec Google",
      terms: "J'accepte les",
      termsLink: "Conditions Générales",
      and: "et la",
      privacyLink: "Politique de Confidentialité",
    },
    phoneStep: {
      title: "Votre numéro de téléphone",
      subtitle: "Nous vous enverrons un code par SMS pour vérifier ce numéro.",
      hint: "Format Cameroun : 6XX XXX XXX",
      sendCode: "Envoyer le code",
    },
    emailOtp: {
      title: "Vérifiez votre email",
      subtitle: "Un code à 6 chiffres a été envoyé à",
      didntReceive: "Vous n'avez pas reçu de code ?",
      resend: "Renvoyer",
      resendIn: "Renvoyer dans {seconds}s",
      checkSpam: "Pensez à vérifier vos spams.",
      verify: "Vérifier",
    },
    otp: {
      title: "Entrez le code reçu",
      subtitle: "Un code à 6 chiffres a été envoyé au",
      didntReceive: "Vous n'avez pas reçu de code ?",
      resend: "Renvoyer",
      resendIn: "Renvoyer dans {seconds}s",
      verify: "Vérifier",
    },
    welcome: {
      title: "Bienvenue sur EasyJob !",
      subtitleCandidate:
        "Votre compte est créé. Connectez-vous pour compléter votre profil et postuler aux missions.",
      subtitleCompany:
        "Votre compte est créé. Connectez-vous pour compléter votre profil et publier votre première offre.",
      continue: "Se connecter",
    },
    errors: {
      emailInvalid: "Adresse email invalide",
      emailAlreadyUsed: "Cette adresse email est déjà utilisée.",
      passwordTooShort: "Le mot de passe doit faire au moins 8 caractères.",
      passwordNeedsLetter: "Ajoutez au moins une lettre.",
      passwordNeedsDigit: "Ajoutez au moins un chiffre.",
      passwordMismatch: "Les mots de passe ne correspondent pas.",
      phoneInvalid: "Numéro invalide. Format : 6XX XXX XXX.",
      phoneAlreadyUsed: "Ce numéro est déjà utilisé.",
      otpInvalid: "Code à 6 chiffres requis.",
      otpWrong: "Code incorrect, réessayez.",
      otpExpired: "Code expiré, demandez un nouveau code.",
      niuInvalid: "NIU invalide. 14 caractères alphanumériques.",
      niuAlreadyUsed: "Ce NIU est déjà enregistré.",
      companyNameTooShort: "Nom trop court.",
      companyNameTooLong: "Nom trop long.",
      termsRequired: "Vous devez accepter les conditions.",
      smsProviderMissing: "Service SMS non configuré. Contactez le support.",
      smsQuotaExceeded: "Trop de tentatives. Réessayez plus tard.",
      emailQuotaExceeded: "Trop de tentatives. Réessayez plus tard.",
      generic: "Une erreur est survenue. Réessayez.",
    },
  },

  // Navigation
  nav: {
    jobs: "Jobs",
    tasks: "Tâches",
    tasksPending: "Tâches, une action vous attend",
    myJobs: "Mes Jobs",
    profile: "Profil",
  },

  // Jobs
  jobs: {
    title: "Offres disponibles",
    empty: "Aucune offre disponible",
    emptyDesc: "Revenez bientôt pour découvrir de nouvelles opportunités",
    search: "Rechercher un job...",
    filters: "Filtres",
    salary: "Salaire",
    location: "Lieu",
    date: "Date",
    duration: "Durée",
    apply: "Postuler",
    applied: "Candidature envoyée",
    deadline: "Date limite",
    spotsLeft: "places restantes",
    urgentBadge: "Urgente",
    urgentLabel: "Offre urgente : elle commence dans moins de 24 h",
  },

  // Détail d'une offre (lot 9d) : travail, montant, lieu, horaires,
  // exigences, puis action.
  jobDetail: {
    // Lot 11 : offre masquée tant que le dossier de l'entreprise n'est pas vérifié.
    unavailableTitle: "Offre indisponible",
    unavailableBody:
      "Cette offre n'est temporairement plus proposée aux nouveaux candidats.",
    unavailableApplied:
      "Cette offre n'accepte plus de nouvelles candidatures pour le moment. Votre candidature reste consultable.",
    backToJobs: "Voir les autres offres",
    // Lot 11b : échéance de recrutement (H−24, ou H−2 si publiée en urgence).
    closedBody: "Les candidatures pour cette offre sont closes.",
    closedApplied:
      "Les candidatures pour cette offre sont closes. Votre candidature reste consultable.",
    closesAt: "Candidatures jusqu'au {date}",
    work: "Travail demandé",
    pay: "Montant par candidat",
    location: "Lieu",
    schedule: "Date et horaires",
    dateRangeTo: "au",
    duration: "{hours} h",
    requirements: "Exigences",
    requiredSkills: "Compétences",
    requiredDocuments: "Justificatifs",
    noRequirement: "Aucune exigence particulière.",
    dressCode: "Tenue vestimentaire",
    specialInstructions: "Instructions",
    company: "À propos de l'entreprise",
    openMap: "Ouvrir le lieu dans Google Maps",
    share: "Partager l'offre",
    shareCopied: "Lien de l'offre copié",
    shareFailed: "Le lien n'a pas pu être copié.",
    applyNow: "Postuler maintenant",
    confirmTitle: "Confirmer votre candidature",
    confirm: "Confirmer",
    cancel: "Annuler",
    close: "Fermer",
    documentLabels: {
      cni: "CNI",
      driving_license: "permis de conduire",
    },
  },

  // Candidature : état, refus de /apply et retrait (lot 9)
  application: {
    applyNowTitle: "Postulez maintenant !",
    positionsLeft: {
      one: "1 place disponible",
      other: "{count} places disponibles",
      none: "Aucune place disponible",
    },
    confirmBefore:
      "Avant de postuler, assurez-vous de pouvoir vous présenter à cette mission.",
    availabilityNotice:
      "Postulez seulement si vous êtes disponible aux horaires indiqués. En cas d'empêchement, prévenez l'entreprise au plus tôt.",
    status: {
      pending: {
        title: "Candidature envoyée",
        desc: "Vous serez notifié si vous êtes sélectionné.",
      },
      selected: {
        title: "Vous êtes sélectionné",
        desc: "Signez votre contrat depuis l'onglet Tâches.",
      },
      rejected: {
        title: "Candidature non retenue",
        desc: "L'entreprise n'a pas retenu votre candidature pour cette offre. D'autres offres vous attendent.",
      },
      withdrawn: {
        title: "Candidature retirée",
        desc: "Vous avez retiré votre candidature. Il n'est pas possible de postuler de nouveau à cette offre.",
      },
      no_show: {
        title: "Absence enregistrée",
        desc: "Une absence a été enregistrée pour cette mission. Contactez le support en cas d'erreur.",
      },
    },
    sentToast: {
      title: "Candidature envoyée",
      desc: "Suivez-la dans Mes jobs.",
    },
    withdraw: {
      button: "Retirer ma candidature",
      confirmTitle: "Retirer votre candidature ?",
      confirmBody:
        "L'entreprise ne la verra plus et vous ne pourrez pas postuler de nouveau à cette offre.",
      confirm: "Retirer",
      cancel: "Annuler",
      doneTitle: "Candidature retirée",
      doneDesc: "Elle apparaît dans l'historique de Mes jobs.",
      errorTitle: "Retrait impossible",
      errors: {
        application_not_withdrawable:
          "Seule une candidature en attente peut être retirée. Contactez l'entreprise ou le support.",
        application_not_found:
          "Candidature introuvable. Rechargez la page pour voir son état actuel.",
        generic: "Le retrait n'a pas pu être enregistré. Réessayez.",
      },
    },
    errorTitle: "Candidature non envoyée",
    refusals: {
      not_authenticated:
        "Votre session a expiré. Reconnectez-vous pour postuler.",
      profile_not_found: "Terminez d'abord votre inscription pour postuler.",
      onboarding_incomplete:
        "Terminez d'abord votre inscription pour postuler.",
      account_suspended:
        "Votre compte est suspendu : vous ne pouvez pas postuler. Contactez le support.",
      job_not_found: "Cette offre n'est plus disponible.",
      job_not_available: "Cette offre n'accepte plus de candidatures.",
      recruitment_closed: "Les candidatures pour cette offre sont closes.",
      no_positions: "Toutes les places de cette offre sont pourvues.",
      already_applied: "Vous avez déjà postulé à cette offre.",
      job_days_required: "Choisissez au moins une journée pour postuler.",
      job_days_invalid:
        "Journées invalides : actualisez la page puis réessayez.",
      job_days_not_selectable:
        "Cette offre couvre toute la période : la candidature porte sur l'ensemble des journées.",
      job_days_missing: "Cette offre n'accepte pas de candidatures.",
      job_days_unavailable:
        "Certaines journées ne sont plus disponibles : rien n'a été envoyé.",
      schedule_conflict:
        "Vous avez déjà un engagement qui chevauche cette mission ou qui en est à moins de 3 h.",
      profile_incomplete:
        "Votre profil doit être complété à au moins 60 % pour postuler.",
      profile_not_verified:
        "Votre identité, votre CNI et votre Mobile Money doivent être vérifiés pour postuler.",
      application_failed:
        "La candidature n'a pas pu être envoyée. Réessayez dans un instant.",
      network:
        "Connexion impossible. Vérifiez votre connexion internet, puis réessayez.",
      generic: "La candidature n'a pas pu être envoyée. Réessayez.",
      cni_expired: "Votre CNI a expiré. Renouvelez-la pour postuler.",
    },
    // Lot 9d : CNI expirée et renouvellement
    cni: {
      expired: "Votre CNI a expiré. Renouvelez-la pour postuler.",
      renewal_pending:
        "Votre nouvelle CNI est en cours de vérification. Vous pourrez postuler dès son approbation.",
      renewal_rejected:
        "Votre nouvelle CNI a été refusée. Envoyez une pièce conforme pour postuler.",
    },
    documents: {
      missingCni: "Cette offre exige une CNI vérifiée.",
      missingLicense: "Cette offre exige un permis de conduire valide.",
      missingSkill:
        "Cette offre exige un diplôme ou un certificat valide pour la compétence « {skill} ».",
      missingOther: "Cette offre exige un justificatif valide : {doc}.",
      pending: "Votre justificatif est encore en cours de vérification.",
      rejected:
        "Votre justificatif a été refusé. Remplacez-le depuis votre profil.",
      expired: "Votre justificatif a expiré. Mettez-le à jour pour postuler.",
      labels: {
        casier_judiciaire: "casier judiciaire",
        diplome: "diplôme",
        certificat: "certificat",
        attestation_formation: "attestation de formation",
        attestation_travail: "attestation de travail",
        autre: "document",
      },
    },
    actions: {
      signIn: "Se connecter",
      finishSignup: "Terminer mon inscription",
      completeProfile: "Compléter mon profil",
      documents: "Gérer mes justificatifs",
      identity: "Vérifier mon identité",
      browseJobs: "Voir les autres offres",
      myApplications: "Voir mes candidatures",
      support: "Contacter le support",
      tasks: "Ouvrir mes tâches",
      renewCni: "Renouveler ma CNI",
      trackRenewal: "Consulter le suivi",
      openTask: "Ouvrir la tâche",
    },
  },

  // Rémunération : montant fixe par candidat pour la mission (XAF)
  pay: {
    forMission: "pour la mission",
    perCandidate: "Rémunération par candidat",
    flatNote:
      "Montant fixe convenu pour chaque candidat sélectionné, quelle que soit l'heure de fin effective.",
    formLabel: "Rémunération par candidat pour la mission (F CFA)",
    formHint:
      "Montant fixe convenu pour chaque candidat sélectionné, quelle que soit l'heure de fin effective. Les horaires restent affichés pour l'organisation.",
    formExample:
      "Exemple : 3 personnes recherchées à 10 000 F CFA = 10 000 F CFA pour chacune.",
    positions: {
      one: "{count} personne recherchée",
      other: "{count} personnes recherchées",
    },
    contractBasis: "Forfait par mission, par candidat, en francs CFA (XAF)",
  },

  // Tasks
  tasks: {
    title: "Mes tâches",
    empty: "Vous êtes prêt !",
    emptyDesc: "Aucune tâche en attente pour le moment",
    pending: "En attente",
    inProgress: "En cours",
    completed: "Terminées",
    upcoming: "À venir",
    discoverJobs: "Découvrir les jobs",
    // Lot 9d : actions qui débloquent une candidature
    actionsTitle: "Pour pouvoir postuler",
    followUpBadge: "En cours de vérification",
    actionBadge: "Action requise",
    concernedJobs: "Offres concernées :",
    profile: {
      onboardingTitle: "Terminer votre inscription",
      onboardingHint: "Quelques étapes restent à compléter.",
      incompleteTitle: "Compléter votre profil",
      incompleteHint:
        "Votre profil est complété à {pct} % : 60 % sont nécessaires pour postuler.",
      action: "Compléter mon profil",
      onboardingAction: "Terminer mon inscription",
    },
    identity: {
      title: "Renseigner votre identité",
      hint: "Nom, prénom et date de naissance sont nécessaires pour postuler.",
      action: "Renseigner mon identité",
    },
    phone: {
      title: "Vérifier votre téléphone",
      hint: "Un numéro vérifié est nécessaire pour postuler.",
      action: "Vérifier mon numéro",
    },
    momo: {
      missingTitle: "Ajouter votre Mobile Money",
      missingHint:
        "Un compte Mobile Money vérifié est nécessaire pour postuler.",
      pendingTitle: "Mobile Money en cours de vérification",
      pendingHint: "Vous serez notifié dès sa vérification.",
      rejectedTitle: "Mobile Money refusé",
      rejectedHint: "Corrigez votre compte Mobile Money pour postuler.",
      action: "Gérer mon Mobile Money",
      track: "Consulter le suivi",
    },
    cni: {
      expiredTitle: "CNI expirée",
      expiredHint: "Votre CNI a expiré le {date}. Renouvelez-la pour postuler.",
      renewalPendingTitle: "Renouvellement de la CNI soumis",
      renewalPendingHint:
        "Votre nouvelle CNI est en cours de vérification. Vous pourrez postuler dès son approbation.",
      renewalRejectedTitle: "Renouvellement de la CNI refusé",
      renewalRejectedHint:
        "Votre nouvelle CNI a été refusée. Envoyez une pièce conforme pour postuler.",
      complementHint:
        "Un complément vous est demandé sur votre CNI. Consultez la demande ci-dessus.",
      missingTitle: "Envoyer votre CNI",
      missingHint: "Recto, verso et selfie sont nécessaires pour postuler.",
      pendingTitle: "CNI en cours de vérification",
      pendingHint: "Vous serez notifié dès sa vérification.",
      rejectedTitle: "CNI refusée",
      rejectedHint: "Envoyez une pièce conforme pour postuler.",
      reason: "Motif : {reason}",
      renew: "Renouveler ma CNI",
      send: "Envoyer ma CNI",
      track: "Consulter le suivi",
    },
    document: {
      missingTitle: "Ajouter un justificatif",
      pendingTitle: "Justificatif en cours de vérification",
      rejectedTitle: "Justificatif refusé",
      expiredTitle: "Justificatif expiré",
      action: "Gérer mes justificatifs",
      track: "Consulter le suivi",
    },
  },

  // My Jobs
  // Gains : montants convenus des missions terminées (lot 9)
  earnings: {
    title: "Mes gains",
    totalLabel: "Montant convenu des missions terminées",
    missionsCount: {
      one: "{count} mission terminée",
      other: "{count} missions terminées",
    },
    note: "Chaque montant est celui inscrit dans le contrat de la mission. L'entreprise s'engage à vous le régler : aucun versement ni retrait Mobile Money n'est encore effectué par l'application.",
    listTitle: "Missions terminées",
    contractAmount: "Montant du contrat",
    noAmount: "Montant non disponible",
    emptyTitle: "Aucune mission terminée",
    emptyDesc:
      "Le montant convenu de chaque mission apparaîtra ici une fois sa fin confirmée par le code.",
    browseJobs: "Parcourir les offres",
    loadErrorTitle: "Connexion impossible",
    loadErrorDesc:
      "Vos missions n'ont pas pu être chargées. Vérifiez votre connexion, puis réessayez.",
    retry: "Réessayer",
  },

  myJobs: {
    title: "Mes jobs",
    tabs: {
      applied: "Candidatures",
      booked: "Réservées",
      completed: "Terminées",
    },
    applicationStatus: {
      pending: "En attente",
      selected: "Sélectionnée",
      rejected: "Non retenue",
      withdrawn: "Retirée",
      no_show: "Absence",
    },
    missionStatus: {
      pending: "Prévue",
      confirmed: "Confirmée",
      in_progress: "En cours",
      completed: "Terminée",
      cancelled: "Annulée",
      no_show: "Absence",
      en_route: "En route",
      arrived: "Sur place",
      validated: "Validée",
      disputed: "En litige",
    },
    appliedOn: "Postulé le",
    history: "Historique",
    empty: {
      neverTitle: "Trouvez votre prochain job !",
      neverDesc: "Vous n'avez encore postulé à aucune offre.",
      noActiveTitle: "Aucune candidature en cours",
      noActiveDesc:
        "Vos candidatures retirées ou non retenues restent visibles dans l'historique ci-dessous.",
      bookedTitle: "Aucune mission réservée",
      bookedDesc:
        "Vos missions apparaissent ici dès qu'une entreprise vous sélectionne.",
      completedTitle: "Aucune mission terminée",
      completedDesc:
        "Vos missions confirmées par le code de fin apparaîtront ici.",
    },
    browseJobs: "Parcourir les offres",
    loadError: {
      title: "Connexion impossible",
      desc: "Vos candidatures n'ont pas pu être chargées. Vérifiez votre connexion, puis réessayez.",
      stale:
        "Connexion impossible : affichage du dernier état connu. Vérifiez votre connexion.",
      retry: "Réessayer",
    },
  },

  // Profile
  profile: {
    title: "Profil",
    editProfile: "Modifier le profil",
    availability: "Ma disponibilité",
    availabilityEdit: "Modifier",
    availabilityPage: {
      title: "Disponibilité",
      subtitle:
        "Indiquez les jours et horaires où vous êtes disponible pour travailler.",
      days: {
        monday: "Lundi",
        tuesday: "Mardi",
        wednesday: "Mercredi",
        thursday: "Jeudi",
        friday: "Vendredi",
        saturday: "Samedi",
        sunday: "Dimanche",
      },
      daysShort: {
        monday: "Lun",
        tuesday: "Mar",
        wednesday: "Mer",
        thursday: "Jeu",
        friday: "Ven",
        saturday: "Sam",
        sunday: "Dim",
      },
      from: "De",
      to: "à",
      maxDistance: "Distance maximale acceptée",
      maxDistanceUnit: "km",
      noDaySelected: "Aucun jour sélectionné pour le moment.",
      save: "Enregistrer",
      saving: "Enregistrement…",
      saved: "Disponibilités mises à jour",
      error: "Impossible d'enregistrer. Réessayez.",
      invalidRange: "L'heure de fin doit être après l'heure de début",
      summaryEmpty: "Disponibilité non renseignée",
    },
    myAccount: "Mon compte",
    myLocation: "Ma localisation",
    myDocuments: "Mes documents",
    preferences: "Préférences",
    understandEasyJob: "Comprendre EasyJob",
    informationSection: "Informations",
    personalData: "Données personnelles",
    newsUpdates: "Actualités",
    settings: "Paramètres",
    support: "Support",
    helpSupport: "Aide & Support",
    about: "À propos d'EasyJob",
    language: "Langue",
    notifications: "Notifications",
    notificationCenter: {
      title: "Notifications",
      empty: "Aucune notification pour le moment.",
      loadError: "Impossible de charger les notifications.",
      openLabel: "Notifications ({count} non lues)",
      openLabelEmpty: "Notifications",
      action: "Voir",
      channelsNote:
        "Les préférences par canal (push/SMS/email) ne sont pas encore configurables.",
    },
    darkMode: "Mode sombre",
    essential: {
      title: "Pour pouvoir postuler",
      bannerTitle: "Profil incomplet pour postuler",
      bannerBody:
        "Il vous manque : {missing}. Complétez-les pour être éligible aux offres.",
      cta: "Compléter",
      required: "Requis",
      identity: "Nom, prénom et date de naissance",
      cni: "CNI vérifiée",
      momo: "Mobile Money vérifié",
    },
    photo: {
      modalTitle: "Modifier la photo de profil",
      modalHint:
        "Choisissez une photo récente et claire (JPEG, PNG ou WebP — 5 Mo max).",
      change: "Changer la photo",
    },
    skillsOverview: {
      verifiedLabel: "Vérifiée",
      verifiedHint: "Compétence certifiée par un justificatif",
      editSkills: "Modifier",
    },
    completion: {
      title: "Complétez votre profil",
      subtitle: "Atteignez 60% pour postuler aux missions",
      progress: "complété",
      cta: "Compléter mon profil",
      required60: "60% requis pour postuler",
      essentialsTitle: "Essentiels pour postuler",
      optionalTitle: "Pour renforcer votre profil",
      done: "Fait",
      todo: "À compléter",
      criteria: {
        identity: "Informations personnelles",
        photo: "Photo de profil",
        skills: "Compétences",
        bio: "Expériences passées",
        availability: "Disponibilités",
        location: "Localisation GPS",
        cni: "Carte Nationale d'Identité",
        momo: "Mobile Money vérifié",
        sector: "Secteur d'activité",
        description: "Description de l'entreprise",
        logo: "Logo de l'entreprise",
        address: "Ville et adresse",
        legal: "Numéro RCCM / NIU",
        contact: "Contact principal",
      },
    },
    edit: {
      title: "Modifier mes informations",
      firstName: "Prénom",
      lastName: "Nom",
      birthDate: "Date de naissance",
      city: "Ville",
      quartier: "Quartier",
      bio: "À propos de vous",
      bioHint:
        "Décrivez brièvement votre expérience (plus de 10 caractères pour compter dans votre complétion).",
      addSkills: "Ajouter mes compétences",
      save: "Enregistrer",
      saving: "Enregistrement…",
      saved: "Profil mis à jour",
      error: "Impossible d'enregistrer. Réessayez.",
      firstNameRequired: "Le prénom est requis",
      lastNameRequired: "Le nom est requis",
      birthDateRequired: "La date de naissance est requise",
      ageInvalid: "Vous devez avoir au moins 18 ans",
      birthDateInvalid: "Date de naissance invalide",
      cityRequired: "Sélectionnez une ville",
      unsavedWarning:
        "Des modifications ne sont pas enregistrées. Quitter quand même ?",
      lockedIdentityLabel: "Informations vérifiées",
      lockedIdentityBody:
        "Vos informations d'identité sont vérifiées et ne peuvent être modifiées qu'après une demande de l'administration. Contactez l'admin si la mise à jour est justifiée.",
      lockedDocLabel: "Document vérifié",
      lockedDocBody:
        "Ce document est vérifié et ne peut être remplacé qu'après une demande de l'administration.",
    },
    documents: {
      title: "Documents",
      photo: "Photo de profil",
      cniFront: "CNI recto",
      cniBack: "CNI verso",
      cniSelfie: "Selfie avec la CNI",
      missing: "Manquant",
      uploaded: "Envoyé",
      uploading: "Envoi en cours…",
      pending: "En attente de validation",
      verified: "Validé",
      rejected: "Refusé",
      expired: "Expiré",
      locked: "Modifiable sur demande admin",
      tooLarge: "Fichier trop volumineux (5 Mo maximum)",
      uploadFailed: "L'envoi a échoué. Réessayez.",
    },
    skillDocuments: {
      menuLabel: "Documents et compétences vérifiées",
      title: "Documents et compétences vérifiées",
      subtitle:
        "Justifiez vos compétences avec un diplôme, un certificat ou une attestation pour renforcer la confiance des entreprises.",
      cvCardTitle: "CV",
      cvCardHint:
        "Document général de votre profil, non rattaché à une compétence précise.",
      addCv: "Ajouter mon CV",
      skillsSectionTitle: "Mes compétences",
      noSkills: "Ajoutez d'abord des compétences dans votre profil.",
      status: {
        declared: "Déclarée",
        missing: "Justificatif manquant",
        pending: "Vérification en attente",
        verified: "Vérifiée",
        rejected: "Justificatif rejeté",
        expired: "Justificatif expiré",
      },
      actions: {
        addProof: "Ajouter un justificatif",
        viewStatus: "Voir le statut",
        replace: "Remplacer le document",
        resubmit: "Corriger et renvoyer",
        updateExpired: "Mettre à jour le document expiré",
        delete: "Supprimer",
      },
      delete: "Supprimer le document",
      deleteError: "La suppression a échoué. Réessayez.",
      documentTypes: {
        cv: "CV",
        diplome: "Diplôme",
        certificat: "Certificat professionnel",
        attestation_formation: "Attestation de formation",
        attestation_travail: "Attestation de travail",
        permis_conduire: "Permis de conduire",
        casier_judiciaire: "Casier judiciaire",
        autre: "Autre justificatif",
      },
      form: {
        title: "Ajouter un justificatif",
        documentType: "Type de document",
        documentTitle: "Titre",
        documentTitlePlaceholder: "Ex : BTS Comptabilité",
        titleRequired: "Le titre est requis",
        issuingOrganization: "Organisme émetteur",
        issuingOrganizationOptional: "Organisme émetteur (facultatif)",
        issuedAt: "Date d'obtention",
        expiresAt: "Date d'expiration (si applicable)",
        linkedSkills: "Compétence(s) associée(s)",
        file: "Fichier (PDF, JPEG, PNG ou WebP — 5 Mo maximum)",
        confirmAccurate:
          "Je confirme que les informations fournies sont exactes",
        submit: "Envoyer",
        submitting: "Envoi en cours…",
        cancel: "Annuler",
      },
      afterUpload: "Document envoyé — vérification en attente",
      rejectionReasonLabel: "Motif du refus",
      expiredNotice:
        "Ce document a expiré. Mettez-le à jour pour continuer à postuler aux offres qui l'exigent.",
      deleteConfirm: "Supprimer ce document ?",
      uploadError: "L'envoi a échoué. Vérifiez le fichier et réessayez.",
      tooLarge: "Fichier trop volumineux (5 Mo maximum)",
      unsupportedType:
        "Format non supporté (PDF, JPEG, PNG ou WebP uniquement)",
      selectSkillRequired:
        "Sélectionnez au moins une compétence (sauf CV et permis de conduire)",
    },
    documentsPage: {
      title: "Mes documents",
      subtitle:
        "L'ensemble de vos justificatifs — CV, permis, diplôme et attestations — avec leur statut de vérification.",
      addTitle: "Ajouter un justificatif",
      addHint:
        "Ajoutez et certifiez vos documents depuis la page « Mes compétences ».",
      addCta: "Mes compétences",
      empty: "Aucun document pour l'instant.",
      emptyHint:
        "Ajoutez votre CV, votre permis ou un justificatif depuis « Mes compétences ».",
      issuedAt: "Obtenu le",
      expiresAt: "Expire le",
      view: "Voir",
      viewError: "Impossible de charger cette pièce. Réessayez.",
      download: "Télécharger",
      downloadError: "Impossible de télécharger cette pièce. Réessayez.",
      linkedSkills: "Compétences associées",
      category: "Catégorie : {cat}",
    },
    skills: {
      title: "Mes compétences",
      subtitle:
        "Gérez vos compétences, certifiez-les avec des justificatifs et joignez votre CV et votre permis de conduire.",
      noSkills:
        "Aucune compétence pour l'instant. Ajoutez-en depuis le catalogue ci-dessous.",
      addSection: "Ajouter une compétence",
      searchPlaceholder: "Rechercher une compétence…",
      noSearch: "Aucune compétence trouvée dans le catalogue.",
      otherSkills: "Vos autres compétences",
      catalog: {
        services: "Services et réception",
        vente: "Vente",
        restauration: "Restauration",
        manutention: "Manutention et logistique",
        transport: "Transport et livraison",
        artisanat: "Bâtiment et métiers d'artisan",
        nettoyage: "Nettoyage et entretien",
        securite: "Sécurité",
        events: "Événementiel",
        bureautique: "Bureautique et administration",
        digital: "Digital et informatique",
        beaute: "Beauté",
        soins: "Soins et assistance",
        langues: "Langues",
      },
      confirmTitle: "Certifier cette compétence ?",
      confirmBody:
        "Voulez-vous certifier « {skill} » maintenant avec un justificatif ?",
      confirmNow: "Certifier maintenant",
      confirmLater: "Plus tard",
      deleteSkill: "Supprimer la compétence",
      deleteSkillConfirm: "Supprimer « {skill} » de votre profil ?",
      deleteSkillError: "La suppression a échoué. Réessayez.",
      addError: "L'ajout a échoué. Réessayez.",
      drivingLicenseTitle: "Permis de conduire",
      drivingLicenseHint:
        "Document général de votre profil, utile pour les missions de conduite et de transport.",
      addDrivingLicense: "Ajouter mon permis",
      licenseCategoryLabel: "Catégorie du permis",
      licenseCategoryPlaceholder: "Sélectionnez la catégorie",
      licenseCategories: {
        moto: "Moto",
        voiture: "Voiture",
        fourgon: "Fourgon",
        camion: "Camion",
        bus: "Bus",
        tous_types: "Tous types (permis international)",
      },
      licenseCategoryBadge: "Catégorie : {cat}",
      licenseCategoryRequired:
        "La catégorie du permis est requise pour ajouter ce document.",
      licenseRequiredError:
        "« {skill} » nécessite un permis de conduire vérifié. Ajoutez et faites vérifier votre permis avant d'ajouter cette compétence.",
    },
    geolocation: {
      title: "Localisation précise",
      explain:
        "Utilisée pour calculer votre distance par rapport aux offres. Facultatif : vous pouvez continuer avec juste la ville et le quartier.",
      useMyLocation: "Utiliser ma position",
      locating: "Localisation en cours…",
      /** Affiché sous le bouton si une position est déjà enregistrée :
       *  badge « GPS enregistré » + précision (± X m) — sans chiffres lat/lng,
       *  convention de confidentialité (l'entreprise ne voit jamais le GPS). */
      success: "Position enregistrée",
      recordedBadge: "GPS enregistré",
      precision: "± {m} m",
      /** Indice affiché tant que le GPS n'est PAS encore enregistré :
       *  les navigateurs refusent toute requête GPS sans geste utilisateur. */
      firstPermissionHint:
        "Au premier clic, votre navigateur vous demandera la permission d'accéder à votre localisation — autorisez-la.",
      denied:
        "Permission refusée. Vous pouvez continuer avec la ville et le quartier.",
      unavailable: "Position indisponible sur cet appareil.",
      /** Fix GPS trop lent (code 3 navigateur) : le bouton reste cliquable,
       *  on invite à réessayer ou à saisir manuellement la ville. */
      timeout:
        "La détection de votre position a pris trop de temps. Réessayez, ou saisissez votre ville et votre quartier manuellement.",
      /** T5 : erreur serveur (coordonnées hors bornes -90..90 / -180..180). */
      geoOutOfRange: "Coordonnées géographiques hors bornes.",
      /** T5.1 : message de refus affiché sous le bouton quand la position
       *  détectée est HORS de la zone de service (Douala/Yaoundé). Le
       *  candidat doit continuer avec la saisie manuelle ville + quartier. */
      outOfZone:
        "Votre position est en dehors de Douala et Yaoundé. Sélectionnez votre ville et votre quartier manuellement.",
      /** T5.1 : info affichée quand un fix est accepté DANS la zone — la
       *  ville est auto-posée à la plus proche, le quartier auto-recherché
       *  via OSM Nominatim (1 seule requête). */
      autoFilledFromGps:
        "Ville et quartier complétés depuis votre position GPS.",
      /** T5.1 : échec du reverse geocoding (OSM down, timeout) — le fix est
       *  accepté mais le quartier n'est PAS auto-posé. Le candidat peut le
       *  saisir lui-même. */
      autoFilledFailed:
        "Position enregistrée, mais le quartier n'a pas pu être détecté. Vous pouvez le saisir manuellement.",
      /** T5.1 : clé Zod de la refine `geoOutOfZone` — coordonnées complètes
       *  mais hors de la zone de service. */
      geoOutOfZone:
        "Coordonnées hors des zones servies (Douala / Yaoundé uniquement).",
      /** T5.1 : clé Zod de la refine `cityNotServed` — ville non listée. */
      cityNotServed:
        "Ville non servie par Easyjob (Douala / Yaoundé uniquement).",
    },
    reverification: {
      modalTitle: "Confirmer la modification",
      modalBody:
        "La modification de votre identité (nom ou date de naissance) nécessitera une nouvelle vérification de votre pièce d'identité. Voulez-vous continuer ?",
      confirm: "Confirmer la modification",
      bannerTitle: "Vérification en cours",
      bannerBody:
        "Votre pièce d'identité est en cours de nouvelle vérification suite à une modification de votre identité.",
    },
    profileUpdateRequests: {
      title: "Mise à jour de profil demandée",
      reasonLabel: "Raisons de la demande",
      identity: "Vos informations d'identité",
      cni_documents: "Vos documents CNI",
      start: "Préparer la mise à jour",
      goToEdit: "Ouvrir mes informations",
      goToDocuments: "Ouvrir mes documents",
      hint: "L'admin a déverrouillé ces champs pour une durée limitée. Une fois enregistrés, la vérification repart de zéro.",
      done: "Mise à jour enregistrée. L'examen de votre pièce reprendra après la prochaine vérification.",
      expiredLabel: "Cette demande a été clôturée",
    },
    myProfile: "Mon Profil",
    missionsCompleted: "missions réalisées",
    missionsPosted: "missions publiées",
    statMissions: "Missions",
    statSkills: "Compétences",
    mySkills: "Mes compétences",
    locationLabel: "Localisation",
    sectorLabel: "Secteur d'activité",
    mobileMoney: "Mobile Money",
    paymentPage: {
      title: "Mobile Money",
      subtitle:
        "Vérifié par l'équipe EasyJob. Aucun paiement n'est encore effectué par l'application.",
      provider: "Opérateur",
      number: "Numéro Mobile Money",
      numberPlaceholder: "6XX XXX XXX",
      accountName: "Nom du compte Mobile Money",
      accountNamePlaceholder: "Selon l'immatriculation du compte",
      accountNameHint:
        "Le nom du compte doit correspondre à votre CNI — les comptes au nom d'un tiers ne sont pas acceptés.",
      accountNameOptional: "(facultatif)",
      save: "Enregistrer",
      saving: "Enregistrement…",
      saved: "Mobile Money mis à jour",
      error: "Impossible d'enregistrer. Réessayez.",
      verified: "Vérifié",
      pending: "En attente de vérification",
      notConfigured: "Aucun moyen de paiement configuré",
      edit: "Modifier",
      revalidateNotice:
        "Changer le numéro ou l'opérateur nécessitera une nouvelle vérification.",
      // T6 — validation admin manuelle (la preuve de possession par OTP a
      // été retirée au lancement — décision produit 2026-09-10) + refus.
      rejected: "Refusé",
      rejectedReason: "Motif : {reason}",
      reviewPending:
        "La validation par l'administration peut prendre jusqu'à 24 h. Le nom du compte est confronté à votre nom de CNI.",
      momoProviderInvalid:
        "Opérateur Mobile Money invalide (MTN MoMo ou Orange Money).",
      momoAccountNameTooLong:
        "Le nom du compte Mobile Money est trop long (100 caractères maximum).",
      momoRejectReasonTooShort: "Le motif de refus est trop court.",
      momoRejectReasonRequired:
        "Un motif de refus est requis pour refuser une vérification.",
    },
    security: "Sécurité",
    settingsPage: {
      title: "Paramètres",
      languageSection: "Langue",
      languageHint:
        "Le changement est appliqué immédiatement et conservé après rafraîchissement.",
      systemSection: "Informations sur le système",
      appVersion: "Version de l'application",
      contractSection: "Résilier le contrat",
      contractUnavailable:
        "La résiliation en libre-service n'est pas encore disponible. Contactez le support pour toute demande concernant votre abonnement ou votre compte.",
      deleteSection: "Suppression du compte",
      deleteUnavailable:
        "La demande de suppression de compte n'est pas encore disponible en libre-service : aucune politique de rétention ou d'anonymisation n'est encore définie. Contactez le support pour en faire la demande manuellement.",
      contactSupport: "Contacter le support",
    },
    securityPage: {
      title: "Sécurité du compte",
      subtitle: "Modifiez votre mot de passe de connexion.",
      currentPassword: "Mot de passe actuel",
      newPassword: "Nouveau mot de passe",
      confirmPassword: "Confirmer le nouveau mot de passe",
      save: "Mettre à jour le mot de passe",
      saving: "Mise à jour…",
      saved: "Mot de passe mis à jour",
      errorCurrent: "Mot de passe actuel incorrect",
      errorMismatch: "Les mots de passe ne correspondent pas",
      errorTooShort: "Le mot de passe doit contenir au moins 8 caractères",
      errorGeneric: "Impossible de mettre à jour le mot de passe. Réessayez.",
    },
    helpCenter: "Centre d'aide",
    helpPage: {
      title: "Centre d'aide",
      subtitle:
        "Notre assistant peut répondre à vos questions immédiatement. Touchez la bulle en bas de l'écran pour lui parler.",
    },
    guidePage: {
      title: "Comment fonctionne EasyJob ?",
      items: [
        {
          q: "Comment compléter et faire vérifier mon profil ?",
          a: "Ouvrez Profil > Modifier le profil pour renseigner votre identité, votre photo et vos documents (CNI recto/verso/selfie). Chaque document envoyé passe au statut « en attente » jusqu'à validation par un administrateur, puis « validé » ou « refusé ».",
        },
        {
          q: "Pourquoi un pourcentage minimal est-il requis ?",
          a: "Un profil complété à au moins 60% est nécessaire pour postuler à une offre. Ce seuil garantit que les entreprises reçoivent des candidatures fiables.",
        },
        {
          q: "Comment rechercher une offre ?",
          a: "Depuis l'onglet Offres, utilisez la recherche et les filtres (ville, catégorie) pour trouver les missions qui vous correspondent.",
        },
        {
          q: "Comment postuler ?",
          a: "Ouvrez une offre et appuyez sur Postuler. La candidature est envoyée en un clic, sans message à rédiger.",
        },
        {
          q: "À quoi sert l'onglet Tâches ?",
          a: "C'est votre centre de suivi pour vos missions : signez votre contrat, commencez la mission à partir de 15 minutes avant l'heure prévue, saisissez le code à six chiffres remis par l'entreprise pour confirmer la fin, puis évaluez l'entreprise. Le dépôt d'autres documents (RIB, justificatif étudiant, certificat de travail) et les formations ne sont pas encore disponibles dans l'application.",
        },
        {
          q: "Comment suivre mes candidatures dans Mes Jobs ?",
          a: "L'onglet Mes Jobs regroupe vos candidatures (onglet Candidatures), vos missions réservées et celles terminées.",
        },
        {
          q: "Quels sont les statuts d'une candidature ?",
          a: "En attente, sélectionné, refusé, retiré ou absence non justifiée.",
        },
        {
          q: "Comment gérer mes disponibilités ?",
          a: "Depuis Profil > Ma disponibilité, choisissez vos jours et horaires ainsi que votre distance de déplacement maximale.",
        },
        {
          q: "Comment modifier mes compétences ?",
          a: "Depuis Profil > Modifier le profil, ajoutez ou retirez des compétences dans la section dédiée.",
        },
        {
          q: "Comment modifier ma localisation ?",
          a: "Depuis Profil > Modifier le profil, changez votre ville et quartier, ou utilisez le bouton « Utiliser ma position » avec votre consentement.",
        },
        {
          q: "Comment envoyer et remplacer mes documents ?",
          a: "Depuis Profil > Modifier le profil, section Documents : touchez une pièce pour en envoyer une nouvelle, elle remplace automatiquement l'ancienne.",
        },
        {
          q: "Comment fonctionnent les notifications ?",
          a: "La cloche en haut du profil affiche vos notifications non lues réelles ; touchez-la pour les consulter et les marquer comme lues.",
        },
        {
          q: "Comment fonctionne Mobile Money ?",
          a: "Depuis Profil > Mobile Money, déclarez ou modifiez votre numéro MTN ou Orange. Il est vérifié par l'équipe EasyJob, et un changement de numéro demande une nouvelle vérification. Aucun paiement ni retrait n'est encore effectué par l'application.",
        },
        {
          q: "Quand suis-je payé ?",
          a: "Le montant fixe de la mission, en XAF, figure dans votre contrat. L'entreprise s'engage à vous le régler une fois la fin confirmée par le code. L'application n'effectue pas encore de versement : aucun paiement ni retrait Mobile Money n'y est géré pour l'instant.",
        },
        {
          q: "Comment fonctionne Premium ?",
          a: "Premium est attribué par l'équipe EasyJob, pour une période dont la date de fin est indiquée dans Profil > Mon plan. Aucun paiement n'est effectué dans l'application. Free et Premium suivent les mêmes règles pour postuler et la même réputation.",
        },
        {
          q: "Comment obtenir de l'aide ?",
          a: "Ouvrez le Centre d'aide depuis le menu Profil pour parler à l'assistant.",
        },
        {
          q: "Quelles sont les règles essentielles de sécurité ?",
          a: "Ne partagez jamais votre mot de passe, vérifiez votre identité avant toute modification sensible, et gérez votre mot de passe depuis Profil > Sécurité.",
        },
      ],
    },
    terms: "Conditions d'utilisation",
    termsPage: {
      title: "Conditions d'utilisation",
      pending:
        "Le contenu officiel des conditions générales d'utilisation n'est pas encore publié sur cette page. Il sera ajouté dès sa validation.",
    },
    privacyPage: {
      title: "Politique de confidentialité",
      pending:
        "Le contenu officiel de la politique de confidentialité n'est pas encore publié sur cette page. Il sera ajouté dès sa validation.",
    },
    logout: "Se déconnecter",
    logoutTitle: "Se déconnecter ?",
    logoutDesc: "Êtes-vous sûr de vouloir vous déconnecter ?",
    cancel: "Annuler",

    // ── Statuts & Premium (candidat) ─────────────────────────
    status: {
      candidate: "Candidat",
      candidatePremium: "Candidat Premium",
      company: "Entreprise",
      companyPremium: "Entreprise Premium",
      new: "Nouveau",
    },
    // Lot 17a : plan effectif (Free ou Premium), attribué par l'équipe.
    candidatePlan: {
      title: "Mon plan",
      free: "Free",
      premium: "Premium",
      current: "Votre plan : {plan}",
      until: "Premium jusqu'au {date} (heure de Douala)",
      since: "Depuis le {date}",
      ended: "Premium terminé le {date}",
      granted:
        "Premium est attribué par l'équipe EasyJob. Aucun paiement n'est effectué dans l'application.",
      sameRules:
        "Free et Premium suivent les mêmes règles pour postuler, la même réputation, les mêmes vérifications et le même accès au support et aux contestations.",
      contactSupport: "Contacter le support",
    },
    paymentDelay: {
      title: "Rémunération",
      standard: "Montant fixe en XAF, inscrit dans chaque contrat",
      note: "Réglé par l'entreprise : aucun versement n'est encore effectué par l'application.",
    },

    // ── Statuts & Plans (entreprise) ─────────────────────────
    plan: {
      free: "Gratuit",
      starter: "Starter",
      pro: "Pro",
      business: "Business",
      currentPlan: "Plan actuel",
      expiresOn: "Expire le {date}",
      renews: "Renouvellement le {date}",
      prioritySupport: "Support prioritaire 24/7",
      features: {
        title: "Mon plan",
        jobsLimitFree: "2 offres actives maximum",
        jobsLimitStarter: "5 offres actives",
        jobsLimitPro: "Offres illimitées",
        jobsLimitBusiness: "Offres illimitées",
        urgentPaid: "Options urgentes payantes",
        urgentFree: "Options urgentes incluses",
        aiRecoOff: "Pas de recommandations IA",
        aiRecoOn: "Indicateurs de fiabilité des candidats",
        reportingOff: "Pas de reporting",
        reportingBasic: "Reporting basique",
        reportingAdvanced: "Reporting avancé",
        editOff: "Modification limitée — contactez le support",
        editOn: "Modification directe des offres actives",
      },
    },
    activeJobs: {
      title: "Mes offres publiées",
      used: "{used} publiée(s) sur {total} disponibles",
      unlimited: "Offres illimitées",
      full: "Quota atteint. Passez au plan supérieur pour publier plus.",
    },
    premiumCompanyBenefits: {
      sectionTitle: "Mes avantages",
      expiresOn: "Expire le {date}",
      // ── Plan Free (5 avantages) ──
      jobsUnlimited: {
        title: "Offres illimitées",
        desc: "Publiez autant d'offres que vous voulez, 24h/7j.",
      },
      serviceFee10: {
        title: "Frais de service 10%",
        desc: "Commission transparente, pas de frais cachés.",
      },
      urgentPaid: {
        title: "Option urgente disponible",
        desc: "Boostez une offre pour 2 000 FCFA quand vous en avez besoin.",
      },
      securePayment: {
        title: "Contrat signé",
        desc: "Chaque sélection crée un contrat que vous et le candidat signez dans l'application.",
      },
      historyAccess: {
        title: "Historique complet",
        desc: "Retrouvez vos offres et leurs missions passées.",
      },
      // ── Plan Starter (4 avantages propres) ──
      reducedFee: {
        title: "Frais de service réduits 8%",
        desc: "Économisez 2% sur chaque mission par rapport au Gratuit.",
      },
      urgentReduced: {
        title: "Option urgente réduite",
        desc: "1 000 FCFA au lieu de 2 000 FCFA pour booster vos offres.",
      },
      visibility: {
        title: "Visibilité accrue",
        desc: "Vos offres apparaissent en priorité dans les recherches.",
      },
      standardSupport: {
        title: "Support standard 48h",
        desc: "Une équipe disponible pour vous accompagner sous 48h.",
      },
      // ── Plan Pro (10 avantages) ──
      zeroFee: {
        title: "0% de frais de service",
        desc: "Aucune commission sur vos missions, votre abonnement couvre tout.",
      },
      freeUrgent: {
        title: "Options urgentes illimitées",
        desc: "Boostez toutes vos offres sans frais supplémentaires.",
      },
      aiMatch: {
        title: "Indicateurs de fiabilité",
        desc: "Comparez les candidats grâce à leur note, leurs missions et leurs vérifications.",
      },
      favorites: {
        title: "Liste de favoris",
        desc: "Sauvegardez vos meilleurs candidats pour les retrouver rapidement.",
      },
      directInvite: {
        title: "Invitation directe",
        desc: "Invitez vos favoris sur une mission sans passer par la candidature publique.",
      },
      templates: {
        title: "Modèles d'offres",
        desc: "Créez et réutilisez vos modèles pour publier en 30 secondes.",
      },
      monthlyReport: {
        title: "Rapport mensuel",
        desc: "Suivez vos KPI : temps de remplissage, no-show, satisfaction.",
      },
      pdfExport: {
        title: "Export PDF / Excel",
        desc: "Téléchargez vos données et factures pour votre comptabilité.",
      },
      directEdit: {
        title: "Modification directe",
        desc: "Éditez vos offres publiées à tout moment, sans support.",
      },
      trialFree: {
        title: "Activation par le support",
        desc: "Le plan est activé par l'équipe EasyJob ; le paiement en ligne n'est pas encore disponible.",
      },
      // ── Plan Business (10 avantages) ──
      guaranteedReplacement: {
        title: "Aide en cas d'absence",
        desc: "Si un candidat ne se présente pas, contactez le support. Aucun remplacement automatique n'est proposé.",
      },
      bulkHiring: {
        title: "Recrutement en masse",
        desc: "Embauchez 10+ candidats en une seule action.",
      },
      priorityInvite: {
        title: "Invitations prioritaires",
        desc: "Vos invitations apparaissent en tête des notifications candidats.",
      },
      availabilityAlerts: {
        title: "Alertes disponibilité",
        desc: "Soyez prévenu dès qu'un candidat de votre liste est disponible.",
      },
      presenceDashboard: {
        title: "Tableau de présence",
        desc: "Visualisez en temps réel qui est présent sur vos missions.",
      },
      sectorContracts: {
        title: "Contrats sectoriels",
        desc: "Modèles juridiques validés par secteur (BTP, événementiel, etc.).",
      },
      advancedReporting: {
        title: "Reporting avancé",
        desc: "Analytics multi-dimensionnels et comparaisons inter-équipes.",
      },
      dedicatedManager: {
        title: "Account Manager dédié",
        desc: "Un interlocuteur unique, SLA 4h, suivi stratégique mensuel.",
      },
      prioritySLA: {
        title: "SLA prioritaire",
        desc: "Support 24/7, traitement de vos tickets sous 1h.",
      },
      immediateModeration: {
        title: "Modération immédiate",
        desc: "Vos offres sont validées en moins de 30 minutes.",
      },
      // ── Pénalités d'annulation ──
      cancellationPenalty: {
        label: "Annulation :",
        freeStarter:
          "aucune somme n'est bloquée ni retenue par l'application. Contactez le support avant d'annuler une mission engagée.",
        pro: "aucune somme n'est bloquée ni retenue par l'application. Contactez le support avant d'annuler une mission engagée.",
        business:
          "aucune somme n'est bloquée ni retenue par l'application. Contactez le support avant d'annuler une mission engagée.",
      },
    },
    upgradeBanner: {
      title: "Vos concurrents recrutent plus vite",
      tagline:
        "0 % de frais de service, options urgentes incluses et modification directe des offres actives.",
      taglineStarter:
        "Passez au Pro : offres illimitées et modification directe.",
      // Labels courts dans les lignes de plan
      starter: "Starter",
      starterKicker:
        "Frais réduits à 8% · Urgentes à 1 000 FCFA · Visibilité accrue",
      pro: "Pro",
      proKicker:
        "0 % de frais · Options urgentes · Favoris · Modèles · Rapport",
      business: "Business",
      businessKicker: "Tout Pro · Manager dédié · Support prioritaire",
      // Badges & CTA
      recommended: "Recommandé",
      cta: "Changer de plan avec le support",
      ctaNote: "Le changement de plan est effectué par l'équipe EasyJob.",
      businessCta: "Demander l'offre Business",
    },

    // ── Showcase Premium Entreprise ─────────────────────────
    premiumCompany: {
      sectionLabel: "Votre avantage stratégique",
      headlineStarter: "Recrutez plus vite. Sans limite.",
      headlinePro: "Publiez sans limite, modifiez en direct.",
      headlineBusiness: "Le sur-mesure pour les grandes équipes.",
      taglineStarter:
        "5 offres simultanées, options urgentes incluses, modification directe.",
      taglinePro:
        "Offres illimitées, options urgentes incluses, modification directe.",
      taglineBusiness:
        "Account manager dédié, SLA garanti, branding, multi-utilisateurs, reporting avancé.",
      metrics: {
        timeToHire: { value: "−45%", label: "Temps de recrutement" },
        compliance: { value: "100%", label: "Conformité contractuelle" },
        retention: { value: "×2", label: "Rétention talents fiables" },
      },
      pillars: {
        control: {
          title: "Contrôle total",
          desc: "Modification instantanée de vos offres actives, sans passer par le support.",
        },
        security: {
          title: "Sécurité renforcée",
          desc: "Candidats vérifiés CNI prioritaires + contrats signés et archivés.",
        },
        aiTalent: {
          title: "Indicateurs de fiabilité",
          desc: "Note, missions réalisées et vérifications de chaque candidat.",
        },
        reporting: {
          title: "Reporting & Analytics",
          desc: "Suivez vos KPI temps réel : taux de remplissage, no-show, satisfaction.",
        },
        accountManager: {
          title: "Account Manager dédié",
          desc: "Un interlocuteur unique, SLA 4h, accompagnement stratégique mensuel.",
        },
        branding: {
          title: "Branding entreprise",
          desc: "Vos offres avec votre logo, vos couleurs, votre voix.",
        },
        team: {
          title: "Comptes multi-utilisateurs",
          desc: "Donnez accès à toute votre équipe RH avec des permissions granulaires.",
        },
      },
      socialProof:
        "12 grandes entreprises camerounaises nous font déjà confiance",
      manageButton: "Gérer mon abonnement",
      upgradePlan: "Évoluer vers {plan}",
    },
  },

  // Days
  companyOnboarding: {
    sizeLabel: "Taille de l'entreprise",
    sizes: {
      tpe: "TPE",
      pme: "PME",
      eti: "ETI",
      ge: "Grande entreprise",
    },
    niuLabel: "NIU (numéro d'identifiant unique)",
    niuHint: "Saisi à l'inscription. Pour le modifier, contactez le support.",
    rccmFileHint: "PDF, JPG, PNG ou WebP — 5 Mo maximum",
    niuDocumentLabel: "Attestation d'immatriculation (NIU)",
    niuDocumentHint:
      "Délivrée par la DGI au nom de l'entreprise. PDF, JPG, PNG ou WebP, 5 Mo maximum.",
    representativeSection: "Représentant de l'entreprise",
    representativeHint:
      "La personne qui agit au nom de l'entreprise sur EasyJob. L'équipe EasyJob vérifie son identité et son habilitation.",
    representativeNameLabel: "Nom complet",
    representativeTitleLabel: "Fonction (ex. : gérant)",
    authorityLabel: "Habilitation",
    authority: {
      listed_officer: "Dirigeant mentionné au RCCM",
      mandate: "Mandat signé par l'entreprise",
    },
    idDocumentLabel: "Pièce d'identité (CNI ou passeport)",
    mandateLabel: "Mandat de l'entreprise",
    fileSaved: "Fichier enregistré. Choisissez-en un autre pour le remplacer.",
    chooseFile: "Cliquez pour choisir un fichier",
    rccmFileSaved:
      "Un document est déjà enregistré. Choisissez un fichier pour le remplacer.",
    saveError: "Vos informations n'ont pas pu être enregistrées.",
    verifiedNotice:
      "Votre entreprise est vérifiée. Modifier le nom, le RCCM ou le document RCCM relancera la vérification : vous ne pourrez plus publier d'offre jusqu'à la nouvelle validation.",
    errors: {
      companyNameTooShort: "Nom trop court.",
      companyNameTooLong: "Nom trop long (100 caractères maximum).",
      sectorRequired: "Choisissez un type d'activité.",
      companySizeRequired: "Choisissez la taille de l'entreprise.",
      websiteInvalid: "Site web invalide : il doit commencer par https://",
      descriptionTooLong: "Description trop longue (1000 caractères maximum).",
      rccmRequired: "Le numéro RCCM est obligatoire.",
      rccmTooLong: "Numéro RCCM trop long (50 caractères maximum).",
      cityRequired: "Choisissez une ville.",
      quartierRequired: "Le quartier est obligatoire.",
      quartierTooLong: "Quartier trop long (100 caractères maximum).",
      addressRequired: "L'adresse est obligatoire.",
      addressTooLong: "Adresse trop longue (200 caractères maximum).",
      file_too_large: "Fichier trop volumineux (5 Mo maximum).",
      file_type: "Format non accepté : PDF, JPG, PNG ou WebP.",
      upload_failed: "Le document n'a pas pu être envoyé.",
      profile_not_found: "Profil entreprise introuvable. Contactez le support.",
      account_suspended: "Votre compte est suspendu.",
      unauthorized: "Session expirée. Veuillez vous reconnecter.",
      representativeNameTooLong: "Nom trop long (100 caractères maximum).",
      representativeTitleTooLong:
        "Fonction trop longue (100 caractères maximum).",
      submit_failed: "Le dossier n'a pas pu être envoyé. Réessayez.",
    },
  },

  companyVerification: {
    title: "Vérification de l'entreprise",
    states: {
      incomplete: {
        title: "Dossier incomplet",
        body: "Ajoutez les pièces manquantes, puis envoyez le dossier à l'équipe EasyJob.",
      },
      in_review: {
        title: "Dossier en cours d'examen",
        body: "L'équipe EasyJob contrôle votre RCCM, votre NIU et votre représentant. Vous pourrez publier des offres dès la vérification du dossier.",
      },
      correction: {
        title: "Correction demandée",
        body: "Corrigez l'élément signalé, remplacez le document si besoin, puis soumettez le dossier à nouveau.",
      },
      verified: {
        title: "Dossier vérifié par EasyJob",
        body: "Votre dossier entreprise est vérifié par EasyJob : vous pouvez publier des offres.",
      },
    },
    reasonLabel: "Motif",
    submittedOn: "Envoyé le {date}",
    reviewedOn: "Décision du {date}",
    complete: "Compléter mon dossier",
    correct: "Corriger mon dossier",
    checks: {
      rccm: "RCCM",
      niu: "NIU",
      representative: "Représentant",
    },
    checkStatus: {
      approved: "Vérifié",
      rejected: "À corriger",
      pending: "En attente",
    },
    missingTitle: "Pièces manquantes",
    pieces: {
      rccm_number: "Numéro RCCM",
      rccm_document: "Document RCCM",
      niu_number: "NIU (contactez le support)",
      niu_document: "Attestation NIU",
      representative_name: "Nom du représentant",
      representative_title: "Fonction du représentant",
      representative_authority: "Habilitation du représentant",
      representative_id_document: "Pièce d'identité du représentant",
      mandate_document: "Mandat de l'entreprise",
    },
    jobEntryHint:
      "Vous pourrez publier dès que votre dossier sera vérifié par EasyJob.",
    offersHidden:
      "Tant que le dossier n'est pas vérifié, vos offres actives sont masquées aux nouveaux candidats et aucune nouvelle candidature ni sélection n'est possible. Les candidatures, contrats et missions en cours continuent.",
    submitButton: "Envoyer mon dossier",
    resubmitButton: "Soumettre à nouveau",
    saveButton: "Enregistrer",
    outcomes: {
      submitted: "Dossier envoyé à l'équipe EasyJob.",
      resubmitted: "Dossier soumis à nouveau.",
      already_pending:
        "Informations enregistrées. Votre dossier reste en cours d'examen.",
      already_verified: "Informations enregistrées.",
      dossier_incomplete:
        "Informations enregistrées. Ajoutez les pièces manquantes pour envoyer votre dossier.",
      nothing_changed:
        "Modifiez l'élément signalé (raison sociale, RCCM, attestation NIU ou représentant) avant de soumettre à nouveau.",
    },
    errors: {
      not_authenticated: "Session expirée. Veuillez vous reconnecter.",
      not_a_company: "Action réservée aux entreprises.",
      account_suspended: "Ce compte est suspendu.",
      company_not_found: "Entreprise introuvable.",
      forbidden: "Votre grade ne permet pas cette décision.",
      invalid_action: "Action invalide.",
      reason_required: "Indiquez un motif d'au moins 10 caractères.",
      reason_too_long: "Motif trop long (500 caractères maximum).",
      company_not_pending: "Ce dossier a déjà été traité.",
      dossier_not_submitted: "Ce dossier n'a pas encore été soumis.",
      company_changed: "Le dossier a changé : relisez-le avant de décider.",
      dossier_incomplete: "Dossier incomplet : des pièces manquent.",
      nothing_changed:
        "Modifiez l'élément signalé avant de soumettre à nouveau.",
      submit_failed: "Le dossier n'a pas pu être envoyé. Réessayez.",
      invalid_check: "Contrôle inconnu.",
      source_required: "Choisissez la source officielle consultée.",
      reference_required:
        "Indiquez une référence ou une note interne (3 caractères minimum).",
      reference_too_long: "Note trop longue (300 caractères maximum).",
      check_changed:
        "Ce contrôle a été modifié entre-temps : relisez le dossier.",
      checks_incomplete:
        "Les trois contrôles doivent être validés sur la version actuelle.",
      company_review_failed: "La décision n'a pas pu être enregistrée.",
      generic: "Une erreur est survenue. Réessayez.",
    },
  },

  companyJobs: {
    title: "Mes offres",
    total: { one: "{count} offre au total", other: "{count} offres au total" },
    newJob: "Nouvelle offre",
    createJob: "Créer une offre",
    tabs: {
      active: "Actives ({count})",
      draft: "Brouillons ({count})",
      closed: "Terminées ({count})",
    },
    empty: {
      activeTitle: "Aucune offre active",
      activeDesc: "Publiez une nouvelle offre pour trouver des candidats",
      draftTitle: "Aucun brouillon",
      draftDesc: "Vos brouillons d'offres apparaîtront ici",
      closedTitle: "Aucune offre terminée",
      closedDesc: "Les offres terminées apparaîtront ici",
    },
    status: {
      active: "Publiée",
      pending_review: "En modération",
      draft: "Brouillon",
      filled: "Pourvue",
      expired: "Expirée",
      rejected: "Refusée",
      cancelled: "Annulée",
    },
    urgent: "Urgent",
    applications: { one: "candidature", other: "candidatures" },
    positions: { one: "/{count} poste", other: "/{count} postes" },
    rejectionReason: "Motif du refus : {reason}",
    rejectedNext:
      "Modifiez l'offre pour corriger ce point : elle repassera en vérification.",
    lockedPlan:
      "Offre publiée : la modification directe est réservée aux plans Pro et Business. Contactez le support.",
    actions: {
      viewApplications: "Voir les candidatures",
      edit: "Modifier",
      delete: "Supprimer",
    },
    deleteDialog: {
      title: "Supprimer cette offre ?",
      description:
        "Cette action est irréversible. Toutes les candidatures associées seront également supprimées.",
      cancel: "Annuler",
      confirm: "Supprimer",
      deleting: "Suppression...",
    },
    toasts: {
      createdTitle: "Offre créée",
      createdDesc: "Votre offre a été soumise pour modération.",
      updatedTitle: "Offre modifiée",
      updatedDesc:
        "Votre offre a été soumise à nouveau. Elle sera visible après validation.",
      deletedTitle: "Offre supprimée",
      deletedDesc: "L'offre a été supprimée avec succès.",
      deleteErrorTitle: "Erreur",
      deleteErrorDesc: "Impossible de supprimer l'offre.",
    },
    form: {
      editTitle: "Modifier l'offre",
      submitEdit: "Soumettre à nouveau",
      editNotice:
        "Après modification, l'offre repasse en modération : elle n'est plus visible par les candidats jusqu'à la nouvelle validation.",
      // Lot 11b : règle de lancement, horaires figés après publication.
      scheduleLocked:
        "Offre déjà publiée : les dates, les journées et les horaires ne peuvent plus être modifiés (ni ajout ni retrait de journée). Les autres informations restent modifiables. Pour déplacer la mission, créez une nouvelle offre : elle sera de nouveau modérée, et l'offre actuelle et ses candidatures sont conservées.",
      scheduleLockedAction: "Créer une nouvelle offre",
      errorTitle: "Offre non enregistrée",
    },
    errors: {
      titleRequired: "Le titre est obligatoire.",
      titleTooLong: "Titre trop long (120 caractères maximum).",
      descriptionRequired: "La description est obligatoire.",
      descriptionTooLong: "Description trop longue (5000 caractères maximum).",
      addressRequired:
        "Adresse manquante : complétez l'adresse de votre entreprise.",
      addressTooLong: "Adresse trop longue (200 caractères maximum).",
      cityRequired:
        "Ville manquante : complétez le profil de votre entreprise.",
      startDatePast: "La date de début ne peut pas être passée.",
      endDateBeforeStart: "La date de fin doit suivre la date de début.",
      missionPayRequired:
        "Indiquez la rémunération par candidat pour la mission.",
      missionPayInvalid:
        "La rémunération par candidat doit être supérieure à 0 F CFA.",
      missionPayInteger:
        "La rémunération par candidat doit être un nombre entier de F CFA.",
      missionPayTooHigh: "Rémunération par candidat trop élevée.",
      positionsInvalid:
        "Nombre de postes invalide (au moins 1, et pas moins que les candidats déjà sélectionnés).",
      invalid_job_data: "Certaines informations de l'offre sont invalides.",
      not_authenticated: "Session expirée. Veuillez vous reconnecter.",
      not_a_company: "Seules les entreprises peuvent publier des offres.",
      account_suspended: "Votre compte est suspendu.",
      company_not_found:
        "Profil entreprise introuvable. Terminez votre inscription.",
      company_not_verified:
        "Votre entreprise n'est pas encore vérifiée : vous pourrez publier des offres après la validation de votre dossier par EasyJob.",
      job_not_found: "Offre introuvable.",
      job_locked_plan:
        "Offre publiée : la modification directe est réservée aux plans Pro et Business. Contactez le support.",
      job_has_selected_candidates:
        "Des candidats sont déjà sélectionnés : contactez le support pour modifier cette offre.",
      job_not_editable: "Cette offre ne peut plus être modifiée.",
      job_has_commitments:
        "Suppression impossible : des candidats sont sélectionnés ou une mission est engagée sur cette offre. Contactez le support.",
      daysRequired: "Ajoutez au moins une date de travail.",
      daysTooMany: "31 journées au maximum par offre.",
      daysDuplicate: "Chaque date ne peut figurer qu'une fois.",
      daysTime: "L'heure de fin doit différer de l'heure de début.",
      daysOverlap:
        "Deux journées se chevauchent : vérifiez les horaires de nuit qui se terminent le lendemain.",
      daysInvalid: "Certaines journées sont invalides.",
      dayPayRequired: "Indiquez un montant entier positif pour chaque journée.",
      job_days_missing:
        "Cette offre n'a pas de dates de travail précises : indiquez chaque journée avant de la soumettre.",
      job_start_too_close:
        "Début trop proche ou passé : publiez l'offre plus de 24 h avant son début, ou au moins 4 h avant pour une publication urgente.",
      job_schedule_locked:
        "Offre déjà publiée : sa date et ses horaires ne peuvent plus être modifiés. Pour déplacer la mission, créez une nouvelle offre.",
      generic: "L'offre n'a pas pu être enregistrée. Réessayez.",
    },
  },

  companyApplicants: {
    back: "Retour",
    jobNotFound: "Offre non trouvée",
    applications: { one: "candidature", other: "candidatures" },
    positionsFilled: {
      one: "/{count} poste pourvu",
      other: "/{count} postes pourvus",
    },
    tabs: {
      pending: "En attente ({count})",
      selected: "Sélectionnées ({count})",
      rejected: "Rejetées ({count})",
    },
    status: {
      pending: "En attente",
      selected: "Sélectionnée",
      rejected: "Rejetée",
      withdrawn: "Retirée",
      no_show: "Absent",
    },
    empty: "Aucune candidature dans cette catégorie",
    distance: "{km} km",
    missions: "{count} missions",
    completion: {
      title: "Code de fin",
      instruction:
        "En fin de mission, communiquez ce code au candidat s'il est présent et a effectué le travail. C'est la seule action demandée.",
      dispute: "En cas de litige :",
      support: "Contacter le support",
      notStarted: "Début non confirmé",
      startedAt: "Début confirmé à {time}",
      completedAt: "Réalisée à {time} (code utilisé)",
      // Lot 15 : journée confirmée par le support après votre confirmation.
      completedBySupportAt:
        "Confirmée par le support à {time}, après votre confirmation",
      completedByDecisionAt:
        "Confirmée à {time} par décision du support, après instruction du dossier",
      scheduled: "Prévue de {start} à {end}",
      rate: "Noter le candidat (facultatif)",
      rated: "Vous avez noté ce candidat.",
    },
    actions: {
      select: "Voir le contrat proposé",
      reject: "Rejeter",
      contact: "Contacter",
      contract: "Contrat",
    },
    // Lot 13 : signature de l'entreprise attendue (contrat créé avant).
    contractToSign: "Votre signature est attendue",
    contractSigned: "Signé par vous",
    cancel: "Annuler",
    processing: "Traitement...",
    // Lot 13 : aperçu du contrat proposé, signé à la sélection.
    selectDialog: {
      title: "Contrat proposé",
      description:
        "Lisez le contrat proposé à {name} avant de le signer. Rien n'est enregistré tant que vous n'avez pas signé.",
      candidate: "Candidat concerné",
      notice:
        "En signant, vous sélectionnez ce candidat : la mission, ses codes de fin et le contrat sont créés, et le candidat est notifié pour signer à son tour.",
      closeNotice:
        "Fermer cet aperçu laisse la candidature en attente et la place disponible.",
      loading: "Préparation du contrat…",
      changed:
        "Les conditions du contrat ont changé depuis votre lecture (offre modifiée ou clauses mises à jour). Relisez le contrat ci-dessous avant de signer.",
      consentHint:
        "Cochez la case d'acceptation en fin de contrat pour signer.",
      confirm: "Signer et sélectionner",
      close: "Fermer",
    },
    rejectDialog: {
      title: "Rejeter la candidature",
      description: "Rejeter la candidature de {name} ?",
      placeholder: "Raison du rejet (optionnel)",
      confirm: "Rejeter",
    },
    toasts: {
      selectedTitle: "Candidat sélectionné",
      selectedDesc:
        "Votre signature est enregistrée. La mission et le contrat ont été créés, et le candidat a été notifié pour signer à son tour.",
      rejectedTitle: "Candidature rejetée",
      rejectedDesc:
        "La candidature a été rejetée et le candidat la voit comme non retenue.",
      rejectError:
        "Impossible de rejeter cette candidature. La liste a été actualisée : vérifiez son état, puis réessayez.",
      errorTitle: "Erreur",
    },
    errors: {
      not_authenticated: "Session expirée. Veuillez vous reconnecter.",
      not_a_company:
        "Seules les entreprises peuvent sélectionner des candidats.",
      account_suspended:
        "Votre compte est suspendu : contactez le support pour le réactiver.",
      company_not_found: "Profil entreprise introuvable.",
      application_not_found: "Candidature introuvable.",
      application_not_selectable:
        "Cette candidature ne peut plus être sélectionnée (retirée ou refusée). Choisissez un autre candidat.",
      company_not_verified:
        "Votre dossier entreprise doit être vérifié par EasyJob pour sélectionner un candidat.",
      job_not_available:
        "Cette offre n'est plus publiée : elle doit l'être pour sélectionner un candidat.",
      recruitment_closed:
        "Recrutement clos : l'échéance de cette offre est passée (24 h avant le début, ou 2 h si elle a été publiée en urgence). Les candidats déjà sélectionnés gardent leur mission.",
      no_positions:
        "Toutes les places de cette offre sont pourvues : aucune autre sélection n'est possible.",
      candidate_unavailable:
        "Ce candidat n'est plus disponible. Choisissez un autre candidat.",
      candidate_schedule_conflict:
        "Ce candidat a déjà un engagement incompatible avec ces horaires (chevauchement ou moins de 3 h d'écart). Choisissez un autre candidat.",
      job_days_missing:
        "Cette offre n'a pas de dates de travail précises : aucune sélection n'est possible.",
      selection_incomplete:
        "Sélection enregistrée sans mission ou contrat. Contactez le support.",
      terms_mismatch:
        "Les conditions du contrat ont changé depuis votre lecture : rien n'a été signé ni enregistré. Relisez le contrat mis à jour.",
      consent_required: "Cochez la case d'acceptation pour signer.",
      preview: "Le contrat proposé n'a pas pu être préparé. Réessayez.",
      generic: "La sélection n'a pas pu être enregistrée. Réessayez.",
      network:
        "Connexion impossible : la sélection n'a pas été envoyée. Vérifiez votre connexion, puis réessayez.",
    },
  },

  // Mission, tâches, code de fin et évaluations (lot 7c)
  mission: {
    back: "Retour",
    notFound: "Mission introuvable ou inaccessible.",
    loadError: "La mission n'a pas pu être chargée.",
    retry: "Réessayer",
    // Lot 13 : état de la mission, distinct de la signature du contrat.
    statusLabel: "Mission : {status}",
    status: {
      pending: "Prévue",
      confirmed: "Confirmée",
      en_route: "En route",
      arrived: "Arrivé",
      in_progress: "En cours",
      completed: "Réalisée",
      validated: "Réalisée",
      cancelled: "Annulée",
      no_show: "Absent",
      disputed: "En litige",
    },
    details: "Détails de la mission",
    today: "Aujourd'hui",
    schedule: "{start} – {end} (heure de Douala)",
    scheduleNote:
      "Horaires prévus par l'offre. La rémunération convenue ne dépend pas de la durée.",
    tracking: "Suivi",
    startedAt: "Début confirmé à {time}",
    completedAt: "Réalisation confirmée à {time}",
    notStarted: "Pas encore commencée",
    goToTasks: "Voir mes tâches",
    tasks: {
      title: "Mes tâches",
      empty: "Aucune tâche pour le moment.",
      sign: "Signer mon contrat",
      signHint: "Vous pouvez signer avant, pendant ou après la mission.",
      signAfterReview:
        "Merci pour votre note. Il vous reste à signer votre contrat.",
      start: "Commencer la mission",
      startHint: "Début prévu à {time}",
      startAvailableAt: "Disponible à {time}",
      startConfirmTitle: "Commencer la mission",
      startConfirmDescription:
        "Confirmez que vous commencez « {job} ». L'heure est enregistrée par EasyJob.",
      startConfirm: "Je commence",
      starting: "Enregistrement…",
      startReminderTitle: "C'est bientôt l'heure",
      startReminder: "Vous pouvez commencer « {job} ».",
      inProgress: "En cours – fin prévue à {time}",
      finish: "Fin de mission",
      finishHint:
        "Demandez à l'entreprise votre code de fin, puis saisissez-le.",
      validate: "Valider",
      // Lot 15 : saisie du code à la fin prévue de chaque journée.
      validateDay: "Valider ma journée",
      validateDayHint: "Saisissez le code de fin remis par l'entreprise.",
      completionAvailableAt: "Validation possible à partir de {time}",
      contactSupport: "Contacter le support",
      contactSupportHint:
        "Code non remis ? Le support vérifie auprès de l'entreprise.",
      openCase: "Voir mon dossier",
      endReminderTitle: "Heure de fin",
      endReminder:
        "« {job} » se termine : saisissez le code remis par l'entreprise.",
      review: "Noter l'entreprise",
      reviewHint: "Votre note est obligatoire.",
      startedToast: "Début confirmé",
      startedAt: "Enregistré à {time}.",
      cancel: "Annuler",
    },
    code: {
      title: "Code de fin",
      description:
        "Saisissez le code à six chiffres que l'entreprise vous a remis à la fin de « {job} ».",
      label: "Code de fin",
      submit: "Valider le code",
      submitting: "Vérification…",
      close: "Fermer",
      invalid: {
        one: "Code incorrect. Il vous reste {count} essai.",
        other: "Code incorrect. Il vous reste {count} essais.",
      },
      locked: "Trop d'essais. Réessayez à partir de {time}.",
      format: "Le code comporte six chiffres.",
      successTitle: "Mission réalisée",
      successAt: "Réalisation confirmée à {time}.",
    },
    review: {
      companyTitle: "Notez l'entreprise",
      companyDescription:
        "Comment s'est passée votre mission avec {name} ? Votre note est obligatoire.",
      candidateTitle: "Notez le candidat",
      candidateDescription:
        "Évaluation facultative de {name} pour cette mission.",
      placeholder: "Laissez un commentaire (optionnel)",
      send: "Envoyer ma note",
      sending: "Envoi…",
      thanks: "Merci pour votre note",
      later: "Plus tard",
      star: "{count} étoile(s) sur 5",
      reasonsTitle: "Qu'est-ce qui n'a pas convenu ?",
      reasonsRequired: "Choisissez au moins un motif.",
      reasonsOptional: "Facultatif pour une note de 3.",
      commentPrivate:
        "Votre commentaire n'est jamais publié : seule l'équipe EasyJob le lit.",
    },
    errors: {
      not_authenticated: "Session expirée. Veuillez vous reconnecter.",
      account_suspended: "Votre compte est suspendu.",
      mission_not_found: "Mission introuvable ou inaccessible.",
      mission_not_active: "Cette mission n'est plus active.",
      day_cancelled: "Cette journée a été annulée.",
      interruption_pending:
        "Une interruption est en examen : le fondateur doit d'abord se prononcer.",
      settlement_not_accepted:
        "Aucun accord valide des deux parties : le code ne peut pas encore être reçu.",
      interruption_unresolved:
        "Désaccord non résolu sur cette journée : le code ne la confirme pas.",
      too_early: "La mission pourra commencer à partir de {time}.",
      not_started: "Confirmez d'abord le début de la mission.",
      completion_not_open:
        "Vous pourrez valider cette journée à partir de {time}.",
      code_unavailable:
        "Aucun code n'est disponible pour cette mission. Contactez le support.",
      mission_not_completed: "La mission n'est pas encore réalisée.",
      rating_invalid: "Choisissez une note de 1 à 5 étoiles.",
      comment_too_long: "Commentaire trop long (1000 caractères maximum).",
      reasons_required:
        "Pour une note inférieure à 3, choisissez au moins un motif.",
      reasons_invalid: "Motif non valable pour cette évaluation.",
      generic: "L'action n'a pas pu être confirmée. Réessayez.",
    },
  },

  // Signalements de mission par journée (lot 14)
  incidents: {
    title: "Signalements",
    report: "Signaler",
    reportTitle: "Signaler un incident",
    reportFor: "Journée concernée",
    mission: "Mission",
    day: "Journée",
    chooseKind: "Que voulez-vous signaler ?",
    kinds: {
      late: "Retard",
      absence: "Absence",
      code_not_received: "Code de fin non remis",
      interruption: "Interruption de la journée",
    },
    hints: {
      candidate: {
        late: "Prévenez d'un retard, ou signalez un retard déjà passé.",
        absence: "Prévenez que vous ne pourrez pas venir ce jour-là.",
        code_not_received:
          "Vous avez effectué le travail, mais l'entreprise ne vous a pas remis le code de fin.",
        interruption:
          "La journée commencée s'est arrêtée avant la fin prévue : le support instruit.",
      },
      company: {
        late: "Le candidat est arrivé en retard ce jour-là.",
        absence: "Le candidat ne s'est pas présenté ce jour-là.",
        code_not_received: "",
        interruption:
          "La journée commencée s'est arrêtée avant la fin prévue : le support instruit.",
      },
    },
    statement: "Votre déclaration",
    statementHint:
      "10 caractères au moins. Elle est visible par l'autre partie et par le support.",
    lateMinutes: "Retard (minutes, facultatif)",
    evidence: "Justificatif (facultatif)",
    evidenceHint:
      "Image ou PDF, 5 Mo au plus. Seul le support EasyJob peut l'ouvrir.",
    noConsequence:
      "Le support examine le signalement. Il ne modifie ni les autres journées, ni le contrat. Pour un code non remis, il peut confirmer la journée après confirmation de l'entreprise.",
    confirm: "Envoyer le signalement",
    sending: "Envoi…",
    cancel: "Annuler",
    status: {
      open: "En attente de la version de l'autre partie",
      answered: "Versions des deux parties reçues",
      decided: "Examiné par le support",
      closed: "Clos : journée confirmée",
    },
    reportedBy: {
      candidate: "Signalé par le candidat",
      company: "Signalé par l'entreprise",
    },
    party: { candidate: "Candidat", company: "Entreprise" },
    you: "vous",
    lateDeclared: "Retard déclaré : {min} min",
    evidenceCount: {
      one: "{count} justificatif transmis au support",
      other: "{count} justificatifs transmis au support",
    },
    giveVersion: "Donner ma version",
    addToVersion: "Compléter ma version",
    sendVersion: "Envoyer",
    addEvidence: "Joindre un justificatif",
    outcome: {
      established: "Fait établi par le support",
      not_established: "Fait non établi par le support",
    },
    decisionNote: "Motif du support : {note}",
    // Lot 15 : journée confirmée par le support (motif interne).
    resolution: {
      support_confirmed_day:
        "Journée confirmée par le support après confirmation de l'entreprise.",
    },
    decisionScope:
      "Cette décision enregistre le fait. Elle ne modifie ni la journée, ni le contrat, ni la réputation.",
    toasts: {
      reported: "Signalement envoyé",
      alreadyReported:
        "Ce signalement existait déjà : il n'a pas été envoyé une seconde fois.",
      caseSent: "Votre dossier est transmis au support",
      caseExists: "Votre dossier existe déjà : le support l'a reçu.",
      statementSent: "Version envoyée",
      evidenceSent: "Justificatif transmis au support",
      errorTitle: "Action non enregistrée",
    },
    errors: {
      day_cancelled: "Cette journée a été annulée par le candidat.",
      interruption_pending:
        "Une interruption est en cours d'instruction sur cette journée.",
      settlement_pending:
        "Un règlement partiel est en cours sur cette journée.",
      response_deadline_passed:
        "Le délai de 72 h est dépassé : cette réponse n'est plus recevable. Vous pouvez ajouter un nouvel élément pour examen.",
      use_founder_decision:
        "Une interruption se décide par le fondateur seul, depuis sa carte dédiée.",
      interruption_cause_invalid: "Choisissez la cause de l'interruption.",
      work_done_invalid:
        "Décrivez le travail effectué (10 caractères au moins).",
      declared_time_invalid:
        "L'heure doit se situer entre le début de la journée et maintenant.",
      not_authenticated: "Session expirée. Veuillez vous reconnecter.",
      account_suspended: "Votre compte est suspendu.",
      forbidden: "Action réservée au support habilité.",
      mission_not_found: "Mission introuvable ou inaccessible.",
      incident_not_found: "Signalement introuvable ou inaccessible.",
      evidence_not_found: "Justificatif introuvable.",
      incident_kind_invalid: "Ce type de signalement n'est pas disponible.",
      statement_invalid: "La déclaration doit compter de 10 à 2000 caractères.",
      late_minutes_invalid: "Indiquez un retard de 1 à 720 minutes.",
      outcome_invalid: "Choisissez une décision.",
      note_invalid: "Le motif doit compter de 10 à 2000 caractères.",
      evidence_invalid: "Fichier refusé : image (JPEG, PNG, WebP) ou PDF.",
      evidence_too_large: "Fichier trop lourd (5 Mo au plus).",
      mission_not_active: "Cette mission n'est plus active.",
      day_already_confirmed:
        "Cette journée est déjà confirmée : une absence ou un code non remis ne peuvent plus être signalés.",
      day_not_ended:
        "Possible à partir de la fin prévue de la journée, si l'entreprise ne vous a pas remis le code.",
      start_not_confirmed: "Confirmez d'abord le début de cette journée.",
      use_day_confirmation:
        "Un code non remis se traite par la confirmation de la journée.",
      company_confirmation_required:
        "Consignez d'abord la confirmation de l'entreprise (réponse « travail confirmé »).",
      contact_invalid: "Contact incomplet ou non valable.",
      contact_date_invalid:
        "Date du contact non valable (entre le début de la journée et maintenant).",
      reference_required:
        "Indiquez la référence de la confirmation (appel, message, interlocuteur).",
      // Lot 16 : instruction, double validation et révision interne.
      use_dispute_decision:
        "Une absence se tranche par une proposition validée par un second agent.",
      situation_invalid: "Choisissez une situation.",
      extension_invalid: "Prolongation de 1 à 168 heures (720 au total).",
      party_invalid: "Choisissez le destinataire.",
      question_invalid: "La question doit compter de 10 à 1000 caractères.",
      decision_text_invalid:
        "Faits retenus, éléments vérifiés, contradictions et justification : 10 à 4000 caractères chacun.",
      disagreement_followup_required:
        "Désaccord persistant : indiquez la tentative amiable et l'orientation.",
      conflict_declaration_required:
        "Déclarez si vous êtes concerné par un conflit d'intérêts.",
      conflict_of_interest:
        "Vous vous êtes déclaré concerné : action impossible sur ce dossier.",
      outcome_not_applicable:
        "Ce résultat ne s'applique pas à ce type de signalement.",
      escalation_pending:
        "Entreprise silencieuse : attendez l'examen renforcé (48 h).",
      second_channel_required:
        "Entreprise silencieuse : consignez d'abord une tentative sur un second canal vérifié.",
      proposal_not_found: "Proposition introuvable.",
      proposal_closed: "Cette proposition n'est plus en attente.",
      self_review_forbidden:
        "Vous ne pouvez pas valider votre propre proposition.",
      proposer_conflict:
        "L'auteur de la proposition s'est déclaré concerné : nouvelle proposition nécessaire.",
      proposal_stale:
        "Le dossier a changé depuis la proposition : une nouvelle proposition est nécessaire.",
      no_decision: "Aucune décision à réviser.",
      review_window_closed: "Le délai de révision interne est écoulé.",
      review_already_decided: "La révision a déjà été examinée.",
      appeal_not_found: "Révision introuvable.",
      reviewer_not_eligible:
        "Un agent qui a proposé ou validé la décision ne peut pas la réviser.",
      appeal_already_assigned: "Révision déjà affectée à un autre agent.",
      appeal_not_assigned: "Révision affectée à un autre agent.",
      arbitration_required:
        "Une journée confirmée n'est pas annulée par la révision : maintenez la décision ou demandez un arbitrage.",
      day_not_started:
        "Cette journée n'a pas encore commencé : ce signalement sera possible à partir de l'heure de début.",
      incident_closed: "Ce signalement est clos.",
      incident_already_decided: "Ce signalement a déjà été examiné.",
      statement_limit: "Vous avez déjà envoyé 5 déclarations.",
      evidence_limit: "Vous avez déjà transmis 5 justificatifs.",
      generic: "L'action n'a pas pu être enregistrée. Réessayez.",
    },
    // Lot 16 : chronologie, compléments, décision et révision.
    situation: {
      company_unreachable: "Entreprise injoignable",
      presence_disputed: "Présence ou réalisation contestée",
      partial_work: "Travail partiellement effectué",
      quality_disputed: "Qualité du travail contestée",
      late_or_conduct: "Retard ou comportement signalé",
    },
    timeline: {
      title: "Chronologie",
      opened: "Dossier ouvert",
      party_notified: "Notification créée dans l'application ({party})",
      reminder_24h: "Relance créée dans l'application pour l'entreprise",
      info_requested: "Le support vous a posé une question",
      info_answered: "Réponse envoyée au support",
      decision_recorded: "Décision enregistrée : {outcome}",
      appeal_requested: "Révision demandée ({party})",
      appeal_assigned: "Révision confiée à un agent",
      appeal_decided: "Révision examinée",
      inApp:
        "EasyJob n'envoie ni SMS ni e-mail : les notifications sont dans l'application.",
    },
    info: {
      title: "Question du support",
      placeholder: "Votre réponse (10 caractères au moins)",
      send: "Répondre",
      answered: "Répondu le {time}",
      sent: "Réponse envoyée au support",
    },
    decision: {
      initial: "Décision du support",
      appeal: "Révision interne",
      facts: "Faits retenus",
      contradictions: "Contradictions relevées",
      justification: "Justification",
      amicable: "Tentative amiable",
      orientation: "Orientation",
      outcomes: {
        established: "Réalisation établie",
        not_established: "Réalisation non établie",
        partial: "Réalisation partielle",
        disagreement: "Désaccord persistant",
      },
      appealResults: {
        upheld: "Décision maintenue",
        revised: "Décision révisée",
        arbitration_required: "Arbitrage demandé",
      },
      noSanction:
        "Cette décision ne crée ni absence fautive, ni sanction, ni paiement.",
      partialNote:
        "Dossier identifié pour un traitement spécifique : la journée n'est pas terminée et le forfait n'est pas divisé.",
    },
    review: {
      title: "Révision interne",
      deadline: "Vous pouvez demander une révision jusqu'au {time}.",
      request: "Demander une révision",
      placeholder:
        "Pourquoi demandez-vous une révision ? (10 caractères au moins)",
      sent: "Révision demandée",
      pending_assignment: "Révision en attente d'un agent",
      assigned: "Révision en cours d'examen",
      decided: "Révision examinée",
      closed: "Délai de révision interne écoulé.",
      otherRemedies:
        "Ce délai interne ne supprime pas vos autres recours, et vous pouvez toujours transmettre de nouveaux éléments au support.",
    },
    admin: {
      title: "Signalements de mission",
      subtitle:
        "Faits déclarés par journée, versions des parties et justificatifs privés.",
      filters: {
        all: "Tous",
        open: "En attente",
        answered: "Versions reçues",
        decided: "Examinés",
        closed: "Clos",
      },
      empty: "Aucun signalement",
      candidate: "Candidat",
      company: "Entreprise",
      statements: "Versions",
      evidence: "Justificatifs privés",
      openEvidence: "Ouvrir",
      noEvidence: "Aucun justificatif",
      dayFacts: "Journée concernée",
      startedAt: "Début déclaré : {time}",
      notStarted: "Début non déclaré",
      confirmedAt: "Confirmée par code : {time}",
      confirmedBySupportAt: "Confirmée par le support : {time}",
      confirmedByDecisionAt:
        "Confirmée par décision du support (double validation) : {time}",
      notConfirmed: "Non confirmée",
      endsAt: "Fin prévue : {time}",
      otherDays: "Autres journées",
      decide: "Décision motivée",
      decisionPlaceholder: "Motif de la décision (10 caractères au moins)",
      submitDecision: "Enregistrer la décision",
      readOnly:
        "Lecture seule : la décision est réservée aux grades ops et fondateur.",
      decided: "Décision enregistrée",
      back: "Retour",
      quickAction: "Signalements",
      codeNotReceivedDecision:
        "Un code non remis se tranche par la confirmation de la journée, ci-dessous.",
      // Lot 15 : contacts avec l'entreprise et confirmation de la journée.
      contacts: {
        title: "Contacts avec l'entreprise",
        privateNotice:
          "Visibles du seul support : référence et note ne sont jamais montrées aux parties.",
        none: "Aucun contact consigné.",
        entryType: {
          request: "Demande de contact",
          response: "Réponse obtenue",
        },
        channel: {
          phone: "Téléphone",
          sms: "SMS",
          whatsapp: "WhatsApp",
          email: "E-mail",
          in_person: "En personne",
          other: "Autre",
        },
        result: {
          sent: "Demande envoyée",
          no_answer: "Sans réponse",
          unreachable: "Injoignable",
          work_confirmed: "Travail confirmé par l'entreprise",
          work_disputed: "Travail contesté par l'entreprise",
          other: "Autre réponse",
        },
        type: "Type",
        channelLabel: "Canal",
        resultLabel: "Résultat",
        occurredAt: "Date et heure du contact (heure de Douala)",
        reference: "Référence privée (appel, message, interlocuteur)",
        referenceValue: "Référence : {ref}",
        note: "Note interne (facultative)",
        submit: "Consigner le contact",
        recorded: "Contact consigné",
        by: "Consigné par : {role}",
      },
      // Lot 16 : instruction, échéances, double validation, révisions.
      contactsVerified:
        "Canal vérifié (numéro ou adresse vérifiés de l'entreprise)",
      contactsVerifiedBadge: "canal vérifié",
      badges: {
        escalated: "Examen renforcé",
        reminder: "Relancé",
        proposal: "Proposition à valider",
        appeal: "Révision",
      },
      dispute: {
        title: "Instruction",
        situation: "Situation",
        situationNone: "Non qualifiée",
        situationSave: "Qualifier",
        situationSaved: "Situation enregistrée",
        deadlines: "Échéances",
        openedAt: "Ouvert le {time}",
        reminderAt: "Relance 24 h : {time}",
        escalationAt: "Examen renforcé 48 h : {time}",
        reminderSent: "Relance créée dans l'application le {time}",
        escalated: "Examen renforcé depuis le {time}",
        companyResponded: "L'entreprise a répondu",
        companySilent: "L'entreprise n'a pas encore répondu",
        notApplicable:
          "Dossier ouvert par l'entreprise : aucune relance automatique.",
        secondChannelRequired:
          "Tenter un second canal vérifié et consigner la demande.",
        secondChannelDone: "Second canal vérifié tenté.",
        extended: "Échéances prolongées de {hours} h au total",
        silenceNote: "L'absence de réponse ne vaut jamais confirmation.",
        extend: "Prolonger",
        extendHours: "Heures",
        extendReason: "Motif de la prolongation (10 caractères au moins)",
        extendDone: "Échéances prolongées",
        infoTitle: "Demander un complément",
        infoParty: "Destinataire",
        infoQuestion: "Question (10 caractères au moins)",
        infoSend: "Envoyer la question",
        infoDone: "Question envoyée (notification dans l'application)",
        infoAnswered: "Répondu le {time}",
        infoPending: "En attente de réponse",
        notesTitle: "Notes internes de vérification",
        notesPlaceholder: "Vérification effectuée (interne)",
        notesAdd: "Ajouter la note",
        eventsTitle: "Chronologie interne",
        events: {
          opened: "Dossier ouvert",
          party_notified: "Notification créée dans l'application",
          reminder_24h: "Relance 24 h créée dans l'application",
          escalation_48h: "Examen renforcé (48 h)",
          deadline_extended: "Prolongation : {hours} h — {reason}",
          situation_set: "Situation qualifiée",
          info_requested: "Complément demandé",
          info_answered: "Complément reçu",
          proposal_created: "Proposition de décision",
          proposal_rejected: "Proposition refusée",
          decision_recorded: "Décision enregistrée",
          appeal_requested: "Révision demandée",
          appeal_assigned: "Révision affectée",
          appeal_decided: "Révision décidée",
        },
        proposeTitle: "Proposer une décision",
        outcome: "Résultat",
        facts: "Faits retenus",
        elements: "Éléments vérifiés (interne)",
        contradictions: "Contradictions",
        justification: "Justification",
        amicable: "Tentative amiable",
        orientation: "Orientation vers le recours compétent",
        conflictNone:
          "Je déclare n'avoir aucun conflit d'intérêts sur ce dossier",
        conflictConcerned: "Je suis concerné (conflit d'intérêts)",
        propose: "Proposer",
        proposed: "Proposition enregistrée : un autre agent doit la valider",
        reservedOps:
          "Proposer et valider : deux agents ops ou fondateur distincts. Le support instruit sans décider.",
        viewerConcerned:
          "Vous vous êtes déclaré concerné : ni proposition ni validation sur ce dossier.",
        conflictRecorded: "Conflit d'intérêts enregistré",
        proposalsTitle: "Propositions",
        proposalStatus: {
          pending: "En attente de seconde validation",
          approved: "Validée",
          rejected: "Refusée",
          superseded: "Remplacée",
        },
        revision: "Version du dossier : {rev}",
        stale:
          "Le dossier a changé depuis cette proposition : relecture et nouvelle proposition nécessaires.",
        mine: "Votre proposition : un autre agent doit la valider.",
        reviewNote: "Note de seconde validation (10 caractères au moins)",
        approve: "Valider la décision",
        reject: "Refuser",
        decided: "Décision enregistrée",
        rejected: "Proposition refusée",
        alreadyConfirmed:
          "Journée déjà confirmée par une autre voie : aucun effet.",
        obsolete: "Dossier déjà tranché : aucun effet.",
        decisionsTitle: "Décisions",
        reviewUntil: "Révision possible jusqu'au {time}",
        appealsTitle: "Révisions internes",
        appealStatus: {
          pending_assignment: "En attente d'affectation",
          assigned: "Affectée",
          decided: "Décidée",
        },
        noAgent: "Aucun agent distinct disponible : en attente d'affectation.",
        eligible: "Agents distincts disponibles : {count}",
        take: "Prendre la révision",
        taken: "Révision affectée",
        appealResult: "Issue",
        newOutcome: "Nouveau résultat",
        decideAppeal: "Décider la révision",
        appealDone: "Révision décidée",
        arbitrationHint:
          "Une journée confirmée n'est pas annulée : maintenez la décision ou demandez un arbitrage.",
      },
      confirmDay: {
        title: "Confirmer la journée",
        hint: "Réservé aux grades ops et fondateur, sur confirmation explicite de l'entreprise. La journée est enregistrée comme confirmée par le support ; le code n'est pas marqué comme saisi.",
        inquiry:
          "Entreprise injoignable ou travail contesté : le dossier reste en instruction.",
        chooseContact: "Confirmation de l'entreprise",
        noConfirmation:
          "Aucune réponse « travail confirmé » consignée sur ce dossier.",
        reason: "Motif de la décision (10 caractères au moins)",
        submit: "Confirmer la journée",
        done: "Journée confirmée",
        already: "Journée déjà confirmée",
        notYet: "Possible à partir de la fin prévue : {time}.",
        needsStart:
          "Début de la journée non confirmé : confirmation impossible.",
        confirmedAt: "Confirmée par le support le {time}",
        reasonLabel: "Motif interne : {reason}",
        readOnly:
          "Lecture seule : confirmation réservée aux grades ops et fondateur.",
      },
    },
  },

  // Contrat de mission (lot 7b)
  contract: {
    back: "Retour",
    title: "Contrat de mission",
    reference: "Référence : {ref}",
    open: "Voir le contrat",
    notFound: "Contrat introuvable ou inaccessible.",
    loadError: "Le contrat n'a pas pu être chargé.",
    retry: "Réessayer",
    template: {
      simple: "Contrat simple (moins de 3 jours)",
      formal: "Contrat formalisé (3 jours et plus)",
    },
    // Lot 13 : mention propre au lecteur (sa signature), jamais l'état de
    // la signature de l'autre partie.
    viewerState: {
      signed: "Signé par vous",
      toSign: "Votre signature est attendue",
      review: "À vérifier par le support",
      closed: "Signature non disponible",
    },
    parties: "Parties au contrat",
    company: "Entreprise",
    candidate: "Candidat",
    terms: "Conditions enregistrées",
    termsNotice:
      "Conditions figées lors de la sélection. Une modification ultérieure de l'offre ne les change pas.",
    job: "Mission",
    dates: "Dates",
    hours: "Horaires",
    breakMinutes: "Pause : {min} min",
    place: "Lieu",
    pay: "Rémunération par candidat",
    clausesTitle: "Engagements des parties",
    clausesVersion: "Version des clauses : {version}",
    clausesMissing:
      "Les clauses générales n'ont pas été enregistrées avec ce contrat. Elles ne sont pas reconstituées.",
    fingerprint: "Empreinte du contenu signé : {hash}",
    needsReview:
      "Ce contrat doit être vérifié par le support avant toute nouvelle signature.",
    yourSignature: "Votre signature",
    signNow: "Votre accord",
    sign: "Signer et accepter",
    signing: "Signature en cours…",
    confirmTitle: "Confirmer votre signature",
    confirmDescription:
      "Vous acceptez le contrat « {job} » avec {company}. Votre signature ne pourra plus être modifiée.",
    confirm: "Je signe",
    cancel: "Annuler",
    alreadySignedByYou: "Vous avez signé ce contrat.",
    separateSteps:
      "La signature du contrat est distincte du début de mission, de la confirmation par code et du règlement du montant convenu.",
    separateStepsCompany:
      "La signature du contrat est distincte de la remise du code de fin au candidat.",
    downloadPdf: "Télécharger le contrat (PDF)",
    pdf: {
      format: "Format",
      days: "Journées et horaires",
      timeZone: "Horaires en heure de Douala (Africa/Douala).",
      generatedAt: "Document généré le {date} (heure de Douala).",
    },
    toasts: {
      signedTitle: "Contrat signé",
      signedDesc: "Votre signature a été enregistrée.",
      errorTitle: "Signature non enregistrée",
    },
    errors: {
      not_authenticated: "Session expirée. Veuillez vous reconnecter.",
      account_suspended: "Votre compte est suspendu.",
      contract_not_found: "Contrat introuvable ou inaccessible.",
      contract_not_signable: "Ce contrat ne peut plus être signé.",
      contract_needs_review:
        "Ce contrat doit être vérifié par le support avant signature.",
      terms_mismatch:
        "Le contrat affiché n'est plus à jour. Rechargez-le avant de signer.",
      consent_required: "Cochez la case d'acceptation pour signer.",
      generic: "La signature n'a pas pu être enregistrée. Réessayez.",
    },
  },

  // Réputation : étoiles des évaluations de missions (lot 9b).
  reputation: {
    noReviews: "Pas encore d'avis",
    summary: "{rating}/5 · {reviews}",
    reviews: { one: "{count} avis", other: "{count} avis" },
    ratingLabel: "Note",
    // Réputation EasyJob (lot 9c) : étoiles seules pour les tiers.
    stars: { one: "{count} étoile", other: "{count} étoiles" },
    statLabel: "Réputation",
    starsAria: "Réputation EasyJob : {stars} sur 5",
    reasons: {
      late: "Retard",
      left_early: "Départ anticipé",
      poor_quality: "Travail non conforme",
      instructions_ignored: "Consignes non respectées",
      behavior: "Comportement inapproprié",
      presentation: "Tenue ou équipement inadaptés",
      unclear_instructions: "Consignes peu claires",
      conditions_mismatch: "Conditions différentes de l'offre",
      disrespect: "Manque de respect",
      unsafe: "Conditions de travail dangereuses",
      code_withheld: "Code de fin remis tardivement",
      extra_tasks: "Tâches non prévues",
    },
    progress: {
      title: "Ma réputation EasyJob",
      candidateNote:
        "Les entreprises voient seulement vos étoiles, jamais vos avis.",
      companyNote:
        "Les candidats voient seulement vos étoiles, jamais vos avis.",
      nextTier: "Prochain palier : {stars}",
      maxTier: "Vous avez atteint le palier maximal.",
      barLabel: "Progression vers {stars}",
      categoryValue: "{stars} sur {max}",
      categories: {
        profile: "Profil complet",
        experience: "Expérience et engagements",
        experienceCompany: "Offres réalisées et engagements",
        reviews: "Avis reçus",
        skills: "Compétences vérifiées",
      },
      actions: {
        missions: {
          one: "Encore {count} mission confirmée",
          other: "Encore {count} missions confirmées",
        },
        offers: {
          one: "Encore {count} offre réalisée",
          other: "Encore {count} offres réalisées",
        },
        reviews: {
          one: "Encore {count} avis de 4 ou 5 étoiles",
          other: "Encore {count} avis de 4 ou 5 étoiles",
        },
        profile50: "Complétez votre profil à 50 %",
        profile100: "Complétez votre profil à 100 %",
        skills: "Faites approuver le justificatif d'une compétence de plus",
        done: "Maximum atteint",
      },
      breaches: {
        one: "{count} manquement confirmé pris en compte",
        other: "{count} manquements confirmés pris en compte",
      },
      companyBreaches: {
        one: "{count} retrait pour annulations tardives",
        other: "{count} retraits pour annulations tardives",
      },
      expiry:
        "Un justificatif expire le {date} : renouvelez-le pour garder vos étoiles.",
      loadError: "Votre réputation n'a pas pu être chargée.",
    },
    celebration: {
      gainTitle: "Félicitations !",
      gainBody: "Votre réputation passe à {stars}.",
      lossTitle: "Votre réputation a baissé",
      lossBody: "Elle passe à {stars}.",
      lossReasons: "Motifs de l'avis : {reasons}.",
      lossDocument: "Justificatif expiré : {documents}.",
      renew: "Renouveler mon justificatif",
      completeProfile: "Compléter mon profil",
      skills: "Mes compétences",
      view: "Voir ma progression",
      contest: "Contester auprès du support",
      contestSubject: "Contestation d'un avis",
      close: "Fermer",
    },
    admin: {
      openCompany: "Réputation et avis",
      title: "Réputation EasyJob",
      categories: "Détail par catégorie",
      reviews: "Avis reçus",
      noReviews: "Aucun avis reçu.",
      author: "Auteur",
      mission: "Mission",
      rating: "Note",
      reasons: "Motifs",
      comment: "Commentaire",
      noComment: "Sans commentaire",
      impact: "Impact",
      impactValue: "{applied} unité(s) (prévu {nominal}), solde {balance}",
      notCounted: "Non compté",
      notCountedHint:
        "Mission non confirmée par code ou avis invalidé par contestation.",
      contest: "Contestation",
      contestNone: "Aucune",
      contestOpen: "En cours",
      contestUpheld: "Acceptée : avis invalidé",
      contestRejected: "Rejetée : avis maintenu",
      openContest: "Rattacher une contestation",
      notePlaceholder: "Demande reçue par le support (date, canal, résumé)",
      decisionPlaceholder: "Motif de la décision",
      uphold: "Accepter (invalider l'avis)",
      reject: "Rejeter (maintenir l'avis)",
      readOnly: "Lecture seule : seuls admin_ops et admin_founder décident.",
      changes: "Variations récentes",
      incidents: "Manquements confirmés",
      noIncidents: "Aucun manquement enregistré.",
      saved: "Décision enregistrée.",
      error: "Action impossible. Réessayez.",
    },
  },
  // Lot 12 : offres de plusieurs journées (dates choisies explicitement).
  // Lots 17b–17c : annulation par le candidat, justification, recours,
  // suspensions et montant acquis.
  cancellations: {
    open: "Annuler des journées",
    title: "Annuler des journées",
    intro:
      "Choisissez les journées dont vous vous désistez. Le désistement est enregistré tout de suite et l'entreprise est prévenue.",
    noneAvailable:
      "Aucune journée de cette mission ne peut encore être annulée.",
    classes: {
      in_time: "Sans sanction",
      reaction_window: "Sans sanction (délai de réaction)",
      late: "Hors délai",
      legacy: "Engagement antérieur : sans sanction automatique",
    },
    deadline: "Sans sanction jusqu'au {date}",
    reaction: "Délai de réaction jusqu'au {date}",
    summaryTitle: "Récapitulatif",
    summaryFree:
      "Aucune sanction. Vous pouvez ajouter un justificatif si vous le souhaitez.",
    summaryLate:
      "Au moins une journée est hors délai. Indiquez le motif et joignez un justificatif : le support l'examinera avant toute sanction. Sans justificatif, un manquement est retenu (−5 unités d'expérience).",
    reason: "Motif",
    reasonPlaceholder: "Choisir un motif",
    reasons: {
      illness: "Maladie",
      family_emergency: "Urgence familiale",
      transport: "Problème de transport",
      late_notification: "Notification de sélection découverte tardivement",
      other: "Autre",
    },
    reasonText: "Précisions (facultatif)",
    evidenceProvided: "J'ajoute un justificatif",
    evidenceNone: "Je n'ai pas de justificatif",
    file: "Justificatif (PDF, JPG ou PNG, 5 Mo au plus)",
    confirm: "Confirmer l'annulation",
    back: "Retour",
    done: "Annulation enregistrée",
    uploadFailed:
      "Le justificatif n'a pas pu être envoyé. Votre dossier reste en attente de pièce : réessayez.",
    retry: "Envoyer un justificatif",
    sending: "Envoi…",
    mineTitle: "Mes annulations",
    daysLabel: "Journées : {dates}",
    status: {
      closed_no_sanction: "Sans sanction",
      awaiting_evidence: "Justificatif attendu",
      under_review: "En examen par le support",
      sanctioned_no_evidence: "Manquement retenu (sans justificatif)",
      accepted: "Justificatif accepté : sans sanction",
      refused: "Justificatif refusé : manquement retenu",
    },
    decisionNote: "Motif de la décision : {note}",
    review: "Demander un recours",
    reviewHint: "Recours possible jusqu'au {date}.",
    reviewNote: "Expliquez votre recours",
    reviewSend: "Envoyer le recours",
    reviewSent: "Recours envoyé le {date}",
    reviewOutcome: {
      maintained: "Recours rejeté",
      overturned: "Recours accepté : manquement annulé",
    },
    dayCancelled: "Annulée",
    companyDayCancelled: "Désistement du candidat",
    amountTitle: "Montant acquis",
    amountValue: "{amount} sur un forfait de {total}",
    amountExact: "Calcul exact : {exact} XAF (arrondi au franc à valider)",
    amountStatus: {
      final: "Définitif",
      in_progress: "Provisoire : des journées restent prévues",
      settlement_pending:
        "En attente de règlement : travail partiel ou interruption en instruction",
    },
    amountPendingNote:
      "Journée interrompue ou partielle : montant en examen, pas encore fixé (ce n'est pas zéro). Seul un accord accepté par les deux parties puis confirmé s'ajoute au montant reconnu.",
    amountUnresolvedNote:
      "Désaccord non résolu sur une journée : aucun montant définitif, ni renoncement, ni remboursement, ni sanction.",
    amountNote:
      "Forfait × heures prévues des journées réalisées ÷ heures prévues de toutes les journées (horaires du contrat, pause non déduite). Aucun versement n'est effectué par l'application.",
    tasksTitle: "Annulations à compléter",
    tasksEvidence: "Justificatif attendu pour « {job} »",
    suspensions: {
      title: "Suspension de votre compte",
      cycle: "Trois annulations tardives sans justificatif valable",
      cycleFinal: "Exclusion définitive",
      fraud: "Fraude présumée examinée par le support",
      until: "Jusqu'au {date} (heure de Douala)",
      noEnd: "Sans date de fin",
      events: "Faits retenus : {dates}",
      contest: "Contester",
      contestNote: "Expliquez votre contestation",
      contestSend: "Envoyer",
      contested: "Contestation envoyée le {date}",
      maintained: "Contestation examinée : suspension maintenue",
    },
    admin: {
      quickAction: "Annulations des candidats",
      title: "Annulations des candidats",
      filterToReview: "À examiner",
      filterAll: "Toutes",
      empty: "Aucun dossier.",
      back: "Retour à la liste",
      candidate: "Candidat",
      job: "Offre",
      planAtSelection: "Plan à la sélection : {plan}",
      lateCount: "Annulations tardives retenues sur le compte : {n}",
      reasonCode: "Motif : {reason}",
      evidence: "Pièces",
      openEvidence: "Ouvrir la pièce {n}",
      noEvidence: "Aucune pièce.",
      decideTitle: "Décision sur le justificatif",
      accept: "Accepter (aucune sanction)",
      refuse: "Refuser (manquement)",
      note: "Motif (10 caractères au moins)",
      reviewTitle: "Recours du candidat",
      reviewBy:
        "Décision par un autre agent que l'auteur de la décision initiale.",
      maintain: "Maintenir",
      overturn: "Annuler le manquement",
      fraudTitle: "Fraude présumée",
      fraudHint:
        "Un justificatif refusé n'est pas une preuve de fraude. Joignez les éléments.",
      fraudReason: "Éléments du signalement",
      fraudReport: "Signaler",
      fraudEvidence: "Joindre un élément",
      suspendEnd: "Fin (heure de Douala) ; vide : jusqu'à levée",
      suspend: "Suspendre pour fraude",
      suspensionsTitle: "Suspensions du compte",
      lift: "Lever",
      maintainContest: "Maintenir après contestation",
      contestNote: "Contestation : {note}",
      futureTitle: "Engagements futurs déjà sélectionnés",
      futureHint:
        "Ni supprimés ni transformés en absences : traitement opérationnel à décider par le support.",
      causes: {
        admin: "Administrative",
        cancellation_cycle: "Annulations tardives, cycle {n}",
        fraud: "Fraude présumée",
      },
      state: {
        active: "En cours",
        ended: "Terminée",
        lifted: "Levée",
      },
      saved: "Enregistré.",
    },
    errors: {
      reason_required: "Choisissez un motif.",
      evidence_choice_required:
        "Choisissez « J'ajoute un justificatif » ou « Je n'ai pas de justificatif ».",
      day_already_cancelled: "Une journée est déjà annulée.",
      day_started: "Une journée a déjà commencé ou été réalisée.",
      day_already_begun:
        "Une journée a déjà débuté : elle ne peut plus être annulée.",
      mission_not_active: "Cette mission n'est plus active.",
      evidence_invalid: "Fichier non reconnu : PDF, JPG ou PNG.",
      evidence_too_large: "Fichier trop volumineux (5 Mo au plus).",
      evidence_limit: "Nombre maximal de pièces atteint.",
      cancellation_closed: "Ce dossier n'accepte plus de pièce.",
      note_invalid: "Texte trop court (10 caractères au moins).",
      review_deadline_passed: "Le délai de recours est dépassé.",
      generic: "Opération impossible. Réessayez.",
    },
  },
  // Interruption d'une journée commencée et règlement encadré par le
  // support (décision du 2026-11-19).
  partialDay: {
    report: "Signaler une interruption",
    causeLabel: "Cause",
    causes: {
      candidate_left: "Départ du candidat",
      company_stopped: "Arrêt demandé par l'entreprise",
    },
    declaredAtLabel: "Heure de l'interruption (heure de Douala)",
    workDoneLabel: "Travail effectué",
    reasonLabel: "Raison",
    notProof:
      "Votre déclaration est transmise au support : elle ne confirme pas la journée et n'est pas une preuve à elle seule.",
    dayInterrupted: "Interruption signalée : dossier en examen",
    taskTitle: "Interruption · {date}",
    taskHint:
      "Le dossier est en examen. Suivez les échéances et répondez depuis la mission.",
    versionsTitle: "Versions des parties",
    versionLine: "{party} · {cause} · {time}",
    party: { candidate: "Candidat", company: "Entreprise" },
    stage: {
      instruction: "Instruction : réponses attendues",
      founder_review: "Examen par le fondateur",
      awaiting_parties: "Proposition en attente des réponses",
      agreement: "Accord des deux parties",
      closed: "Dossier clos",
    },
    dueAt: "Échéance : {time}",
    reviewDue: "Décision du fondateur attendue au plus tard le {time}.",
    reviewOverdue:
      "Délai d'examen dépassé depuis le {time} : un rappel est adressé au fondateur. Aucune décision n'est prise automatiquement.",
    versionRequested: "Votre version est attendue avant le {time}.",
    versionExpired:
      "Le délai pour donner votre version a expiré le {time}. Le fondateur examine le dossier avec les éléments disponibles.",
    requestDue: "À répondre avant le {time} (échéance incluse)",
    requestExpired:
      "Délai expiré le {time} : la réponse n'est plus recevable. Vous pouvez encore ajouter un nouvel élément pour examen.",
    silenceNote:
      "Le silence ne prouve ni la réalisation, ni l'absence, ni une faute.",
    amount: {
      under_review:
        "Montant de cette journée : en examen. Aucun montant n'est encore fixé, ce qui ne veut pas dire zéro.",
      unresolved:
        "Désaccord non résolu : aucun montant définitif. Ce n'est ni un renoncement à rémunération, ni un remboursement, ni une sanction.",
      settled:
        "Accord finalisé pour cette journée : {amount} (information, aucun versement)",
      not_applicable:
        "Interruption non établie : la journée reprend son parcours normal.",
    },
    proposalsTitle: "Propositions du fondateur",
    proposalLine: "Version {version} · {amount}",
    motivationLabel: "Motivation",
    proposalStatus: {
      open: "En attente des réponses",
      accepted: "Acceptée par les deux parties",
      refused: "Refusée",
      expired: "Expirée sans deux acceptations",
      superseded: "Remplacée par une nouvelle version",
    },
    respondBy:
      "Réponse attendue avant le {time} (48 h, échéance incluse). Sans réponse, la proposition expire.",
    responseLine: "{party} : {decision} le {time}",
    decisions: { accept: "acceptée", refuse: "refusée" },
    sameAmount:
      "Le candidat et l'entreprise voient le même montant ; chacun accepte ou refuse pour son propre compte. Le silence ne vaut jamais acceptation.",
    accept: "Accepter",
    refuse: "Refuser",
    youAccepted: "Vous avez accepté cette version.",
    waitingOther: "En attente de la réponse de l'autre partie.",
    youRefused:
      "Vous avez refusé cette version : le dossier revient au fondateur.",
    refused:
      "Proposition refusée : le dossier revient au fondateur pour examen.",
    agreementCandidate:
      "Accord des deux parties sur {amount} : saisissez le code de la journée, même avant la fin prévue.",
    agreementCompany:
      "Accord des deux parties sur {amount} : remettez le code de la journée au candidat.",
    recourse: "Le code n'est pas remis : demander au support",
    recourseSent:
      "Recours enregistré : le fondateur vérifie puis peut finaliser l'accord.",
    closureTitle: "Décision du fondateur",
    closureOutcome: {
      not_established: "Interruption non établie",
      disagreement: "Désaccord non résolu",
      settled: "Accord partiel finalisé",
    },
    finance: {
      title: "Suivi des montants",
      recognized: "Déjà reconnu pour la mission : {amount}",
      cap: "Plafond de cette journée (contrat signé) : {amount}",
      pending: "Proposition en attente de réponse : {amount}",
      accepted: "Montant accepté par les deux parties : {amount}",
      settled: "Accord finalisé pour cette journée : {amount}",
      none: "Aucun montant n'est encore proposé pour cette journée (ce n'est pas zéro).",
      finalization: {
        pending: "Finalisation : en attente du code de la journée",
        code: "Finalisation : confirmée par le code",
        support: "Finalisation : par le fondateur (code non remis)",
      },
      notPaid:
        "Information seulement : un montant reconnu ou accepté n'est pas un versement ; l'application n'effectue aucun paiement.",
      exactNote:
        "Accord : montant entier. Plafond : arrondi à l'entier inférieur. Total reconnu : calcul exact au prorata, qui peut rester fractionnaire ; l'arrondi d'un éventuel versement relèvera du lot paiement.",
    },
    dayState: {
      under_review: "Interrompue — en examen",
      agreement: "Interrompue — accord à confirmer par le code",
      settled: "Interrompue — accord partiel finalisé",
      unresolved: "Interrompue — règlement non résolu",
      normal: "Parcours normal rétabli",
      confirmed: "Confirmée",
    },
    situation: {
      day: "Journée : {state}",
      dossier: "Dossier : {stage}",
      mission:
        "Mission : {confirmed} journée(s) confirmée(s) sur {total} ; les autres journées suivent leur propre parcours.",
    },
    reexam: {
      title: "Signaler une erreur dans la décision",
      hint: "Le fondateur réexamine sa décision avec votre motif. Ce n'est pas un recours indépendant ; la demande ne change ni les délais ni l'état de la journée.",
      placeholder: "Motif de la demande de réexamen",
      send: "Demander un réexamen",
      sent: "Demande de réexamen enregistrée",
      pending: "Réexamen demandé le {time} : en attente du fondateur.",
      decisions: {
        maintained: "Décision maintenue",
        reopened:
          "Examen rouvert : décision précédente conservée dans l'historique",
        separate_handling:
          "Correction nécessitant un traitement distinct : rien n'est modifié ici",
      },
      decisionLine: "{decision} le {time}",
      history: "Décisions précédentes",
      historyLine: "{outcome} · décidée le {decided} · remplacée le {revoked}",
    },
    noticesTitle: "Avis dans l'application",
    noticeLine: "{kind} · mis à disposition le {time}",
    noticeViewed: "consulté le {time}",
    noticeNotViewed: "consultation non observée",
    noticeScope:
      "Avis disponibles dans l'application uniquement : aucun SMS, e-mail ni notification push n'est envoyé.",
    noticeKinds: {
      version_request: "Version demandée",
      version_reminder: "Rappel : version attendue",
      version_expired: "Délai de version expiré",
      info_request: "Justificatif demandé",
      info_reminder: "Rappel : justificatif attendu",
      info_expired: "Délai de réponse expiré",
      proposal: "Montant proposé",
      proposal_reminder: "Rappel : proposition",
      proposal_expired: "Proposition expirée",
      proposal_refused: "Proposition refusée",
      agreement: "Accord des deux parties",
      review_extended: "Examen prolongé",
      founder_overdue: "Délai du fondateur dépassé",
      recourse: "Recours : code non remis",
      closure: "Décision",
      finalized: "Accord finalisé par le support",
      reexam_request: "Réexamen demandé",
      reexam_decision: "Réexamen traité",
      new_element: "Nouvel élément",
    },
    codeAmount: "Montant convenu : {amount}",
    noPayment:
      "La confirmation enregistre l'accord accepté ; elle ne vaut ni versement ni remboursement.",
    dayPartial: "Accord partiel finalisé",
    dayPartialSupport: "Accord partiel finalisé par le support",
    tasksTitle: "Interruptions : actions attendues",
    taskActions: {
      give_version: "Donner votre version",
      answer_request: "Répondre ou fournir une pièce",
      respond_proposal: "Proposition de {amount} : accepter ou refuser",
      agreement_code_candidate: "Accord sur {amount} : saisir le code",
      agreement_code_company: "Accord sur {amount} : remettre le code",
    },
    taskOpen: "Ouvrir le dossier",
    admin: {
      title: "Interruption : décision du fondateur",
      founderOnly:
        "Seul le fondateur actif propose ou modifie un montant, prolonge son délai, clôt le dossier ou finalise un accord, sans seconde validation. Le support et les opérations recueillent versions, justificatifs et contacts.",
      readOnly: "Lecture seule : décision réservée au fondateur.",
      policyPending:
        "Proposition de montant fermée : le montant minimal, le plafond et l'arrondi ne sont pas encore arbitrés.",
      amountLabel: "Montant proposé (XAF)",
      motivationLabel: "Motivation de la proposition",
      propose: "Proposer ce montant",
      amend: "Proposer une nouvelle version",
      proposed: "Proposition enregistrée",
      closeLabel: "Clôture motivée",
      closeOutcome: {
        not_established: "Interruption non établie",
        disagreement: "Désaccord non résolu",
      },
      closeHint: {
        not_established: "La journée reprend son parcours normal.",
        disagreement:
          "Aucun montant définitif, ni renoncement, ni remboursement, ni sanction ; la journée n'est pas confirmée.",
      },
      closeMotivation: "Motivation de la clôture",
      close: "Clore le dossier",
      closed: "Dossier clos",
      extendEnds: "Nouvelle échéance (heure de Douala)",
      extendReason: "Motif de la prolongation",
      extend: "Prolonger exceptionnellement",
      extended: "Prolongation enregistrée",
      extensionsTitle: "Prolongations",
      extensionLine: "Jusqu'au {time} · {reason}",
      finalizeHint:
        "Recours reçu : le code n'est pas remis. Vérifiez, puis finalisez au montant accepté (provenance distincte, jamais une réalisation complète).",
      finalizeMotivation: "Vérifications effectuées",
      finalize: "Finaliser l'accord",
      finalized: "Accord finalisé",
      requestsTitle: "Demandes adressées aux parties",
      versionRequestLine: "Version de la partie {party} · avant le {time}",
      requestLine: "{party} · avant le {time}",
      requestAnswered: "répondu le {time}",
      requestOpen: "en attente",
      requestExpired: "délai expiré",
      capLabel:
        "Plafond : {amount} (contrat signé ; il encadre la proposition sans calculer la valeur du travail)",
      zeroNote:
        "Un montant de 0 suit les mêmes garanties : motif, affichage clair et acceptation explicite des deux parties sur la même version.",
      extensionOnce:
        "Une seule prolongation par dossier, 7 jours au plus après l'échéance en cours.",
      extensionUsed: "Prolongation déjà utilisée pour ce dossier.",
      reexamTitle: "Demandes de réexamen",
      reexamDecision: "Décision du réexamen",
      reexamMotivation: "Motivation du réexamen",
      reexamSubmit: "Enregistrer la décision",
      reexamDone: "Réexamen traité",
      overdueBadge: "Délai du fondateur dépassé",
      dueBadge: "Échéance {time}",
      notices: "Mises à disposition et consultations",
      recipient: {
        candidate: "Candidat",
        company: "Entreprise",
        founder: "Fondateur",
      },
    },
    errors: {
      decision_invalid: "Réponse invalide.",
      settlement_changed:
        "La proposition a changé : relisez la nouvelle version.",
      settlement_not_found: "Proposition introuvable.",
      already_responded: "Vous avez déjà répondu à cette version.",
      proposal_refused:
        "Cette proposition a été refusée : le dossier revient au fondateur.",
      proposal_expired:
        "Le délai de réponse de 48 h est dépassé : la proposition a expiré.",
      incident_closed: "Ce dossier est clos.",
      settlement_not_accepted:
        "Aucun accord valide des deux parties sur la version en cours.",
      settlement_accepted:
        "Un accord des deux parties est en cours : il ne peut plus être modifié.",
      recourse_required:
        "Finalisation possible seulement après un recours d'une partie.",
      amount_above_cap:
        "Montant supérieur au plafond de la journée (contrat signé).",
      settlement_cap_unavailable:
        "Plafond introuvable dans le contrat signé : aucune proposition possible.",
      extension_already_used:
        "La prolongation de ce dossier a déjà été utilisée.",
      no_decision: "Aucune décision du fondateur à réexaminer.",
      reexamination_not_found: "Demande de réexamen introuvable.",
      reexamination_decided: "Ce réexamen est déjà traité.",
      reexamination_obsolete:
        "La décision visée a changé : relisez le dossier.",
      requires_separate_handling:
        "Correction impossible ici (accord finalisé ou journée confirmée) : traitement distinct nécessaire.",
      motivation_invalid: "Motivation de 10 à 2 000 caractères.",
      amount_invalid: "Montant hors des bornes validées.",
      settlement_rule_pending:
        "Montant minimal, plafond et arrondi non arbitrés : aucune proposition n'est possible.",
      instruction_pending:
        "Des réponses sont encore attendues dans le délai de 72 h.",
      proposal_open: "Une proposition attend encore les réponses (48 h).",
      review_not_open: "Le dossier n'est pas à l'examen du fondateur.",
      extension_date_invalid:
        "Échéance postérieure à l'échéance en cours, 7 jours au plus après elle.",
      closure_outcome_invalid: "Choisissez une clôture.",
      note_invalid: "Motif de 10 à 1 000 caractères.",
      forbidden: "Action réservée au fondateur actif.",
      day_already_confirmed: "Cette journée est déjà confirmée.",
      mission_not_active: "Cette mission n'est plus active.",
      incident_not_found: "Dossier introuvable.",
      mission_not_found: "Mission introuvable ou inaccessible.",
      account_suspended: "Votre compte est suspendu.",
      generic: "Opération impossible. Réessayez.",
    },
  },
  schedule: {
    datesLabel: "Dates de travail",
    datesHint:
      "Ajoutez chaque date travaillée. Les dates peuvent ne pas se suivre : aucun jour n'est ajouté automatiquement entre deux dates.",
    addDate: "Ajouter",
    addDateLabel: "Date à ajouter",
    removeDate: "Retirer le {date}",
    noDates: "Aucune date ajoutée.",
    sameHours: "Mêmes horaires pour toutes les journées",
    startTime: "Début",
    endTime: "Fin",
    nextDay: "+1 j",
    crossesMidnight: "Se termine le lendemain.",
    formatLabel: "Format de la mission",
    formats: {
      full_period: {
        title: "Période complète",
        desc: "Le candidat s'engage sur toutes les dates. Un montant fixe par candidat couvre toute la période.",
      },
      per_day: {
        title: "Journées au choix",
        desc: "Le candidat choisit ses journées. Montant et places propres à chaque journée.",
      },
    },
    periodPayLabel: "Montant par candidat pour toute la période (F CFA)",
    periodPayHint:
      "Ce montant fixe couvre toutes les journées prévues. Il n'est jamais divisé par journée.",
    dayPayLabel: "Montant par candidat (F CFA)",
    dayPositions: "Places",
    copyFirstDay: "Reprendre la première journée pour toutes",
    preview: "Aperçu des journées",
    dayCount: { one: "{count} journée", other: "{count} journées" },
    perDayPositions: {
      one: "{count} place",
      other: "{count} places",
    },
    payFromTo: "De {min} à {max} par journée",
    payPerDay: "{amount} par journée",
    payPeriod: "Pour toute la période ({days})",
    periodCommitment:
      "Période complète : vous vous engagez sur toutes ces journées. Le montant couvre l'ensemble.",
    chooseDays: "Choisissez vos journées",
    chooseDaysHint:
      "Cochez une ou plusieurs journées encore ouvertes. Vous pourrez postuler plus tard aux autres journées ouvertes.",
    applyDays: {
      one: "Postuler à {count} journée",
      other: "Postuler à {count} journées",
    },
    selectDayFirst: "Choisissez au moins une journée",
    summaryTitle: "Journées choisies",
    dayState: {
      open: "Ouverte",
      closed: "Candidatures closes",
      full: "Complète",
      pending: "Candidature envoyée",
      selected: "Sélectionné(e)",
      rejected: "Non retenue",
      withdrawn: "Retirée",
      no_show: "Absence enregistrée",
      conflict: "Incompatible",
    },
    withdrawDay: "Retirer cette candidature",
    blocked: {
      title: "Certaines journées ne sont plus disponibles",
      recruitment_closed: "{date} : candidatures closes",
      already_applied: "{date} : candidature déjà envoyée",
      no_positions: "{date} : journée complète",
      schedule_conflict: "{date} : vous avez déjà un engagement trop proche",
      none: "Rien n'a été envoyé. Modifiez votre choix puis réessayez.",
    },
    conflict:
      "Vous avez déjà un engagement qui chevauche cette période ou qui en est à moins de 3 h ({days}).",
    // Conflit expliqué avant l'envoi (verdict de la base, jamais le détail
    // de l'autre engagement).
    conflictDay:
      "Vous avez déjà un engagement sélectionné qui chevauche cette journée ou en est à moins de 3 h.",
    conflictRule:
      "Il faut au moins 3 h entre deux engagements sélectionnés. Vos candidatures en attente ne comptent pas.",
    conflictOthersOpen: "Les autres journées restent disponibles.",
    periodConflict: {
      one: "Candidature impossible : la journée du {dates} est incompatible avec un engagement déjà sélectionné (chevauchement ou moins de 3 h d'écart). Cette offre engage sur toutes ses journées.",
      other:
        "Candidature impossible : {count} journées sont incompatibles avec un engagement déjà sélectionné (chevauchement ou moins de 3 h d'écart) : {dates}. Cette offre engage sur toutes ses journées.",
    },
    singleConflict:
      "Candidature impossible : vous avez déjà un engagement sélectionné qui chevauche cette mission ou en est à moins de 3 h.",
    applyBlockedConflict:
      "Candidature impossible : conflit d'horaire avec un engagement déjà sélectionné.",
    noCompatibleDay:
      "Aucune journée encore ouverte n'est compatible avec vos engagements sélectionnés.",
    unverified:
      "Impossible de vérifier votre disponibilité pour le moment. La candidature reste bloquée tant que la vérification n'a pas abouti.",
    selectionChanged: "Votre choix a été mis à jour",
    selectionChangedHint: {
      one: "Cette journée a été retirée de votre choix.",
      other: "Ces journées ont été retirées de votre choix.",
    },
    tooClose: "Journées trop proches pour être publiées : {days}.",
    dayHeading: "Journée du {date}",
    allDays: "Toutes les journées",
    dayProgress: "{done}/{total} journées confirmées",
    startDay: "Commencer la journée",
    confirmDay: "Confirmer la journée",
    dayStarted: "Commencée",
    dayConfirmed: "Confirmée",
    // Lot 15 : journée confirmée par le support après vérification.
    dayConfirmedBySupport: "Confirmée par le support",
    // Lot 16 : confirmation exceptionnelle (double validation).
    dayConfirmedByDecision: "Confirmée par décision du support",
    dayNotConfirmed: "Non confirmée",
    dayUpcoming: "À venir",
    dayCode: "Code du {date}",
    missionDoneAfterAll:
      "La mission sera réalisée quand toutes les journées seront confirmées.",
    unconfirmedNote:
      "Une journée non confirmée reste non confirmée : rien n'est annulé ni retenu automatiquement. Pour un problème, contactez le support.",
  },
  days: {
    monday: "Lun",
    tuesday: "Mar",
    wednesday: "Mer",
    thursday: "Jeu",
    friday: "Ven",
    saturday: "Sam",
    sunday: "Dim",
  },

  // Errors
  errors: {
    generic: "Une erreur est survenue. Veuillez réessayer.",
    network: "Erreur de connexion. Vérifiez votre internet.",
    unauthorized: "Session expirée. Veuillez vous reconnecter.",
    notFound: "Page non trouvée",
    serverError: "Erreur serveur. Veuillez réessayer plus tard.",
    onboardingIncomplete:
      "Votre profil n'a pas pu être finalisé : vérifiez vos informations, vos compétences (au moins 2) et votre compte Mobile Money.",
  },

  // Success messages
  success: {
    saved: "Enregistré avec succès",
    deleted: "Supprimé avec succès",
    applied: "Candidature envoyée",
    profileUpdated: "Profil mis à jour",
  },

  // Home / Landing page
  home: {
    badge: "Disponible à Douala & Yaoundé",
    hero: {
      title: "Trouvez votre prochaine mission en un clic",
      subtitle:
        "La plateforme qui connecte les talents camerounais aux entreprises locales. Montant fixe par mission, contrat signé dans l'application, fin confirmée par code.",
      ctaCandidate: "Je cherche une mission",
      ctaCompany: "Je recrute",
      trust: "Inscription gratuite · Montant fixe en XAF · Contrat signé",
    },
    stats: {
      flatPay: "Montant fixe par mission",
      signatures: "Signatures par contrat",
      completionCode: "Chiffres du code de fin",
      cities: "Villes couvertes",
    },
    how: {
      title: "Comment ça marche",
      candidate: "Je suis candidat",
      company: "Je suis une entreprise",
      step1: "Étape 1",
      step2: "Étape 2",
      step3: "Étape 3",
      cStep1Title: "Créez votre profil",
      cStep1Desc:
        "Inscription en quelques minutes : photo, compétences, CNI vérifiée par l'équipe EasyJob.",
      cStep2Title: "Postulez en 1 clic",
      cStep2Desc:
        "Trouvez une offre adaptée à vos disponibilités. Aucun message requis. Réponse rapide.",
      cStep3Title: "Confirmez la fin de mission",
      cStep3Desc:
        "Saisissez le code à six chiffres remis par l'entreprise. Le montant fixe convenu figure dans votre contrat.",
      eStep1Title: "Décrivez votre besoin",
      eStep1Desc:
        "Renseignez le poste, les horaires et le montant fixe par candidat. L'équipe EasyJob vérifie l'offre avant publication.",
      eStep2Title: "Choisissez vos candidats",
      eStep2Desc:
        "Consultez les candidatures avec la note, les missions et les vérifications de chacun, puis sélectionnez.",
      eStep3Title: "Mission accomplie",
      eStep3Desc:
        "Remettez le code de fin au candidat une fois le travail effectué, réglez le montant convenu, puis évaluez-le.",
    },
    features: {
      title: "Pourquoi choisir EasyJob CM",
      f1Title: "Montant fixe par mission",
      f1Desc:
        "Chaque offre annonce un montant en XAF par candidat, repris tel quel dans le contrat.",
      f2Title: "Contrat digital",
      f2Desc:
        "Chaque sélection crée un contrat que l'entreprise et le candidat signent électroniquement.",
      f3Title: "Avis après chaque mission",
      f3Desc:
        "Après chaque mission, l'entreprise et le candidat s'évaluent. La note et le nombre d'avis sont visibles avant la sélection ; un profil sans avis peut postuler.",
      f4Title: "Recherche ciblée",
      f4Desc:
        "Filtrez les offres par ville et par catégorie, puis postulez en un clic.",
    },
    cta: {
      title: "Prêt à commencer ?",
      subtitle:
        "Créez votre compte pour trouver ou publier une mission à Douala et Yaoundé.",
      btn: "Créer mon compte gratuitement",
      login: "J'ai déjà un compte",
    },
  },

  // Cookie consent
  cookie: {
    title: "Vos préférences de cookies",
    desc: "Nous utilisons des cookies pour améliorer votre expérience. Les cookies nécessaires ne peuvent pas être désactivés.",
    subtitle: "Personnalisez vos préférences",
    accept: "Tout accepter",
    decline: "Refuser",
    declineNonEssential: "Refuser non-essentiels",
    back: "← Retour",
    manage: "Gérer mes cookies",
    necessary: "Nécessaires",
    necessaryDesc: "Indispensables au fonctionnement de l'application.",
    alwaysOn: "Toujours actif",
    analytics: "Analytiques",
    analyticsDesc:
      "Nous aident à comprendre comment vous utilisez l'application.",
    marketing: "Marketing",
    marketingDesc: "Permettent d'afficher des publicités pertinentes.",
    preferences: "Préférences",
    preferencesDesc: "Mémorisent vos préférences d'affichage.",
    save: "Enregistrer mes choix",
    gdprNote: "RGPD · Nécessaires uniquement",
  },

  // Landing page extras
  landing: {
    nav: {
      features: "Fonctionnalités",
      howItWorks: "Comment ça marche",
      about: "À propos",
    },
    theme: { darkMode: "Mode sombre", lightMode: "Mode clair" },
    language: { french: "Français", english: "English" },
    trust: {
      signup: "Inscription gratuite",
      momo: "Montant fixe en XAF",
      contract: "Contrat signé",
    },
    simpleFastSecure: "Simple. Rapide. Sécurisé.",
    featuresLabel: "Fonctionnalités",
    mockup: {
      jobsNear: "Missions près de vous",
      doualaCount: "Douala · 12 offres",
      applyOneClick: "Postuler en 1 clic",
      paymentReceived: "Contrat signé",
      missionConfirmed: "Mission confirmée",
      reviewed: "Avis après mission",
      reviewedValue: "4,9/5 · 12 avis",
    },
    pwa: {
      title: "Installez EasyJob CM sur votre appareil",
      desc: "Application web à installer sur l'écran d'accueil, sans passer par un store. Compatible iOS, Android et ordinateur.",
      install: "Installer l'app",
      installed: "Application installée !",
      free: "Gratuit · Aucun store requis",
      guideTitle: "Comment installer l'app",
      iosSafari: "Partager → Ajouter à l'écran d'accueil",
      android: "Menu ⋮ → Installer l'application",
      desktop: "Icône ⊕ dans la barre d'adresse",
    },
    footer: {
      product: "Produit",
      company: "Entreprise",
      support: "Support",
      legal: "Légal",
      pricing: "Tarifs",
      about: "À propos",
      blog: "Blog",
      press: "Presse",
      contact: "Contact",
      faq: "FAQ",
      helpCenter: "Centre d'aide",
      reportBug: "Signaler un bug",
      status: "Statut / Status",
      cookies: "Cookies",
      gdpr: "RGPD / GDPR",
      madeFor: "Fait avec ❤️ pour le Cameroun",
    },
  },

  // Splash screen
  splash: {
    tagline: "Le travail, simplifié.",
    madeIn: "Made in Cameroon",
    version: "v1.0.0",
  },

  // Temps réel (lot 7d)
  realtime: {
    suspendedTitle: "Votre compte est suspendu.",
    suspendedBody:
      "Vous pouvez consulter vos informations, mais plus postuler, publier, sélectionner, signer ni démarrer de mission. Contactez le support.",
    unavailable: "Ce contenu n'est plus disponible.",
    actionUnavailable: "Action indisponible : compte suspendu.",
  },

  // Chatbot
  chatbot: {
    name: "EasyBot",
    status: "Assistant IA · En ligne",
    openChat: "Ouvrir le chat",
    closeChat: "Fermer le chat",
    greeting:
      "Bonjour ! Je suis EasyBot, votre assistant virtuel. Comment puis-je vous aider aujourd'hui ?",
    placeholder: "Écrivez votre message...",
    q1: "Comment postuler ?",
    q2: "Comment suis-je rémunéré ?",
    q3: "Comment publier une offre ?",
    q4: "Où signer mon contrat ?",
    send: "Envoyer",
    signIn: "Se connecter",
    errors: {
      not_authenticated: "Connectez-vous pour discuter avec EasyBot.",
      account_inactive:
        "EasyBot est disponible une fois votre compte ouvert (téléphone vérifié) et actif.",
      chat_payload_too_large:
        "Message ou conversation trop long. Raccourcissez votre question.",
      invalid_chat_request: "Message invalide. Réessayez.",
      chat_quota_exceeded:
        "Vous avez atteint la limite de questions. Réessayez plus tard.",
      chat_unavailable:
        "EasyBot est momentanément indisponible. Réessayez plus tard ou écrivez à support@easyjob.cm.",
      generic: "Une erreur est survenue. Réessayez.",
    },
  },
};

export type TranslationKeys = typeof fr;
