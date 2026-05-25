import useSWR from 'swr'
import useSWRMutation from 'swr/mutation'

// Generic fetcher
const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const error = await res.json()
    throw new Error(error.error || 'An error occurred')
  }
  return res.json()
}

// POST fetcher
async function postFetcher(url: string, { arg }: { arg: any }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(arg),
  })
  if (!res.ok) {
    const error = await res.json()
    throw new Error(error.error || 'An error occurred')
  }
  return res.json()
}

// User hook
export function useUser() {
  const { data, error, isLoading, mutate } = useSWR('/api/user', fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    user: data?.user,
    profile: data?.profile,
    auth: data?.auth,
    isLoading,
    isError: error,
    mutate,
  }
}

// Jobs list hook
export function useJobs(params?: {
  city?: string
  category?: string
  search?: string
  page?: number
  limit?: number
}) {
  const searchParams = new URLSearchParams()
  if (params?.city) searchParams.set('city', params.city)
  if (params?.category) searchParams.set('category', params.category)
  if (params?.search) searchParams.set('search', params.search)
  if (params?.page) searchParams.set('page', params.page.toString())
  if (params?.limit) searchParams.set('limit', params.limit.toString())

  const url = `/api/jobs?${searchParams.toString()}`

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
  })

  return {
    jobs: data?.jobs || [],
    pagination: data?.pagination,
    isLoading,
    isError: error,
    mutate,
  }
}

// Single job hook
export function useJob(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? `/api/jobs/${id}` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  return {
    job: data?.job,
    userStatus: data?.userStatus,
    isLoading,
    isError: error,
    mutate,
  }
}

// Categories hook
export function useCategories() {
  const { data, error, isLoading } = useSWR('/api/categories', fetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  })

  return {
    categories: data?.categories || [],
    isLoading,
    isError: error,
  }
}

// Apply to job mutation
export function useApplyToJob(jobId: string) {
  const { trigger, isMutating, error } = useSWRMutation(
    `/api/jobs/${jobId}/apply`,
    postFetcher
  )

  return {
    apply: trigger,
    isApplying: isMutating,
    error,
  }
}

// Create job mutation (for companies)
export function useCreateJob() {
  const { trigger, isMutating, error } = useSWRMutation(
    '/api/jobs',
    postFetcher
  )

  return {
    createJob: trigger,
    isCreating: isMutating,
    error,
  }
}
