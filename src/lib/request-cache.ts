import { useEffect, useState } from 'react'

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 80

type CacheEntry = {
  data: unknown
  updatedAt: number
}

type RequestState<T> = {
  url: string | null
  data: T | null
  error: string
  loading: boolean
}

const responseCache = new Map<string, CacheEntry>()
const inFlightRequests = new Map<string, Promise<unknown>>()

function readCache<T>(url: string): CacheEntry & { data: T } | null {
  const entry = responseCache.get(url)

  if (!entry) return null

  // Refresh the entry's position to maintain LRU ordering.
  responseCache.delete(url)
  responseCache.set(url, entry)

  return entry as CacheEntry & { data: T }
}

function writeCache<T>(url: string, data: T) {
  responseCache.delete(url)

  responseCache.set(url, {
    data,
    updatedAt: Date.now(),
  })

  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value

    if (!oldestKey) break

    responseCache.delete(oldestKey)
  }
}

async function fetchCachedJson<T>(
  url: string,
  ttlMs: number,
): Promise<T> {
  const cached = readCache<T>(url)

  if (cached && Date.now() - cached.updatedAt < ttlMs) {
    return cached.data
  }

  const existingRequest = inFlightRequests.get(url)

  if (existingRequest) {
    return existingRequest as Promise<T>
  }

  const request = (async () => {
    const response = await fetch(url)

    const payload = await response.json() as T & {
      message?: string
      error?: string
    }

    if (!response.ok) {
      throw new Error(
        payload.message ??
        payload.error ??
        `Request failed (${response.status})`,
      )
    }

    writeCache(url, payload)

    return payload as T
  })()

  inFlightRequests.set(url, request)

  try {
    return await request
  } finally {
    if (inFlightRequests.get(url) === request) {
      inFlightRequests.delete(url)
    }
  }
}

export function useCachedApiData<T>(
  url: string | null,
  ttlMs = DEFAULT_CACHE_TTL_MS,
) {
  const [state, setState] = useState<RequestState<T>>({
    url: null,
    data: null,
    error: '',
    loading: false,
  })

  useEffect(() => {
    if (!url) return

    let active = true

    const cached = readCache<T>(url)
    const cacheIsFresh =
      cached !== null &&
      Date.now() - cached.updatedAt < ttlMs

    // Fresh cached data requires no network request.
    if (cacheIsFresh) {
      return () => {
        active = false
      }
    }

    // Fetch new data or refresh stale cached data.
    void fetchCachedJson<T>(url, ttlMs)
      .then((data) => {
        if (!active) return

        setState({
          url,
          data,
          error: '',
          loading: false,
        })
      })
      .catch((error: unknown) => {
        if (!active) return

        setState({
          url,
          data: cached?.data ?? null,
          error: cached
            ? ''
            : error instanceof Error
              ? error.message
              : 'Could not load data.',
          loading: false,
        })
      })

    return () => {
      active = false
    }
  }, [url, ttlMs])

  // Resolve cached data during rendering.
  const visibleCache = url ? readCache<T>(url) : null
  const isCurrentRequest = state.url === url

  return {
    data: isCurrentRequest
      ? state.data
      : visibleCache?.data ?? null,

    error: isCurrentRequest ? state.error : '',

    loading: Boolean(url) && (
      isCurrentRequest
        ? state.loading
        : !visibleCache
    ),
  }
}