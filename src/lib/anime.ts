import { useCachedApiData } from './request-cache'

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



export function useAnimeData<T>(url: string | null) {
  return useCachedApiData<T>(url)
}

export function animeYear(date: string | null | undefined): string {
  return date?.slice(0, 4) || 'Year unknown'
}

export function animeScore(rating: number | null | undefined): string {
  return typeof rating === 'number' && rating > 0 ? (rating / 10).toFixed(1) : '—'
}
