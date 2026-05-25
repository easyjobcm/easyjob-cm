export const fr = {
  // Common
  common: {
    loading: 'Chargement...',
    error: 'Une erreur est survenue',
    retry: 'Réessayer',
    cancel: 'Annuler',
    confirm: 'Confirmer',
    save: 'Enregistrer',
    delete: 'Supprimer',
    edit: 'Modifier',
    back: 'Retour',
    next: 'Suivant',
    previous: 'Précédent',
    search: 'Rechercher',
    filter: 'Filtrer',
    sort: 'Trier',
    all: 'Tout',
    none: 'Aucun',
    yes: 'Oui',
    no: 'Non',
    or: 'ou',
    and: 'et',
  },
  
  // App name
  app: {
    name: 'EasyJob CM',
    tagline: 'Trouvez votre prochain job flexible',
    description: 'La plateforme de mise en relation entre candidats et entreprises pour des missions flexibles au Cameroun.',
  },
  
  // Auth
  auth: {
    welcome: 'Bienvenue sur EasyJob CM',
    welcomeBack: 'Bon retour !',
    signIn: 'Se connecter',
    signUp: 'Créer un compte',
    signOut: 'Se déconnecter',
    phone: 'Numéro de téléphone',
    phonePlaceholder: '6XX XXX XXX',
    phoneHint: 'Entrez votre numéro camerounais',
    invalidPhone: 'Numéro de téléphone invalide',
    otp: 'Code de vérification',
    otpSent: 'Un code a été envoyé au',
    otpPlaceholder: '000000',
    otpHint: 'Entrez le code à 6 chiffres',
    otpInvalid: 'Code invalide',
    otpExpired: 'Code expiré',
    resendOtp: 'Renvoyer le code',
    resendIn: 'Renvoyer dans',
    verifying: 'Vérification...',
    selectRole: 'Je suis...',
    candidate: 'Un candidat',
    candidateDesc: 'Je cherche des missions flexibles',
    company: 'Une entreprise',
    companyDesc: 'Je propose des missions',
    termsAgree: 'En continuant, vous acceptez nos',
    terms: 'Conditions générales',
    privacy: 'Politique de confidentialité',
  },
  
  // Navigation
  nav: {
    jobs: 'Jobs',
    tasks: 'Tâches',
    myJobs: 'Mes Jobs',
    profile: 'Profil',
  },
  
  // Jobs
  jobs: {
    title: 'Offres disponibles',
    empty: 'Aucune offre disponible',
    emptyDesc: 'Revenez bientôt pour découvrir de nouvelles opportunités',
    search: 'Rechercher un job...',
    filters: 'Filtres',
    salary: 'Salaire',
    location: 'Lieu',
    date: 'Date',
    duration: 'Durée',
    apply: 'Postuler',
    applied: 'Candidature envoyée',
    deadline: 'Date limite',
    spotsLeft: 'places restantes',
    perHour: '/heure',
    perDay: '/jour',
    perMission: '/mission',
  },
  
  // Tasks
  tasks: {
    title: 'Mes tâches',
    empty: 'Vous êtes prêt !',
    emptyDesc: 'Aucune tâche en attente pour le moment',
    pending: 'En attente',
    inProgress: 'En cours',
    completed: 'Terminées',
    upcoming: 'À venir',
    discoverJobs: 'Découvrir les jobs',
  },
  
  // My Jobs
  myJobs: {
    title: 'Mes Jobs',
    applications: 'Candidatures',
    booked: 'Réservés',
    worked: 'Effectués',
    empty: 'Trouvez votre prochain job !',
    emptyDesc: 'Vous n\'avez pas encore de candidatures',
    browseJobs: 'Parcourir les jobs',
  },
  
  // Profile
  profile: {
    title: 'Profil',
    editProfile: 'Modifier le profil',
    availability: 'Ma disponibilité',
    availabilityEdit: 'Modifier',
    myAccount: 'Mon compte',
    personalData: 'Données personnelles',
    newsUpdates: 'Actualités',
    settings: 'Paramètres',
    support: 'Support',
    helpSupport: 'Aide & Support',
    about: 'À propos d\'EasyJob',
    language: 'Langue',
    notifications: 'Notifications',
    darkMode: 'Mode sombre',
  },
  
  // Days
  days: {
    monday: 'Lun',
    tuesday: 'Mar',
    wednesday: 'Mer',
    thursday: 'Jeu',
    friday: 'Ven',
    saturday: 'Sam',
    sunday: 'Dim',
  },
  
  // Errors
  errors: {
    generic: 'Une erreur est survenue. Veuillez réessayer.',
    network: 'Erreur de connexion. Vérifiez votre internet.',
    unauthorized: 'Session expirée. Veuillez vous reconnecter.',
    notFound: 'Page non trouvée',
    serverError: 'Erreur serveur. Veuillez réessayer plus tard.',
  },
  
  // Success messages
  success: {
    saved: 'Enregistré avec succès',
    deleted: 'Supprimé avec succès',
    applied: 'Candidature envoyée',
    profileUpdated: 'Profil mis à jour',
  },
}

export type TranslationKeys = typeof fr
