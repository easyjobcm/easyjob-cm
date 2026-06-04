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
    completion: {
      title: "Complétez votre profil",
      subtitle: "Atteignez 60% pour postuler aux missions",
      progress: "complété",
      cta: "Compléter mon profil",
      required60: "60% requis pour postuler",
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
    security: "Sécurité",
    helpCenter: "Centre d'aide",
    terms: "Conditions d'utilisation",
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
      socialProof: "Rejoint par 1 200+ candidats déjà Premium",
      bullets: {
        fastPayment: "Payé en 48h au lieu de 7 jours",
        priority: "Priorité sur toutes les candidatures",
        exclusive: "Accès aux offres exclusives Premium",
      },
      microCommitment: "Sans engagement · Annulable à tout moment",
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
      directEdit: {
        title: "Modification directe",
        desc: "Éditez vos offres publiées à tout moment, sans passer par le support.",
      },
      verifiedCandidates: {
        title: "Candidats CNI vérifiés",
        desc: "Accès prioritaire aux profils avec identité validée et sans antécédents.",
      },
      urgentBoost: {
        title: "Option urgente incluse",
        desc: "Boostez une offre en 1h pour combler un poste critique rapidement.",
      },
      aiMatch: {
        title: "IA Talent Match",
        desc: "L'IA pré-sélectionne les meilleurs profils pour chacune de vos offres.",
      },
      unlimited: {
        title: "Offres illimitées",
        desc: "Publiez autant d'offres que nécessaire, 24h/7j, sans restriction.",
      },
      reporting: {
        title: "Reporting recrutement",
        desc: "Suivez vos délais d'embauche, taux de conversion et satisfaction.",
      },
      accountManager: {
        title: "Account Manager dédié",
        desc: "Un expert disponible en moins de 4h pour accompagner votre croissance.",
      },
      multiUser: {
        title: "Équipe RH multi-comptes",
        desc: "Jusqu'à 10 collaborateurs avec permissions personnalisées.",
      },
      branding: {
        title: "Branding entreprise",
        desc: "Vos offres avec votre logo et vos couleurs pour attirer les meilleurs talents.",
      },
    },
    upgradeBanner: {
      title: "Débloquez tout le potentiel d'EasyJob",
      tagline: "Plus d'offres, plus de talents, plus de croissance.",
      starter: "Starter — 5 offres + options urgentes",
      pro: "Pro — Offres illimitées + IA",
      business: "Business — Tout illimité + reporting avancé",
      cta: "Découvrir les plans",
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
