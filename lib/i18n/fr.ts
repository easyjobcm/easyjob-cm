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
    },
    jobPreview: {
      company: "Entreprise",
      description: "Description",
      date: "Date",
      time: "Horaires",
      location: "Lieu",
      salary: "Salaire",
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
      empty: "Aucun CNI sur ce filtre",
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
      verifiedBadge: "Entreprise vérifiée",
      viewProfile: "Voir le profil",
      suspend: "Suspendre",
      activate: "Réactiver",
      suspendConfirm:
        "Suspendre cette entreprise ? Elle ne pourra plus publier d'offres ni recevoir de candidatures.",
      activateConfirm: "Réactiver cette entreprise ?",
      readOnly:
        "Accès en lecture seule — seuls admin_ops et admin_founder peuvent suspendre ou réactiver.",
    },
    candidateProfile: {
      title: "Profil candidat",
      back: "Tous les candidats",
      identitySection: "Identité",
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
      statSandbox: "Niveau Sandbox",
      premiumLabel: "Premium",
      premiumNone: "Aucun abonnement Premium",
      premiumUntil: "jusqu'au",
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
    },
  },

  // Auth
  auth: {
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
      heroSubtitle: "Des missions près de chez vous, payées en Mobile Money.",
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
    perHour: "/heure",
    perDay: "/jour",
    perMission: "/mission",
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
  },

  // My Jobs
  myJobs: {
    title: "Mes Jobs",
    applications: "Candidatures",
    booked: "Réservés",
    worked: "Effectués",
    empty: "Trouvez votre prochain job !",
    emptyDesc: "Vous n'avez pas encore de candidatures",
    browseJobs: "Parcourir les jobs",
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
      premiumCta: "Passez à Premium",
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
      sandbox: {
        title: "Votre niveau Sandbox",
        current: "Niveau actuel",
        unlockNext: "Pour passer au niveau supérieur :",
        level0: "Nouveau",
        level1: "Confirmé",
        level2: "Fiable",
        level3: "Expert",
        missions0: "Missions d'initiation",
        missions1: "Missions intermédiaires",
        missions2: "Missions à responsabilité",
        missions3: "Toutes les missions",
        req_registered: "Inscription validée",
        req_m1_r35: "1 mission + note ≥ 3.5★",
        req_m3_r4_p80: "3 missions + note ≥ 4★ + profil ≥ 80%",
        req_m10_r45_verified: "10 missions + note ≥ 4.5★ + badge vérifié",
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
    statScore: "Score",
    statSkills: "Compétences",
    mySkills: "Mes compétences",
    locationLabel: "Localisation",
    sectorLabel: "Secteur d'activité",
    mobileMoney: "Mobile Money",
    paymentPage: {
      title: "Mobile Money",
      subtitle: "Utilisé pour recevoir vos paiements de mission.",
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
          a: "C'est votre centre de suivi pour les démarches liées à vos missions : validez vos heures d'arrivée et de départ après un job, signez numériquement vos contrats de courte durée avant de démarrer une mission, et donnez votre avis une fois la mission terminée. Tant qu'une signature de contrat ou une évaluation reste en attente, le démarrage de votre prochaine mission peut être retardé. Le dépôt d'autres documents (RIB, justificatif étudiant, certificat de travail) et les formations/briefings ne sont pas encore disponibles dans l'application.",
        },
        {
          q: "Comment suivre mes candidatures dans Mes Jobs ?",
          a: "L'onglet Mes Jobs regroupe vos candidatures (onglet Candidatures), vos missions réservées et celles terminées.",
        },
        {
          q: "Quels sont les statuts d'une candidature ?",
          a: "En attente, présélectionné, sélectionné, refusé, retiré ou absence non justifiée.",
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
          a: "Depuis Profil > Mobile Money, ajoutez ou modifiez votre numéro MTN ou Orange. Un changement de numéro nécessite une nouvelle vérification.",
        },
        {
          q: "Quand suis-je payé ?",
          a: "Selon votre profil : 7 jours après la mission par défaut, 48h si vous êtes Premium et bien noté, ou moitié-moitié si l'une des deux conditions est remplie.",
        },
        {
          q: "Comment fonctionne Premium ?",
          a: "Premium (1 000 FCFA/mois) améliore votre priorité de candidature et votre délai de paiement. La souscription en libre-service n'est pas encore disponible : contactez le support.",
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
    premium: {
      sectionTitle: "Mon avantage Premium",
      activeBadge: "Premium actif",
      expiresOn: "Expire le {date}",
      renewSoon: "Renouvellement imminent",
      benefits: {
        fastPayment: {
          title: "Paiement accéléré",
          desc4Stars:
            "100 % en 48h dès que votre note dépasse 4★. Sinon 50 % immédiat + 50 % sous 7 jours.",
          descDefault: "50 % immédiat + 50 % sous 7 jours.",
        },
        priority: {
          title: "Priorité dans les candidatures",
          desc: "Votre profil remonte en premier auprès des entreprises.",
        },
        exclusive: {
          title: "Offres exclusives",
          desc: "Accédez aux missions réservées aux candidats Premium.",
        },
      },
    },
    upgradePremium: {
      title: "Passez à Premium",
      tagline: "Multipliez vos chances. Soyez payé plus vite.",
      price: "1 000 FCFA",
      pricePeriod: "/ mois",
      ctaPrimary: "Devenir Premium",
      ctaSecondary: "Voir les avantages",
      bullets: {
        fastPayment: "Payé en 48h au lieu de 7 jours",
        priority: "Priorité sur toutes les candidatures",
        exclusive: "Accès aux offres exclusives Premium",
      },
      statusActive: "Premium actif jusqu'au {date}",
      statusExpired: "Votre abonnement Premium a expiré le {date}",
      statusNone: "Vous n'êtes pas encore abonné Premium",
      subscribeUnavailable:
        "Le paiement en libre-service n'est pas encore disponible. Contactez le support pour activer votre abonnement Premium.",
      renewalNote:
        "Le renouvellement et l'annulation sont gérés manuellement par le support tant que le paiement en ligne n'est pas disponible.",
      contactSupport: "Contacter le support",
    },
    paymentDelay: {
      title: "Délai de paiement",
      standard: "7 jours après la mission",
      premiumFast: "100 % en 48 h",
      premiumSplit: "50 % immédiat + 50 % sous 7 j",
      improveCta: "Améliorez votre note pour passer à 48 h",
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
        aiRecoOn: "Recommandations IA d'anciens travailleurs",
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
        title: "Paiement sécurisé",
        desc: "Vos paiements sont bloqués jusqu'à validation de la mission.",
      },
      historyAccess: {
        title: "Historique complet",
        desc: "Accédez à toutes vos missions passées et factures.",
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
        title: "IA Talent Match",
        desc: "L'IA pré-sélectionne les meilleurs profils pour chacune de vos offres.",
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
        title: "7 jours d'essai gratuits",
        desc: "Testez le plan sans engagement, annulez à tout moment.",
      },
      // ── Plan Business (10 avantages) ──
      guaranteedReplacement: {
        title: "Remplacement garanti",
        desc: "En cas de no-show, nous remplaçons le candidat sous 2h.",
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
        label: "Annulation tardive :",
        freeStarter:
          "vous récupérez 50% du montant bloqué. 25% pour les candidats premium, 25% pour EasyJob.",
        pro: "vous récupérez 75% du montant bloqué. 25% pour les candidats premium.",
        business:
          "vous récupérez 100% du montant bloqué. Aucune pénalité — remplacement garanti.",
      },
    },
    upgradeBanner: {
      title: "Vos concurrents recrutent plus vite",
      tagline:
        "0% de frais. L'IA sélectionne pour vous. Essai gratuit 7 jours.",
      taglineStarter:
        "Arrêtez de payer des frais. Passez au Pro — 7 jours offerts.",
      // Labels courts dans les lignes de plan
      starter: "Starter",
      starterKicker:
        "Frais réduits à 8% · Urgentes à 1 000 FCFA · Visibilité accrue",
      pro: "Pro",
      proKicker:
        "0% de frais · IA qui sélectionne · Favoris · Modèles · Rapport",
      business: "Business",
      businessKicker:
        "7j offerts · Remplacement en 2h garanti · Manager dédié · SLA <30 min",
      // Badges & CTA
      recommended: "Recommandé",
      trialBadge: "7j gratuits",
      ctaTrial: "Essayer Pro — 7 jours gratuits",
      cta: "Voir les plans",
      businessCta: "En savoir plus sur Business",
    },

    // ── Showcase Premium Entreprise ─────────────────────────
    premiumCompany: {
      sectionLabel: "Votre avantage stratégique",
      headlineStarter: "Recrutez plus vite. Sans limite.",
      headlinePro: "L'IA recrute pour vous.",
      headlineBusiness: "Le sur-mesure pour les grandes équipes.",
      taglineStarter:
        "5 offres simultanées, options urgentes incluses, modification directe.",
      taglinePro:
        "Offres illimitées, IA qui recommande vos meilleurs candidats, reporting.",
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
          title: "IA Talent Match",
          desc: "Recommandations intelligentes basées sur vos anciens travailleurs performants.",
        },
        priorityPool: {
          title: "Pool de talents prioritaire",
          desc: "Vos offres remontent en premier auprès des candidats Premium et notés 4★+.",
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
        "La plateforme qui connecte les talents camerounais aux entreprises locales. Paiement Mobile Money, contrat digital, confiance garantie.",
      ctaCandidate: "Je cherche une mission",
      ctaCompany: "Je recrute",
      trust: "Inscription gratuite · Paiement Mobile Money · Contrat signé",
    },
    stats: {
      missions: "Missions publiées",
      companies: "Entreprises actives",
      candidates: "Candidats inscrits",
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
        "Inscription en 2 min. Photo, compétences, CNI vérifiée. L'IA complète votre profil automatiquement.",
      cStep2Title: "Postulez en 1 clic",
      cStep2Desc:
        "Trouvez une offre adaptée à vos disponibilités. Aucun message requis. Réponse rapide.",
      cStep3Title: "Recevez votre paiement",
      cStep3Desc:
        "Mission validée ? Votre paiement arrive directement sur votre MoMo MTN ou Orange Money.",
      eStep1Title: "Décrivez votre besoin",
      eStep1Desc:
        "En quelques mots. L'IA génère votre offre complète et structurée en moins de 5 secondes.",
      eStep2Title: "Recevez des profils triés",
      eStep2Desc:
        "Notre algorithme vous présente les candidats les plus proches et les plus adaptés en premier.",
      eStep3Title: "Mission accomplie",
      eStep3Desc:
        "Validez la fin de mission. Le paiement des candidats est géré automatiquement par EasyJob CM.",
    },
    features: {
      title: "Pourquoi choisir EasyJob CM",
      f1Title: "Paiement Mobile Money",
      f1Desc:
        "MTN MoMo & Orange Money. Paiement garanti, délai transparent selon votre profil.",
      f2Title: "Contrat digital",
      f2Desc:
        "Chaque mission est couverte par un contrat signé électroniquement. Zéro litige.",
      f3Title: "Système de confiance",
      f3Desc:
        "Le niveau Sandbox récompense la fiabilité. Montez en grade, accédez aux meilleures offres.",
      f4Title: "Matching par IA",
      f4Desc:
        "L'algorithme vous recommande les missions les plus proches de chez vous et de votre profil.",
    },
    sandbox: {
      title: "Un système de confiance unique",
      subtitle:
        "Progressez mission après mission. Chaque niveau débloque de nouvelles opportunités.",
      l0Name: "Nouveau",
      l0Desc: "Missions d'initiation",
      l1Name: "Confirmé",
      l1Desc: "1 mission · 3.5★",
      l2Name: "Fiable",
      l2Desc: "3 missions · 4★",
      l3Name: "Expert",
      l3Desc: "10 missions · 4.5★",
    },
    cta: {
      title: "Prêt à commencer ?",
      subtitle:
        "Rejoignez des centaines de candidats et entreprises à Douala et Yaoundé.",
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
      sandbox: "Sandbox",
    },
    theme: { darkMode: "Mode sombre", lightMode: "Mode clair" },
    language: { french: "Français", english: "English" },
    trust: {
      signup: "Inscription gratuite",
      momo: "Paiement Mobile Money",
      contract: "Contrat signé",
    },
    simpleFastSecure: "Simple. Rapide. Sécurisé.",
    featuresLabel: "Fonctionnalités",
    mockup: {
      jobsNear: "Missions près de vous",
      doualaCount: "Douala · 12 offres",
      applyOneClick: "Postuler en 1 clic",
      paymentReceived: "Paiement reçu",
      missionConfirmed: "Mission confirmée",
      expert: "Expert",
    },
    pwa: {
      title: "Installez EasyJob CM sur votre appareil",
      desc: "Application PWA — fonctionne hors ligne, rapide comme une app native. Compatible iOS, Android et desktop.",
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
    q2: "Comment retirer mes gains ?",
    q3: "Comment publier une offre ?",
    q4: "Quels sont les frais ?",
  },
};

export type TranslationKeys = typeof fr;
