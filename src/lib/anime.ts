import { useEffect, useState } from 'react'

export type KitsuAnime = {
  id: string
  title: string
  synopsis: string
  posterUrl: string | null
  coverUrl: string | null
  averageRating: number
  startDate: string | null
  episodeCount: number | null
  episodeLength: number | null
  subtype: string | null
  status: string | null
  ageRating: string | null
  genres: string[]
  userCount: number
  youtubeVideoId: string | null
  slug: string | null
  nsfw: boolean
}

export type KitsuAnimeList = {
  page: number
  results: KitsuAnime[]
  totalResults: number
  totalPages: number
}

type AnimeDataState<T> = {
  url: string | null
  data: T | null
  error: string
}

export function useAnimeData<T>(url: string | null) {
  const [state, setState] = useState<AnimeDataState<T>>({
    url: null,
    data: null,
    error: '',
  })

  useEffect(() => {
    if (!url) return
    const controller = new AbortController()

    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as T & { message?: string; error?: string }
        if (!response.ok) {
          throw new Error(payload.message ?? payload.error ?? `Request failed (${response.status})`)
        }
        return payload as T
      })
      .then((data) => setState({ url, data, error: '' }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setState({
          url,
          data: null,
          error: error instanceof Error ? error.message : 'Could not load anime data.',
        })
      })

    return () => controller.abort()
  }, [url])

  return {
    data: state.url === url ? state.data : null,
    error: state.url === url ? state.error : '',
    loading: Boolean(url) && state.url !== url,
  }
}

export function animeYear(date: string | null | undefined): string {
  return date?.slice(0, 4) || 'Year unknown'
}

export function animeScore(rating: number | null | undefined): string {
  return typeof rating === 'number' && rating > 0 ? (rating / 10).toFixed(1) : '—'
}
