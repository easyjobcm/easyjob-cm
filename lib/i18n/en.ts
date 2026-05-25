import type { TranslationKeys } from './fr'

export const en: TranslationKeys = {
  // Common
  common: {
    loading: 'Loading...',
    error: 'An error occurred',
    retry: 'Retry',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    back: 'Back',
    next: 'Next',
    previous: 'Previous',
    search: 'Search',
    filter: 'Filter',
    sort: 'Sort',
    all: 'All',
    none: 'None',
    yes: 'Yes',
    no: 'No',
    or: 'or',
    and: 'and',
  },
  
  // App name
  app: {
    name: 'EasyJob CM',
    tagline: 'Find your next flexible job',
    description: 'The platform connecting candidates and companies for flexible missions in Cameroon.',
  },
  
  // Auth
  auth: {
    welcome: 'Welcome to EasyJob CM',
    welcomeBack: 'Welcome back!',
    signIn: 'Sign in',
    signUp: 'Create account',
    signOut: 'Sign out',
    phone: 'Phone number',
    phonePlaceholder: '6XX XXX XXX',
    phoneHint: 'Enter your Cameroonian number',
    invalidPhone: 'Invalid phone number',
    otp: 'Verification code',
    otpSent: 'A code has been sent to',
    otpPlaceholder: '000000',
    otpHint: 'Enter the 6-digit code',
    otpInvalid: 'Invalid code',
    otpExpired: 'Code expired',
    resendOtp: 'Resend code',
    resendIn: 'Resend in',
    verifying: 'Verifying...',
    selectRole: 'I am...',
    candidate: 'A candidate',
    candidateDesc: 'Looking for flexible missions',
    company: 'A company',
    companyDesc: 'Offering missions',
    termsAgree: 'By continuing, you agree to our',
    terms: 'Terms of Service',
    privacy: 'Privacy Policy',
  },
  
  // Navigation
  nav: {
    jobs: 'Jobs',
    tasks: 'Tasks',
    myJobs: 'My Jobs',
    profile: 'Profile',
  },
  
  // Jobs
  jobs: {
    title: 'Available jobs',
    empty: 'No jobs available',
    emptyDesc: 'Check back soon for new opportunities',
    search: 'Search for a job...',
    filters: 'Filters',
    salary: 'Salary',
    location: 'Location',
    date: 'Date',
    duration: 'Duration',
    apply: 'Apply',
    applied: 'Application sent',
    deadline: 'Deadline',
    spotsLeft: 'spots left',
    perHour: '/hour',
    perDay: '/day',
    perMission: '/mission',
  },
  
  // Tasks
  tasks: {
    title: 'My tasks',
    empty: 'You\'re all set!',
    emptyDesc: 'No pending tasks at the moment',
    pending: 'Pending',
    inProgress: 'In progress',
    completed: 'Completed',
    upcoming: 'Upcoming',
    discoverJobs: 'Discover jobs',
  },
  
  // My Jobs
  myJobs: {
    title: 'My Jobs',
    applications: 'Applications',
    booked: 'Booked',
    worked: 'Worked',
    empty: 'Find your next job!',
    emptyDesc: 'You don\'t have any applications yet',
    browseJobs: 'Browse jobs',
  },
  
  // Profile
  profile: {
    title: 'Profile',
    editProfile: 'Edit profile',
    availability: 'My availability',
    availabilityEdit: 'Edit',
    myAccount: 'My account',
    personalData: 'Personal data',
    newsUpdates: 'News & Updates',
    settings: 'Settings',
    support: 'Support',
    helpSupport: 'Help & Support',
    about: 'About EasyJob',
    language: 'Language',
    notifications: 'Notifications',
    darkMode: 'Dark mode',
  },
  
  // Days
  days: {
    monday: 'Mon',
    tuesday: 'Tue',
    wednesday: 'Wed',
    thursday: 'Thu',
    friday: 'Fri',
    saturday: 'Sat',
    sunday: 'Sun',
  },
  
  // Errors
  errors: {
    generic: 'An error occurred. Please try again.',
    network: 'Connection error. Check your internet.',
    unauthorized: 'Session expired. Please sign in again.',
    notFound: 'Page not found',
    serverError: 'Server error. Please try again later.',
  },
  
  // Success messages
  success: {
    saved: 'Saved successfully',
    deleted: 'Deleted successfully',
    applied: 'Application sent',
    profileUpdated: 'Profile updated',
  },
}
