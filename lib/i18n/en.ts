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

  // Administration (T8)
  admin: {
    dashboard: {
      title: "Administration",
      subtitle: "Platform management",
    },
    stats: {
      users: "Users",
      candidates: "candidates",
      companies: "companies",
      totalJobs: "Total jobs",
      activeJobs: "active",
      applications: "Applications",
      pending: "Pending review",
    },
    quickActions: {
      users: "Candidates",
      jobs: "Jobs",
      momo: "Mobile Money",
      skillProofs: "Skill proofs",
    },
    moderation: {
      pendingJobsTitle: "Jobs to moderate",
      viewAll: "See all",
      view: "View",
      approve: "Approve",
      reject: "Reject",
      empty: "No jobs pending moderation",
      pendingStatus: "Pending",
      urgent: "Urgent",
      reasonLabel: "Rejection reason",
      reasonPlaceholder: "Tell the company what to correct",
      confirmReject: "Confirm rejection",
      approvedToast: "Job approved: candidates can now see it.",
      rejectedToast: "Job rejected: the company has been notified.",
      errorTitle: "Decision not saved",
      errors: {
        forbidden: "Only ops and founder admins can moderate jobs.",
        reason_required:
          "A rejection reason is required (at least 3 characters).",
        reason_too_long: "Reason too long (500 characters maximum).",
        job_not_pending:
          "This job has already been moderated. The list was refreshed.",
        job_changed:
          "The company edited the job in the meantime. Review it before deciding.",
        company_not_eligible:
          "Company suspended or not verified: the job cannot be published.",
        job_not_found: "Job not found.",
        not_authenticated: "Session expired. Please sign in again.",
        invalid_action: "Invalid action.",
        moderation_failed: "The decision could not be saved. Please try again.",
      },
    },
    jobPreview: {
      company: "Company",
      description: "Description",
      date: "Date",
      time: "Time",
      location: "Location",
      pay: "Pay per candidate",
      positions: "People needed",
      positionsValue: "{count} person(s)",
    },
    momo: {
      title: "Mobile Money review",
      subtitle:
        "Match the name declared on the MoMo account against the CNI name. Third-party or family accounts are rejected (mandatory reason).",
      pending: "Pending",
      verified: "Verified",
      rejected: "Rejected",
      accountName: "Declared account name",
      number: "Number",
      cniName: "Identity name (CNI)",
      cniVerified: "CNI verified",
      cniStatus: "CNI status",
      cniNotProvided: "CNI not provided or not verified",
      rejectionReason: "Rejection reason",
      verifiedLabel: "Verified on",
      empty: "No Mobile Money declarations for this filter",
      emptyVerified: "No verified accounts",
      emptyRejected: "No rejected accounts",
      review: "Review",
      approve: "Approve",
      reject: "Reject",
      rejectReasonPlaceholder: "Rejection reason (required)",
      rejectReasonRequired:
        "A rejection reason is required (min. 3 characters).",
      readOnly:
        "Read-only access — only admin_ops and admin_founder can approve or reject.",
      actionFailed: "The action failed. Please try again.",
      cniLoadFailed:
        "Could not load the CNI. The candidate may not have uploaded it yet.",
      mtn: "MTN MoMo",
      orange: "Orange Money",
    },
    cni: {
      title: "CNI review",
      subtitle:
        "Verify identity documents (front / back / selfie) submitted by candidates. Approval triggers deletion of the photos from private storage (SRS §8.4).",
      pending: "Pending",
      verified: "Verified",
      rejected: "Rejected",
      notProvided: "Not provided",
      front: "Front",
      back: "Back",
      selfie: "Selfie",
      name: "Identity name",
      cniNumber: "CNI number",
      dob: "Date of birth",
      expiresAt: "Expires on",
      rejectionReason: "Rejection reason",
      verifiedLabel: "Verified on",
      empty: "No CNI pending",
      emptyVerified: "No verified CNI",
      emptyRejected: "No rejected CNI",
      emptyNotProvided: "No candidate without a submitted CNI",
      review: "Review",
      approve: "Approve",
      reject: "Reject",
      rejectReasonPlaceholder: "Rejection reason (required)",
      rejectReasonRequired:
        "A rejection reason is required (min. 3 characters).",
      readOnly:
        "Read-only access — only admin_ops and admin_founder can approve or reject.",
      actionFailed: "The action failed. Please try again.",
      loadDocFailed: "Could not load the document.",
      noCni: "This candidate has not submitted a CNI yet.",
      deletionNote:
        "Photos will be removed from private storage after verification.",
      expiresHint:
        "Required if date of birth + 10 years has already passed: enter the expiry date printed on the card.",
      expiryInvalid:
        "Expiry date missing or already passed: enter the date printed on the new ID card.",
    },
    candidates: {
      title: "Candidates",
      subtitle:
        "Centralized view: identity, Mobile Money, CNI/MoMo status and account state for every candidate. Search by name, e-mail or phone.",
      searchPlaceholder: "Search (name, e-mail, phone)",
      sectionPending: "Pending",
      sectionVerified: "Verified",
      sectionSuspended: "Suspended",
      emptyPending: "No candidates pending verification",
      emptyVerified: "No verified candidates",
      emptySuspended: "No suspended candidates",
      noResults: "No candidates match this search",
      momo: "Mobile Money",
      noMomo: "Mobile Money not registered",
      momoLabel: "MoMo number",
      emailLabel: "E-mail",
      verifiedBadge: "Verified profile",
      viewProfile: "View profile",
      btnCni: "CNI",
      btnMomo: "MoMo",
      btnDocuments: "Documents",
      suspend: "Suspend",
      activate: "Reactivate",
      suspendConfirm:
        "Suspend this candidate? They can no longer apply or work.",
      activateConfirm: "Reactivate this candidate?",
      readOnly:
        "Read-only access — only admin_ops and admin_founder can suspend or reactivate.",
    },
    companies: {
      title: "Companies",
      subtitle:
        "Centralized view: legal name, contact and verification status for every company. Search by name, e-mail or phone.",
      searchPlaceholder: "Search (name, e-mail, phone)",
      sectionPending: "Pending",
      sectionVerified: "Verified",
      sectionSuspended: "Suspended",
      emptyPending: "No companies pending verification",
      emptyVerified: "No verified companies",
      emptySuspended: "No suspended companies",
      noResults: "No companies match this search",
      emailLabel: "Contact e-mail",
      phoneLabel: "Phone",
      noContact: "Contact information not provided",
      verifiedBadge: "Verified company",
      viewProfile: "View profile",
      suspend: "Suspend",
      activate: "Reactivate",
      suspendConfirm:
        "Suspend this company? It can no longer post jobs or receive applications.",
      activateConfirm: "Reactivate this company?",
      readOnly:
        "Read-only access — only admin_ops and admin_founder can suspend or reactivate.",
    },
    candidateProfile: {
      title: "Candidate profile",
      back: "All candidates",
      identitySection: "Identity",
      filteredByUser:
        "View restricted to the candidate from the “Candidates” card. Click “All candidates” to go back to the full list.",
      suspended: "Account suspended",
      readOnly: "Read-only — identity editing is reserved to admin_founder.",
      notFound: "Profile not found",
      genderLabel: "Gender",
      genderMale: "Male",
      genderFemale: "Female",
      genderOther: "Other",
      bioLabel: "Bio",
      noBio: "No bio provided",
      locationLabel: "Location",
      noLocation: "Location not provided",
      cniSection: "CNI",
      momoSection: "Mobile Money",
      momoAccountName: "Account name",
      noMomoAccountName: "Account name not provided",
      skillsSection: "Skills",
      noSkills: "No declared skills",
      documentsSection: "Documents",
      noDocuments: "No documents",
      missionsSection: "Missions",
      noMissions: "No missions",
      statsSection: "Statistics",
      statTotal: "Total missions",
      statCompleted: "Completed",
      statNoShows: "No-shows",
      statReliability: "Reliability",
      statRating: "Average rating",
      premiumLabel: "Premium",
      premiumNone: "No Premium subscription",
      premiumUntil: "until",
      createdAt: "Registered on",
      updatedAt: "Updated on",
      editTitle: "Edit identity",
      editHint:
        "Only admin_founder can edit the first name, last name and date of birth.",
      editResetNotice:
        "This change resets the CNI to “Pending”: the candidate will need to re-verify their identity.",
      firstNameLabel: "First name",
      lastNameLabel: "Last name",
      dobLabel: "Date of birth",
      save: "Save",
      saved: "Identity saved",
      saveFailed: "Saving failed. Try again.",
      missionStatuses: {
        pending: "Pending",
        confirmed: "Confirmed",
        in_progress: "In progress",
        completed: "Completed",
        cancelled: "Cancelled",
        no_show: "No-show",
        en_route: "En route",
        arrived: "Arrived",
        validated: "Validated",
        disputed: "Disputed",
      },
      paymentStatuses: {
        pending: "Pending",
        processing: "Processing",
        completed: "Settled",
        failed: "Failed",
        refunded: "Refunded",
        cancelled: "Cancelled",
        partial: "Partial",
        full: "Full",
      },
      // T8.5 — "Profile updates" section of the candidate profile.
      updateRequestsSection: "Profile updates",
      noUpdateRequests: "No profile update requests for this candidate",
      requestUpdateButton: "Request an update",
      requestReadOnly:
        "Read-only access — only admin_ops and admin_founder can request updates.",
    },
    // T8.5 — Profile update requests initiated by the admin (SRS §5.1.1).
    // The T2 model has no "approve/reject": the admin initiates, the
    // candidate executes (auto-closes to `done`); the admin may cancel
    // (`cancelled`) or purge closed history (`DELETE`).
    updateRequests: {
      title: "Profile updates",
      subtitle:
        "Requests to unlock verified fields (identity / CNI) initiated by the administration. The candidate executes the update; the request closes automatically.",
      back: "Dashboard",
      pending: "Pending",
      done: "Executed",
      cancelled: "Cancelled",
      all: "All",
      empty: "No profile update requests",
      fieldsLabel: "Affected fields",
      reasonLabel: "Reason",
      noReason: "No reason provided",
      requestedBy: "Requested by",
      requestedAt: "Requested on",
      completedAt: "Executed on",
      fieldIdentity: "Identity",
      fieldCniDocuments: "CNI documents",
      cancel: "Cancel",
      cancelConfirm:
        "Cancel this request? The candidate will no longer be able to change the affected fields and they will be locked again.",
      delete: "Delete",
      deleteConfirm:
        "Permanently delete this request? This action cannot be undone.",
      readOnly:
        "Read-only access — only admin_ops and admin_founder can cancel or delete.",
      actionFailed: "The action failed. Please try again.",
      createdTitle: "Profile update requested",
      createTitle: "Request an update",
      createHint:
        "Temporarily unlocks the candidate’s verified fields until they are resubmitted and re-verified.",
      candidateLabel: "Candidate",
      searchPlaceholder: "Search a candidate…",
      noCandidate: "Search a candidate (name or email) to request an update.",
      fieldsLabelHint: "At least one group to unlock",
      reasonPlaceholder:
        "e.g. name change on an up-to-date deed, expired CNI to replace…",
      reasonRequired: "A reason of at least 5 characters is required.",
      submit: "Request the update",
      submitting: "Sending…",
      created: "Request sent to the candidate.",
    },
  },

  // Auth
  auth: {
    oauthError: {
      title: "Sign-in interrupted",
      description:
        "We could not complete the Google sign-in. The link may have expired or the sign-in was cancelled.",
      retry: "Sign in again",
      signup: "Create an account",
      home: "Back to home",
    },
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
      heroSubtitle: "Jobs near you, at a fixed pay in XAF.",
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
    tasksPending: "Tasks, an action is waiting for you",
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
    urgentBadge: "Urgent",
    urgentLabel: "Urgent job: it starts in less than 24 hours",
  },

  jobDetail: {
    work: "Work required",
    pay: "Amount per candidate",
    location: "Location",
    schedule: "Date and hours",
    dateRangeTo: "to",
    duration: "{hours} h",
    requirements: "Requirements",
    requiredSkills: "Skills",
    requiredDocuments: "Supporting documents",
    noRequirement: "No specific requirement.",
    dressCode: "Dress code",
    specialInstructions: "Instructions",
    company: "About the company",
    openMap: "Open the location in Google Maps",
    share: "Share this job",
    shareCopied: "Job link copied",
    shareFailed: "The link could not be copied.",
    applyNow: "Apply now",
    confirmTitle: "Confirm your application",
    confirm: "Confirm",
    cancel: "Cancel",
    close: "Close",
    documentLabels: {
      cni: "national ID card",
      driving_license: "driving licence",
    },
  },

  // Pay: fixed amount per candidate for the mission (XAF)

  // Application: status, /apply refusals and withdrawal (lot 9)
  application: {
    applyNowTitle: "Apply now!",
    positionsLeft: {
      one: "1 position available",
      other: "{count} positions available",
      none: "No positions available",
    },
    confirmBefore: "Before applying, make sure you can attend this mission.",
    availabilityNotice:
      "Only apply if you are available at the stated times. If something comes up, let the company know as soon as possible.",
    status: {
      pending: {
        title: "Application sent",
        desc: "You will be notified if you are selected.",
      },
      shortlisted: {
        title: "You are shortlisted",
        desc: "The company is reviewing your application. You will be notified of its decision.",
      },
      selected: {
        title: "You are selected",
        desc: "Sign your contract from the Tasks tab.",
      },
      rejected: {
        title: "Application not accepted",
        desc: "The company did not accept your application for this job. Other jobs are waiting for you.",
      },
      withdrawn: {
        title: "Application withdrawn",
        desc: "You withdrew your application. You cannot apply to this job again.",
      },
      no_show: {
        title: "No-show recorded",
        desc: "A no-show was recorded for this mission. Contact support if this is a mistake.",
      },
    },
    sentToast: {
      title: "Application sent",
      desc: "Follow it in My Jobs.",
    },
    withdraw: {
      button: "Withdraw my application",
      confirmTitle: "Withdraw your application?",
      confirmBody:
        "The company will no longer see it and you will not be able to apply to this job again.",
      confirm: "Withdraw",
      cancel: "Cancel",
      doneTitle: "Application withdrawn",
      doneDesc: "It now appears in your My Jobs history.",
      errorTitle: "Withdrawal failed",
      errors: {
        application_not_withdrawable:
          "Only a pending application can be withdrawn. Contact the company or support.",
        application_not_found:
          "Application not found. Reload the page to see its current status.",
        generic: "The withdrawal could not be saved. Please try again.",
      },
    },
    errorTitle: "Application not sent",
    refusals: {
      not_authenticated: "Your session has expired. Sign in again to apply.",
      profile_not_found: "Finish signing up first to apply.",
      onboarding_incomplete: "Finish signing up first to apply.",
      account_suspended:
        "Your account is suspended: you cannot apply. Contact support.",
      job_not_found: "This job is no longer available.",
      job_not_available: "This job no longer accepts applications.",
      no_positions: "All positions for this job are filled.",
      already_applied: "You have already applied to this job.",
      profile_incomplete:
        "Your profile must be at least 60% complete to apply.",
      profile_not_verified:
        "Your identity, ID card and Mobile Money must be verified to apply.",
      application_failed:
        "The application could not be sent. Please try again in a moment.",
      network:
        "Cannot connect. Check your internet connection, then try again.",
      generic: "The application could not be sent. Please try again.",
      cni_expired: "Your ID card has expired. Renew it to apply.",
    },
    cni: {
      expired: "Your ID card has expired. Renew it to apply.",
      renewal_pending:
        "Your new ID card is being checked. You can apply as soon as it is approved.",
      renewal_rejected:
        "Your new ID card was rejected. Send a valid document to apply.",
    },
    documents: {
      missingCni: "This job requires a verified national ID card.",
      missingLicense: "This job requires a valid driving licence.",
      missingSkill:
        "This job requires a valid diploma or certificate for the skill \u201c{skill}\u201d.",
      missingOther: "This job requires a valid document: {doc}.",
      pending: "Your document is still being verified.",
      rejected: "Your document was rejected. Replace it from your profile.",
      expired: "Your document has expired. Update it to apply.",
      labels: {
        casier_judiciaire: "criminal record",
        diplome: "diploma",
        certificat: "certificate",
        attestation_formation: "training certificate",
        attestation_travail: "work certificate",
        autre: "document",
      },
    },
    actions: {
      signIn: "Sign in",
      finishSignup: "Finish signing up",
      completeProfile: "Complete my profile",
      documents: "Manage my documents",
      identity: "Verify my identity",
      browseJobs: "See other jobs",
      myApplications: "View my applications",
      support: "Contact support",
      tasks: "Open my tasks",
      renewCni: "Renew my ID card",
      trackRenewal: "View progress",
      openTask: "Open the task",
    },
  },
  pay: {
    forMission: "for the mission",
    perCandidate: "Pay per candidate",
    flatNote:
      "Fixed amount agreed for each selected candidate, whatever the actual finishing time.",
    formLabel: "Pay per candidate for the mission (CFA francs)",
    formHint:
      "Fixed amount agreed for each selected candidate, whatever the actual finishing time. The schedule is still shown so everyone can plan.",
    formExample:
      "Example: 3 people needed at 10,000 CFA francs = 10,000 CFA francs for each of them.",
    positions: { one: "{count} person needed", other: "{count} people needed" },
    contractBasis:
      "Flat amount per mission, per candidate, in CFA francs (XAF)",
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
    actionsTitle: "To be able to apply",
    followUpBadge: "Being checked",
    actionBadge: "Action required",
    concernedJobs: "Jobs concerned:",
    profile: {
      onboardingTitle: "Finish signing up",
      onboardingHint: "A few steps are left to complete.",
      incompleteTitle: "Complete your profile",
      incompleteHint:
        "Your profile is {pct}% complete: 60% is needed to apply.",
      action: "Complete my profile",
      onboardingAction: "Finish signing up",
    },
    identity: {
      title: "Enter your identity",
      hint: "First name, last name and date of birth are needed to apply.",
      action: "Enter my identity",
    },
    phone: {
      title: "Verify your phone",
      hint: "A verified number is needed to apply.",
      action: "Verify my number",
    },
    momo: {
      missingTitle: "Add your Mobile Money",
      missingHint: "A verified Mobile Money account is needed to apply.",
      pendingTitle: "Mobile Money being checked",
      pendingHint: "You will be notified once it is verified.",
      rejectedTitle: "Mobile Money rejected",
      rejectedHint: "Correct your Mobile Money account to apply.",
      action: "Manage my Mobile Money",
      track: "View progress",
    },
    cni: {
      expiredTitle: "ID card expired",
      expiredHint: "Your ID card expired on {date}. Renew it to apply.",
      renewalPendingTitle: "ID card renewal submitted",
      renewalPendingHint:
        "Your new ID card is being checked. You can apply as soon as it is approved.",
      renewalRejectedTitle: "ID card renewal rejected",
      renewalRejectedHint:
        "Your new ID card was rejected. Send a valid document to apply.",
      complementHint:
        "Additional information is requested about your ID card. See the request above.",
      missingTitle: "Send your ID card",
      missingHint: "Front, back and selfie are needed to apply.",
      pendingTitle: "ID card being checked",
      pendingHint: "You will be notified once it is verified.",
      rejectedTitle: "ID card rejected",
      rejectedHint: "Send a valid document to apply.",
      reason: "Reason: {reason}",
      renew: "Renew my ID card",
      send: "Send my ID card",
      track: "View progress",
    },
    document: {
      missingTitle: "Add a supporting document",
      pendingTitle: "Supporting document being checked",
      rejectedTitle: "Supporting document rejected",
      expiredTitle: "Supporting document expired",
      action: "Manage my documents",
      track: "View progress",
    },
  },

  // My Jobs
  // Earnings: agreed amounts of completed missions (lot 9)
  earnings: {
    title: "My earnings",
    totalLabel: "Agreed amount of completed missions",
    missionsCount: {
      one: "{count} completed mission",
      other: "{count} completed missions",
    },
    note: "Each amount is the one set in the mission's contract. The company commits to paying it: the app doesn't make any payment or Mobile Money withdrawal yet.",
    listTitle: "Completed missions",
    contractAmount: "Contract amount",
    noAmount: "Amount unavailable",
    emptyTitle: "No completed mission",
    emptyDesc:
      "The agreed amount of each mission will appear here once completion is confirmed with the code.",
    browseJobs: "Browse jobs",
    loadErrorTitle: "Cannot connect",
    loadErrorDesc:
      "Your missions could not be loaded. Check your connection, then try again.",
    retry: "Try again",
  },

  myJobs: {
    title: "My Jobs",
    tabs: {
      applied: "Applications",
      booked: "Booked",
      completed: "Completed",
    },
    applicationStatus: {
      pending: "Pending",
      shortlisted: "Shortlisted",
      selected: "Selected",
      rejected: "Not accepted",
      withdrawn: "Withdrawn",
      no_show: "No-show",
    },
    missionStatus: {
      pending: "Scheduled",
      confirmed: "Confirmed",
      in_progress: "In progress",
      completed: "Completed",
      cancelled: "Cancelled",
      no_show: "No-show",
      en_route: "On the way",
      arrived: "On site",
      validated: "Validated",
      disputed: "Disputed",
    },
    appliedOn: "Applied on",
    history: "History",
    empty: {
      neverTitle: "Find your next job!",
      neverDesc: "You haven't applied to any job yet.",
      noActiveTitle: "No application in progress",
      noActiveDesc:
        "Your withdrawn or declined applications remain visible in the history below.",
      bookedTitle: "No booked mission",
      bookedDesc: "Your missions appear here as soon as a company selects you.",
      completedTitle: "No completed mission",
      completedDesc:
        "Missions confirmed with the completion code will appear here.",
    },
    browseJobs: "Browse jobs",
    loadError: {
      title: "Cannot connect",
      desc: "Your applications could not be loaded. Check your connection, then try again.",
      stale:
        "Cannot connect: showing the last known state. Check your connection.",
      retry: "Try again",
    },
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
      action: "Open",
      channelsNote:
        "Per-channel preferences (push/SMS/email) aren't configurable yet.",
    },
    darkMode: "Dark mode",
    essential: {
      title: "To start applying",
      bannerTitle: "Profile not ready to apply",
      bannerBody:
        "You are missing: {missing}. Complete them to become eligible.",
      cta: "Complete",
      required: "Required",
      identity: "First name, last name and date of birth",
      cni: "Verified national ID",
      momo: "Verified Mobile Money",
    },
    photo: {
      modalTitle: "Change profile photo",
      modalHint: "Pick a recent, clear photo (JPEG, PNG or WebP — 5 MB max).",
      change: "Change photo",
    },
    skillsOverview: {
      verifiedLabel: "Verified",
      verifiedHint: "Skill certified with a proof document",
      editSkills: "Edit",
    },
    completion: {
      title: "Complete your profile",
      subtitle: "Reach 60% to apply for jobs",
      progress: "complete",
      cta: "Complete my profile",
      required60: "60% required to apply",
      essentialsTitle: "Essentials to apply",
      optionalTitle: "To strengthen your profile",
      premiumCta: "Go Premium",
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
    },
    edit: {
      title: "Edit my information",
      firstName: "First name",
      lastName: "Last name",
      birthDate: "Date of birth",
      city: "City",
      quartier: "Neighborhood",
      bio: "About you",
      bioHint:
        "Briefly describe your experience (more than 10 characters to count towards completion).",
      addSkills: "Add my skills",
      save: "Save",
      saving: "Saving…",
      saved: "Profile updated",
      error: "Could not save. Please try again.",
      firstNameRequired: "First name is required",
      lastNameRequired: "Last name is required",
      birthDateRequired: "Date of birth is required",
      ageInvalid: "You must be at least 18 years old",
      birthDateInvalid: "Invalid date of birth",
      cityRequired: "Select a city",
      unsavedWarning: "You have unsaved changes. Leave anyway?",
      lockedIdentityLabel: "Verified information",
      lockedIdentityBody:
        "Your identity information is verified and can only be changed after an admin request. Contact the admin if the update is justified.",
      lockedDocLabel: "Verified document",
      lockedDocBody:
        "This document is verified and can only be replaced after an admin request.",
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
      locked: "Editable on admin request",
      tooLarge: "File too large (5 MB max)",
      uploadFailed: "Upload failed. Please try again.",
    },
    skillDocuments: {
      menuLabel: "Documents & verified skills",
      title: "Documents & verified skills",
      subtitle:
        "Back up your skills with a diploma, certificate or reference letter to build trust with companies.",
      cvCardTitle: "CV",
      cvCardHint: "A general profile document, not linked to a specific skill.",
      addCv: "Add my CV",
      skillsSectionTitle: "My skills",
      noSkills: "Add skills to your profile first.",
      status: {
        declared: "Declared",
        missing: "Proof missing",
        pending: "Review pending",
        verified: "Verified",
        rejected: "Proof rejected",
        expired: "Proof expired",
      },
      actions: {
        addProof: "Add proof",
        viewStatus: "View status",
        replace: "Replace document",
        resubmit: "Fix and resend",
        updateExpired: "Update expired document",
        delete: "Delete",
      },
      delete: "Delete the document",
      deleteError: "The document could not be deleted. Please try again.",
      documentTypes: {
        cv: "CV",
        diplome: "Diploma",
        certificat: "Professional certificate",
        attestation_formation: "Training certificate",
        attestation_travail: "Work reference letter",
        permis_conduire: "Driving license",
        casier_judiciaire: "Criminal record certificate",
        autre: "Other proof",
      },
      form: {
        title: "Add a proof document",
        documentType: "Document type",
        documentTitle: "Title",
        documentTitlePlaceholder: "E.g. Accounting diploma",
        titleRequired: "Title is required",
        issuingOrganization: "Issuing organization",
        issuingOrganizationOptional: "Issuing organization (optional)",
        issuedAt: "Date obtained",
        expiresAt: "Expiry date (if applicable)",
        linkedSkills: "Related skill(s)",
        file: "File (PDF, JPEG, PNG or WebP — 5 MB max)",
        confirmAccurate: "I confirm this information is accurate",
        submit: "Submit",
        submitting: "Submitting…",
        cancel: "Cancel",
      },
      afterUpload: "Document sent — review pending",
      rejectionReasonLabel: "Rejection reason",
      expiredNotice:
        "This document has expired. Update it to keep applying to offers that require it.",
      deleteConfirm: "Delete this document?",
      uploadError: "Upload failed. Check the file and try again.",
      tooLarge: "File too large (5 MB max)",
      unsupportedType: "Unsupported format (PDF, JPEG, PNG or WebP only)",
      selectSkillRequired:
        "Select at least one skill (not required for a CV or a driving license)",
    },
    documentsPage: {
      title: "My documents",
      subtitle:
        "All your supporting documents — CV, driving license, degree and certificates — with their verification status.",
      addTitle: "Add a supporting document",
      addHint: "Add and certify your documents from the “My skills” page.",
      addCta: "My skills",
      empty: "No documents yet.",
      emptyHint:
        "Add your CV, driving license or a supporting document from “My skills”.",
      issuedAt: "Issued on",
      expiresAt: "Expires on",
      view: "View",
      viewError: "Could not load this document. Please try again.",
      download: "Download",
      downloadError: "Could not download this document. Please try again.",
      linkedSkills: "Linked skills",
      category: "Category: {cat}",
    },
    skills: {
      title: "My skills",
      subtitle:
        "Manage your skills, certify them with proof documents, and attach your CV and driving license.",
      noSkills: "No skills yet. Add some from the catalogue below.",
      addSection: "Add a skill",
      searchPlaceholder: "Search a skill…",
      noSearch: "No skill found in the catalogue.",
      otherSkills: "Your other skills",
      catalog: {
        services: "Front desk & services",
        vente: "Sales",
        restauration: "Catering & food service",
        manutention: "Handling & logistics",
        transport: "Transport & delivery",
        artisanat: "Building trades & crafts",
        nettoyage: "Cleaning & maintenance",
        securite: "Security",
        events: "Events",
        bureautique: "Office & administration",
        digital: "Digital & IT",
        beaute: "Beauty",
        soins: "Care & assistance",
        langues: "Languages",
      },
      confirmTitle: "Certify this skill?",
      confirmBody:
        'Would you like to certify "{skill}" now with a proof document?',
      confirmNow: "Certify now",
      confirmLater: "Later",
      deleteSkill: "Delete the skill",
      deleteSkillConfirm: 'Delete "{skill}" from your profile?',
      deleteSkillError: "The skill could not be deleted. Please try again.",
      addError: "The skill could not be added. Please try again.",
      drivingLicenseTitle: "Driving license",
      drivingLicenseHint:
        "A general profile document, useful for driving and delivery missions.",
      addDrivingLicense: "Add my driving license",
      licenseCategoryLabel: "License category",
      licenseCategoryPlaceholder: "Select the category",
      licenseCategories: {
        moto: "Motorcycle",
        voiture: "Car",
        fourgon: "Van",
        camion: "Truck",
        bus: "Bus",
        tous_types: "All types (international license)",
      },
      licenseCategoryBadge: "Category: {cat}",
      licenseCategoryRequired:
        "The license category is required to add this document.",
      licenseRequiredError:
        '"{skill}" requires a verified driving license. Add and get your license verified before adding this skill.',
    },
    geolocation: {
      title: "Precise location",
      explain:
        "Used to calculate your distance from job offers. Optional: you can continue with just your city and neighborhood.",
      useMyLocation: "Use my location",
      locating: "Locating…",
      success: "Location saved",
      recordedBadge: "GPS saved",
      precision: "± {m} m",
      /** Shown until GPS is saved: browsers only ask for permission on user gesture. */
      firstPermissionHint:
        "On your first click, your browser will ask for location permission — allow it.",
      denied:
        "Permission denied. You can continue with your city and neighborhood.",
      unavailable: "Location unavailable on this device.",
      /** GPS fix too slow (browser code 3): the button stays clickable,
       *  retry or enter the city manually. */
      timeout:
        "Detecting your location took too long. Please retry, or select your city and neighborhood manually.",
      /** T5: server error (coords out of bounds -90..90 / -180..180). */
      geoOutOfRange: "Geographic coordinates out of range.",
      /** T5.1: shown under the button when the detected position is OUTSIDE
       *  the service zone (Douala/Yaoundé). The candidate continues with the
       *  manual city + neighborhood selection. */
      outOfZone:
        "Your position is outside of Douala and Yaoundé. Please select your city and neighborhood manually.",
      /** T5.1: info shown when an in-zone fix is accepted — city is auto-set
       *  to the nearest, and the neighborhood is auto-looked-up via OSM
       *  Nominatim (single request). */
      autoFilledFromGps:
        "City and neighborhood were filled from your GPS position.",
      /** T5.1: reverse-geocode failure (OSM down / timeout) — the fix is
       *  accepted but the neighborhood is NOT auto-filled. The candidate can
       *  enter it manually. */
      autoFilledFailed:
        "Position saved, but the neighborhood could not be detected. You can fill it in manually.",
      /** T5.1: Zod refinement key `geoOutOfZone` — in-zone bounds but outside
       *  the service area. */
      geoOutOfZone:
        "Coordinates outside the service area (Douala / Yaoundé only).",
      /** T5.1: Zod refinement key `cityNotServed` — city not in the catalog. */
      cityNotServed: "City not served by Easyjob (Douala / Yaoundé only).",
    },
    reverification: {
      modalTitle: "Confirm the change",
      modalBody:
        "Changing your identity (name or date of birth) will require a new verification of your ID document. Do you want to continue?",
      confirm: "Confirm the change",
      bannerTitle: "Verification in progress",
      bannerBody:
        "Your ID document is being re-verified following a change to your identity.",
    },
    profileUpdateRequests: {
      title: "Requested profile update",
      reasonLabel: "Reason for the request",
      identity: "Your identity information",
      cni_documents: "Your ID documents",
      start: "Prepare the update",
      goToEdit: "Open my information",
      goToDocuments: "Open my documents",
      hint: "The admin unlocked these fields for a limited time. Once saved, verification starts over.",
      done: "Update saved. Your document will be re-reviewed after the next verification.",
      expiredLabel: "This request was closed",
    },
    myProfile: "My Profile",
    missionsCompleted: "missions completed",
    missionsPosted: "missions posted",
    statMissions: "Missions",
    statSkills: "Skills",
    mySkills: "My skills",
    locationLabel: "Location",
    sectorLabel: "Sector of activity",
    mobileMoney: "Mobile Money",
    paymentPage: {
      title: "Mobile Money",
      subtitle:
        "Verified by the EasyJob team. The app doesn't make payments yet.",
      provider: "Provider",
      number: "Mobile Money number",
      numberPlaceholder: "6XX XXX XXX",
      accountName: "Mobile Money account name",
      accountNamePlaceholder: "As registered on the account",
      accountNameHint:
        "The account name must match your CNI — accounts registered in someone else's name are not accepted.",
      accountNameOptional: "(optional)",
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
      // T6 — manual admin verification (OTP proof of ownership was removed
      // at launch — product decision 2026-09-10) + rejected status.
      rejected: "Rejected",
      rejectedReason: "Reason: {reason}",
      reviewPending:
        "Admin review can take up to 24 h. The account name is matched against your CNI name.",
      momoProviderInvalid:
        "Invalid Mobile Money provider (MTN MoMo or Orange Money).",
      momoAccountNameTooLong:
        "Mobile Money account name is too long (100 characters max).",
      momoRejectReasonTooShort: "The rejection reason is too short.",
      momoRejectReasonRequired:
        "A rejection reason is required to reject a verification.",
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
          a: "It's your tracking center for your missions: sign your contract, start the mission from 15 minutes before the scheduled time, enter the six-digit code the company gives you to confirm completion, then review the company. Uploading other documents (bank details, student proof, work certificate) and training aren't available in the app yet.",
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
          a: "From Profile > Mobile Money, declare or edit your MTN or Orange number. The EasyJob team verifies it, and a new number needs a new verification. The app doesn't make payments or withdrawals yet.",
        },
        {
          q: "When do I get paid?",
          a: "The mission's fixed amount, in XAF, is shown in your contract. The company commits to paying it once completion is confirmed with the code. The app doesn't make payments yet: no Mobile Money payment or withdrawal is handled in it for now.",
        },
        {
          q: "How does Premium work?",
          a: "Premium costs 1,000 FCFA per month. Self-service subscription isn't available yet: contact support to activate it and learn about the benefits offered.",
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
      tagline: "Stand out to companies.",
      price: "1,000 FCFA",
      pricePeriod: "/ month",
      ctaPrimary: "Become Premium",
      ctaSecondary: "See benefits",
      bullets: {
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
      title: "Pay",
      standard: "Fixed amount in XAF, set in each contract",
      note: "Paid by the company: the app doesn't make payments yet.",
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
        aiRecoOn: "Candidate reliability indicators",
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
        title: "Signed contract",
        desc: "Each selection creates a contract that you and the candidate sign in the app.",
      },
      historyAccess: {
        title: "Full history",
        desc: "Find your jobs and their past missions.",
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
        title: "Reliability indicators",
        desc: "Compare candidates by rating, missions and verifications.",
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
        title: "Activation by support",
        desc: "The plan is activated by the EasyJob team; online payment isn't available yet.",
      },
      // ── Business plan (10 perks) ──
      guaranteedReplacement: {
        title: "Help with no-shows",
        desc: "If a candidate doesn't show up, contact support. No automatic replacement is offered.",
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
        label: "Cancellation:",
        freeStarter:
          "no amount is held or withheld by the app. Contact support before cancelling a committed mission.",
        pro: "no amount is held or withheld by the app. Contact support before cancelling a committed mission.",
        business:
          "no amount is held or withheld by the app. Contact support before cancelling a committed mission.",
      },
    },
    upgradeBanner: {
      title: "Your competitors hire faster",
      tagline:
        "0% service fee, urgent options included and direct editing of active jobs.",
      taglineStarter: "Switch to Pro: unlimited jobs and direct editing.",
      // Short labels inside plan rows
      starter: "Starter",
      starterKicker: "8% fee · Urgent boost at 1,000 FCFA · Higher visibility",
      pro: "Pro",
      proKicker: "0% fee · Urgent options · Favorites · Templates · Report",
      business: "Business",
      businessKicker:
        "Everything in Pro · Dedicated manager · Priority support",
      // Badges & CTA
      recommended: "Recommended",
      cta: "Change plan with support",
      ctaNote: "Plan changes are made by the EasyJob team.",
      businessCta: "Ask about Business",
    },

    // ── Premium Company Showcase ────────────────────────────
    premiumCompany: {
      sectionLabel: "Your strategic advantage",
      headlineStarter: "Hire faster. Without limits.",
      headlinePro: "Post without limits, edit directly.",
      headlineBusiness: "Tailor-made for large teams.",
      taglineStarter:
        "5 simultaneous jobs, urgent options included, direct editing.",
      taglinePro: "Unlimited jobs, urgent options included, direct editing.",
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
          title: "Reliability indicators",
          desc: "Each candidate's rating, completed missions and verifications.",
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
  companyOnboarding: {
    sizeLabel: "Company size",
    sizes: {
      tpe: "Micro",
      pme: "SME",
      eti: "Mid-size",
      ge: "Large company",
    },
    niuLabel: "NIU (unique identification number)",
    niuHint: "Entered at sign-up. To change it, contact support.",
    rccmFileHint: "PDF, JPG, PNG or WebP — 5 MB max",
    rccmFileSaved: "A document is already saved. Choose a file to replace it.",
    saveError: "Your information could not be saved.",
    verifiedNotice:
      "Your company is verified. Changing the name, the RCCM number or the RCCM document will restart verification: you will not be able to post jobs until it is approved again.",
    errors: {
      companyNameTooShort: "Name too short.",
      companyNameTooLong: "Name too long (100 characters max).",
      sectorRequired: "Choose a business type.",
      companySizeRequired: "Choose the company size.",
      websiteInvalid: "Invalid website: it must start with https://",
      descriptionTooLong: "Description too long (1000 characters max).",
      rccmRequired: "The RCCM number is required.",
      rccmTooLong: "RCCM number too long (50 characters max).",
      cityRequired: "Choose a city.",
      quartierRequired: "The area is required.",
      quartierTooLong: "Area too long (100 characters max).",
      addressRequired: "The address is required.",
      addressTooLong: "Address too long (200 characters max).",
      file_too_large: "File too large (5 MB max).",
      file_type: "Format not accepted: PDF, JPG, PNG or WebP.",
      upload_failed: "The document could not be uploaded.",
      profile_not_found: "Company profile not found. Contact support.",
      account_suspended: "Your account is suspended.",
      unauthorized: "Session expired. Please sign in again.",
    },
  },

  companyJobs: {
    title: "My jobs",
    total: { one: "{count} job in total", other: "{count} jobs in total" },
    newJob: "New job",
    createJob: "Create a job",
    tabs: {
      active: "Active ({count})",
      draft: "Drafts ({count})",
      closed: "Closed ({count})",
    },
    empty: {
      activeTitle: "No active jobs",
      activeDesc: "Post a new job to find candidates",
      draftTitle: "No drafts",
      draftDesc: "Your job drafts will appear here",
      closedTitle: "No closed jobs",
      closedDesc: "Closed jobs will appear here",
    },
    status: {
      active: "Published",
      pending_review: "In moderation",
      draft: "Draft",
      filled: "Filled",
      expired: "Expired",
      rejected: "Rejected",
      cancelled: "Cancelled",
    },
    urgent: "Urgent",
    applications: { one: "application", other: "applications" },
    positions: { one: "/{count} position", other: "/{count} positions" },
    rejectionReason: "Rejection reason: {reason}",
    rejectedNext: "Edit the job to fix this point: it will be reviewed again.",
    lockedPlan:
      "Published job: direct editing is available on Pro and Business plans. Contact support.",
    actions: {
      viewApplications: "View applications",
      edit: "Edit",
      delete: "Delete",
    },
    deleteDialog: {
      title: "Delete this job?",
      description:
        "This action cannot be undone. All related applications will also be deleted.",
      cancel: "Cancel",
      confirm: "Delete",
      deleting: "Deleting...",
    },
    toasts: {
      createdTitle: "Job created",
      createdDesc: "Your job has been submitted for moderation.",
      updatedTitle: "Job updated",
      updatedDesc:
        "Your job has been submitted again. It will be visible once approved.",
      deletedTitle: "Job deleted",
      deletedDesc: "The job was deleted successfully.",
      deleteErrorTitle: "Error",
      deleteErrorDesc: "The job could not be deleted.",
    },
    form: {
      editTitle: "Edit job",
      submitEdit: "Submit again",
      editNotice:
        "After editing, the job goes back to moderation: candidates cannot see it until it is approved again.",
      errorTitle: "Job not saved",
    },
    errors: {
      titleRequired: "The title is required.",
      titleTooLong: "Title too long (120 characters maximum).",
      descriptionRequired: "The description is required.",
      descriptionTooLong: "Description too long (5000 characters maximum).",
      addressRequired: "Missing address: complete your company address.",
      addressTooLong: "Address too long (200 characters maximum).",
      cityRequired: "Missing city: complete your company profile.",
      startDatePast: "The start date cannot be in the past.",
      endDateBeforeStart: "The end date must be after the start date.",
      missionPayRequired: "Enter the pay per candidate for the mission.",
      missionPayInvalid:
        "The pay per candidate must be greater than 0 CFA francs.",
      missionPayInteger:
        "The pay per candidate must be a whole number of CFA francs.",
      missionPayTooHigh: "The pay per candidate is too high.",
      positionsInvalid:
        "Invalid number of positions (at least 1, and not fewer than the candidates already selected).",
      invalid_job_data: "Some job details are invalid.",
      not_authenticated: "Session expired. Please sign in again.",
      not_a_company: "Only companies can post jobs.",
      account_suspended: "Your account is suspended.",
      company_not_found: "Company profile not found. Finish your sign-up.",
      company_not_verified:
        "Your company is not verified yet: you can post jobs once EasyJob has approved your documents.",
      job_not_found: "Job not found.",
      job_locked_plan:
        "Published job: direct editing is available on Pro and Business plans. Contact support.",
      job_has_selected_candidates:
        "Candidates have already been selected: contact support to edit this job.",
      job_not_editable: "This job can no longer be edited.",
      job_has_commitments:
        "This job cannot be deleted: candidates have been selected or a mission is under way. Contact support.",
      generic: "The job could not be saved. Please try again.",
    },
  },

  companyApplicants: {
    back: "Back",
    jobNotFound: "Job not found",
    applications: { one: "application", other: "applications" },
    positionsFilled: {
      one: "/{count} position filled",
      other: "/{count} positions filled",
    },
    tabs: {
      pending: "Pending ({count})",
      shortlisted: "Shortlist ({count})",
      selected: "Selected ({count})",
      rejected: "Rejected ({count})",
    },
    status: {
      pending: "Pending",
      shortlisted: "Shortlisted",
      selected: "Selected",
      rejected: "Rejected",
      withdrawn: "Withdrawn",
      no_show: "No-show",
    },
    empty: "No applications in this category",
    distance: "{km} km",
    missions: "{count} missions",
    completion: {
      title: "Completion code",
      instruction:
        "At the end of the mission, give this code to the candidate if they are present and did the work. This is the only action required.",
      dispute: "In case of dispute:",
      support: "Contact support",
      notStarted: "Start not confirmed",
      startedAt: "Start confirmed at {time}",
      completedAt: "Completed at {time} (code used)",
      scheduled: "Scheduled from {start} to {end}",
      rate: "Rate the candidate (optional)",
      rated: "You rated this candidate.",
    },
    actions: {
      select: "Select",
      reject: "Reject",
      contact: "Contact",
      contract: "Contract",
    },
    cancel: "Cancel",
    processing: "Processing...",
    selectDialog: {
      title: "Confirm selection",
      description: "Do you want to select {name} for this job?",
      notice:
        "A mission and a contract will be created, and the candidate will be notified.",
      confirm: "Confirm",
    },
    rejectDialog: {
      title: "Reject application",
      description: "Reject the application from {name}?",
      placeholder: "Reason for rejection (optional)",
      confirm: "Reject",
    },
    toasts: {
      selectedTitle: "Candidate selected",
      selectedDesc:
        "The mission and the contract have been created and the candidate has been notified. Now sign the contract from this application.",
      rejectedTitle: "Application rejected",
      rejectedDesc:
        "The application has been rejected and the candidate sees it as not accepted.",
      rejectError:
        "This application could not be rejected. The list has been refreshed: check its status, then try again.",
      errorTitle: "Error",
    },
    errors: {
      not_authenticated: "Session expired. Please sign in again.",
      not_a_company: "Only companies can select candidates.",
      account_suspended:
        "Your account is suspended: contact support to reactivate it.",
      company_not_found: "Company profile not found.",
      application_not_found: "Application not found.",
      application_not_selectable:
        "This application can no longer be selected (withdrawn or rejected). Choose another candidate.",
      job_not_available:
        "This job is no longer published: it must be live to select a candidate.",
      no_positions:
        "All positions for this job are filled: no other selection is possible.",
      candidate_unavailable:
        "This candidate is no longer available. Choose another candidate.",
      selection_incomplete:
        "Selection saved without a mission or contract. Contact support.",
      generic: "The selection could not be saved. Please try again.",
      network:
        "Cannot connect: the selection was not sent. Check your connection, then try again.",
    },
  },

  // Mission, tasks, completion code and reviews (lot 7c)
  mission: {
    back: "Back",
    notFound: "Mission not found or not accessible.",
    loadError: "The mission could not be loaded.",
    retry: "Retry",
    status: {
      pending: "Scheduled",
      confirmed: "Confirmed",
      en_route: "On the way",
      arrived: "Arrived",
      in_progress: "In progress",
      completed: "Completed",
      validated: "Completed",
      cancelled: "Cancelled",
      no_show: "No-show",
      disputed: "Disputed",
    },
    details: "Mission details",
    today: "Today",
    schedule: "{start} – {end} (Douala time)",
    scheduleNote:
      "Scheduled hours from the job offer. The agreed pay does not depend on the duration.",
    tracking: "Tracking",
    startedAt: "Start confirmed at {time}",
    completedAt: "Completion confirmed at {time}",
    notStarted: "Not started yet",
    goToTasks: "See my tasks",
    tasks: {
      title: "My tasks",
      empty: "No tasks for now.",
      sign: "Sign my contract",
      signHint: "You can sign before, during or after the mission.",
      signAfterReview: "Thank you for your rating. Please sign your contract.",
      start: "Start the mission",
      startHint: "Scheduled start at {time}",
      startAvailableAt: "Available at {time}",
      startConfirmTitle: "Start the mission",
      startConfirmDescription:
        'Confirm that you are starting "{job}". EasyJob records the time.',
      startConfirm: "I'm starting",
      starting: "Saving…",
      startReminderTitle: "It's almost time",
      startReminder: 'You can start "{job}".',
      inProgress: "In progress – scheduled end at {time}",
      finish: "End of mission",
      finishHint: "Ask the company for your completion code, then enter it.",
      validate: "Validate",
      endReminderTitle: "End time",
      endReminder: '"{job}" is ending: enter the code given by the company.',
      review: "Rate the company",
      reviewHint: "Your rating is required.",
      startedToast: "Start confirmed",
      startedAt: "Recorded at {time}.",
      cancel: "Cancel",
    },
    code: {
      title: "Completion code",
      description:
        'Enter the six-digit code the company gave you at the end of "{job}".',
      label: "Completion code",
      submit: "Validate code",
      submitting: "Checking…",
      close: "Close",
      invalid: {
        one: "Incorrect code. {count} attempt left.",
        other: "Incorrect code. {count} attempts left.",
      },
      locked: "Too many attempts. Try again from {time}.",
      format: "The code has six digits.",
      successTitle: "Mission completed",
      successAt: "Completion confirmed at {time}.",
    },
    review: {
      companyTitle: "Rate the company",
      companyDescription:
        "How was your mission with {name}? Your rating is required.",
      candidateTitle: "Rate the candidate",
      candidateDescription: "Optional rating of {name} for this mission.",
      placeholder: "Leave a comment (optional)",
      send: "Send my rating",
      sending: "Sending…",
      thanks: "Thank you for your rating",
      later: "Later",
      star: "{count} star(s) out of 5",
      reasonsTitle: "What went wrong?",
      reasonsRequired: "Choose at least one reason.",
      reasonsOptional: "Optional for a 3-star rating.",
      commentPrivate:
        "Your comment is never published: only the EasyJob team reads it.",
    },
    errors: {
      not_authenticated: "Session expired. Please sign in again.",
      account_suspended: "Your account is suspended.",
      mission_not_found: "Mission not found or not accessible.",
      mission_not_active: "This mission is no longer active.",
      too_early: "The mission can start from {time}.",
      not_started: "Confirm the start of the mission first.",
      code_unavailable:
        "No code is available for this mission. Please contact support.",
      mission_not_completed: "The mission is not completed yet.",
      rating_invalid: "Choose a rating from 1 to 5 stars.",
      comment_too_long: "Comment too long (1000 characters maximum).",
      reasons_required: "For a rating below 3, choose at least one reason.",
      reasons_invalid: "This reason is not valid for this review.",
      generic: "The action could not be confirmed. Please try again.",
    },
  },

  // Mission contract (lot 7b)
  contract: {
    back: "Back",
    title: "Mission contract",
    reference: "Reference: {ref}",
    open: "View contract",
    notFound: "Contract not found or not accessible.",
    loadError: "The contract could not be loaded.",
    retry: "Retry",
    template: {
      simple: "Simple contract (under 3 days)",
      formal: "Formal contract (3 days or more)",
    },
    status: {
      pending: "Awaiting signatures",
      candidate_signed: "Signed by the candidate",
      company_signed: "Signed by the company",
      completed: "Signed by both parties",
      rejected: "Rejected",
      expired: "Expired",
      signed_candidate: "Needs review",
      signed_company: "Needs review",
      fully_signed: "Needs review",
    },
    parties: "Parties",
    company: "Company",
    candidate: "Candidate",
    terms: "Recorded terms",
    termsNotice:
      "Terms frozen at selection. Later changes to the job offer do not affect them.",
    job: "Mission",
    dates: "Dates",
    hours: "Hours",
    breakMinutes: "Break: {min} min",
    place: "Location",
    pay: "Pay per candidate",
    clausesTitle: "Commitments",
    clausesVersion: "Clause version: {version}",
    clausesMissing:
      "The general clauses were not recorded with this contract. They are not reconstructed.",
    signatures: "Signatures",
    signedOn: "Signed on {date}",
    awaiting: "Pending",
    fingerprint: "Fingerprint of the signed content: {hash}",
    needsReview:
      "This contract must be reviewed by support before any new signature.",
    yourSignature: "Your agreement",
    sign: "Sign and accept",
    signing: "Signing…",
    confirmTitle: "Confirm your signature",
    confirmDescription:
      'You accept the contract "{job}" with {company}. Your signature cannot be changed afterwards.',
    confirm: "Sign",
    cancel: "Cancel",
    alreadySignedByYou: "You have signed this contract.",
    awaitingOther: "Waiting for the other party's signature.",
    separateSteps:
      "Signing the contract is separate from starting the mission, confirming it with the code and paying the agreed amount.",
    toasts: {
      signedTitle: "Contract signed",
      signedDesc: "Your signature has been recorded.",
      completedDesc: "The contract is signed by both parties.",
      errorTitle: "Signature not recorded",
    },
    errors: {
      not_authenticated: "Session expired. Please sign in again.",
      account_suspended: "Your account is suspended.",
      contract_not_found: "Contract not found or not accessible.",
      contract_not_signable: "This contract can no longer be signed.",
      contract_needs_review:
        "This contract must be reviewed by support before signing.",
      terms_mismatch:
        "The contract shown is out of date. Reload it before signing.",
      consent_required: "Tick the acceptance box to sign.",
      generic: "The signature could not be recorded. Please try again.",
    },
  },

  // Reputation: star ratings from mission reviews (lot 9b).
  reputation: {
    noReviews: "No reviews yet",
    summary: "{rating}/5 · {reviews}",
    reviews: { one: "{count} review", other: "{count} reviews" },
    ratingLabel: "Rating",
    stars: { one: "{count} star", other: "{count} stars" },
    statLabel: "Reputation",
    starsAria: "EasyJob reputation: {stars} out of 5",
    reasons: {
      late: "Late arrival",
      left_early: "Left early",
      poor_quality: "Work not up to standard",
      instructions_ignored: "Instructions not followed",
      behavior: "Inappropriate behaviour",
      presentation: "Unsuitable dress or equipment",
      unclear_instructions: "Unclear instructions",
      conditions_mismatch: "Conditions different from the job offer",
      disrespect: "Disrespectful treatment",
      unsafe: "Unsafe working conditions",
      code_withheld: "Completion code given late",
      extra_tasks: "Tasks not agreed",
    },
    progress: {
      title: "My EasyJob reputation",
      candidateNote: "Companies only see your stars, never your reviews.",
      companyNote: "Candidates only see your stars, never your reviews.",
      nextTier: "Next level: {stars}",
      maxTier: "You have reached the top level.",
      barLabel: "Progress towards {stars}",
      categoryValue: "{stars} of {max}",
      categories: {
        profile: "Complete profile",
        experience: "Experience and commitments",
        experienceCompany: "Completed jobs and commitments",
        reviews: "Reviews received",
        skills: "Verified skills",
      },
      actions: {
        missions: {
          one: "{count} more confirmed mission",
          other: "{count} more confirmed missions",
        },
        offers: {
          one: "{count} more completed job",
          other: "{count} more completed jobs",
        },
        reviews: {
          one: "{count} more 4 or 5-star review",
          other: "{count} more 4 or 5-star reviews",
        },
        profile50: "Complete your profile to 50%",
        profile100: "Complete your profile to 100%",
        skills: "Get one more skill document approved",
        done: "Maximum reached",
      },
      breaches: {
        one: "{count} confirmed missed commitment counted",
        other: "{count} confirmed missed commitments counted",
      },
      companyBreaches: {
        one: "{count} deduction for late cancellations",
        other: "{count} deductions for late cancellations",
      },
      expiry:
        "A supporting document expires on {date}: renew it to keep your stars.",
      loadError: "Your reputation could not be loaded.",
    },
    celebration: {
      gainTitle: "Congratulations!",
      gainBody: "Your reputation rises to {stars}.",
      lossTitle: "Your reputation went down",
      lossBody: "It is now {stars}.",
      lossReasons: "Review reasons: {reasons}.",
      lossDocument: "Expired document: {documents}.",
      renew: "Renew my document",
      completeProfile: "Complete my profile",
      skills: "My skills",
      view: "See my progress",
      contest: "Dispute it with support",
      contestSubject: "Review dispute",
      close: "Close",
    },
    admin: {
      openCompany: "Reputation and reviews",
      title: "EasyJob reputation",
      categories: "Breakdown by category",
      reviews: "Reviews received",
      noReviews: "No reviews received.",
      author: "Author",
      mission: "Mission",
      rating: "Rating",
      reasons: "Reasons",
      comment: "Comment",
      noComment: "No comment",
      impact: "Impact",
      impactValue: "{applied} unit(s) (nominal {nominal}), balance {balance}",
      notCounted: "Not counted",
      notCountedHint:
        "Mission not confirmed by code, or review invalidated by a dispute.",
      contest: "Dispute",
      contestNone: "None",
      contestOpen: "Open",
      contestUpheld: "Accepted: review invalidated",
      contestRejected: "Rejected: review kept",
      openContest: "Attach a dispute",
      notePlaceholder: "Request received by support (date, channel, summary)",
      decisionPlaceholder: "Reason for the decision",
      uphold: "Accept (invalidate the review)",
      reject: "Reject (keep the review)",
      readOnly: "Read only: only admin_ops and admin_founder decide.",
      changes: "Recent changes",
      incidents: "Confirmed missed commitments",
      noIncidents: "No missed commitment recorded.",
      saved: "Decision saved.",
      error: "Action failed. Please try again.",
    },
  },
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
    onboardingIncomplete:
      "Your profile could not be completed: check your details, your skills (at least 2) and your Mobile Money account.",
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
        "The platform connecting Cameroonian talent with local businesses. Fixed pay per mission, contract signed in the app, completion confirmed by code.",
      ctaCandidate: "I am looking for a job",
      ctaCompany: "I am hiring",
      trust: "Free registration · Fixed pay in XAF · Signed contract",
    },
    stats: {
      flatPay: "Fixed pay per mission",
      signatures: "Signatures per contract",
      completionCode: "Digits in the completion code",
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
        "Sign up in a few minutes: photo, skills, ID verified by the EasyJob team.",
      cStep2Title: "Apply in one click",
      cStep2Desc:
        "Find a mission that fits your schedule. No message required. Fast response.",
      cStep3Title: "Confirm the mission",
      cStep3Desc:
        "Enter the six-digit code the company gives you. The agreed fixed amount is in your contract.",
      eStep1Title: "Describe your need",
      eStep1Desc:
        "Enter the role, schedule and fixed pay per candidate. The EasyJob team reviews the job before it goes live.",
      eStep2Title: "Pick your candidates",
      eStep2Desc:
        "Review applications with each candidate's rating, missions and verifications, then select.",
      eStep3Title: "Mission done",
      eStep3Desc:
        "Give the completion code to the candidate once the work is done, pay the agreed amount, then review them.",
    },
    features: {
      title: "Why choose EasyJob CM",
      f1Title: "Fixed pay per mission",
      f1Desc:
        "Each job states an amount in XAF per candidate, carried as is into the contract.",
      f2Title: "Digital Contract",
      f2Desc:
        "Each selection creates a contract that the company and the candidate sign electronically.",
      f3Title: "Reviews after every mission",
      f3Desc:
        "After each mission, the company and the candidate rate each other. The rating and number of reviews are visible before selection; a profile without reviews can still apply.",
      f4Title: "Targeted search",
      f4Desc: "Filter jobs by city and category, then apply in one click.",
    },
    cta: {
      title: "Ready to start?",
      subtitle:
        "Create your account to find or post a mission in Douala and Yaoundé.",
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
    },
    theme: { darkMode: "Dark mode", lightMode: "Light mode" },
    language: { french: "Français", english: "English" },
    trust: {
      signup: "Free signup",
      momo: "Fixed pay in XAF",
      contract: "Signed contract",
    },
    simpleFastSecure: "Simple. Fast. Secure.",
    featuresLabel: "Features",
    mockup: {
      jobsNear: "Jobs near you",
      doualaCount: "Douala · 12 jobs",
      applyOneClick: "Apply in 1 click",
      paymentReceived: "Contract signed",
      missionConfirmed: "Mission confirmed",
      reviewed: "Post-mission review",
      reviewedValue: "4.9/5 · 12 reviews",
    },
    pwa: {
      title: "Install EasyJob CM on your device",
      desc: "Web app you can install on your home screen, no store needed. Works on iOS, Android and desktop.",
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

  // Realtime (lot 7d)
  realtime: {
    suspendedTitle: "Your account is suspended.",
    suspendedBody:
      "You can still view your information, but you can no longer apply, publish, select, sign or start a mission. Please contact support.",
    unavailable: "This content is no longer available.",
    actionUnavailable: "Action unavailable: account suspended.",
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
    q2: "How am I paid?",
    q3: "How do I post a job?",
    q4: "Where do I sign my contract?",
    send: "Send",
    signIn: "Sign in",
    errors: {
      not_authenticated: "Sign in to chat with EasyBot.",
      account_inactive:
        "EasyBot is available once your account is open (phone verified) and active.",
      chat_payload_too_large:
        "Message or conversation too long. Please shorten your question.",
      invalid_chat_request: "Invalid message. Please try again.",
      chat_quota_exceeded:
        "You have reached the question limit. Please try again later.",
      chat_unavailable:
        "EasyBot is temporarily unavailable. Try again later or write to support@easyjob.cm.",
      generic: "Something went wrong. Please try again.",
    },
  },
};
