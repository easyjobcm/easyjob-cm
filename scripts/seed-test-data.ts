import { createClient } from '@supabase/supabase-js'

// Load local env file when running as a standalone script (Node 22+).
if (typeof process.loadEnvFile === 'function') {
  process.loadEnvFile('.env.local')
}

// Use service role key to bypass RLS for seed operations.
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.',
  )
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

type SeedUser = {
  phone: string
  role: 'candidate' | 'company'
  locale: 'fr' | 'en'
}

async function getOrCreateAuthUser(phone: string, role: SeedUser['role']) {
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    phone,
    user_metadata: { seed: true },
    app_metadata: { role },
    phone_confirm: true,
  })

  if (!createError && created.user) {
    return created.user.id
  }

  const { data: usersPage, error: listError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })

  if (listError) {
    throw listError
  }

  const existing = usersPage.users.find((u) => u.phone === phone)
  if (!existing) {
    throw createError ?? new Error(`Unable to create/find auth user for ${phone}`)
  }

  return existing.id
}

async function seedTestData() {
  console.log('Starting seed process...')
  
  // Create or reuse auth users first; public.users references auth.users.
  const seedUsers: SeedUser[] = [
    { phone: '+237690000001', role: 'candidate', locale: 'fr' },
    { phone: '+237690000002', role: 'candidate', locale: 'fr' },
    { phone: '+237690000003', role: 'candidate', locale: 'fr' },
    { phone: '+237690000004', role: 'company', locale: 'fr' },
    { phone: '+237690000005', role: 'company', locale: 'fr' },
  ]

  const authUserIds = await Promise.all(
    seedUsers.map(async (u) => ({
      ...u,
      id: await getOrCreateAuthUser(u.phone, u.role),
    })),
  )

  const candidateUserId1 = authUserIds[0].id
  const candidateUserId2 = authUserIds[1].id
  const candidateUserId3 = authUserIds[2].id
  const companyUserId1 = authUserIds[3].id
  const companyUserId2 = authUserIds[4].id
  
  const candidateProfileId1 = crypto.randomUUID()
  const candidateProfileId2 = crypto.randomUUID()
  const candidateProfileId3 = crypto.randomUUID()
  const companyProfileId1 = crypto.randomUUID()
  const companyProfileId2 = crypto.randomUUID()
  
  const jobId1 = crypto.randomUUID()
  const jobId2 = crypto.randomUUID()
  const jobId3 = crypto.randomUUID()
  const jobId4 = crypto.randomUUID()
  const jobId5 = crypto.randomUUID()
  
  const applicationId1 = crypto.randomUUID()
  const applicationId2 = crypto.randomUUID()
  const applicationId3 = crypto.randomUUID()
  const applicationId4 = crypto.randomUUID()
  const applicationId5 = crypto.randomUUID()
  
  const missionId1 = crypto.randomUUID()
  const missionId2 = crypto.randomUUID()
  const missionId3 = crypto.randomUUID()
  
  
  // 1. Create job categories
  console.log('Creating job categories...')
  const categories = [
    { name_fr: 'Restauration', name_en: 'Restaurant', icon: 'utensils', sort_order: 1, is_active: true },
    { name_fr: 'Nettoyage', name_en: 'Cleaning', icon: 'sparkles', sort_order: 2, is_active: true },
    { name_fr: 'Manutention', name_en: 'Warehouse', icon: 'package', sort_order: 3, is_active: true },
    { name_fr: 'Événementiel', name_en: 'Events', icon: 'calendar', sort_order: 4, is_active: true },
    { name_fr: 'Commerce', name_en: 'Retail', icon: 'shopping-bag', sort_order: 5, is_active: true },
    { name_fr: 'Hôtellerie', name_en: 'Hospitality', icon: 'building', sort_order: 6, is_active: true },
    { name_fr: 'Transport', name_en: 'Transport', icon: 'truck', sort_order: 7, is_active: true },
    { name_fr: 'Sécurité', name_en: 'Security', icon: 'shield', sort_order: 8, is_active: true },
  ]
  
  // Check if categories already exist
  const { data: existingCategories } = await supabase.from('job_categories').select('id, name_fr')
  
  if (!existingCategories || existingCategories.length === 0) {
    const { data: insertedCategories, error: catError } = await supabase
      .from('job_categories')
      .insert(categories)
      .select()
    
    if (catError) {
      console.error('Error creating categories:', catError)
    } else {
      console.log(`Created ${insertedCategories?.length || 0} categories`)
    }
  } else {
    console.log(`Categories already exist: ${existingCategories.length}`)
  }

  // Get category IDs
  const { data: allCategories } = await supabase.from('job_categories').select('id, name_fr')
  const categoryMap = new Map(allCategories?.map(c => [c.name_fr, c.id]) || [])

  // 2. Create test users
  console.log('Creating test users...')
  const testUsers = authUserIds.map((u) => ({
    id: u.id,
    phone: u.phone,
    role: u.role,
    is_verified: true,
    phone_verified: true,
    is_active: true,
    locale: u.locale,
  }))

  const { error: usersError } = await supabase
    .from('users')
    .upsert(testUsers, { onConflict: 'id' })
  
  if (usersError) {
    console.error('Error creating users:', usersError)
  } else {
    console.log('Created test users')
  }

  // 3. Create candidate profiles
  console.log('Creating candidate profiles...')
  const candidateProfiles = [
    {
      id: candidateProfileId1,
      user_id: candidateUserId1,
      first_name: 'Jean',
      last_name: 'Mbarga',
      gender: 'male',
      date_of_birth: '1998-05-15',
      cni_number: 'CM123456789',
      cni_verified: 'verified',
      address: 'Rue 1234, Bastos',
      city: 'Yaoundé',
      quartier: 'Bastos',
      latitude: 3.8767,
      longitude: 11.5021,
      momo_provider: 'mtn',
      momo_number: '+237690000001',
      momo_verified: true,
      bio: 'Travailleur motivé avec 2 ans d\'expérience en restauration.',
      reliability_score: 4.8,
      completed_missions: 15,
      total_missions: 16,
      onboarding_status: 'completed',
      onboarding_step: 6,
    },
    {
      id: candidateProfileId2,
      user_id: candidateUserId2,
      first_name: 'Marie',
      last_name: 'Ngo Ndongo',
      gender: 'female',
      date_of_birth: '2000-08-22',
      cni_number: 'CM987654321',
      cni_verified: 'verified',
      address: 'Avenue Kennedy',
      city: 'Douala',
      quartier: 'Akwa',
      latitude: 4.0511,
      longitude: 9.7679,
      momo_provider: 'orange',
      momo_number: '+237690000002',
      momo_verified: true,
      bio: 'Étudiante en commerce, disponible les weekends.',
      reliability_score: 4.5,
      completed_missions: 8,
      total_missions: 9,
      onboarding_status: 'completed',
      onboarding_step: 6,
    },
    {
      id: candidateProfileId3,
      user_id: candidateUserId3,
      first_name: 'Paul',
      last_name: 'Atangana',
      gender: 'male',
      date_of_birth: '1995-03-10',
      cni_number: 'CM456789123',
      cni_verified: 'pending',
      address: 'Carrefour Nlongkak',
      city: 'Yaoundé',
      quartier: 'Nlongkak',
      latitude: 3.8600,
      longitude: 11.5200,
      momo_provider: 'mtn',
      momo_number: '+237690000003',
      momo_verified: false,
      bio: 'Agent de sécurité expérimenté.',
      reliability_score: 4.2,
      completed_missions: 5,
      total_missions: 6,
      onboarding_status: 'in_progress',
      onboarding_step: 4,
    },
  ]

  const { error: candError } = await supabase
    .from('candidate_profiles')
    .upsert(candidateProfiles, { onConflict: 'user_id' })
  
  if (candError) {
    console.error('Error creating candidate profiles:', candError)
  } else {
    console.log('Created candidate profiles')
  }

  // 4. Create candidate skills
  console.log('Creating candidate skills...')
  const candidateSkills = [
    { candidate_id: candidateProfileId1, skill_name: 'Service en salle', skill_level: 4 },
    { candidate_id: candidateProfileId1, skill_name: 'Cuisine', skill_level: 3 },
    { candidate_id: candidateProfileId1, skill_name: 'Nettoyage', skill_level: 4 },
    { candidate_id: candidateProfileId2, skill_name: 'Vente', skill_level: 5 },
    { candidate_id: candidateProfileId2, skill_name: 'Caisse', skill_level: 4 },
    { candidate_id: candidateProfileId2, skill_name: 'Service client', skill_level: 5 },
    { candidate_id: candidateProfileId3, skill_name: 'Sécurité', skill_level: 5 },
    { candidate_id: candidateProfileId3, skill_name: 'Surveillance', skill_level: 4 },
  ]

  const { error: skillsError } = await supabase
    .from('candidate_skills')
    .insert(candidateSkills)

  if (skillsError) {
    console.error('Error creating skills:', skillsError)
  } else {
    console.log('Created candidate skills')
  }

  // 5. Create company profiles
  console.log('Creating company profiles...')
  const companyProfiles = [
    {
      id: companyProfileId1,
      user_id: companyUserId1,
      company_name: 'Restaurant Le Baobab',
      legal_name: 'Le Baobab SARL',
      niu: 'NIU123456789',
      rccm: 'RC/YDE/2020/B/1234',
      contact_name: 'Michel Fouda',
      contact_phone: '+237690000004',
      contact_email: 'contact@lebaobab.cm',
      address: '123 Avenue de l\'Indépendance',
      city: 'Yaoundé',
      quartier: 'Centre-ville',
      latitude: 3.8480,
      longitude: 11.5021,
      sector: 'Restauration',
      description: 'Restaurant traditionnel camerounais depuis 2015.',
      company_size: 'pme',
      verification_status: 'verified',
      subscription_tier: 'premium',
      is_active: true,
      onboarding_status: 'completed',
      onboarding_step: 5,
    },
    {
      id: companyProfileId2,
      user_id: companyUserId2,
      company_name: 'Hôtel Akwa Palace',
      legal_name: 'Akwa Palace SA',
      niu: 'NIU987654321',
      rccm: 'RC/DLA/2018/A/5678',
      contact_name: 'Christine Bella',
      contact_phone: '+237690000005',
      contact_email: 'rh@akwapalace.cm',
      address: '45 Boulevard de la Liberté',
      city: 'Douala',
      quartier: 'Akwa',
      latitude: 4.0511,
      longitude: 9.7679,
      sector: 'Hôtellerie',
      description: 'Hôtel 4 étoiles au cœur de Douala.',
      company_size: 'eti',
      verification_status: 'verified',
      subscription_tier: 'enterprise',
      is_active: true,
      onboarding_status: 'completed',
      onboarding_step: 5,
    },
  ]

  const { error: compError } = await supabase
    .from('company_profiles')
    .upsert(companyProfiles, { onConflict: 'user_id' })

  if (compError) {
    console.error('Error creating company profiles:', compError)
  } else {
    console.log('Created company profiles')
  }

  // 6. Create jobs
  console.log('Creating jobs...')
  const now = new Date()
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  
  const jobs = [
    {
      id: jobId1,
      company_id: companyProfileId1,
      category_id: categoryMap.get('Restauration'),
      title: 'Serveur/Serveuse pour soirée événementielle',
      description: 'Nous recherchons des serveurs expérimentés pour une grande soirée VIP. Tenue correcte exigée.',
      job_type: 'shift',
      start_date: tomorrow.toISOString().split('T')[0],
      end_date: tomorrow.toISOString().split('T')[0],
      start_time: '18:00',
      end_time: '02:00',
      hourly_rate: 2500,
      currency: 'XAF',
      address: '123 Avenue de l\'Indépendance',
      city: 'Yaoundé',
      quartier: 'Centre-ville',
      latitude: 3.8480,
      longitude: 11.5021,
      positions_available: 5,
      positions_filled: 2,
      required_skills: ['Service en salle', 'Communication'],
      dress_code: 'Chemise blanche et pantalon noir',
      status: 'active',
      urgency: 'urgent',
      published_at: now.toISOString(),
    },
    {
      id: jobId2,
      company_id: companyProfileId1,
      category_id: categoryMap.get('Nettoyage'),
      title: 'Agent de nettoyage - Contrat hebdomadaire',
      description: 'Nettoyage du restaurant tous les matins avant l\'ouverture. Matériel fourni.',
      job_type: 'contract',
      start_date: tomorrow.toISOString().split('T')[0],
      end_date: nextWeek.toISOString().split('T')[0],
      start_time: '06:00',
      end_time: '09:00',
      is_recurring: true,
      recurring_days: [1, 2, 3, 4, 5],
      hourly_rate: 1500,
      currency: 'XAF',
      address: '123 Avenue de l\'Indépendance',
      city: 'Yaoundé',
      quartier: 'Centre-ville',
      latitude: 3.8480,
      longitude: 11.5021,
      positions_available: 2,
      positions_filled: 0,
      required_skills: ['Nettoyage'],
      status: 'active',
      urgency: 'normal',
      published_at: now.toISOString(),
    },
    {
      id: jobId3,
      company_id: companyProfileId2,
      category_id: categoryMap.get('Hôtellerie'),
      title: 'Réceptionniste de nuit',
      description: 'Accueil des clients, gestion des réservations, service de conciergerie.',
      job_type: 'shift',
      start_date: tomorrow.toISOString().split('T')[0],
      end_date: tomorrow.toISOString().split('T')[0],
      start_time: '22:00',
      end_time: '06:00',
      hourly_rate: 2000,
      currency: 'XAF',
      address: '45 Boulevard de la Liberté',
      city: 'Douala',
      quartier: 'Akwa',
      latitude: 4.0511,
      longitude: 9.7679,
      positions_available: 1,
      positions_filled: 0,
      required_skills: ['Service client', 'Communication'],
      dress_code: 'Tenue professionnelle fournie',
      status: 'active',
      urgency: 'urgent',
      published_at: now.toISOString(),
    },
    {
      id: jobId4,
      company_id: companyProfileId2,
      category_id: categoryMap.get('Événementiel'),
      title: 'Staff pour conférence internationale',
      description: 'Accueil des participants, gestion des badges, orientation. Anglais et français requis.',
      job_type: 'shift',
      start_date: nextWeek.toISOString().split('T')[0],
      end_date: nextWeek.toISOString().split('T')[0],
      start_time: '07:00',
      end_time: '19:00',
      hourly_rate: 3000,
      currency: 'XAF',
      address: '45 Boulevard de la Liberté',
      city: 'Douala',
      quartier: 'Akwa',
      latitude: 4.0511,
      longitude: 9.7679,
      positions_available: 10,
      positions_filled: 0,
      required_skills: ['Service client', 'Communication', 'Anglais'],
      dress_code: 'T-shirt événement fourni',
      status: 'pending_review',
      urgency: 'normal',
    },
    {
      id: jobId5,
      company_id: companyProfileId1,
      category_id: categoryMap.get('Manutention'),
      title: 'Manutentionnaire - Réception livraisons',
      description: 'Déchargement et rangement des livraisons. Port de charges lourdes.',
      job_type: 'shift',
      start_date: tomorrow.toISOString().split('T')[0],
      end_date: tomorrow.toISOString().split('T')[0],
      start_time: '08:00',
      end_time: '12:00',
      hourly_rate: 2000,
      currency: 'XAF',
      address: '123 Avenue de l\'Indépendance',
      city: 'Yaoundé',
      quartier: 'Centre-ville',
      latitude: 3.8480,
      longitude: 11.5021,
      positions_available: 3,
      positions_filled: 1,
      required_skills: ['Manutention'],
      status: 'active',
      urgency: 'normal',
      published_at: now.toISOString(),
    },
  ]

  const { error: jobsError } = await supabase
    .from('jobs')
    .insert(jobs)

  if (jobsError) {
    console.error('Error creating jobs:', jobsError)
  } else {
    console.log('Created jobs')
  }

  // 7. Create job applications
  console.log('Creating job applications...')
  const applications = [
    {
      id: applicationId1,
      job_id: jobId1,
      candidate_id: candidateProfileId1,
      status: 'selected',
      match_score: 92,
      distance_km: 2.5,
      contract_signed: true,
    },
    {
      id: applicationId2,
      job_id: jobId1,
      candidate_id: candidateProfileId2,
      status: 'pending',
      match_score: 78,
      distance_km: 280,
    },
    {
      id: applicationId3,
      job_id: jobId2,
      candidate_id: candidateProfileId1,
      status: 'pending',
      match_score: 85,
      distance_km: 2.5,
    },
    {
      id: applicationId4,
      job_id: jobId3,
      candidate_id: candidateProfileId2,
      status: 'selected',
      match_score: 88,
      distance_km: 1.2,
      contract_signed: true,
    },
    {
      id: applicationId5,
      job_id: jobId5,
      candidate_id: candidateProfileId3,
      status: 'selected',
      match_score: 75,
      distance_km: 3.0,
      contract_signed: true,
    },
  ]

  const { error: appError } = await supabase
    .from('job_applications')
    .insert(applications)

  if (appError) {
    console.error('Error creating applications:', appError)
  } else {
    console.log('Created job applications')
  }

  // 8. Create missions
  console.log('Creating missions...')
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  
  const missions = [
    {
      id: missionId1,
      job_id: jobId1,
      candidate_id: candidateProfileId1,
      application_id: applicationId1,
      scheduled_date: tomorrow.toISOString().split('T')[0],
      scheduled_start_time: '18:00',
      scheduled_end_time: '02:00',
      status: 'confirmed',
      company_validation_code: 'ABC123',
    },
    {
      id: missionId2,
      job_id: jobId3,
      candidate_id: candidateProfileId2,
      application_id: applicationId4,
      scheduled_date: tomorrow.toISOString().split('T')[0],
      scheduled_start_time: '22:00',
      scheduled_end_time: '06:00',
      status: 'confirmed',
      company_validation_code: 'XYZ789',
    },
    {
      id: missionId3,
      job_id: jobId5,
      candidate_id: candidateProfileId3,
      application_id: applicationId5,
      scheduled_date: yesterday.toISOString().split('T')[0],
      scheduled_start_time: '08:00',
      scheduled_end_time: '12:00',
      actual_start_time: new Date(yesterday.getTime() + 8 * 60 * 60 * 1000).toISOString(),
      actual_end_time: new Date(yesterday.getTime() + 12 * 60 * 60 * 1000).toISOString(),
      status: 'completed',
      arrival_validated: true,
      departure_validated: true,
    },
  ]

  const { error: missionsError } = await supabase
    .from('missions')
    .insert(missions)

  if (missionsError) {
    console.error('Error creating missions:', missionsError)
  } else {
    console.log('Created missions')
  }

  // 9. Create payments
  console.log('Creating payments...')
  const paymentId = crypto.randomUUID()
  const payments = [
    {
      id: paymentId,
      mission_id: missionId3,
      candidate_id: candidateProfileId3,
      company_id: companyProfileId1,
      gross_amount: 8000,
      platform_fee: 800,
      net_amount: 7200,
      hours_worked: 4,
      hourly_rate: 2000,
      status: 'completed',
      reference_number: 'PAY-2024-0001',
      currency: 'XAF',
    },
  ]

  const { error: paymentsError } = await supabase
    .from('payments')
    .insert(payments)

  if (paymentsError) {
    console.error('Error creating payments:', paymentsError)
  } else {
    console.log('Created payments')
  }

  // 10. Create reviews
  console.log('Creating reviews...')
  const reviewId1 = crypto.randomUUID()
  const reviewId2 = crypto.randomUUID()
  const reviews = [
    {
      id: reviewId1,
      mission_id: missionId3,
      reviewer_type: 'company',
      reviewer_id: companyProfileId1,
      reviewed_type: 'candidate',
      reviewed_id: candidateProfileId3,
      overall_rating: 4,
      punctuality_rating: 5,
      professionalism_rating: 4,
      work_quality_rating: 4,
      communication_rating: 3,
      comment: 'Bon travailleur, ponctuel et efficace.',
      is_public: true,
    },
    {
      id: reviewId2,
      mission_id: missionId3,
      reviewer_type: 'candidate',
      reviewer_id: candidateProfileId3,
      reviewed_type: 'company',
      reviewed_id: companyProfileId1,
      overall_rating: 5,
      punctuality_rating: 5,
      professionalism_rating: 5,
      communication_rating: 5,
      comment: 'Excellente entreprise, équipe accueillante et paiement rapide.',
      is_public: true,
    },
  ]

  const { error: reviewsError } = await supabase
    .from('reviews')
    .insert(reviews)

  if (reviewsError) {
    console.error('Error creating reviews:', reviewsError)
  } else {
    console.log('Created reviews')
  }

  // 11. Create notifications
  console.log('Creating notifications...')
  const notifications = [
    {
      user_id: candidateUserId1,
      notification_type: 'mission_reminder',
      title: 'Mission demain',
      body: 'Rappel: Vous avez une mission demain à 18h00 au Restaurant Le Baobab.',
      is_read: false,
    },
    {
      user_id: candidateUserId2,
      notification_type: 'application_update',
      title: 'Candidature en attente',
      body: 'Votre candidature pour "Serveur/Serveuse" est en cours d\'examen.',
      is_read: true,
    },
    {
      user_id: candidateUserId3,
      notification_type: 'payment',
      title: 'Paiement reçu',
      body: 'Vous avez reçu 7,200 XAF pour votre mission du 19/05.',
      is_read: false,
    },
    {
      user_id: companyUserId1,
      notification_type: 'application_update',
      title: 'Nouvelle candidature',
      body: 'Marie Ngo Ndongo a postulé pour "Serveur/Serveuse pour soirée événementielle".',
      is_read: false,
    },
  ]

  const { error: notifError } = await supabase
    .from('notifications')
    .insert(notifications)

  if (notifError) {
    console.error('Error creating notifications:', notifError)
  } else {
    console.log('Created notifications')
  }

  console.log('\n✅ Seed data created successfully!')
  console.log('\nTest accounts (numéros de téléphone):')
  console.log('- Candidate 1: +237690000001 (Jean Mbarga)')
  console.log('- Candidate 2: +237690000002 (Marie Ngo Ndongo)')
  console.log('- Candidate 3: +237690000003 (Paul Atangana)')
  console.log('- Company 1: +237690000004 (Restaurant Le Baobab)')
  console.log('- Company 2: +237690000005 (Hôtel Akwa Palace)')
  console.log('\nVous pouvez vous connecter avec ces numéros.')
  console.log('Le code OTP de test est: 123456')
}

seedTestData().catch(console.error)
