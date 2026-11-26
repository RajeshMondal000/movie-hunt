import { useCachedApiData } from './request-cache'

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


/** Fetches a same-origin Worker API endpoint and ignores stale requests. */
export function useTmdbData<T>(url: string | null) {
  return useCachedApiData<T>(url)
}
