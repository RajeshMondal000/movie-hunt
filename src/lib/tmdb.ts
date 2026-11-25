import { useEffect, useState } from 'react'

export type TmdbGenre = {
  id: number
  name: string
}

export type TmdbMovie = {
  id: number
  title: string
  original_title?: string
  overview?: string
  poster_path: string | null
  backdrop_path: string | null
  release_date?: string
  original_language?: string
  popularity?: number
  vote_average?: number
  vote_count?: number
  genre_ids?: number[]
  genres?: TmdbGenre[]
  adult?: boolean
}

export type TmdbMovieList = {
  page: number
  results: TmdbMovie[]
  total_pages: number
  total_results: number
}

export type TmdbMovieDetails = TmdbMovie & {
  runtime?: number | null
  tagline?: string | null
  status?: string
  homepage?: string
  genres?: TmdbGenre[]
  credits?: {
    cast?: Array<{
      id: number
      name: string
      character: string
      profile_path: string | null
    }>
    crew?: Array<{
      id: number
      name: string
      job: string
      department: string
    }>
  }
  videos?: {
    results?: Array<{
      id: string
      key: string
      name: string
      site: string
      type: string
      official: boolean
    }>
  }
  recommendations?: TmdbMovieList
}

export function tmdbImage(path: string | null | undefined, size = 'w500') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null
}

type RequestState<T> = {
  url: string | null
  data: T | null
  error: string
  loading: boolean
}

/** Fetches a same-origin Worker API endpoint and ignores stale requests. */
export function useTmdbData<T>(url: string | null) {
  const [state, setState] = useState<RequestState<T>>({
    url: null,
    data: null,
    error: '',
    loading: true,
  })

  useEffect(() => {
    if (!url) return

    const controller = new AbortController()

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as T & { message?: string; error?: string }
        if (!response.ok) {
          throw new Error(data.message ?? data.error ?? `Request failed (${response.status})`)
        }
        return data
      })
      .then((data) => {
        setState({ url, data, error: '', loading: false })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          url,
          data: null,
          error: error instanceof Error ? error.message : 'Could not load movies.',
          loading: false,
        })
      })

    return () => controller.abort()
  }, [url])

  const isCurrentRequest = state.url === url

  return {
    data: isCurrentRequest ? state.data : null,
    error: isCurrentRequest ? state.error : '',
    loading: Boolean(url) && (!isCurrentRequest || state.loading),
  }
}
