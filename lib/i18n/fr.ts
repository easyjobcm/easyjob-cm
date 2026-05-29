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
      passwordHint: "Au moins 8 caractères, lettres et chiffres.",
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
        "Votre compte est créé. Complétons votre profil pour postuler aux missions.",
      subtitleCompany:
        "Votre compte est créé. Complétons votre profil pour publier votre première offre.",
      continue: "Continuer",
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
    myAccount: "Mon compte",
    personalData: "Données personnelles",
    newsUpdates: "Actualités",
    settings: "Paramètres",
    support: "Support",
    helpSupport: "Aide & Support",
    about: "À propos d'EasyJob",
    language: "Langue",
    notifications: "Notifications",
    darkMode: "Mode sombre",
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
