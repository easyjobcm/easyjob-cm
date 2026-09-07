import type { TranslationKeys } from "./fr";

export const en: TranslationKeys = {
  // Common
  common: {
    loading: "Loading...",
    error: "An error occurred",
    retry: "Retry",
    cancel: "Cancel",
    confirm: "Confirm",
    save: "Save",
    delete: "Delete",
    edit: "Edit",
    back: "Back",
    close: "Close",
    next: "Next",
    previous: "Previous",
    search: "Search",
    filter: "Filter",
    sort: "Sort",
    all: "All",
    none: "None",
    yes: "Yes",
    no: "No",
    or: "or",
    and: "and",
  },

  // App name
  app: {
    name: "EasyJob CM",
    tagline: "Find your next flexible job",
    description:
      "The platform connecting candidates and companies for flexible missions in Cameroon.",
  },

  // Auth
  auth: {
    welcome: "Welcome to EasyJob CM",
    welcomeBack: "Welcome back!",
    signIn: "Sign in",
    signUp: "Create account",
    signOut: "Sign out",
    phone: "Phone number",
    phonePlaceholder: "6XX XXX XXX",
    phoneHint: "Enter your Cameroonian number",
    invalidPhone: "Invalid phone number",
    otp: "Verification code",
    otpSent: "A code has been sent to",
    otpPlaceholder: "000000",
    otpHint: "Enter the 6-digit code",
    otpInvalid: "Invalid code",
    otpExpired: "Code expired",
    resendOtp: "Resend code",
    resendIn: "Resend in",
    verifying: "Verifying...",
    selectRole: "I am...",
    candidate: "A candidate",
    candidateDesc: "Looking for flexible missions",
    company: "A company",
    companyDesc: "Offering missions",
    termsAgree: "By continuing, you agree to our",
    terms: "Terms of Service",
    privacy: "Privacy Policy",
    loginPage: {
      title: "Welcome back!",
      subtitle: "Sign in to continue",
      email: "Email address",
      emailPlaceholder: "you@email.com",
      password: "Password",
      forgot: "Forgot password?",
      submit: "Sign in",
      noAccount: "Don't have an account?",
      createAccount: "Create account",
      errors: {
        invalidCredentials: "Incorrect email or password.",
        generic: "An error occurred. Try again.",
      },
    },
    forgotPage: {
      title: "Forgot your password?",
      subtitle: "Enter your email address to receive a 6-digit code.",
      email: "Email address",
      emailPlaceholder: "you@email.com",
      submit: "Send code",
      sending: "Sending…",
      backToLogin: "Back to sign in",
      errors: {
        generic: "An error occurred. Try again.",
      },
      otp: {
        title: "Check your email",
        subtitle: "A 6-digit code was sent to",
        checkSpam: "Check your spam folder if you don’t receive it.",
        verify: "Verify code",
        didntReceive: "Didn’t receive the code?",
        resend: "Resend",
        resendIn: "Resend in {seconds}s",
      },
    },
    resetPage: {
      title: "New password",
      subtitle: "Choose a secure password for your account.",
      password: "New password",
      passwordPlaceholder: "At least 8 characters",
      confirm: "Confirm password",
      confirmPlaceholder: "Repeat your password",
      submit: "Save password",
      saving: "Saving…",
      backToLogin: "Back to sign in",
      successTitle: "Password updated!",
      successMessage:
        "Your password has been changed successfully. You can now sign in.",
      goToLogin: "Sign in",
      sessionExpiredTitle: "Link expired",
      requestNewCode: "Request a new code",
      showPassword: "Show password",
      hidePassword: "Hide password",
      errors: {
        mismatch: "Passwords do not match.",
        tooShort: "At least 8 characters required.",
        sessionExpired:
          "The link has expired or is invalid. Please request a new code.",
        generic: "An error occurred. Try again.",
      },
    },
  },

  // Signup wizard
  signup: {
    chooseRole: {
      title: "Create my account",
      subtitle: "Choose your profile to get started",
      candidateTitle: "I'm looking for jobs",
      candidateDesc: "Find flexible missions and get paid fast.",
      companyTitle: "I'm hiring",
      companyDesc: "Post jobs and find reliable candidates in 24h.",
      alreadyAccount: "I already have an account",
      start: "Get started",
      recruit: "Start recruiting",
    },
    steps: {
      account: "Account",
      company: "Company",
      email: "Email",
      phone: "Phone",
      verify: "Verify",
    },
    candidate: {
      heroTitle: "Welcome future EasyJob star",
      heroSubtitle: "Jobs near you, paid via Mobile Money.",
    },
    company: {
      heroTitle: "Hire top talent",
      heroSubtitle: "Post in 2 minutes, receive qualified applicants.",
      companyName: "Company name",
      companyNamePlaceholder: "E.g. Boulangerie Akwa",
      niu: "Unique Identifier Number (NIU)",
      niuPlaceholder: "M123456789012X",
      niuHelp: "14 alphanumeric characters issued by DGI.",
    },
    account: {
      title: "Create your account",
      subtitle: "Email and a secure password.",
      email: "Email address",
      emailPlaceholder: "you@email.com",
      password: "Password",
      passwordHint:
        "At least 8 characters with lowercase, uppercase letters, digits and symbols (!@#$%^&*).",
      confirmPassword: "Confirm password",
      orContinueWith: "Or continue with",
      continueGoogle: "Continue with Google",
      terms: "I agree to the",
      termsLink: "Terms of Service",
      and: "and the",
      privacyLink: "Privacy Policy",
    },
    phoneStep: {
      title: "Your phone number",
      subtitle: "We'll send a verification code via SMS.",
      hint: "Cameroon format: 6XX XXX XXX",
      sendCode: "Send code",
    },
    emailOtp: {
      title: "Verify your email",
      subtitle: "A 6-digit code was sent to",
      didntReceive: "Didn't receive a code?",
      resend: "Resend",
      resendIn: "Resend in {seconds}s",
      checkSpam: "Don't forget to check your spam folder.",
      verify: "Verify",
    },
    otp: {
      title: "Enter the code",
      subtitle: "A 6-digit code was sent to",
      didntReceive: "Didn't receive a code?",
      resend: "Resend",
      resendIn: "Resend in {seconds}s",
      verify: "Verify",
    },
    welcome: {
      title: "Welcome to EasyJob!",
      subtitleCandidate:
        "Your account is created. Sign in to complete your profile and apply to jobs.",
      subtitleCompany:
        "Your account is created. Sign in to complete your profile and post your first job.",
      continue: "Sign in",
    },
    errors: {
      emailInvalid: "Invalid email address",
      emailAlreadyUsed: "This email is already in use.",
      passwordTooShort: "Password must be at least 8 characters.",
      passwordNeedsLetter: "Add at least one letter.",
      passwordNeedsDigit: "Add at least one digit.",
      passwordMismatch: "Passwords do not match.",
      phoneInvalid: "Invalid phone number. Format: 6XX XXX XXX.",
      phoneAlreadyUsed: "This phone number is already in use.",
      otpInvalid: "6-digit code required.",
      otpWrong: "Wrong code, try again.",
      otpExpired: "Code expired, request a new one.",
      niuInvalid: "Invalid NIU. 14 alphanumeric characters.",
      niuAlreadyUsed: "This NIU is already registered.",
      companyNameTooShort: "Name too short.",
      companyNameTooLong: "Name too long.",
      termsRequired: "You must accept the terms.",
      smsProviderMissing: "SMS service not configured. Contact support.",
      smsQuotaExceeded: "Too many attempts. Try again later.",
      emailQuotaExceeded: "Too many attempts. Try again later.",
      generic: "An error occurred. Try again.",
    },
  },

  // Navigation
  nav: {
    jobs: "Jobs",
    tasks: "Tasks",
    myJobs: "My Jobs",
    profile: "Profile",
  },

  // Jobs
  jobs: {
    title: "Available jobs",
    empty: "No jobs available",
    emptyDesc: "Check back soon for new opportunities",
    search: "Search for a job...",
    filters: "Filters",
    salary: "Salary",
    location: "Location",
    date: "Date",
    duration: "Duration",
    apply: "Apply",
    applied: "Application sent",
    deadline: "Deadline",
    spotsLeft: "spots left",
    perHour: "/hour",
    perDay: "/day",
    perMission: "/mission",
  },

  // Tasks
  tasks: {
    title: "My tasks",
    empty: "You're all set!",
    emptyDesc: "No pending tasks at the moment",
    pending: "Pending",
    inProgress: "In progress",
    completed: "Completed",
    upcoming: "Upcoming",
    discoverJobs: "Discover jobs",
  },

  // My Jobs
  myJobs: {
    title: "My Jobs",
    applications: "Applications",
    booked: "Booked",
    worked: "Worked",
    empty: "Find your next job!",
    emptyDesc: "You don't have any applications yet",
    browseJobs: "Browse jobs",
  },

  // Profile
  profile: {
    title: "Profile",
    editProfile: "Edit profile",
    availability: "My availability",
    availabilityEdit: "Edit",
    availabilityPage: {
      title: "Availability",
      subtitle: "Indicate the days and hours you're available to work.",
      days: {
        monday: "Monday",
        tuesday: "Tuesday",
        wednesday: "Wednesday",
        thursday: "Thursday",
        friday: "Friday",
        saturday: "Saturday",
        sunday: "Sunday",
      },
      daysShort: {
        monday: "Mon",
        tuesday: "Tue",
        wednesday: "Wed",
        thursday: "Thu",
        friday: "Fri",
        saturday: "Sat",
        sunday: "Sun",
      },
      from: "From",
      to: "to",
      maxDistance: "Maximum travel distance",
      maxDistanceUnit: "km",
      noDaySelected: "No day selected yet.",
      save: "Save",
      saving: "Saving…",
      saved: "Availability updated",
      error: "Could not save. Please try again.",
      invalidRange: "End time must be after start time",
      summaryEmpty: "Availability not set",
    },
    myAccount: "My account",
    myLocation: "My location",
    myDocuments: "My documents",
    preferences: "Preferences",
    understandEasyJob: "Understand EasyJob",
    informationSection: "Information",
    personalData: "Personal data",
    newsUpdates: "News & Updates",
    settings: "Settings",
    support: "Support",
    helpSupport: "Help & Support",
    about: "About EasyJob",
    language: "Language",
    notifications: "Notifications",
    notificationCenter: {
      title: "Notifications",
      empty: "No notifications yet.",
      loadError: "Could not load notifications.",
      openLabel: "Notifications ({count} unread)",
      openLabelEmpty: "Notifications",
      channelsNote:
        "Per-channel preferences (push/SMS/email) aren't configurable yet.",
    },
    darkMode: "Dark mode",
    completion: {
      title: "Complete your profile",
      subtitle: "Reach 60% to apply for jobs",
      progress: "complete",
      cta: "Complete my profile",
      required60: "60% required to apply",
      done: "Done",
      todo: "To complete",
      criteria: {
        identity: "Personal information",
        photo: "Profile photo",
        skills: "Skills",
        bio: "Past experience",
        availability: "Availability",
        location: "GPS location",
        cni: "National ID card",
        momo: "Mobile Money verified",
        sector: "Sector of activity",
        description: "Company description",
        logo: "Company logo",
        address: "City and address",
        legal: "RCCM / NIU number",
        contact: "Main contact",
      },
      sandbox: {
        title: "Your Sandbox level",
        current: "Current level",
        unlockNext: "To reach the next level:",
        level0: "New",
        level1: "Confirmed",
        level2: "Reliable",
        level3: "Expert",
        missions0: "Introductory missions",
        missions1: "Intermediate missions",
        missions2: "Responsible missions",
        missions3: "All missions",
        req_registered: "Registration validated",
        req_m1_r35: "1 mission + rating ≥ 3.5★",
        req_m3_r4_p80: "3 missions + rating ≥ 4★ + profile ≥ 80%",
        req_m10_r45_verified: "10 missions + rating ≥ 4.5★ + verified badge",
      },
    },
    edit: {
      title: "Edit my information",
      firstName: "First name",
      lastName: "Last name",
      city: "City",
      quartier: "Neighborhood",
      bio: "About you",
      bioHint:
        "Briefly describe your experience (more than 10 characters to count towards completion).",
      skills: "Skills",
      addSkills: "Add my skills",
      save: "Save",
      saving: "Saving…",
      saved: "Profile updated",
      error: "Could not save. Please try again.",
      firstNameRequired: "First name is required",
      lastNameRequired: "Last name is required",
      cityRequired: "Select a city",
      unsavedWarning: "You have unsaved changes. Leave anyway?",
    },
    documents: {
      title: "Documents",
      photo: "Profile photo",
      cniFront: "ID card (front)",
      cniBack: "ID card (back)",
      cniSelfie: "Selfie holding your ID",
      missing: "Missing",
      uploaded: "Uploaded",
      uploading: "Uploading…",
      pending: "Pending review",
      verified: "Verified",
      rejected: "Rejected",
      expired: "Expired",
      tooLarge: "File too large (5 MB max)",
      uploadFailed: "Upload failed. Please try again.",
    },
    geolocation: {
      title: "Precise location",
      explain:
        "Used to calculate your distance from job offers. Optional: you can continue with just your city and neighborhood.",
      useMyLocation: "Use my location",
      locating: "Locating…",
      success: "Location saved",
      denied:
        "Permission denied. You can continue with your city and neighborhood.",
      unavailable: "Location unavailable on this device.",
    },
    reverification: {
      modalTitle: "Confirm the change",
      modalBody:
        "Changing your name will require a new verification of your ID document. Do you want to continue?",
      confirm: "Confirm the change",
      bannerTitle: "Verification in progress",
      bannerBody:
        "Your ID document is being re-verified following a change to your name.",
    },
    myProfile: "My Profile",
    missionsCompleted: "missions completed",
    missionsPosted: "missions posted",
    statMissions: "Missions",
    statScore: "Score",
    statSkills: "Skills",
    mySkills: "My skills",
    locationLabel: "Location",
    sectorLabel: "Sector of activity",
    mobileMoney: "Mobile Money",
    paymentPage: {
      title: "Mobile Money",
      subtitle: "Used to receive your mission payments.",
      provider: "Provider",
      number: "Mobile Money number",
      numberPlaceholder: "6XX XXX XXX",
      save: "Save",
      saving: "Saving…",
      saved: "Mobile Money updated",
      error: "Could not save. Please try again.",
      verified: "Verified",
      pending: "Pending verification",
      notConfigured: "No payment method configured",
      edit: "Edit",
      revalidateNotice:
        "Changing the number or provider will require a new verification.",
    },
    security: "Security",
    settingsPage: {
      title: "Settings",
      languageSection: "Language",
      languageHint:
        "The change applies immediately and is kept after refreshing.",
      systemSection: "System information",
      appVersion: "App version",
      contractSection: "Terminate contract",
      contractUnavailable:
        "Self-service termination isn't available yet. Contact support for any request about your subscription or account.",
      deleteSection: "Account deletion",
      deleteUnavailable:
        "Self-service account deletion isn't available yet: no retention or anonymization policy has been defined yet. Contact support to request it manually.",
      contactSupport: "Contact support",
    },
    securityPage: {
      title: "Account security",
      subtitle: "Change your sign-in password.",
      currentPassword: "Current password",
      newPassword: "New password",
      confirmPassword: "Confirm new password",
      save: "Update password",
      saving: "Updating…",
      saved: "Password updated",
      errorCurrent: "Current password is incorrect",
      errorMismatch: "Passwords do not match",
      errorTooShort: "Password must be at least 8 characters",
      errorGeneric: "Could not update password. Please try again.",
    },
    helpCenter: "Help Center",
    helpPage: {
      title: "Help center",
      subtitle:
        "Our assistant can answer your questions right away. Tap the bubble at the bottom of the screen to talk to it.",
    },
    guidePage: {
      title: "How does EasyJob work?",
      items: [
        {
          q: "How do I complete and get my profile verified?",
          a: 'Open Profile > Edit profile to fill in your identity, photo and documents (ID front/back/selfie). Each document goes to "pending" until an admin reviews it, then "verified" or "rejected".',
        },
        {
          q: "Why is a minimum percentage required?",
          a: "A profile at least 60% complete is required to apply to a job. This threshold ensures companies receive reliable applications.",
        },
        {
          q: "How do I search for a job?",
          a: "From the Jobs tab, use search and filters (city, category) to find missions that fit you.",
        },
        {
          q: "How do I apply?",
          a: "Open a job and tap Apply. Your application is sent in one click, no message needed.",
        },
        {
          q: "What is the Tasks tab for?",
          a: "It's your tracking center for mission-related steps: confirm your arrival and departure check-in times after a job, digitally sign your short-term contracts before a mission starts, and leave your review once a mission is completed. As long as a contract signature or an evaluation is pending, your next mission may be delayed. Uploading other documents (bank details, student proof, work certificate) and training/briefings aren't available yet in the app.",
        },
        {
          q: "How do I track my applications in My Jobs?",
          a: "The My Jobs tab groups your applications, booked missions and completed ones.",
        },
        {
          q: "What are the possible application statuses?",
          a: "Pending, shortlisted, selected, rejected, withdrawn, or no-show.",
        },
        {
          q: "How do I manage my availability?",
          a: "From Profile > My availability, pick your days, hours, and maximum travel distance.",
        },
        {
          q: "How do I edit my skills?",
          a: "From Profile > Edit profile, add or remove skills in the dedicated section.",
        },
        {
          q: "How do I change my location?",
          a: 'From Profile > Edit profile, change your city and neighborhood, or use "Use my location" with your consent.',
        },
        {
          q: "How do I send and replace my documents?",
          a: "From Profile > Edit profile, Documents section: tap a document to upload a new one, it automatically replaces the old one.",
        },
        {
          q: "How do notifications work?",
          a: "The bell at the top of your profile shows your real unread notifications; tap it to view and mark them read.",
        },
        {
          q: "How does Mobile Money work?",
          a: "From Profile > Mobile Money, add or edit your MTN or Orange number. Changing the number requires a new verification.",
        },
        {
          q: "When do I get paid?",
          a: "It depends on your profile: 7 days after the mission by default, 48h if you're Premium and well rated, or split 50/50 if only one condition is met.",
        },
        {
          q: "How does Premium work?",
          a: "Premium (1,000 FCFA/month) improves your application priority and payment delay. Self-service subscription isn't available yet: contact support.",
        },
        {
          q: "How do I get help?",
          a: "Open the Help center from the Profile menu to talk to the assistant.",
        },
        {
          q: "What are the essential security rules?",
          a: "Never share your password, verify your identity before any sensitive change, and manage your password from Profile > Security.",
        },
      ],
    },
    terms: "Terms of Service",
    termsPage: {
      title: "Terms of Service",
      pending:
        "The official terms of use content has not been published on this page yet. It will be added once validated.",
    },
    privacyPage: {
      title: "Privacy Policy",
      pending:
        "The official privacy policy content has not been published on this page yet. It will be added once validated.",
    },
    logout: "Log out",
    logoutTitle: "Log out?",
    logoutDesc: "Are you sure you want to log out?",
    cancel: "Cancel",

    // ── Statuses & Premium (candidate) ───────────────────────
    status: {
      candidate: "Candidate",
      candidatePremium: "Premium Candidate",
      company: "Company",
      companyPremium: "Premium Company",
      new: "New",
    },
    premium: {
      sectionTitle: "My Premium benefits",
      activeBadge: "Premium active",
      expiresOn: "Expires on {date}",
      renewSoon: "Renewing soon",
      benefits: {
        fastPayment: {
          title: "Fast payment",
          desc4Stars:
            "100% within 48h once your rating exceeds 4★. Otherwise 50% immediately + 50% within 7 days.",
          descDefault: "50% immediately + 50% within 7 days.",
        },
        priority: {
          title: "Priority on applications",
          desc: "Your profile is shown first to companies.",
        },
        exclusive: {
          title: "Exclusive jobs",
          desc: "Access missions reserved for Premium candidates.",
        },
      },
    },
    upgradePremium: {
      title: "Go Premium",
      tagline: "Boost your chances. Get paid faster.",
      price: "1,000 FCFA",
      pricePeriod: "/ month",
      ctaPrimary: "Become Premium",
      ctaSecondary: "See benefits",
      bullets: {
        fastPayment: "Paid in 48h instead of 7 days",
        priority: "Priority on every application",
        exclusive: "Access to exclusive Premium jobs",
      },
      statusActive: "Premium active until {date}",
      statusExpired: "Your Premium subscription expired on {date}",
      statusNone: "You're not subscribed to Premium yet",
      subscribeUnavailable:
        "Self-service payment isn't available yet. Contact support to activate your Premium subscription.",
      renewalNote:
        "Renewal and cancellation are handled manually by support until online payment is available.",
      contactSupport: "Contact support",
    },
    paymentDelay: {
      title: "Payment delay",
      standard: "7 days after the mission",
      premiumFast: "100% within 48h",
      premiumSplit: "50% immediate + 50% within 7d",
      improveCta: "Improve your rating to unlock 48h payment",
    },

    // ── Statuses & Plans (company) ───────────────────────────
    plan: {
      free: "Free",
      starter: "Starter",
      pro: "Pro",
      business: "Business",
      currentPlan: "Current plan",
      expiresOn: "Expires on {date}",
      renews: "Renews on {date}",
      prioritySupport: "Priority 24/7 support",
      features: {
        title: "My plan",
        jobsLimitFree: "Up to 2 active jobs",
        jobsLimitStarter: "5 active jobs",
        jobsLimitPro: "Unlimited jobs",
        jobsLimitBusiness: "Unlimited jobs",
        urgentPaid: "Urgent options paid",
        urgentFree: "Urgent options included",
        aiRecoOff: "No AI recommendations",
        aiRecoOn: "AI recommendations from past workers",
        reportingOff: "No reporting",
        reportingBasic: "Basic reporting",
        reportingAdvanced: "Advanced reporting",
        editOff: "Limited editing — contact support",
        editOn: "Direct editing of active jobs",
      },
    },
    activeJobs: {
      title: "My published jobs",
      used: "{used} published out of {total} available",
      unlimited: "Unlimited jobs",
      full: "Quota reached. Upgrade your plan to publish more.",
    },
    premiumCompanyBenefits: {
      sectionTitle: "My benefits",
      expiresOn: "Expires on {date}",
      // ── Free plan (5 perks) ──
      jobsUnlimited: {
        title: "Unlimited jobs",
        desc: "Post as many jobs as you want, 24/7.",
      },
      serviceFee10: {
        title: "10% service fee",
        desc: "Transparent commission, no hidden charges.",
      },
      urgentPaid: {
        title: "Urgent boost available",
        desc: "Boost a job for 2,000 FCFA whenever you need it.",
      },
      securePayment: {
        title: "Secure payment",
        desc: "Your payments are held until the mission is validated.",
      },
      historyAccess: {
        title: "Full history",
        desc: "Access all your past missions and invoices.",
      },
      // ── Starter plan (4 perks) ──
      reducedFee: {
        title: "Reduced 8% service fee",
        desc: "Save 2% on every mission compared to Free.",
      },
      urgentReduced: {
        title: "Discounted urgent boost",
        desc: "1,000 FCFA instead of 2,000 FCFA to promote your jobs.",
      },
      visibility: {
        title: "Higher visibility",
        desc: "Your jobs appear higher in candidate search results.",
      },
      standardSupport: {
        title: "Standard support 48h",
        desc: "A team available to help you within 48h.",
      },
      // ── Pro plan (10 perks) ──
      zeroFee: {
        title: "0% service fee",
        desc: "No commission on your missions, your plan covers it all.",
      },
      freeUrgent: {
        title: "Unlimited urgent boosts",
        desc: "Boost all your jobs with no extra cost.",
      },
      aiMatch: {
        title: "AI Talent Match",
        desc: "AI pre-selects the best profiles for each of your jobs.",
      },
      favorites: {
        title: "Favorites list",
        desc: "Bookmark your top candidates and find them quickly.",
      },
      directInvite: {
        title: "Direct invitations",
        desc: "Invite your favorites to a mission without public applications.",
      },
      templates: {
        title: "Job templates",
        desc: "Create and reuse templates to publish in 30 seconds.",
      },
      monthlyReport: {
        title: "Monthly report",
        desc: "Track your KPIs: time-to-fill, no-show, satisfaction.",
      },
      pdfExport: {
        title: "PDF / Excel export",
        desc: "Download your data and invoices for accounting.",
      },
      directEdit: {
        title: "Direct editing",
        desc: "Edit your published jobs anytime, no support needed.",
      },
      trialFree: {
        title: "7-day free trial",
        desc: "Try the plan with no commitment, cancel anytime.",
      },
      // ── Business plan (10 perks) ──
      guaranteedReplacement: {
        title: "Guaranteed replacement",
        desc: "If a candidate doesn't show up, we replace them within 2h.",
      },
      bulkHiring: {
        title: "Bulk hiring",
        desc: "Hire 10+ candidates in a single action.",
      },
      priorityInvite: {
        title: "Priority invitations",
        desc: "Your invitations appear at the top of candidate notifications.",
      },
      availabilityAlerts: {
        title: "Availability alerts",
        desc: "Get notified the moment a favorite candidate becomes available.",
      },
      presenceDashboard: {
        title: "Presence dashboard",
        desc: "See in real time who's on-site for your missions.",
      },
      sectorContracts: {
        title: "Sector contracts",
        desc: "Legally vetted templates per sector (construction, events, etc.).",
      },
      advancedReporting: {
        title: "Advanced reporting",
        desc: "Multi-dimensional analytics and cross-team comparisons.",
      },
      dedicatedManager: {
        title: "Dedicated Account Manager",
        desc: "A single point of contact, 4h SLA, monthly strategic reviews.",
      },
      prioritySLA: {
        title: "Priority SLA",
        desc: "24/7 support, tickets handled within 1h.",
      },
      immediateModeration: {
        title: "Immediate moderation",
        desc: "Your jobs are validated in under 30 minutes.",
      },
      // ── Cancellation penalties ──
      cancellationPenalty: {
        label: "Late cancellation:",
        freeStarter:
          "you recover 50% of the locked amount. 25% goes to premium candidates, 25% to EasyJob.",
        pro: "you recover 75% of the locked amount. 25% goes to premium candidates.",
        business:
          "you recover 100% of the locked amount. No penalty — guaranteed replacement.",
      },
    },
    upgradeBanner: {
      title: "Your competitors hire faster",
      tagline: "0% fees. AI screens candidates for you. Free 7-day trial.",
      taglineStarter: "Stop paying fees. Switch to Pro — 7 days free.",
      // Short labels inside plan rows
      starter: "Starter",
      starterKicker: "8% fee · Urgent boost at 1,000 FCFA · Higher visibility",
      pro: "Pro",
      proKicker: "0% fee · AI shortlisting · Favorites · Templates · Report",
      business: "Business",
      businessKicker:
        "7 days free · Replacement in 2h guaranteed · Dedicated manager · <30 min SLA",
      // Badges & CTA
      recommended: "Recommended",
      trialBadge: "7d free",
      ctaTrial: "Try Pro — 7 days free",
      cta: "See plans",
      businessCta: "Learn more about Business",
    },

    // ── Premium Company Showcase ────────────────────────────
    premiumCompany: {
      sectionLabel: "Your strategic advantage",
      headlineStarter: "Hire faster. Without limits.",
      headlinePro: "AI hires for you.",
      headlineBusiness: "Tailor-made for large teams.",
      taglineStarter:
        "5 simultaneous jobs, urgent options included, direct editing.",
      taglinePro:
        "Unlimited jobs, AI recommending your top candidates, reporting.",
      taglineBusiness:
        "Dedicated account manager, guaranteed SLA, branding, multi-user, advanced reporting.",
      metrics: {
        timeToHire: { value: "−45%", label: "Time to hire" },
        compliance: { value: "100%", label: "Contract compliance" },
        retention: { value: "×2", label: "Reliable talent retention" },
      },
      pillars: {
        control: {
          title: "Full control",
          desc: "Instantly edit your active jobs without going through support.",
        },
        security: {
          title: "Enhanced security",
          desc: "Priority ID-verified candidates + signed and archived contracts.",
        },
        aiTalent: {
          title: "AI Talent Match",
          desc: "Smart recommendations based on your past high-performing workers.",
        },
        priorityPool: {
          title: "Priority talent pool",
          desc: "Your jobs appear first to Premium and 4★+ rated candidates.",
        },
        reporting: {
          title: "Reporting & Analytics",
          desc: "Track your KPIs in real time: fill rate, no-show, satisfaction.",
        },
        accountManager: {
          title: "Dedicated Account Manager",
          desc: "Single point of contact, 4h SLA, monthly strategic guidance.",
        },
        branding: {
          title: "Company branding",
          desc: "Your jobs with your logo, colors, and tone of voice.",
        },
        team: {
          title: "Multi-user accounts",
          desc: "Grant access to your full HR team with granular permissions.",
        },
      },
      socialProof: "12 major Cameroonian companies already trust us",
      manageButton: "Manage subscription",
      upgradePlan: "Upgrade to {plan}",
    },
  },

  // Days
  days: {
    monday: "Mon",
    tuesday: "Tue",
    wednesday: "Wed",
    thursday: "Thu",
    friday: "Fri",
    saturday: "Sat",
    sunday: "Sun",
  },

  // Errors
  errors: {
    generic: "An error occurred. Please try again.",
    network: "Connection error. Check your internet.",
    unauthorized: "Session expired. Please sign in again.",
    notFound: "Page not found",
    serverError: "Server error. Please try again later.",
  },

  // Success messages
  success: {
    saved: "Saved successfully",
    deleted: "Deleted successfully",
    applied: "Application sent",
    profileUpdated: "Profile updated",
  },

  // Home / Landing page
  home: {
    badge: "Available in Douala & Yaoundé",
    hero: {
      title: "Find your next mission in one click",
      subtitle:
        "The platform connecting Cameroonian talent with local businesses. Mobile Money payment, digital contract, guaranteed trust.",
      ctaCandidate: "I am looking for a job",
      ctaCompany: "I am hiring",
      trust: "Free registration · Mobile Money payment · Signed contract",
    },
    stats: {
      missions: "Published missions",
      companies: "Active companies",
      candidates: "Registered candidates",
      cities: "Cities covered",
    },
    how: {
      title: "How it works",
      candidate: "I am a candidate",
      company: "I am a company",
      step1: "Step 1",
      step2: "Step 2",
      step3: "Step 3",
      cStep1Title: "Create your profile",
      cStep1Desc:
        "Sign up in 2 min. Photo, skills, verified ID. AI completes your profile automatically.",
      cStep2Title: "Apply in one click",
      cStep2Desc:
        "Find a mission that fits your schedule. No message required. Fast response.",
      cStep3Title: "Get paid",
      cStep3Desc:
        "Mission validated? Your payment goes directly to your MTN or Orange MoMo.",
      eStep1Title: "Describe your need",
      eStep1Desc:
        "In a few words. AI generates your complete structured job listing in under 5 seconds.",
      eStep2Title: "Receive ranked profiles",
      eStep2Desc:
        "Our algorithm shows you the closest and most suitable candidates first.",
      eStep3Title: "Mission done",
      eStep3Desc:
        "Validate the mission end. Candidate payment is handled automatically by EasyJob CM.",
    },
    features: {
      title: "Why choose EasyJob CM",
      f1Title: "Mobile Money Payment",
      f1Desc:
        "MTN MoMo & Orange Money. Guaranteed payment, transparent timeline based on your profile.",
      f2Title: "Digital Contract",
      f2Desc:
        "Every mission is covered by an electronically signed contract. Zero disputes.",
      f3Title: "Trust System",
      f3Desc:
        "The Sandbox level rewards reliability. Level up and access better opportunities.",
      f4Title: "AI Matching",
      f4Desc:
        "The algorithm recommends missions closest to you and matching your profile.",
    },
    sandbox: {
      title: "A unique trust system",
      subtitle:
        "Progress mission by mission. Each level unlocks new opportunities.",
      l0Name: "New",
      l0Desc: "Introductory missions",
      l1Name: "Confirmed",
      l1Desc: "1 mission · 3.5★",
      l2Name: "Reliable",
      l2Desc: "3 missions · 4★",
      l3Name: "Expert",
      l3Desc: "10 missions · 4.5★",
    },
    cta: {
      title: "Ready to start?",
      subtitle:
        "Join hundreds of candidates and companies in Douala and Yaoundé.",
      btn: "Create my free account",
      login: "I already have an account",
    },
  },

  // Cookie consent
  cookie: {
    title: "Your cookie preferences",
    desc: "We use cookies to improve your experience. Necessary cookies cannot be disabled.",
    subtitle: "Customise your preferences",
    accept: "Accept all",
    decline: "Decline",
    declineNonEssential: "Reject non-essential",
    back: "← Back",
    manage: "Manage cookies",
    necessary: "Necessary",
    necessaryDesc: "Essential for the application to function.",
    alwaysOn: "Always on",
    analytics: "Analytics",
    analyticsDesc: "Help us understand how you use the application.",
    marketing: "Marketing",
    marketingDesc: "Allow relevant ads to be displayed.",
    preferences: "Preferences",
    preferencesDesc: "Remember your display preferences.",
    save: "Save my choices",
    gdprNote: "GDPR · Necessary only",
  },

  // Landing page extras
  landing: {
    nav: {
      features: "Features",
      howItWorks: "How it works",
      about: "About",
      sandbox: "Sandbox",
    },
    theme: { darkMode: "Dark mode", lightMode: "Light mode" },
    language: { french: "Français", english: "English" },
    trust: {
      signup: "Free signup",
      momo: "Mobile Money payment",
      contract: "Signed contract",
    },
    simpleFastSecure: "Simple. Fast. Secure.",
    featuresLabel: "Features",
    mockup: {
      jobsNear: "Jobs near you",
      doualaCount: "Douala · 12 jobs",
      applyOneClick: "Apply in 1 click",
      paymentReceived: "Payment received",
      missionConfirmed: "Mission confirmed",
      expert: "Expert",
    },
    pwa: {
      title: "Install EasyJob CM on your device",
      desc: "PWA app — works offline, as fast as a native app. iOS, Android and desktop compatible.",
      install: "Install the app",
      installed: "App installed!",
      free: "Free · No store needed",
      guideTitle: "How to install the app",
      iosSafari: "Share → Add to Home Screen",
      android: "Menu ⋮ → Install app",
      desktop: "⊕ icon in the address bar",
    },
    footer: {
      product: "Product",
      company: "Company",
      support: "Support",
      legal: "Legal",
      pricing: "Pricing",
      about: "About",
      blog: "Blog",
      press: "Press",
      contact: "Contact",
      faq: "FAQ",
      helpCenter: "Help center",
      reportBug: "Report a bug",
      status: "Status",
      cookies: "Cookies",
      gdpr: "GDPR",
      madeFor: "Made with ❤️ for Cameroon",
    },
  },

  // Splash screen
  splash: {
    tagline: "Work, simplified.",
    madeIn: "Made in Cameroon",
    version: "v1.0.0",
  },

  // Chatbot
  chatbot: {
    name: "EasyBot",
    status: "AI Assistant · Online",
    openChat: "Open chat",
    closeChat: "Close chat",
    greeting:
      "Hi! I am EasyBot, your virtual assistant. How can I help you today?",
    placeholder: "Type your message...",
    q1: "How do I apply?",
    q2: "How do I withdraw my earnings?",
    q3: "How do I post a job?",
    q4: "What are the fees?",
  },
};
