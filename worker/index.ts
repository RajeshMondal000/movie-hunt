import { and, desc, eq, inArray, lte, like, ne, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import * as schema from '../src/db/schema.js'
import { createAuth, type AuthBindings } from './auth.js'

import {
  consumeAiSubmissionQuota,
  consumeGeminiAttemptQuota,
  enforceAuthRateLimits,
  enforceRequestRateLimits,
  getDailyQuotaRetryAfterSeconds,
  type RateLimitBindings,
} from './rate-limit.js'

type AppBindings = Env & AuthBindings & RateLimitBindings & {
  TMDB_ACCESS_TOKEN?: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}
type AppContext = Context<{ Bindings: AppBindings }>

type MemberRecord = {
  id: string
  name: string
  email: string
  image?: string | null
  role?: 'user' | 'admin' | string
  approvalStatus?: 'pending' | 'approved' | 'rejected' | string
  approvalExpiresAt?: number
  approvedAt?: number | null
  isAnonymous?: boolean
}


type TmdbGenre = { id: number; name: string }
type TmdbMovie = {
  id: number
  title: string
  original_title?: string
  overview?: string | null
  poster_path?: string | null
  backdrop_path?: string | null
  release_date?: string
  original_language?: string
  popularity?: number
  vote_average?: number
  vote_count?: number
  adult?: boolean
  genre_ids?: number[]
  genres?: TmdbGenre[]
}
type TmdbList = {
  page: number
  results: TmdbMovie[]
  total_pages: number
  total_results: number
}
type TmdbStatus = 400 | 404 | 429 | 502 | 503

class TmdbApiError extends Error {
  readonly status: TmdbStatus

  constructor(
    message: string,
    status: TmdbStatus,
  ) {
    super(message)
    this.name = 'TmdbApiError'
    this.status = status
  }
}

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'

async function tmdbRequest<T>(
  env: AppBindings,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const token = env.TMDB_ACCESS_TOKEN?.trim()
  if (!token) {
    throw new TmdbApiError(
      'TMDB is not configured. Add TMDB_ACCESS_TOKEN to your local or production Worker secrets.',
      503,
    )
  }

  const url = new URL(`${TMDB_BASE_URL}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const safeStatus: TmdbStatus =
      response.status === 404 ? 404 : response.status === 429 ? 429 : 502
    const detail = await response.text().catch(() => '')
    console.error('TMDB request failed:', response.status, detail.slice(0, 500))
    throw new TmdbApiError(
      response.status === 401
        ? 'TMDB rejected the access token. Check TMDB_ACCESS_TOKEN.'
        : response.status === 404
          ? 'The requested movie was not found.'
          : response.status === 429
            ? 'TMDB request limit reached. Please try again shortly.'
            : 'TMDB is temporarily unavailable. Please try again.',
      safeStatus,
    )
  }

  return response.json() as Promise<T>
}

function tmdbErrorResponse(c: AppContext, error: unknown) {
  if (error instanceof TmdbApiError) {
    return c.json(
      { error: 'tmdb_request_failed', message: error.message },
      error.status,
    )
  }

  console.error('Unexpected TMDB integration error:', error)
  return c.json(
    { error: 'tmdb_request_failed', message: 'Could not load movie data from TMDB.' },
    502,
  )
}

function validPage(value: string | undefined) {
  const page = Number(value ?? 1)
  if (!Number.isInteger(page) || page < 1) return 1
  return Math.min(page, 500)
}

async function cacheTmdbMovies(
  env: AppBindings,
  items: TmdbMovie[],
  suppliedGenres: TmdbGenre[] = [],
) {
  const db = getDb(env)
  const now = Math.floor(Date.now() / 1000)
  const genresById = new Map<number, TmdbGenre>()

  for (const genre of suppliedGenres) genresById.set(genre.id, genre)
  for (const item of items) {
    for (const genre of item.genres ?? []) genresById.set(genre.id, genre)
  }

  if (genresById.size > 0) {
    await db
      .insert(schema.genres)
      .values([...genresById.values()].map((genre) => ({ tmdbId: genre.id, name: genre.name })))
      .onConflictDoUpdate({
        target: schema.genres.tmdbId,
        set: { name: sql`excluded.name` },
      })
  }

  for (const item of items) {
    await db
      .insert(schema.movies)
      .values({
        tmdbId: item.id,
        title: item.title,
        originalTitle: item.original_title ?? null,
        overview: item.overview ?? '',
        posterPath: item.poster_path ?? null,
        backdropPath: item.backdrop_path ?? null,
        releaseDate: item.release_date ?? null,
        originalLanguage: item.original_language ?? null,
        popularity: item.popularity ?? 0,
        voteAverage: item.vote_average ?? 0,
        voteCount: item.vote_count ?? 0,
        isAdult: item.adult ?? false,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.movies.tmdbId,
        set: {
          title: item.title,
          originalTitle: item.original_title ?? null,
          overview: item.overview ?? '',
          posterPath: item.poster_path ?? null,
          backdropPath: item.backdrop_path ?? null,
          releaseDate: item.release_date ?? null,
          originalLanguage: item.original_language ?? null,
          popularity: item.popularity ?? 0,
          voteAverage: item.vote_average ?? 0,
          voteCount: item.vote_count ?? 0,
          isAdult: item.adult ?? false,
          updatedAt: now,
        },
      })

    const [cachedMovie] = await db
      .select({ id: schema.movies.id })
      .from(schema.movies)
      .where(eq(schema.movies.tmdbId, item.id))
      .limit(1)

    const genreIds = [...new Set([
      ...(item.genre_ids ?? []),
      ...(item.genres ?? []).map((genre) => genre.id),
    ])]

    if (cachedMovie && genreIds.length > 0) {
      const knownGenres = await db
        .select({ tmdbId: schema.genres.tmdbId })
        .from(schema.genres)
        .where(inArray(schema.genres.tmdbId, genreIds))

      if (knownGenres.length > 0) {
        await db
          .insert(schema.movieGenres)
          .values(knownGenres.map((genre) => ({ movieId: cachedMovie.id, genreId: genre.tmdbId })))
          .onConflictDoNothing()
      }
    }
  }
}

function queueMovieCache(c: AppContext, items: TmdbMovie[], genres: TmdbGenre[] = []) {
  c.executionCtx.waitUntil(
    cacheTmdbMovies(c.env, items, genres).catch((error) => {
      console.error('Could not cache TMDB movie data:', error)
    }),
  )
}

const WATCHLIST_STATUSES = ['want_to_watch', 'watching', 'watched', 'dropped'] as const
type WatchlistStatus = (typeof WATCHLIST_STATUSES)[number]

function isWatchlistStatus(value: unknown): value is WatchlistStatus {
  return typeof value === 'string' && WATCHLIST_STATUSES.includes(value as WatchlistStatus)
}

async function requireActiveMember(c: AppContext): Promise<MemberRecord | Response> {
  const result = await getSessionMember(c)
  if (!result) return c.json({ error: 'not_authenticated' }, 401)
  if (result.expired) {
    return c.json(
      { error: 'account_not_approved', message: 'This account is no longer active.' },
      403,
    )
  }
  return result.member
}

/** Ensure a movie exists in the local TMDB cache before attaching member data to it. */
async function ensureCachedMovie(env: AppBindings, tmdbId: number): Promise<number> {
  const db = getDb(env)
  const [existing] = await db
    .select({ id: schema.movies.id })
    .from(schema.movies)
    .where(eq(schema.movies.tmdbId, tmdbId))
    .limit(1)
  if (existing) return existing.id

  const movie = await tmdbRequest<TmdbMovie & { genres?: TmdbGenre[] }>(
    env,
    `/movie/${tmdbId}`,
    { language: 'en-US' },
  )
  await cacheTmdbMovies(env, [movie], movie.genres ?? [])

  const [cached] = await db
    .select({ id: schema.movies.id })
    .from(schema.movies)
    .where(eq(schema.movies.tmdbId, tmdbId))
    .limit(1)
  if (!cached) throw new Error('Movie metadata could not be cached.')
  return cached.id
}


type KitsuResource = {
  id: string
  type: string
  attributes?: Record<string, unknown>
  relationships?: Record<string, { data?: Array<{ id: string; type: string }> }>
}
type KitsuPayload = {
  data: KitsuResource | KitsuResource[]
  included?: KitsuResource[]
  meta?: { count?: number }
}
type KitsuAnime = {
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
type KitsuStatus = 400 | 404 | 429 | 502 | 503

class KitsuApiError extends Error {
  readonly status: KitsuStatus

  constructor(message: string, status: KitsuStatus) {
    super(message)
    this.name = 'KitsuApiError'
    this.status = status
  }
}

const KITSU_BASE_URL = 'https://kitsu.io/api/edge'
const KITSU_PAGE_SIZE = 20

async function kitsuRequest<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${KITSU_BASE_URL}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
    },
  })

  if (!response.ok) {
    const rawStatus = response.status
    const status: KitsuStatus = rawStatus === 404 ? 404 : rawStatus === 429 ? 429 : rawStatus === 400 ? 400 : 502
    const detail = await response.text().catch(() => '')
    console.error('Kitsu request failed:', rawStatus, detail.slice(0, 300))
    throw new KitsuApiError(
      rawStatus === 404
        ? 'The requested anime was not found.'
        : rawStatus === 429
          ? 'Kitsu request limit reached. Please try again shortly.'
          : rawStatus === 400
            ? 'Kitsu rejected the anime request parameters.'
            : 'Kitsu is temporarily unavailable. Please try again.',
      status,
    )
  }

  return response.json() as Promise<T>
}

function kitsuImage(value: unknown): string | null {
  if (typeof value === 'string' && /^https:\/\//i.test(value)) return value
  if (!value || typeof value !== 'object') return null
  const image = value as Record<string, unknown>
  for (const key of ['large', 'original', 'medium', 'small']) {
    const candidate = image[key]
    if (typeof candidate === 'string' && /^https:\/\//i.test(candidate)) return candidate
  }
  return null
}

function normalizeKitsuAnime(resource: KitsuResource, included: KitsuResource[] = []): KitsuAnime {
  const attributes = resource.attributes ?? {}
  const genreRelationships = resource.relationships?.genres?.data ?? []
  const genreIds = new Set(genreRelationships.map((item) => item.id))
  const includedGenres = included
    .filter((item) => item.type === 'genres' && genreIds.has(item.id))
    .map((item) => {
      const name = item.attributes?.name
      return typeof name === 'string' ? name : ''
    })
    .filter(Boolean)
  const attributeGenres = Array.isArray(attributes.genres)
    ? attributes.genres.filter((item): item is string => typeof item === 'string')
    : []
  const titles = attributes.titles && typeof attributes.titles === 'object'
    ? attributes.titles as Record<string, unknown>
    : {}
  const title = [attributes.canonicalTitle, titles.en, titles.en_jp, titles.ja_jp]
    .find((item): item is string => typeof item === 'string' && item.trim().length > 0) ?? `Anime ${resource.id}`
  const rating = Number(attributes.averageRating ?? 0)
  const count = Number(attributes.userCount ?? 0)
  const episodes = Number(attributes.episodeCount ?? 0)
  const length = Number(attributes.episodeLength ?? 0)

  return {
    id: String(resource.id),
    title,
    synopsis: typeof attributes.synopsis === 'string'
      ? attributes.synopsis
      : typeof attributes.description === 'string' ? attributes.description : '',
    posterUrl: kitsuImage(attributes.posterImage),
    coverUrl: kitsuImage(attributes.coverImage),
    averageRating: Number.isFinite(rating) ? rating : 0,
    startDate: typeof attributes.startDate === 'string' ? attributes.startDate : null,
    episodeCount: Number.isFinite(episodes) && episodes > 0 ? episodes : null,
    episodeLength: Number.isFinite(length) && length > 0 ? length : null,
    subtype: typeof attributes.subtype === 'string' ? attributes.subtype : null,
    status: typeof attributes.status === 'string' ? attributes.status : null,
    ageRating: typeof attributes.ageRating === 'string' ? attributes.ageRating : null,
    genres: [...new Set(includedGenres.length ? includedGenres : attributeGenres)],
    userCount: Number.isFinite(count) ? count : 0,
    youtubeVideoId: typeof attributes.youtubeVideoId === 'string' ? attributes.youtubeVideoId : null,
    slug: typeof attributes.slug === 'string' ? attributes.slug : null,
    nsfw: attributes.nsfw === true,
  }
}

function normalizeKitsuPayload(payload: KitsuPayload): KitsuAnime[] {
  const resources = Array.isArray(payload.data) ? payload.data : [payload.data]
  return resources
    .filter((resource) => resource && resource.type === 'anime')
    .map((resource) => normalizeKitsuAnime(resource, payload.included ?? []))
    // Keep public browsing safe by default; mature material is not part of this MVP.
    .filter((anime) => !anime.nsfw && anime.ageRating !== 'R18' && anime.ageRating !== 'R18+')
}

function kitsuErrorResponse(c: AppContext, error: unknown) {
  if (error instanceof KitsuApiError) {
    return c.json({ error: 'kitsu_request_failed', message: error.message }, error.status)
  }
  console.error('Unexpected Kitsu integration error:', error)
  return c.json({ error: 'kitsu_request_failed', message: 'Could not load anime data from Kitsu.' }, 502)
}

async function cacheKitsuAnime(env: AppBindings, anime: KitsuAnime) {
  const db = getDb(env)
  const now = Math.floor(Date.now() / 1000)
  await db.insert(schema.animeCatalog).values({
    kitsuId: anime.id,
    title: anime.title,
    synopsis: anime.synopsis,
    posterUrl: anime.posterUrl,
    coverUrl: anime.coverUrl,
    averageRating: anime.averageRating,
    startDate: anime.startDate,
    episodeCount: anime.episodeCount,
    episodeLength: anime.episodeLength,
    subtype: anime.subtype,
    status: anime.status,
    ageRating: anime.ageRating,
    genresJson: JSON.stringify(anime.genres),
    userCount: anime.userCount,
    youtubeVideoId: anime.youtubeVideoId,
    slug: anime.slug,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: schema.animeCatalog.kitsuId,
    set: {
      title: anime.title,
      synopsis: anime.synopsis,
      posterUrl: anime.posterUrl,
      coverUrl: anime.coverUrl,
      averageRating: anime.averageRating,
      startDate: anime.startDate,
      episodeCount: anime.episodeCount,
      episodeLength: anime.episodeLength,
      subtype: anime.subtype,
      status: anime.status,
      ageRating: anime.ageRating,
      genresJson: JSON.stringify(anime.genres),
      userCount: anime.userCount,
      youtubeVideoId: anime.youtubeVideoId,
      slug: anime.slug,
      updatedAt: now,
    },
  })
}

async function ensureCachedAnime(env: AppBindings, kitsuId: string): Promise<string> {
  const db = getDb(env)
  const [existing] = await db.select({ kitsuId: schema.animeCatalog.kitsuId })
    .from(schema.animeCatalog)
    .where(eq(schema.animeCatalog.kitsuId, kitsuId))
    .limit(1)
  if (existing) return existing.kitsuId

  const payload = await kitsuRequest<KitsuPayload>(`/anime/${encodeURIComponent(kitsuId)}`, { include: 'genres' })
  const resources = normalizeKitsuPayload(payload)
  const anime = resources[0]
  if (!anime) throw new Error('Anime metadata was unavailable or not eligible for the public catalogue.')
  await cacheKitsuAnime(env, anime)
  return anime.id
}

const ANIME_WATCHLIST_STATUSES = ['want_to_watch', 'watching', 'watched', 'dropped'] as const
type AnimeWatchlistStatus = (typeof ANIME_WATCHLIST_STATUSES)[number]
function isAnimeWatchlistStatus(value: unknown): value is AnimeWatchlistStatus {
  return typeof value === 'string' && ANIME_WATCHLIST_STATUSES.includes(value as AnimeWatchlistStatus)
}

const app = new Hono<{ Bindings: AppBindings }>()

function getDb(env: AppBindings) {
  return drizzle(env.movie_hunt_db, { schema })
}

function authFor(c: AppContext) {
  return createAuth(c.env, new URL(c.req.url).origin)
}

type SessionLookupResult = {
  member: MemberRecord
  expired: boolean
} | null

const sessionLookupCache =
  new WeakMap<AppContext, Promise<SessionLookupResult>>()

async function getSessionMember(
  c: AppContext,
): Promise<SessionLookupResult> {
  const cached = sessionLookupCache.get(c)

  if (cached) return cached

  const lookup = (async (): Promise<SessionLookupResult> => {
    const auth = authFor(c)

    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    })

    if (!session) return null

    const member = session.user as unknown as MemberRecord

    const expiredPending =
      member.approvalStatus === 'pending' &&
      Number(member.approvalExpiresAt ?? 0) <= Date.now()

    const rejected = member.approvalStatus === 'rejected'

    if (expiredPending || rejected) {
      await deleteMember(c.env, member.id)
      return { member, expired: true }
    }

    return { member, expired: false }
  })()

  sessionLookupCache.set(c, lookup)

  return lookup
}

async function deleteMember(env: AppBindings, userId: string) {
  const db = getDb(env)
  await db.delete(schema.watchlistItems).where(eq(schema.watchlistItems.userId, userId))
  await db.delete(schema.userReviews).where(eq(schema.userReviews.userId, userId))
  await db.delete(schema.animeWatchlistItems).where(eq(schema.animeWatchlistItems.userId, userId))
  await db.delete(schema.animeReviews).where(eq(schema.animeReviews.userId, userId))
  await db.delete(schema.sharedRecommendations).where(or(eq(schema.sharedRecommendations.senderId, userId), eq(schema.sharedRecommendations.recipientId, userId)))
  await db.delete(schema.friendships).where(or(eq(schema.friendships.userAId, userId), eq(schema.friendships.userBId, userId)))
  await db.delete(schema.socialPrivacy).where(eq(schema.socialPrivacy.userId, userId))
  await db.delete(schema.authSession).where(eq(schema.authSession.userId, userId))
  await db.delete(schema.authAccount).where(eq(schema.authAccount.userId, userId))
  await db.delete(schema.authUser).where(eq(schema.authUser.id, userId))
}


app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname

  if (path === '/api/health' || path === '/api') {
    return next()
  }

  // Authentication and guest creation: IP-based protection.
  if (path.startsWith('/api/auth/')) {
    const response = await enforceAuthRateLimits(
      c.req.raw,
      c.env,
    )

    if (response) return response

    return next()
  }

  // Identify the current user.
  const result = await getSessionMember(c)

  const member =
    result && !result.expired
      ? result.member
      : null

  // Apply general, category-specific and applicable
  // daily D1 quotas.
  const response = await enforceRequestRateLimits(
    c.req.raw,
    c.env,
    member,
  )

  if (response) return response

  return next()
})


app.get('/api', (c) =>
  c.json({ name: 'Movie Hunt API', version: '0.2.0', status: 'running' }),
)

app.get('/api/health', async (c) => {
  try {
    const db = getDb(c.env)
    await db.select({ id: schema.movies.id }).from(schema.movies).limit(1)
    return c.json({
      status: 'ok',
      service: 'movie-hunt-api',
      database: 'connected',
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Movie Hunt health check failed:', error)
    return c.json(
      { status: 'error', service: 'movie-hunt-api', database: 'unavailable' },
      503,
    )
  }
})

// Better Auth handles Google OAuth and its session endpoints.
app.all('/api/auth/*', async (c) => {
  try {
    const auth = authFor(c)
    return await auth.handler(c.req.raw)
  } catch (error) {
    console.error('Authentication is not configured:', error)
    return c.json(
      {
        error: 'authentication_not_configured',
        message: 'Configure the Better Auth and Google OAuth values in .dev.vars.',
      },
      503,
    )
  }
})

// Return the current user's account and approval state to the frontend.
app.get('/api/me', async (c) => {
  try {
    const result = await getSessionMember(c)
    if (!result) return c.json({ error: 'not_authenticated' }, 401)
    if (result.expired) {
      return c.json(
        { error: 'account_not_approved', message: 'This account is no longer active.' },
        403,
      )
    }

    const { member } = result
    return c.json({
      user: {
        id: member.id,
        name: member.name,
        email: member.email,
        image: member.image ?? null,
        role: member.role ?? 'user',
        approvalStatus: member.approvalStatus ?? 'pending',
        approvalExpiresAt: member.approvalExpiresAt ?? null,
        approvedAt: member.approvedAt ?? null,
        isAnonymous: member.isAnonymous === true,
      },
    })
  } catch (error) {
    console.error('Could not read current member:', error)
    return c.json({ error: 'could_not_read_current_member' }, 500)
  }
})


// ============================================================
// MEMBER PROFILE
// ============================================================

app.get('/api/profile', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member

    const db = c.env.movie_hunt_db
    const userId = member.id

    type Counts = {
      tracked: number
      wantToWatch: number
      watching: number
      watched: number
      dropped: number
    }

    type RatingStats = {
      reviewed: number
      averageRating: number
    }

    type RecentRow = {
      mediaId: string | number
      title: string
      poster: string | null
      status: string
      updatedAt: number
      rating: number | null
    }

    const [
      account,
      movieCounts,
      movieRatings,
      animeCounts,
      animeRatings,
      friendshipCount,
      privacy,
      movieRows,
      animeRows,
      movieGenres,
      animeGenres,
    ] = await Promise.all([
      db.prepare(`
        SELECT
          id, name, email, image, role,
          approval_status AS approvalStatus,
          created_at AS createdAt,
          approved_at AS approvedAt
        FROM user
        WHERE id = ?
      `).bind(userId).first<{
        id: string
        name: string
        email: string
        image: string | null
        role: string
        approvalStatus: string
        createdAt: number
        approvedAt: number | null
      }>(),

      db.prepare(`
        SELECT
          COUNT(*) AS tracked,
          SUM(CASE WHEN status = 'want_to_watch' THEN 1 ELSE 0 END) AS wantToWatch,
          SUM(CASE WHEN status = 'watching' THEN 1 ELSE 0 END) AS watching,
          SUM(CASE WHEN status = 'watched' THEN 1 ELSE 0 END) AS watched,
          SUM(CASE WHEN status = 'dropped' THEN 1 ELSE 0 END) AS dropped
        FROM watchlist_items
        WHERE user_id = ?
      `).bind(userId).first<Counts>(),

      db.prepare(`
        SELECT
          COUNT(*) AS reviewed,
          COALESCE(AVG(rating), 0) AS averageRating
        FROM user_reviews
        WHERE user_id = ?
      `).bind(userId).first<RatingStats>(),

      db.prepare(`
        SELECT
          COUNT(*) AS tracked,
          SUM(CASE WHEN status = 'want_to_watch' THEN 1 ELSE 0 END) AS wantToWatch,
          SUM(CASE WHEN status = 'watching' THEN 1 ELSE 0 END) AS watching,
          SUM(CASE WHEN status = 'watched' THEN 1 ELSE 0 END) AS watched,
          SUM(CASE WHEN status = 'dropped' THEN 1 ELSE 0 END) AS dropped
        FROM anime_watchlist_items
        WHERE user_id = ?
      `).bind(userId).first<Counts>(),

      db.prepare(`
        SELECT
          COUNT(*) AS reviewed,
          COALESCE(AVG(rating), 0) AS averageRating
        FROM anime_reviews
        WHERE user_id = ?
      `).bind(userId).first<RatingStats>(),

      db.prepare(`
        SELECT COUNT(*) AS total
        FROM friendships
        WHERE status = 'accepted'
          AND (user_a_id = ? OR user_b_id = ?)
      `).bind(userId, userId).first<{ total: number }>(),

      db.prepare(`
        SELECT
          share_activity AS shareActivity,
          allow_friend_requests AS allowFriendRequests
        FROM social_privacy
        WHERE user_id = ?
      `).bind(userId).first<{
        shareActivity: number
        allowFriendRequests: number
      }>(),

      db.prepare(`
        SELECT
          m.tmdb_id AS mediaId,
          m.title,
          m.poster_path AS poster,
          w.status,
          w.updated_at AS updatedAt,
          r.rating
        FROM watchlist_items w
        JOIN movies m ON m.id = w.movie_id
        LEFT JOIN user_reviews r
          ON r.user_id = w.user_id
          AND r.movie_id = w.movie_id
        WHERE w.user_id = ?
        ORDER BY w.updated_at DESC
        LIMIT 8
      `).bind(userId).all<RecentRow>(),

      db.prepare(`
        SELECT
          a.kitsu_id AS mediaId,
          a.title,
          a.poster_url AS poster,
          w.status,
          w.updated_at AS updatedAt,
          r.rating
        FROM anime_watchlist_items w
        JOIN anime_catalog a ON a.kitsu_id = w.anime_id
        LEFT JOIN anime_reviews r
          ON r.user_id = w.user_id
          AND r.anime_id = w.anime_id
        WHERE w.user_id = ?
        ORDER BY w.updated_at DESC
        LIMIT 8
      `).bind(userId).all<RecentRow>(),

      db.prepare(`
        SELECT
          g.name,
          ROUND(AVG(r.rating), 1) AS averageRating,
          COUNT(*) AS reviewCount
        FROM user_reviews r
        JOIN movies m ON m.id = r.movie_id
        JOIN movie_genres mg ON mg.movie_id = m.id
        JOIN genres g ON g.tmdb_id = mg.genre_id
        WHERE r.user_id = ?
        GROUP BY g.tmdb_id, g.name
        ORDER BY averageRating DESC
        LIMIT 8
      `).bind(userId).all<{
        name: string
        averageRating: number
        reviewCount: number
      }>(),

      db.prepare(`
        SELECT
          a.genres_json AS genresJson,
          r.rating
        FROM anime_reviews r
        JOIN anime_catalog a ON a.kitsu_id = r.anime_id
        WHERE r.user_id = ?
      `).bind(userId).all<{
        genresJson: string
        rating: number
      }>(),
    ])

    if (!account) {
      return c.json({ error: 'profile_not_found' }, 404)
    }

    // Derive favourite anime genres from the member's own ratings.
    const genreWeights = new Map<
      string,
      { total: number; count: number }
    >()

    for (const row of animeGenres.results ?? []) {
      let genres: unknown

      try {
        genres = JSON.parse(row.genresJson || '[]')
      } catch {
        continue
      }

      if (!Array.isArray(genres)) continue

      for (const genre of genres) {
        if (typeof genre !== 'string' || !genre.trim()) continue

        const current = genreWeights.get(genre) ?? {
          total: 0,
          count: 0,
        }

        current.total += Number(row.rating) || 0
        current.count += 1

        genreWeights.set(genre, current)
      }
    }

    const favoriteAnimeGenres = [...genreWeights.entries()]
      .map(([name, value]) => ({
        name,
        averageRating: Number(
          (value.total / value.count).toFixed(1)
        ),
        reviewCount: value.count,
      }))
      .sort((a, b) => b.averageRating - a.averageRating)
      .slice(0, 8)

    const recentActivity = [
      ...(movieRows.results ?? []).map((row) => ({
        ...row,
        mediaType: 'movie' as const,
      })),
      ...(animeRows.results ?? []).map((row) => ({
        ...row,
        mediaType: 'anime' as const,
      })),
    ]
      .sort(
        (a, b) => Number(b.updatedAt) - Number(a.updatedAt)
      )
      .slice(0, 8)

    return c.json({
      user: account,

      stats: {
        friends: Number(friendshipCount?.total ?? 0),

        movies: {
          tracked: Number(movieCounts?.tracked ?? 0),
          wantToWatch: Number(movieCounts?.wantToWatch ?? 0),
          watching: Number(movieCounts?.watching ?? 0),
          watched: Number(movieCounts?.watched ?? 0),
          dropped: Number(movieCounts?.dropped ?? 0),
          reviewed: Number(movieRatings?.reviewed ?? 0),
          averageRating: Number(
            Number(movieRatings?.averageRating ?? 0).toFixed(1)
          ),
        },

        anime: {
          tracked: Number(animeCounts?.tracked ?? 0),
          wantToWatch: Number(animeCounts?.wantToWatch ?? 0),
          watching: Number(animeCounts?.watching ?? 0),
          watched: Number(animeCounts?.watched ?? 0),
          dropped: Number(animeCounts?.dropped ?? 0),
          reviewed: Number(animeRatings?.reviewed ?? 0),
          averageRating: Number(
            Number(animeRatings?.averageRating ?? 0).toFixed(1)
          ),
        },
      },

      favoriteGenres: {
        movies: movieGenres.results ?? [],
        anime: favoriteAnimeGenres,
      },

      recentActivity,

      privacy: {
        shareActivity: Boolean(privacy?.shareActivity ?? false),
        allowFriendRequests: Boolean(
          privacy?.allowFriendRequests ?? true
        ),
      },
    })
  } catch (error) {
    console.error('Could not load member profile:', error)
    return c.json({ error: 'could_not_load_profile' }, 500)
  }
})


// Update display name. Email and account permissions remain server-managed.
app.patch('/api/profile', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member

    const body = await c.req.json().catch(() => null) as {
      name?: unknown
    } | null

    if (typeof body?.name !== 'string') {
      return c.json({ error: 'invalid_profile_name' }, 400)
    }

    const name = [...body.name]
      .filter((character) => {
        const code = character.codePointAt(0) ?? 0
        return code >= 0x20 && code !== 0x7f
      })
      .join('')
      .trim()
      .replace(/\s+/g, ' ')

    if (name.length < 2 || name.length > 40) {
      return c.json({
        error: 'invalid_profile_name',
        message: 'Name must be between 2 and 40 characters.',
      }, 400)
    }

    await c.env.movie_hunt_db.prepare(`
      UPDATE user SET name = ? WHERE id = ?
    `).bind(name, member.id).run()

    return c.json({ name })
  } catch (error) {
    console.error('Could not update profile:', error)
    return c.json({ error: 'could_not_update_profile' }, 500)
  }
})


app.get('/api/admin/pending-users', async (c) => {
  try {
    const result = await getSessionMember(c)
    if (!result) return c.json({ error: 'not_authenticated' }, 401)
    if (result.expired) return c.json({ error: 'account_not_active' }, 403)
    if (result.member.role !== 'admin') return c.json({ error: 'admin_required' }, 403)

    const db = getDb(c.env)
    const users = await db
      .select({
        id: schema.authUser.id,
        name: schema.authUser.name,
        email: schema.authUser.email,
        image: schema.authUser.image,
        createdAt: schema.authUser.createdAt,
        approvalExpiresAt: schema.authUser.approvalExpiresAt,
      })
      .from(schema.authUser)
      .where(
        and(
          eq(schema.authUser.approvalStatus, 'pending'),
          eq(schema.authUser.isAnonymous, false),
        ),
      )
      .orderBy(desc(schema.authUser.createdAt))
      .limit(100)

    return c.json({ users })
  } catch (error) {
    console.error('Could not load pending users:', error)
    return c.json({ error: 'could_not_load_pending_users' }, 500)
  }
})

app.post('/api/admin/users/:userId/approve', async (c) => {
  try {
    const result = await getSessionMember(c)
    if (!result) return c.json({ error: 'not_authenticated' }, 401)
    if (result.expired) return c.json({ error: 'account_not_active' }, 403)
    if (result.member.role !== 'admin') return c.json({ error: 'admin_required' }, 403)

    const userId = c.req.param('userId')
    const db = getDb(c.env)
    const [target] = await db
      .select({ id: schema.authUser.id })
      .from(schema.authUser)
      .where(eq(schema.authUser.id, userId))
      .limit(1)

    if (!target) return c.json({ error: 'user_not_found' }, 404)

    await db
      .update(schema.authUser)
      .set({ approvalStatus: 'approved', approvedAt: Date.now() })
      .where(eq(schema.authUser.id, userId))

    return c.json({ status: 'approved', userId })
  } catch (error) {
    console.error('Could not approve user:', error)
    return c.json({ error: 'could_not_approve_user' }, 500)
  }
})

app.post('/api/admin/users/:userId/reject', async (c) => {
  try {
    const result = await getSessionMember(c)
    if (!result) return c.json({ error: 'not_authenticated' }, 401)
    if (result.expired) return c.json({ error: 'account_not_active' }, 403)
    if (result.member.role !== 'admin') return c.json({ error: 'admin_required' }, 403)

    const userId = c.req.param('userId')
    const db = getDb(c.env)
    const [target] = await db
      .select({ id: schema.authUser.id })
      .from(schema.authUser)
      .where(eq(schema.authUser.id, userId))
      .limit(1)

    if (!target) return c.json({ error: 'user_not_found' }, 404)

    await db
      .update(schema.authUser)
      .set({ approvalStatus: 'rejected' })
      .where(eq(schema.authUser.id, userId))

    return c.json({ status: 'rejected', userId })
  } catch (error) {
    console.error('Could not reject user:', error)
    return c.json({ error: 'could_not_reject_user' }, 500)
  }
})


// Public movie discovery endpoints. TMDB credentials remain on the Worker.
app.get('/api/tmdb/trending', async (c) => {
  const timeWindow = c.req.query('time_window') ?? 'week'
  if (timeWindow !== 'day' && timeWindow !== 'week') {
    return c.json({ error: 'invalid_time_window', message: 'time_window must be day or week.' }, 400)
  }

  try {
    const data = await tmdbRequest<TmdbList>(c.env, `/trending/movie/${timeWindow}`, {
      page: String(validPage(c.req.query('page'))),
      language: c.req.query('language') ?? 'en-US',
    })
    queueMovieCache(c, data.results ?? [])
    return c.json(data)
  } catch (error) {
    return tmdbErrorResponse(c, error)
  }
})

app.get('/api/tmdb/popular', async (c) => {
  try {
    const data = await tmdbRequest<TmdbList>(c.env, '/movie/popular', {
      page: String(validPage(c.req.query('page'))),
      language: c.req.query('language') ?? 'en-US',
      region: c.req.query('region') ?? 'IN',
    })
    queueMovieCache(c, data.results ?? [])
    return c.json(data)
  } catch (error) {
    return tmdbErrorResponse(c, error)
  }
})

app.get('/api/tmdb/search', async (c) => {
  const query = (c.req.query('query') ?? '').trim()
  if (!query || query.length > 100) {
    return c.json(
      { error: 'invalid_query', message: 'Provide a search query between 1 and 100 characters.' },
      400,
    )
  }

  try {
    const data = await tmdbRequest<TmdbList>(c.env, '/search/movie', {
      query,
      page: String(validPage(c.req.query('page'))),
      language: c.req.query('language') ?? 'en-US',
      include_adult: 'false',
      region: c.req.query('region') ?? 'IN',
    })
    queueMovieCache(c, data.results ?? [])
    return c.json(data)
  } catch (error) {
    return tmdbErrorResponse(c, error)
  }
})

app.get('/api/tmdb/discover', async (c) => {
  const genre = c.req.query('with_genres') ?? ''
  if (genre && !/^\d+(?:[,|]\d+)*$/.test(genre)) {
    return c.json({ error: 'invalid_genre', message: 'with_genres must contain TMDB genre IDs.' }, 400)
  }

  try {
    const data = await tmdbRequest<TmdbList>(c.env, '/discover/movie', {
      page: String(validPage(c.req.query('page'))),
      language: c.req.query('language') ?? 'en-US',
      region: c.req.query('region') ?? 'IN',
      include_adult: 'false',
      sort_by: 'popularity.desc',
      ...(genre ? { with_genres: genre } : {}),
    })
    queueMovieCache(c, data.results ?? [])
    return c.json(data)
  } catch (error) {
    return tmdbErrorResponse(c, error)
  }
})

app.get('/api/tmdb/genres', async (c) => {
  try {
    const data = await tmdbRequest<{ genres: TmdbGenre[] }>(c.env, '/genre/movie/list', {
      language: c.req.query('language') ?? 'en-US',
    })
    c.executionCtx.waitUntil(
      getDb(c.env)
        .insert(schema.genres)
        .values(data.genres.map((genre) => ({ tmdbId: genre.id, name: genre.name })))
        .onConflictDoUpdate({
          target: schema.genres.tmdbId,
          set: { name: sql`excluded.name` },
        })
        .catch((error) => console.error('Could not cache TMDB genres:', error)),
    )
    return c.json(data)
  } catch (error) {
    return tmdbErrorResponse(c, error)
  }
})

app.get('/api/tmdb/movie/:id', async (c) => {
  const movieId = Number(c.req.param('id'))
  if (!Number.isInteger(movieId) || movieId <= 0) {
    return c.json({ error: 'invalid_movie_id', message: 'Movie ID must be a positive integer.' }, 400)
  }

  try {
    const data = await tmdbRequest<TmdbMovie & {
      genres?: TmdbGenre[]
      runtime?: number | null
      tagline?: string | null
      credits?: unknown
      videos?: unknown
      recommendations?: TmdbList
      similar?: TmdbList
    }>(c.env, `/movie/${movieId}`, {
      language: c.req.query('language') ?? 'en-US',
      append_to_response: 'credits,videos,recommendations,similar',
    })
    queueMovieCache(c, [data], data.genres ?? [])
    return c.json(data)
  } catch (error) {
    return tmdbErrorResponse(c, error)
  }
})

app.get('/api/movies', async (c) => {
  try {
    const requestedLimit = Number(c.req.query('limit') ?? 20)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 50)
      : 20

    const db = getDb(c.env)
    const results = await db
      .select()
      .from(schema.movies)
      .orderBy(desc(schema.movies.popularity))
      .limit(limit)

    return c.json({ results, count: results.length })
  } catch (error) {
    console.error('Could not retrieve cached movies:', error)
    return c.json({ error: 'Could not retrieve movies' }, 500)
  }
})


// Hybrid recommendations: explicit request intent first, personal taste second, Gemini explanations/reranking third.
type RecommendationProfile = {
  ratedMovies: Array<{ title: string; rating: number }>
  preferredGenres: Array<{ id: number; name: string; weight: number }>
  trackedMovies: number
}

type RankedCandidate = {
  movie: TmdbMovie
  score: number
  algorithmReason: string
}

type GeminiResult = {
  recommendations: Map<number, string> | null
  status: 'used' | 'missing_key' | 'http_error' | 'invalid_response' | 'network_error' | 'blocked_response' | 'truncated_response' | 'quota_exceeded'
  httpStatus?: number
  attempts?: number
  diagnostic?: string
}

const TMDB_GENRE_NAMES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
}

const PROMPT_GENRE_RULES: Array<{ pattern: RegExp; ids: number[] }> = [
  { pattern: /\bpsychological\b|\bpsychological thriller\b|\bmind[- ]game thriller\b/i, ids: [53, 9648] },
  { pattern: /\bthriller\b|\bsuspense\b|\btense\b|\bedge of your seat\b/i, ids: [53] },
  { pattern: /\bmystery\b|\bwhodunit\b|\bdetective\b|\bwhodunnit\b/i, ids: [9648] },
  { pattern: /\bcrime\b|\bheist\b|\bgangster\b/i, ids: [80] },
  { pattern: /\bhorror\b|\bscary\b|\bterrifying\b|\bsupernatural horror\b/i, ids: [27] },
  { pattern: /\bscience[- ]fiction\b|\bsci[- ]?fi\b|\bspace opera\b|\btime travel\b|\balien\b/i, ids: [878] },
  { pattern: /\baction\b|\bsuperhero\b|\bmartial arts\b/i, ids: [28] },
  { pattern: /\badventure\b|\bquest\b/i, ids: [12] },
  { pattern: /\bcomedy\b|\bfunny\b|\bhumorous\b/i, ids: [35] },
  { pattern: /\bdrama\b|\bemotional\b|\bcharacter[- ]driven\b/i, ids: [18] },
  { pattern: /\bfamily\b|\bkid[- ]friendly\b/i, ids: [10751] },
  { pattern: /\bfantasy\b|\bmagical\b|\bmythical\b/i, ids: [14] },
  { pattern: /\bromance\b|\blove story\b|\bromantic\b/i, ids: [10749] },
  { pattern: /\banimation\b|\banimated\b|\banime\b/i, ids: [16] },
  { pattern: /\bdocumentary\b|\breal[- ]life story\b/i, ids: [99] },
  { pattern: /\bwar film\b|\bwar movie\b|\bmilitary drama\b/i, ids: [10752] },
  { pattern: /\bwestern\b|\bcowboy\b/i, ids: [37] },
  { pattern: /\bhistorical\b|\bhistory\b|\bperiod piece\b/i, ids: [36] },
]

const PROMPT_NON_CONTENT_WORDS = new Set([
  'psychological', 'thriller', 'suspense', 'tense', 'mystery', 'crime', 'horror',
  'science', 'fiction', 'sci', 'action', 'adventure', 'comedy', 'drama', 'family',
  'fantasy', 'romance', 'animation', 'animated', 'anime', 'documentary', 'western',
  'historical', 'history', 'strong', 'great', 'good', 'story', 'storytelling',
  'well', 'written', 'film', 'films', 'movie', 'movies', 'recommend', 'recommendation',
  'something', 'watch', 'want', 'please', 'preferably', 'under', 'over', 'hours',
])

function tokenizeRecommendationText(value: string): string[] {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'about', 'movie',
    'film', 'films', 'movies', 'something', 'like', 'want', 'watch', 'recommend',
    'recommendation', 'please', 'good', 'great', 'best', 'some', 'any', 'very',
    'have', 'has', 'had', 'are', 'was', 'were', 'but', 'not', 'too', 'its',
    'their', 'they', 'them', 'who', 'what', 'when', 'where', 'which', 'while',
    'under', 'over', 'less', 'more', 'than', 'just', 'based', 'after', 'before',
  ])
  return [...new Set(
    value.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((word) => !stopWords.has(word)) ?? [],
  )]
}

function inferPromptGenreIds(prompt: string): number[] {
  const ids = new Set<number>()
  for (const rule of PROMPT_GENRE_RULES) {
    if (rule.pattern.test(prompt)) {
      for (const id of rule.ids) ids.add(id)
    }
  }
  return [...ids]
}

function extractPromptContentTerms(prompt: string): string[] {
  return tokenizeRecommendationText(prompt).filter((term) => !PROMPT_NON_CONTENT_WORDS.has(term))
}

function scoreRecommendationCandidate(
  movie: TmdbMovie,
  promptTerms: string[],
  promptGenreIds: number[],
  genreWeights: Map<number, number>,
  maxGenreWeight: number,
  qualityFocused: boolean,
): number {
  const movieGenres = movie.genre_ids ?? []
  const genreAffinity = maxGenreWeight > 0 && movieGenres.length > 0
    ? Math.min(
      1,
      movieGenres.reduce((sum, id) => sum + (genreWeights.get(id) ?? 0), 0)
      / (maxGenreWeight * Math.min(movieGenres.length, 2)),
    )
    : 0

  const requestedGenreMatches = promptGenreIds.filter((id) => movieGenres.includes(id)).length
  const requestGenreAffinity = promptGenreIds.length > 0 && requestedGenreMatches > 0
    ? 0.65 + 0.35 * (requestedGenreMatches / promptGenreIds.length)
    : 0

  const movieGenreText = movieGenres.map((id) => TMDB_GENRE_NAMES[id] ?? '').join(' ')
  const candidateTerms = new Set(tokenizeRecommendationText(
    `${movie.title} ${movie.original_title ?? ''} ${movie.overview ?? ''} ${movieGenreText}`,
  ))
  const promptTextMatch = promptTerms.length > 0
    ? promptTerms.filter((term) => candidateTerms.has(term)).length / promptTerms.length
    : 0

  const voteAverage = Math.max(0, Math.min(10, movie.vote_average ?? 0)) / 10
  const voteConfidence = Math.min(1, Math.log1p(movie.vote_count ?? 0) / Math.log1p(500))
  const quality = voteAverage * (0.75 + 0.25 * voteConfidence)
  const popularity = Math.max(0, Math.min(1, Math.log1p(movie.popularity ?? 0) / Math.log1p(500)))

  let score: number
  if (promptGenreIds.length > 0) {
    // An explicit genre/mood request is the strongest signal; taste is secondary.
    score = requestGenreAffinity * 0.58
      + promptTextMatch * 0.10
      + genreAffinity * 0.12
      + quality * (qualityFocused ? 0.16 : 0.15)
      + popularity * (qualityFocused ? 0.04 : 0.05)
  } else if (promptTerms.length > 0) {
    score = promptTextMatch * 0.43
      + genreAffinity * 0.17
      + quality * (qualityFocused ? 0.28 : 0.25)
      + popularity * (qualityFocused ? 0.12 : 0.15)
  } else if (maxGenreWeight > 0) {
    score = genreAffinity * 0.60 + quality * 0.25 + popularity * 0.15
  } else {
    score = quality * 0.65 + popularity * 0.35
  }

  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}

function fallbackRecommendationReason(
  movie: TmdbMovie,
  promptTerms: string[],
  promptGenreIds: number[],
  preferredGenres: Array<{ id: number; name: string; weight: number }>,
): string {
  const movieGenres = movie.genre_ids ?? []
  const matchingRequestedGenres = promptGenreIds
    .filter((id) => movieGenres.includes(id))
    .map((id) => TMDB_GENRE_NAMES[id])
    .filter(Boolean)

  if (matchingRequestedGenres.length > 0) {
    return `Matches your request for ${matchingRequestedGenres.join(' and ')}. Its plot and audience response make it a relevant candidate.`
  }

  const candidateTerms = new Set(tokenizeRecommendationText(`${movie.title} ${movie.overview ?? ''}`))
  const matchingTerms = promptTerms.filter((term) => candidateTerms.has(term)).slice(0, 3)
  if (matchingTerms.length > 0) {
    return `Its title or synopsis overlaps with themes in your request: ${matchingTerms.join(', ')}.`
  }
  if (promptGenreIds.length > 0) {
    return 'A secondary discovery pick. It does not directly match every requested genre, so check its details before choosing.'
  }
  if (preferredGenres.length > 0) {
    return `A taste-based pick matching genres you've enjoyed: ${preferredGenres.slice(0, 2).map((genre) => genre.name).join(' and ')}.`
  }
  return 'A catalogue pick based on its audience rating and popularity.'
}

const GEMINI_MAX_ATTEMPTS = 3
const GEMINI_RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const GEMINI_BACKOFF_DELAYS_MS = [1_000, 2_000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Return a bounded retry delay. If Google asks us to wait more than five
 * seconds, skip the retry and use the local recommendation fallback instead.
 */
function getGeminiRetryDelayMs(response: Response, failedAttempt: number): number | null {
  const retryAfter = response.headers.get('retry-after')?.trim()

  if (retryAfter) {
    let retryAfterMs: number | null = null
    const seconds = Number(retryAfter)

    if (Number.isFinite(seconds) && seconds >= 0) {
      retryAfterMs = seconds * 1_000
    } else {
      const retryAt = Date.parse(retryAfter)
      if (Number.isFinite(retryAt)) {
        retryAfterMs = Math.max(0, retryAt - Date.now())
      }
    }

    if (retryAfterMs !== null) {
      if (retryAfterMs > 5_000) return null
      return retryAfterMs + Math.floor(Math.random() * 250)
    }
  }

  const backoff = GEMINI_BACKOFF_DELAYS_MS[failedAttempt - 1] ?? 2_000
  return backoff + Math.floor(Math.random() * 250)
}

function parseGeminiJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned) as unknown
  } catch {
    // Some model responses may include a short preamble despite JSON mode.
    // Extract the first balanced JSON object/array without trusting its content.
    const startCandidates = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter((value) => value >= 0)
    if (startCandidates.length === 0) throw new Error('No JSON object or array found')
    const startAt = Math.min(...startCandidates)
    const opening = cleaned[startAt]
    const closing = opening === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false

    for (let index = startAt; index < cleaned.length; index += 1) {
      const character = cleaned[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') inString = true
      else if (character === opening) depth += 1
      else if (character === closing) {
        depth -= 1
        if (depth === 0) {
          return JSON.parse(cleaned.slice(startAt, index + 1)) as unknown
        }
      }
    }
    throw new Error('JSON response was incomplete')
  }
}

function getGeminiRecommendationItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []

  const object = value as Record<string, unknown>
  for (const key of ['recommendations', 'movies', 'picks', 'results', 'items']) {
    if (Array.isArray(object[key])) return object[key] as unknown[]
  }
  return []
}

function normalizeMovieTitle(value: unknown): string {
  return typeof value === 'string'
    ? value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
    : ''
}

async function getGeminiRecommendationReasons(
  env: AppBindings,
  prompt: string,
  profile: RecommendationProfile,
  requestedGenres: string[],
  candidates: RankedCandidate[],
): Promise<GeminiResult> {
  const apiKey = env.GEMINI_API_KEY?.trim()
  if (!apiKey) return { recommendations: null, status: 'missing_key', attempts: 0 }

  const model = (env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash').replace(/[^a-zA-Z0-9._-]/g, '')
  const candidatePayload = candidates.slice(0, 24).map(({ movie }) => ({
    tmdb_id: movie.id,
    title: movie.title,
    release_year: movie.release_date?.slice(0, 4) ?? null,
    overview: (movie.overview ?? '').slice(0, 350),
    genres: (movie.genre_ids ?? []).map((id) => TMDB_GENRE_NAMES[id] ?? String(id)),
    tmdb_rating: movie.vote_average ?? null,
    vote_count: movie.vote_count ?? 0,
  }))

  const userPrompt = [
    'You are the recommendation and explanation layer for Movie Hunt.',
    'The user request is the primary objective. Select movies that match its explicit genre, mood, themes, and constraints.',
    'Use the personal taste profile only as a secondary tie-breaker. Never select an unrelated movie just because it matches the user\'s historical genres.',
    'Return at most 8 recommendations and only use tmdb_id values from the candidate list below.',
    'When fewer than 3 candidates genuinely match, return fewer. Do not pad the list with unrelated movies.',
    'Each reason must explain the match using only the candidate title, listed genres, and synopsis.',
    'Return one JSON object with a recommendations array. Each item must contain numeric tmdb_id and a short reason.',
    JSON.stringify({
      request: prompt || 'Recommend films that fit my established movie taste.',
      requested_genres: requestedGenres,
      rated_movies: profile.ratedMovies.slice(0, 12),
      preferred_genres: profile.preferredGenres.slice(0, 6).map(({ name, weight }) => ({ name, weight: Number(weight.toFixed(2)) })),
      candidates: candidatePayload,
    }),
  ].join('\n\n')

  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      // Gemini 3.x ignores custom temperature values. Use minimal thinking for
      // this constrained ranking/explanation task so the output budget is used
      // for the structured response rather than extended reasoning.
      thinkingConfig: { thinkingLevel: 'MINIMAL' },
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          recommendations: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                tmdb_id: { type: 'INTEGER', description: 'A TMDB ID copied exactly from the supplied candidates.' },
                reason: { type: 'STRING', description: 'A concise explanation of why this candidate matches the user request.' },
              },
              required: ['tmdb_id', 'reason'],
            },
          },
        },
        required: ['recommendations'],
      },
    },
  })

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    const quota = await consumeGeminiAttemptQuota(env)

    if (!quota.allowed) {
      return {
        recommendations: null,
        status: 'quota_exceeded',
        attempts: attempt - 1,
        diagnostic: quota.reason ?? 'gemini_quota_exceeded',
      }
    }

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: requestBody,
      })
    } catch (error) {
      if (attempt < GEMINI_MAX_ATTEMPTS) {
        const delay = (GEMINI_BACKOFF_DELAYS_MS[attempt - 1] ?? 2_000)
          + Math.floor(Math.random() * 250)
        console.warn(`Gemini network failure on attempt ${attempt}/${GEMINI_MAX_ATTEMPTS}; retrying in ${delay}ms.`)
        await sleep(delay)
        continue
      }

      console.warn('Gemini request failed after retries due to a network error:', error)
      return { recommendations: null, status: 'network_error', attempts: attempt, diagnostic: 'network_error' }
    }

    if (!response.ok) {
      const retryable = GEMINI_RETRYABLE_HTTP_STATUSES.has(response.status)
      const delay = retryable && attempt < GEMINI_MAX_ATTEMPTS
        ? getGeminiRetryDelayMs(response, attempt)
        : null

      if (delay !== null) {
        console.warn(
          `Gemini returned HTTP ${response.status} on attempt ${attempt}/${GEMINI_MAX_ATTEMPTS}; retrying in ${delay}ms.`,
        )
        await sleep(delay)
        continue
      }

      const errorBody = await response.text().catch(() => '')
      console.warn(
        `Gemini recommendation request ended with HTTP ${response.status} after ${attempt} attempt(s):`,
        errorBody.slice(0, 500),
      )
      return {
        recommendations: null,
        status: 'http_error',
        httpStatus: response.status,
        attempts: attempt,
        diagnostic: `http_${response.status}`,
      }
    }

    let payload: {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> }
        finishReason?: string
        finishMessage?: string
      }>
      promptFeedback?: { blockReason?: string; blockReasonMessage?: string }
      modelVersion?: string
    }
    try {
      payload = await response.json() as typeof payload
    } catch (error) {
      console.warn('Gemini returned a successful HTTP response with invalid JSON:', error)
      return { recommendations: null, status: 'invalid_response', attempts: attempt, diagnostic: 'invalid_api_json' }
    }

    const candidate = payload.candidates?.[0]
    const finishReason = candidate?.finishReason ?? 'UNSPECIFIED'
    const blockReason = payload.promptFeedback?.blockReason
    const responseText = candidate?.content?.parts
      ?.filter((part) => part.thought !== true && typeof part.text === 'string')
      .map((part) => part.text ?? '')
      .join('\n')
      .trim() ?? ''

    if (!candidate && blockReason) {
      console.warn(`Gemini blocked the recommendation prompt: ${blockReason}.`)
      return {
        recommendations: null,
        status: 'blocked_response',
        attempts: attempt,
        diagnostic: `prompt_blocked_${blockReason.toLowerCase()}`,
      }
    }

    if (finishReason === 'MAX_TOKENS') {
      console.warn(`Gemini recommendation output was truncated at maxOutputTokens; textLength=${responseText.length}.`)
      return {
        recommendations: null,
        status: 'truncated_response',
        attempts: attempt,
        diagnostic: 'finish_reason_max_tokens',
      }
    }

    if (!responseText) {
      console.warn(
        `Gemini returned no usable text candidate; finishReason=${finishReason}; blockReason=${blockReason ?? 'none'}; candidateCount=${payload.candidates?.length ?? 0}.`,
      )
      return {
        recommendations: null,
        status: blockReason ? 'blocked_response' : 'invalid_response',
        attempts: attempt,
        diagnostic: blockReason ? `prompt_blocked_${blockReason.toLowerCase()}` : `empty_text_finish_${finishReason.toLowerCase()}`,
      }
    }

    let parsed: unknown
    try {
      parsed = parseGeminiJson(responseText)
    } catch (error) {
      console.warn(
        `Gemini output was not parseable JSON; finishReason=${finishReason}; textLength=${responseText.length}; modelVersion=${payload.modelVersion ?? 'unknown'}.`,
        error,
      )
      return { recommendations: null, status: 'invalid_response', attempts: attempt, diagnostic: 'json_parse_failed' }
    }

    const rawItems = getGeminiRecommendationItems(parsed)
    const allowedById = new Map(candidates.map(({ movie }) => [movie.id, movie]))
    const allowedByTitle = new Map(candidates.map(({ movie }) => [normalizeMovieTitle(movie.title), movie.id]))
    const reasons = new Map<number, string>()
    let idsSeen = 0

    for (const rawItem of rawItems) {
      if (!rawItem || typeof rawItem !== 'object') continue
      const item = rawItem as Record<string, unknown>
      const nestedMovie = item.movie && typeof item.movie === 'object'
        ? item.movie as Record<string, unknown>
        : undefined
      const rawId = item.tmdb_id ?? item.tmdbId ?? item.movie_id ?? item.movieId ?? item.id ?? nestedMovie?.id
      const numericId = Number(rawId)
      const rawTitle = item.title ?? item.movie_title ?? item.movieTitle ?? nestedMovie?.title
      let allowedId = Number.isSafeInteger(numericId) ? numericId : undefined
      if (allowedId === undefined || !allowedById.has(allowedId)) {
        const matchedByTitle = allowedByTitle.get(normalizeMovieTitle(rawTitle))
        if (matchedByTitle !== undefined) allowedId = matchedByTitle
      }
      if (rawId !== undefined || rawTitle !== undefined) idsSeen += 1

      const rawReason = item.reason ?? item.explanation ?? item.why ?? item.match_reason
      const reason = typeof rawReason === 'string' && rawReason.trim()
        ? rawReason.trim().slice(0, 360)
        : 'This movie matches the themes and constraints in your request.'

      if (allowedId !== undefined && allowedById.has(allowedId) && !reasons.has(allowedId)) {
        reasons.set(allowedId, reason)
      }
      if (reasons.size >= 8) break
    }

    if (reasons.size > 0) {
      return { recommendations: reasons, status: 'used', attempts: attempt }
    }

    const diagnostic = rawItems.length === 0
      ? 'json_missing_recommendations_array'
      : `no_candidate_ids_matched_items_${rawItems.length}_ids_${idsSeen}`
    console.warn(
      `Gemini JSON contained no allowed TMDB candidate IDs; finishReason=${finishReason}; itemCount=${rawItems.length}; idsSeen=${idsSeen}; allowedCandidateCount=${allowedById.size}; modelVersion=${payload.modelVersion ?? 'unknown'}.`,
    )
    return { recommendations: null, status: 'invalid_response', attempts: attempt, diagnostic }
  }

  return { recommendations: null, status: 'network_error', attempts: GEMINI_MAX_ATTEMPTS, diagnostic: 'retry_limit_reached' }
}

app.post('/api/recommendations', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member

    const body = await c.req.json().catch(() => null) as { prompt?: unknown } | null
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    if (prompt.length > 240) {
      return c.json({ error: 'prompt_too_long', message: 'Keep your request under 240 characters.' }, 400)
    }
    const submissionQuota = await consumeAiSubmissionQuota(
      c.env,
      member,
    )

    if (!submissionQuota.allowed) {
      const unavailable =
        submissionQuota.reason === 'quota_store_unavailable'

      return c.json({
        error: unavailable
          ? 'quota_store_unavailable'
          : 'daily_ai_limit_exceeded',

        message: unavailable
          ? 'AI usage limits could not be checked. Please try again shortly.'
          : 'You have reached your daily AI recommendation limit.',
      }, unavailable ? 503 : 429, {
        'Retry-After': unavailable
          ? '60'
          : String(getDailyQuotaRetryAfterSeconds()),
        'Cache-Control': 'no-store',
      })
    }

    const promptGenreIds = inferPromptGenreIds(prompt)
    const promptTerms = extractPromptContentTerms(prompt)
    const requestedGenres = promptGenreIds.map((id) => TMDB_GENRE_NAMES[id]).filter(Boolean)
    const qualityFocused = /\b(strong story|great story|well[- ]written|good storytelling|excellent screenplay|critically acclaimed|highly rated)\b/i.test(prompt)

    const db = getDb(c.env)
    const [watchlistRows, reviewRows] = await Promise.all([
      db.select({
        movieId: schema.watchlistItems.movieId,
        tmdbId: schema.movies.tmdbId,
        title: schema.movies.title,
        status: schema.watchlistItems.status,
      })
        .from(schema.watchlistItems)
        .innerJoin(schema.movies, eq(schema.watchlistItems.movieId, schema.movies.id))
        .where(eq(schema.watchlistItems.userId, member.id))
        .limit(200),
      db.select({
        movieId: schema.userReviews.movieId,
        tmdbId: schema.movies.tmdbId,
        title: schema.movies.title,
        rating: schema.userReviews.rating,
      })
        .from(schema.userReviews)
        .innerJoin(schema.movies, eq(schema.userReviews.movieId, schema.movies.id))
        .where(eq(schema.userReviews.userId, member.id))
        .orderBy(desc(schema.userReviews.rating), desc(schema.userReviews.updatedAt))
        .limit(30),
    ])

    const excludedIds = new Set<number>([
      ...watchlistRows.map((row) => row.tmdbId),
      ...reviewRows.map((row) => row.tmdbId),
    ])

    // Watched movies are stronger signals; want-to-watch entries are weak interest signals.
    const movieSignals = new Map<number, number>()
    for (const row of watchlistRows) {
      if (row.status === 'watched') movieSignals.set(row.movieId, 0.75)
      else if (row.status === 'watching') movieSignals.set(row.movieId, 0.50)
      else if (row.status === 'want_to_watch') movieSignals.set(row.movieId, 0.20)
      else if (row.status === 'dropped') movieSignals.set(row.movieId, -0.45)
    }
    for (const row of reviewRows) {
      movieSignals.set(row.movieId, Math.max(-1, Math.min(1, (row.rating - 5) / 5)))
    }

    const signalMovieIds = [...movieSignals.entries()]
      .filter(([, weight]) => weight > 0)
      .map(([movieId]) => movieId)

    const genreWeights = new Map<number, number>()
    const genreNames = new Map<number, string>()
    if (signalMovieIds.length > 0) {
      const tasteGenres = await db.select({
        movieId: schema.movieGenres.movieId,
        genreId: schema.genres.tmdbId,
        genreName: schema.genres.name,
      })
        .from(schema.movieGenres)
        .innerJoin(schema.genres, eq(schema.movieGenres.genreId, schema.genres.tmdbId))
        .where(inArray(schema.movieGenres.movieId, signalMovieIds))

      for (const row of tasteGenres) {
        const weight = movieSignals.get(row.movieId) ?? 0
        genreWeights.set(row.genreId, (genreWeights.get(row.genreId) ?? 0) + weight)
        genreNames.set(row.genreId, row.genreName)
      }
    }

    const preferredGenres = [...genreWeights.entries()]
      .filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, weight]) => ({ id, name: genreNames.get(id) ?? TMDB_GENRE_NAMES[id] ?? `Genre ${id}`, weight }))
    const maxGenreWeight = preferredGenres[0]?.weight ?? 0
    const profile: RecommendationProfile = {
      ratedMovies: reviewRows.slice(0, 12).map((row) => ({ title: row.title, rating: row.rating })),
      preferredGenres,
      trackedMovies: watchlistRows.length,
    }

    const commonParams = {
      page: '1',
      language: 'en-US',
      region: 'IN',
      include_adult: 'false',
    }
    const requests: Promise<TmdbList>[] = [
      tmdbRequest<TmdbList>(c.env, '/trending/movie/week', commonParams),
    ]
    if (preferredGenres.length > 0) {
      requests.push(tmdbRequest<TmdbList>(c.env, '/discover/movie', {
        ...commonParams,
        with_genres: preferredGenres.slice(0, 4).map((genre) => genre.id).join('|'),
        sort_by: 'popularity.desc',
      }))
    } else {
      requests.push(tmdbRequest<TmdbList>(c.env, '/movie/popular', commonParams))
    }

    // Retrieve a separate pool for the user's explicit request so their current prompt
    // cannot be crowded out by genres from older watchlist activity.
    if (promptGenreIds.length > 0) {
      requests.push(tmdbRequest<TmdbList>(c.env, '/discover/movie', {
        ...commonParams,
        with_genres: promptGenreIds.join('|'),
        sort_by: qualityFocused ? 'vote_average.desc' : 'popularity.desc',
        'vote_count.gte': qualityFocused ? '100' : '30',
      }))
    }

    const settled = await Promise.allSettled(requests)
    const candidateMap = new Map<number, TmdbMovie>()
    let tmdbSuccesses = 0
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue
      tmdbSuccesses += 1
      for (const movie of result.value.results ?? []) {
        if (!movie.adult && !excludedIds.has(movie.id)) candidateMap.set(movie.id, movie)
      }
    }
    if (tmdbSuccesses === 0 || candidateMap.size === 0) {
      const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (firstFailure?.reason instanceof TmdbApiError) return tmdbErrorResponse(c, firstFailure.reason)
      return c.json({ error: 'no_recommendation_candidates', message: 'Could not find movie candidates. Try again shortly.' }, 502)
    }

    const rankedCandidates: RankedCandidate[] = [...candidateMap.values()]
      .map((movie) => ({
        movie,
        score: scoreRecommendationCandidate(
          movie,
          promptTerms,
          promptGenreIds,
          genreWeights,
          maxGenreWeight,
          qualityFocused,
        ),
        algorithmReason: fallbackRecommendationReason(movie, promptTerms, promptGenreIds, preferredGenres),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 24)

    queueMovieCache(c, rankedCandidates.map((candidate) => candidate.movie))

    const geminiResult = await getGeminiRecommendationReasons(
      c.env,
      prompt,
      profile,
      requestedGenres,
      rankedCandidates,
    )

    let orderedCandidates = rankedCandidates.slice(0, 8)
    if (geminiResult.recommendations) {
      const candidateById = new Map(rankedCandidates.map((candidate) => [candidate.movie.id, candidate]))
      const aiOrdered = [...geminiResult.recommendations.entries()]
        .map(([id, reason]) => ({ candidate: candidateById.get(id), reason }))
        .filter((item): item is { candidate: RankedCandidate; reason: string } => Boolean(item.candidate))
      orderedCandidates = aiOrdered.map(({ candidate, reason }) => ({
        ...candidate,
        algorithmReason: reason,
      }))
    }

    return c.json({
      source: geminiResult.recommendations ? 'gemini' : 'algorithm',
      model: geminiResult.recommendations ? (c.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash') : null,
      aiStatus: geminiResult.status,
      aiHttpStatus: geminiResult.httpStatus ?? null,
      aiAttempts: geminiResult.attempts ?? 0,
      aiDiagnostic: geminiResult.diagnostic ?? null,
      profile: {
        ratedMovies: reviewRows.length,
        trackedMovies: watchlistRows.length,
        favoriteGenres: preferredGenres.slice(0, 5).map((genre) => genre.name),
        requestedGenres,
        personalized: preferredGenres.length > 0 || reviewRows.length > 0,
      },
      recommendations: orderedCandidates.map(({ movie, score, algorithmReason }) => ({
        movie,
        score,
        reason: algorithmReason,
      })),
    })
  } catch (error) {
    if (error instanceof TmdbApiError) return tmdbErrorResponse(c, error)
    console.error('Could not generate movie recommendations:', error)
    return c.json({ error: 'could_not_generate_recommendations', message: 'Could not generate recommendations right now.' }, 500)
  }
})

// Personal watchlist and review endpoints. Every query is scoped to the current member.
app.get('/api/watchlist', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member

    const requestedStatus = c.req.query('status')
    if (requestedStatus && !isWatchlistStatus(requestedStatus)) {
      return c.json({ error: 'invalid_status', message: 'Unsupported watchlist status.' }, 400)
    }

    const db = getDb(c.env)
    const whereClause = requestedStatus
      ? and(
        eq(schema.watchlistItems.userId, member.id),
        eq(schema.watchlistItems.status, requestedStatus),
      )
      : eq(schema.watchlistItems.userId, member.id)

    const items = await db
      .select({
        id: schema.watchlistItems.id,
        tmdbId: schema.movies.tmdbId,
        title: schema.movies.title,
        overview: schema.movies.overview,
        posterPath: schema.movies.posterPath,
        backdropPath: schema.movies.backdropPath,
        releaseDate: schema.movies.releaseDate,
        voteAverage: schema.movies.voteAverage,
        status: schema.watchlistItems.status,
        addedAt: schema.watchlistItems.addedAt,
        updatedAt: schema.watchlistItems.updatedAt,
        watchedAt: schema.watchlistItems.watchedAt,
        rating: schema.userReviews.rating,
        review: schema.userReviews.review,
      })
      .from(schema.watchlistItems)
      .innerJoin(schema.movies, eq(schema.watchlistItems.movieId, schema.movies.id))
      .leftJoin(
        schema.userReviews,
        and(
          eq(schema.userReviews.movieId, schema.watchlistItems.movieId),
          eq(schema.userReviews.userId, member.id),
        ),
      )
      .where(whereClause)
      .orderBy(desc(schema.watchlistItems.updatedAt))
      .limit(200)

    return c.json({ items })
  } catch (error) {
    console.error('Could not load member watchlist:', error)
    return c.json({ error: 'could_not_load_watchlist' }, 500)
  }
})

app.get('/api/watchlist/:tmdbId', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member

    const tmdbId = Number(c.req.param('tmdbId'))
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      return c.json({ error: 'invalid_movie_id' }, 400)
    }

    const movieId = await ensureCachedMovie(c.env, tmdbId)
    const db = getDb(c.env)
    const [item] = await db
      .select({
        tmdbId: schema.movies.tmdbId,
        title: schema.movies.title,
        status: schema.watchlistItems.status,
        watchedAt: schema.watchlistItems.watchedAt,
      })
      .from(schema.watchlistItems)
      .innerJoin(schema.movies, eq(schema.watchlistItems.movieId, schema.movies.id))
      .where(and(
        eq(schema.watchlistItems.userId, member.id),
        eq(schema.watchlistItems.movieId, movieId),
      ))
      .limit(1)
    const [review] = await db
      .select({ rating: schema.userReviews.rating, review: schema.userReviews.review })
      .from(schema.userReviews)
      .where(and(
        eq(schema.userReviews.userId, member.id),
        eq(schema.userReviews.movieId, movieId),
      ))
      .limit(1)

    return c.json({ item: item ?? null, review: review ?? null })
  } catch (error) {
    if (error instanceof TmdbApiError) return tmdbErrorResponse(c, error)
    console.error('Could not load member movie state:', error)
    return c.json({ error: 'could_not_load_movie_state' }, 500)
  }
})

app.post('/api/watchlist', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member

    const body = await c.req.json().catch(() => null) as
      | { tmdbId?: unknown; status?: unknown }
      | null
    const tmdbId = Number(body?.tmdbId)
    const status = body?.status ?? 'want_to_watch'
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !isWatchlistStatus(status)) {
      return c.json({ error: 'invalid_watchlist_item', message: 'Provide a valid TMDB movie ID and status.' }, 400)
    }

    const movieId = await ensureCachedMovie(c.env, tmdbId)
    const db = getDb(c.env)
    const now = Date.now()
    await db
      .insert(schema.watchlistItems)
      .values({
        id: crypto.randomUUID(),
        userId: member.id,
        movieId,
        status,
        addedAt: now,
        updatedAt: now,
        watchedAt: status === 'watched' ? now : null,
      })
      .onConflictDoUpdate({
        target: [schema.watchlistItems.userId, schema.watchlistItems.movieId],
        set: {
          status,
          updatedAt: now,
          watchedAt: status === 'watched' ? now : null,
        },
      })

    return c.json({ status: 'saved', tmdbId, watchlistStatus: status })
  } catch (error) {
    if (error instanceof TmdbApiError) return tmdbErrorResponse(c, error)
    console.error('Could not save watchlist item:', error)
    return c.json({ error: 'could_not_save_watchlist_item' }, 500)
  }
})

app.patch('/api/watchlist/:tmdbId', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member

    const tmdbId = Number(c.req.param('tmdbId'))
    const body = await c.req.json().catch(() => null) as { status?: unknown } | null
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !isWatchlistStatus(body?.status)) {
      return c.json({ error: 'invalid_watchlist_update' }, 400)
    }

    const db = getDb(c.env)
    const [movie] = await db
      .select({ id: schema.movies.id })
      .from(schema.movies)
      .where(eq(schema.movies.tmdbId, tmdbId))
      .limit(1)
    if (!movie) return c.json({ error: 'movie_not_found' }, 404)

    const [existing] = await db
      .select({ id: schema.watchlistItems.id })
      .from(schema.watchlistItems)
      .where(and(
        eq(schema.watchlistItems.userId, member.id),
        eq(schema.watchlistItems.movieId, movie.id),
      ))
      .limit(1)
    if (!existing) return c.json({ error: 'watchlist_item_not_found' }, 404)

    const now = Date.now()
    await db
      .update(schema.watchlistItems)
      .set({
        status: body.status,
        updatedAt: now,
        watchedAt: body.status === 'watched' ? now : null,
      })
      .where(eq(schema.watchlistItems.id, existing.id))

    return c.json({ status: 'updated', tmdbId, watchlistStatus: body.status })
  } catch (error) {
    console.error('Could not update watchlist item:', error)
    return c.json({ error: 'could_not_update_watchlist_item' }, 500)
  }
})

app.delete('/api/watchlist/:tmdbId', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member

    const tmdbId = Number(c.req.param('tmdbId'))
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) return c.json({ error: 'invalid_movie_id' }, 400)

    const db = getDb(c.env)
    const [movie] = await db
      .select({ id: schema.movies.id })
      .from(schema.movies)
      .where(eq(schema.movies.tmdbId, tmdbId))
      .limit(1)
    if (!movie) return c.json({ status: 'deleted' })

    await db
      .delete(schema.watchlistItems)
      .where(and(
        eq(schema.watchlistItems.userId, member.id),
        eq(schema.watchlistItems.movieId, movie.id),
      ))
    return c.json({ status: 'deleted', tmdbId })
  } catch (error) {
    console.error('Could not remove watchlist item:', error)
    return c.json({ error: 'could_not_remove_watchlist_item' }, 500)
  }
})

app.put('/api/reviews/:tmdbId', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member

    const tmdbId = Number(c.req.param('tmdbId'))
    const body = await c.req.json().catch(() => null) as
      | { rating?: unknown; review?: unknown }
      | null
    const rating = Number(body?.rating)
    const review = body?.review ?? ''
    if (
      !Number.isInteger(tmdbId) || tmdbId <= 0 ||
      !Number.isFinite(rating) || rating < 1 || rating > 10 ||
      typeof review !== 'string' || review.length > 2000
    ) {
      return c.json({ error: 'invalid_review', message: 'Rating must be 1–10 and review must be at most 2,000 characters.' }, 400)
    }

    const movieId = await ensureCachedMovie(c.env, tmdbId)
    const db = getDb(c.env)
    const now = Date.now()
    await db
      .insert(schema.userReviews)
      .values({
        id: crypto.randomUUID(),
        userId: member.id,
        movieId,
        rating,
        review,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.userReviews.userId, schema.userReviews.movieId],
        set: { rating, review, updatedAt: now },
      })

    return c.json({ status: 'saved', tmdbId, rating, review })
  } catch (error) {
    if (error instanceof TmdbApiError) return tmdbErrorResponse(c, error)
    console.error('Could not save movie review:', error)
    return c.json({ error: 'could_not_save_review' }, 500)
  }
})

app.delete('/api/reviews/:tmdbId', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member

    const tmdbId = Number(c.req.param('tmdbId'))
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) return c.json({ error: 'invalid_movie_id' }, 400)

    const db = getDb(c.env)
    const [movie] = await db
      .select({ id: schema.movies.id })
      .from(schema.movies)
      .where(eq(schema.movies.tmdbId, tmdbId))
      .limit(1)
    if (movie) {
      await db
        .delete(schema.userReviews)
        .where(and(
          eq(schema.userReviews.userId, member.id),
          eq(schema.userReviews.movieId, movie.id),
        ))
    }
    return c.json({ status: 'deleted', tmdbId })
  } catch (error) {
    console.error('Could not delete movie review:', error)
    return c.json({ error: 'could_not_delete_review' }, 500)
  }
})


// Kitsu-backed anime discovery. Public catalogue pages are not copied wholesale into D1;
// only metadata for anime explicitly added to a member's library is cached.

app.get('/api/anime/popular', async (c) => {
  const page = validPage(c.req.query('page'))
  const genre = (c.req.query('genre') ?? '').trim().toLowerCase()

  if (genre && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(genre)) {
    return c.json({ error: 'invalid_genre' }, 400)
  }

  try {
    const params: Record<string, string> = {
      sort: '-userCount',
      include: 'genres',
      'page[limit]': String(KITSU_PAGE_SIZE),
      'page[offset]': String((page - 1) * KITSU_PAGE_SIZE),
    }

    // Filter the complete Kitsu catalogue before pagination.
    if (genre) {
      params['filter[genres]'] = genre
    }

    const payload = await kitsuRequest<KitsuPayload>(
      '/anime',
      params,
    )

    const results = normalizeKitsuPayload(payload)
    const totalResults = Number(payload.meta?.count ?? results.length)

    return c.json({
      page,
      results,
      totalResults,
      totalPages: Math.max(
        1,
        Math.ceil(totalResults / KITSU_PAGE_SIZE),
      ),
      appliedGenre: genre || null,
    })
  } catch (error) {
    return kitsuErrorResponse(c, error)
  }
})



app.get('/api/anime/search', async (c) => {
  const query = (c.req.query('query') ?? '').trim()
  const genre = (c.req.query('genre') ?? '').trim().toLowerCase()

  if (!query || query.length > 100) {
    return c.json({
      error: 'invalid_query',
      message: 'Provide an anime search query between 1 and 100 characters.',
    }, 400)
  }

  if (genre && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(genre)) {
    return c.json({ error: 'invalid_genre' }, 400)
  }

  const page = validPage(c.req.query('page'))

  try {
    const params: Record<string, string> = {
      'filter[text]': query,
      include: 'genres',
      'page[limit]': String(KITSU_PAGE_SIZE),
      'page[offset]': String((page - 1) * KITSU_PAGE_SIZE),
    }

    // Text search and genre filtering are applied together.
    if (genre) {
      params['filter[genres]'] = genre
    }

    const payload = await kitsuRequest<KitsuPayload>(
      '/anime',
      params,
    )

    const results = normalizeKitsuPayload(payload)
    const totalResults = Number(payload.meta?.count ?? results.length)

    return c.json({
      page,
      results,
      totalResults,
      totalPages: Math.max(
        1,
        Math.ceil(totalResults / KITSU_PAGE_SIZE),
      ),
      appliedGenre: genre || null,
    })
  } catch (error) {
    return kitsuErrorResponse(c, error)
  }
})


app.get('/api/anime/watchlist', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const requestedStatus = c.req.query('status')
    if (requestedStatus && !isAnimeWatchlistStatus(requestedStatus)) {
      return c.json({ error: 'invalid_status' }, 400)
    }
    const db = getDb(c.env)
    const whereClause = requestedStatus
      ? and(eq(schema.animeWatchlistItems.userId, member.id), eq(schema.animeWatchlistItems.status, requestedStatus))
      : eq(schema.animeWatchlistItems.userId, member.id)
    const items = await db.select({
      kitsuId: schema.animeCatalog.kitsuId,
      title: schema.animeCatalog.title,
      synopsis: schema.animeCatalog.synopsis,
      posterUrl: schema.animeCatalog.posterUrl,
      coverUrl: schema.animeCatalog.coverUrl,
      averageRating: schema.animeCatalog.averageRating,
      startDate: schema.animeCatalog.startDate,
      episodeCount: schema.animeCatalog.episodeCount,
      subtype: schema.animeCatalog.subtype,
      genresJson: schema.animeCatalog.genresJson,
      status: schema.animeWatchlistItems.status,
      addedAt: schema.animeWatchlistItems.addedAt,
      updatedAt: schema.animeWatchlistItems.updatedAt,
      watchedAt: schema.animeWatchlistItems.watchedAt,
      rating: schema.animeReviews.rating,
      review: schema.animeReviews.review,
    }).from(schema.animeWatchlistItems)
      .innerJoin(schema.animeCatalog, eq(schema.animeWatchlistItems.animeId, schema.animeCatalog.kitsuId))
      .leftJoin(schema.animeReviews, and(
        eq(schema.animeReviews.userId, member.id),
        eq(schema.animeReviews.animeId, schema.animeWatchlistItems.animeId),
      ))
      .where(whereClause)
      .orderBy(desc(schema.animeWatchlistItems.updatedAt))
      .limit(200)

    return c.json({
      items: items.map((item) => ({
        ...item,
        genres: (() => { try { return JSON.parse(item.genresJson) as string[] } catch { return [] } })(),
      }))
    })
  } catch (error) {
    console.error('Could not load anime watchlist:', error)
    return c.json({ error: 'could_not_load_anime_watchlist' }, 500)
  }
})

app.get('/api/anime/watchlist/:kitsuId', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const kitsuId = c.req.param('kitsuId')
    if (!/^\d{1,12}$/.test(kitsuId)) return c.json({ error: 'invalid_anime_id' }, 400)
    const db = getDb(c.env)
    const [entry] = await db.select({
      status: schema.animeWatchlistItems.status,
      watchedAt: schema.animeWatchlistItems.watchedAt,
    }).from(schema.animeWatchlistItems)
      .where(and(
        eq(schema.animeWatchlistItems.userId, member.id),
        eq(schema.animeWatchlistItems.animeId, kitsuId),
      ))
      .limit(1)
    const [review] = await db.select({
      rating: schema.animeReviews.rating,
      review: schema.animeReviews.review,
    }).from(schema.animeReviews)
      .where(and(
        eq(schema.animeReviews.userId, member.id),
        eq(schema.animeReviews.animeId, kitsuId),
      ))
      .limit(1)
    if (!entry && !review) return c.json({ item: null })
    return c.json({
      item: {
        status: entry?.status ?? null,
        watchedAt: entry?.watchedAt ?? null,
        rating: review?.rating ?? null,
        review: review?.review ?? null,
      },
    })
  } catch (error) {
    console.error('Could not load anime watchlist state:', error)
    return c.json({ error: 'could_not_load_anime_watchlist_state' }, 500)
  }
})

app.post('/api/anime/watchlist', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const body = await c.req.json().catch(() => null) as { kitsuId?: unknown; status?: unknown } | null
    const kitsuId = typeof body?.kitsuId === 'string' ? body.kitsuId : ''
    const status = body?.status ?? 'want_to_watch'
    if (!/^\d{1,12}$/.test(kitsuId) || !isAnimeWatchlistStatus(status)) {
      return c.json({ error: 'invalid_anime_watchlist_item' }, 400)
    }
    await ensureCachedAnime(c.env, kitsuId)
    const db = getDb(c.env)
    const now = Date.now()
    await db.insert(schema.animeWatchlistItems).values({
      id: crypto.randomUUID(),
      userId: member.id,
      animeId: kitsuId,
      status,
      addedAt: now,
      updatedAt: now,
      watchedAt: status === 'watched' ? now : null,
    }).onConflictDoUpdate({
      target: [schema.animeWatchlistItems.userId, schema.animeWatchlistItems.animeId],
      set: { status, updatedAt: now, watchedAt: status === 'watched' ? now : null },
    })
    return c.json({ status: 'saved', kitsuId, watchlistStatus: status })
  } catch (error) {
    if (error instanceof KitsuApiError) return kitsuErrorResponse(c, error)
    console.error('Could not save anime watchlist entry:', error)
    return c.json({ error: 'could_not_save_anime_watchlist_item' }, 500)
  }
})

app.patch('/api/anime/watchlist/:kitsuId', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const kitsuId = c.req.param('kitsuId')
    const body = await c.req.json().catch(() => null) as { status?: unknown } | null
    const nextStatus = body?.status
    if (!/^\d{1,12}$/.test(kitsuId) || !isAnimeWatchlistStatus(nextStatus)) {
      return c.json({ error: 'invalid_anime_watchlist_update' }, 400)
    }
    const db = getDb(c.env)
    const [entry] = await db.select({ id: schema.animeWatchlistItems.id })
      .from(schema.animeWatchlistItems)
      .where(and(eq(schema.animeWatchlistItems.userId, member.id), eq(schema.animeWatchlistItems.animeId, kitsuId)))
      .limit(1)
    if (!entry) return c.json({ error: 'anime_watchlist_item_not_found' }, 404)
    const now = Date.now()
    await db.update(schema.animeWatchlistItems).set({
      status: nextStatus,
      updatedAt: now,
      watchedAt: nextStatus === 'watched' ? now : null,
    }).where(eq(schema.animeWatchlistItems.id, entry.id))
    return c.json({ status: 'updated', kitsuId, watchlistStatus: nextStatus })
  } catch (error) {
    console.error('Could not update anime watchlist item:', error)
    return c.json({ error: 'could_not_update_anime_watchlist_item' }, 500)
  }
})

app.delete('/api/anime/watchlist/:kitsuId', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const kitsuId = c.req.param('kitsuId')
    if (!/^\d{1,12}$/.test(kitsuId)) return c.json({ error: 'invalid_anime_id' }, 400)
    const db = getDb(c.env)
    await db.delete(schema.animeWatchlistItems).where(and(
      eq(schema.animeWatchlistItems.userId, member.id),
      eq(schema.animeWatchlistItems.animeId, kitsuId),
    ))
    return c.json({ status: 'deleted', kitsuId })
  } catch (error) {
    console.error('Could not delete anime watchlist item:', error)
    return c.json({ error: 'could_not_delete_anime_watchlist_item' }, 500)
  }
})

app.put('/api/anime/reviews/:kitsuId', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const kitsuId = c.req.param('kitsuId')
    const body = await c.req.json().catch(() => null) as { rating?: unknown; review?: unknown } | null
    const rating = Number(body?.rating)
    const review = typeof body?.review === 'string' ? body.review.trim() : ''
    if (!/^\d{1,12}$/.test(kitsuId) || !Number.isFinite(rating) || rating < 1 || rating > 10 || review.length > 2000) {
      return c.json({ error: 'invalid_anime_review', message: 'Rating must be 1–10 and review must be 2,000 characters or fewer.' }, 400)
    }
    await ensureCachedAnime(c.env, kitsuId)
    const db = getDb(c.env)
    const now = Date.now()
    await db.insert(schema.animeReviews).values({
      id: crypto.randomUUID(),
      userId: member.id,
      animeId: kitsuId,
      rating,
      review,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.animeReviews.userId, schema.animeReviews.animeId],
      set: { rating, review, updatedAt: now },
    })
    return c.json({ status: 'saved', kitsuId, rating, review })
  } catch (error) {
    if (error instanceof KitsuApiError) return kitsuErrorResponse(c, error)
    console.error('Could not save anime review:', error)
    return c.json({ error: 'could_not_save_anime_review' }, 500)
  }
})

app.delete('/api/anime/reviews/:kitsuId', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const kitsuId = c.req.param('kitsuId')
    if (!/^\d{1,12}$/.test(kitsuId)) return c.json({ error: 'invalid_anime_id' }, 400)
    const db = getDb(c.env)
    await db.delete(schema.animeReviews).where(and(
      eq(schema.animeReviews.userId, member.id),
      eq(schema.animeReviews.animeId, kitsuId),
    ))
    return c.json({ status: 'deleted', kitsuId })
  } catch (error) {
    console.error('Could not delete anime review:', error)
    return c.json({ error: 'could_not_delete_anime_review' }, 500)
  }
})

app.get('/api/anime/:id', async (c) => {
  const kitsuId = c.req.param('id')
  if (!/^\d{1,12}$/.test(kitsuId)) return c.json({ error: 'invalid_anime_id' }, 400)
  try {
    const payload = await kitsuRequest<KitsuPayload>(`/anime/${encodeURIComponent(kitsuId)}`, { include: 'genres' })
    const anime = normalizeKitsuPayload(payload)[0]
    if (!anime) return c.json({ error: 'anime_not_found' }, 404)
    return c.json({ anime })
  } catch (error) {
    return kitsuErrorResponse(c, error)
  }
})

const ANIME_PROMPT_GENRE_RULES: Array<{ pattern: RegExp; genres: string[] }> = [
  { pattern: /\bpsychological\b/i, genres: ['Psychological', 'Thriller', 'Drama', 'Mystery'] },
  { pattern: /\bthriller\b|\btense\b|\bsuspense\b/i, genres: ['Thriller', 'Mystery', 'Psychological'] },
  { pattern: /\bmystery\b|\bdetective\b|\bwhodunit\b/i, genres: ['Mystery', 'Thriller'] },
  { pattern: /\baction\b|\bfight\b|\bbattle\b|\bsuperhero\b/i, genres: ['Action'] },
  { pattern: /\badventure\b|\bquest\b/i, genres: ['Adventure'] },
  { pattern: /\bcomedy\b|\bfunny\b|\bhilarious\b/i, genres: ['Comedy'] },
  { pattern: /\bdrama\b|\bemotional\b|\bstrong story\b/i, genres: ['Drama'] },
  { pattern: /\bfantasy\b|\bmagic\b|\bmagical\b/i, genres: ['Fantasy', 'Supernatural'] },
  { pattern: /\bhorror\b|\bscary\b|\bterrifying\b/i, genres: ['Horror', 'Supernatural'] },
  { pattern: /\bromance\b|\blove story\b/i, genres: ['Romance'] },
  { pattern: /\bsci[- ]?fi\b|\bscience fiction\b|\bspace\b|\bcyberpunk\b/i, genres: ['Sci-Fi', 'Science Fiction'] },
  { pattern: /\bslice of life\b|\beveryday life\b/i, genres: ['Slice of Life'] },
  { pattern: /\bsports\b|\bfootball\b|\bbasketball\b/i, genres: ['Sports'] },
  { pattern: /\bsupernatural\b|\bspirits?\b|\byokai\b/i, genres: ['Supernatural'] },
]

function inferAnimePromptGenres(prompt: string): string[] {
  const genres = new Set<string>()
  for (const rule of ANIME_PROMPT_GENRE_RULES) {
    if (rule.pattern.test(prompt)) for (const genre of rule.genres) genres.add(genre.toLowerCase())
  }
  return [...genres]
}

function animeGenreMatch(anime: KitsuAnime, requestedGenres: string[]): string[] {
  const genres = anime.genres.map((genre) => genre.toLowerCase())
  return requestedGenres.filter((requested) => genres.some((genre) =>
    genre === requested || genre.includes(requested) || requested.includes(genre),
  ))
}

function scoreAnimeCandidate(
  anime: KitsuAnime,
  promptTerms: string[],
  requestedGenres: string[],
  genreWeights: Map<string, number>,
  maxGenreWeight: number,
): number {
  const normalizedGenres = anime.genres.map((genre) => genre.toLowerCase())
  const tasteAffinity = maxGenreWeight > 0 && normalizedGenres.length > 0
    ? Math.min(1, normalizedGenres.reduce((sum, genre) => sum + (genreWeights.get(genre) ?? 0), 0) / (maxGenreWeight * Math.min(normalizedGenres.length, 2)))
    : 0
  const requestedMatches = animeGenreMatch(anime, requestedGenres).length
  const requestAffinity = requestedGenres.length > 0 && requestedMatches > 0
    ? 0.7 + 0.3 * requestedMatches / requestedGenres.length
    : 0
  const candidateTerms = new Set(tokenizeRecommendationText(`${anime.title} ${anime.synopsis} ${anime.genres.join(' ')}`))
  const textMatch = promptTerms.length > 0
    ? promptTerms.filter((term) => candidateTerms.has(term)).length / promptTerms.length
    : 0
  const quality = Math.max(0, Math.min(1, anime.averageRating / 100))
  const popularity = Math.min(1, Math.log1p(Math.max(0, anime.userCount)) / Math.log1p(100_000))

  let score: number
  if (requestedGenres.length > 0) {
    score = requestAffinity * 0.62 + textMatch * 0.10 + tasteAffinity * 0.12 + quality * 0.12 + popularity * 0.04
  } else if (promptTerms.length > 0) {
    score = textMatch * 0.38 + tasteAffinity * 0.22 + quality * 0.25 + popularity * 0.15
  } else if (maxGenreWeight > 0) {
    score = tasteAffinity * 0.55 + quality * 0.30 + popularity * 0.15
  } else {
    score = quality * 0.65 + popularity * 0.35
  }
  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}

function animeFallbackReason(anime: KitsuAnime, requestedGenres: string[], preferredGenres: string[]): string {
  const matches = animeGenreMatch(anime, requestedGenres)
  if (matches.length) return `Matches your request for ${matches.slice(0, 2).join(' and ')} anime.`
  if (requestedGenres.length) return 'A secondary pick based on audience rating and popularity; it may not match every requested genre.'
  if (preferredGenres.length) return `Fits genres you have enjoyed: ${preferredGenres.slice(0, 2).join(' and ')}.`
  return 'A popular anime with a strong audience rating.'
}

async function getGeminiAnimeReasons(
  env: AppBindings,
  prompt: string,
  preferredGenres: string[],
  candidates: Array<{ anime: KitsuAnime; score: number }>,
): Promise<{ reasons: Map<string, string> | null; status: string; diagnostic?: string }> {
  const apiKey = env.GEMINI_API_KEY?.trim()
  if (!apiKey) return { reasons: null, status: 'missing_key', diagnostic: 'missing_key' }
  const model = (env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite').replace(/[^a-zA-Z0-9._-]/g, '')
  const allowed = new Map(candidates.map(({ anime }) => [anime.id, anime]))
  const userPrompt = [
    'You are the anime recommendation explanation layer for Movie Hunt.',
    'Use the user request as the primary objective and personal genre preferences only as a secondary signal.',
    'Return up to 8 anime from the supplied candidate list only. Never invent titles or IDs.',
    'When a candidate does not match the request, omit it instead of padding the list.',
    'Return JSON with a recommendations array. Every item must contain kitsu_id and a short reason.',
    JSON.stringify({
      request: prompt || 'Recommend anime based on my tracked genres.',
      preferred_genres: preferredGenres,
      candidates: candidates.slice(0, 20).map(({ anime, score }) => ({
        kitsu_id: anime.id,
        title: anime.title,
        genres: anime.genres,
        synopsis: anime.synopsis.slice(0, 360),
        score,
        audience_rating: Number((anime.averageRating / 10).toFixed(1)),
      })),
    }),
  ].join('\n\n')
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const requestBody = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      thinkingConfig: { thinkingLevel: 'MINIMAL' },
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          recommendations: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                kitsu_id: { type: 'STRING' },
                reason: { type: 'STRING' },
              },
              required: ['kitsu_id', 'reason'],
            },
          },
        },
        required: ['recommendations'],
      },
    },
  })


  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    let response: Response
    try {

      const quota = await consumeGeminiAttemptQuota(env)

      if (!quota.allowed) {
        return {
          reasons: null,
          status: 'quota_exceeded',
          diagnostic: quota.reason ?? 'gemini_quota_exceeded',
        }
      }

      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: requestBody,
      })
    } catch (error) {
      if (attempt < GEMINI_MAX_ATTEMPTS) {
        await sleep((GEMINI_BACKOFF_DELAYS_MS[attempt - 1] ?? 2_000) + Math.floor(Math.random() * 250))
        continue
      }
      console.warn('Gemini anime recommendation network failure:', error)
      return { reasons: null, status: 'network_error', diagnostic: 'network_error' }
    }
    if (!response.ok) {
      const delay = GEMINI_RETRYABLE_HTTP_STATUSES.has(response.status) && attempt < GEMINI_MAX_ATTEMPTS
        ? getGeminiRetryDelayMs(response, attempt)
        : null
      if (delay !== null) {
        await sleep(delay)
        continue
      }
      const detail = await response.text().catch(() => '')
      console.warn(`Gemini anime recommendation HTTP ${response.status}:`, detail.slice(0, 300))
      return { reasons: null, status: 'http_error', diagnostic: `http_${response.status}` }
    }
    const payload = await response.json().catch(() => null) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>
    } | null
    const responseText = payload?.candidates?.[0]?.content?.parts
      ?.filter((part) => part.thought !== true && typeof part.text === 'string')
      .map((part) => part.text ?? '').join('\n').trim() ?? ''
    if (!responseText) return { reasons: null, status: 'invalid_response', diagnostic: 'empty_text' }
    let parsed: unknown
    try {
      parsed = parseGeminiJson(responseText)
    } catch {
      return { reasons: null, status: 'invalid_response', diagnostic: 'json_parse_failed' }
    }
    const reasons = new Map<string, string>()
    for (const raw of getGeminiRecommendationItems(parsed)) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const kitsuId = String(item.kitsu_id ?? item.kitsuId ?? item.id ?? '')
      const reason = typeof item.reason === 'string' ? item.reason.trim().slice(0, 360) : ''
      if (allowed.has(kitsuId) && reason && !reasons.has(kitsuId)) reasons.set(kitsuId, reason)
      if (reasons.size >= 8) break
    }
    if (reasons.size) return { reasons, status: 'used' }
    return { reasons: null, status: 'invalid_response', diagnostic: 'no_candidate_ids_matched' }
  }
  return { reasons: null, status: 'network_error', diagnostic: 'retry_limit_reached' }
}

app.post('/api/anime/recommendations', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const body = await c.req.json().catch(() => null) as { prompt?: unknown } | null
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    if (prompt.length > 240) return c.json({ error: 'prompt_too_long', message: 'Keep your anime request under 240 characters.' }, 400)

    const submissionQuota = await consumeAiSubmissionQuota(
      c.env,
      member,
    )

    if (!submissionQuota.allowed) {
      const unavailable =
        submissionQuota.reason === 'quota_store_unavailable'

      return c.json({
        error: unavailable
          ? 'quota_store_unavailable'
          : 'daily_ai_limit_exceeded',

        message: unavailable
          ? 'AI usage limits could not be checked. Please try again shortly.'
          : 'You have reached your daily AI recommendation limit.',
      }, unavailable ? 503 : 429, {
        'Retry-After': unavailable
          ? '60'
          : String(getDailyQuotaRetryAfterSeconds()),
        'Cache-Control': 'no-store',
      })
    }

    const db = getDb(c.env)
    const [trackedRows, reviewRows] = await Promise.all([
      db.select({ animeId: schema.animeWatchlistItems.animeId, title: schema.animeCatalog.title, genresJson: schema.animeCatalog.genresJson, status: schema.animeWatchlistItems.status })
        .from(schema.animeWatchlistItems)
        .innerJoin(schema.animeCatalog, eq(schema.animeWatchlistItems.animeId, schema.animeCatalog.kitsuId))
        .where(eq(schema.animeWatchlistItems.userId, member.id)).limit(200),
      db.select({ animeId: schema.animeReviews.animeId, title: schema.animeCatalog.title, genresJson: schema.animeCatalog.genresJson, rating: schema.animeReviews.rating })
        .from(schema.animeReviews)
        .innerJoin(schema.animeCatalog, eq(schema.animeReviews.animeId, schema.animeCatalog.kitsuId))
        .where(eq(schema.animeReviews.userId, member.id)).orderBy(desc(schema.animeReviews.rating)).limit(30),
    ])

    const excluded = new Set([...trackedRows.map((row) => row.animeId), ...reviewRows.map((row) => row.animeId)])
    const genreWeights = new Map<string, number>()
    for (const row of trackedRows) {
      let genres: string[] = []
      try { genres = JSON.parse(row.genresJson) as string[] } catch { genres = [] }
      const weight = row.status === 'watched' ? 0.85 : row.status === 'watching' ? 0.60 : row.status === 'want_to_watch' ? 0.20 : -0.25
      for (const genre of genres) genreWeights.set(genre.toLowerCase(), (genreWeights.get(genre.toLowerCase()) ?? 0) + weight)
    }
    for (const row of reviewRows) {
      let genres: string[] = []
      try { genres = JSON.parse(row.genresJson) as string[] } catch { genres = [] }
      const weight = Math.max(-0.5, Math.min(1, (row.rating - 5) / 5))
      for (const genre of genres) genreWeights.set(genre.toLowerCase(), (genreWeights.get(genre.toLowerCase()) ?? 0) + weight)
    }
    const preferredGenres = [...genreWeights.entries()].filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name)
    const maxGenreWeight = Math.max(0, ...genreWeights.values())
    const requestedGenres = inferAnimePromptGenres(prompt)
    const promptTerms = extractPromptContentTerms(prompt)

    // Two pages of popular Kitsu catalogue entries form the candidate pool. We never bulk-copy them to D1.
    const pages = await Promise.all([0, 1].map((pageIndex) => kitsuRequest<KitsuPayload>('/anime', {
      sort: '-userCount',
      include: 'genres',
      'page[limit]': String(KITSU_PAGE_SIZE),
      'page[offset]': String(pageIndex * KITSU_PAGE_SIZE),
    })))
    const byId = new Map<string, KitsuAnime>()
    for (const payload of pages) for (const anime of normalizeKitsuPayload(payload)) {
      if (!excluded.has(anime.id)) byId.set(anime.id, anime)
    }
    const candidates = [...byId.values()]
      .filter((anime) => requestedGenres.length === 0 || animeGenreMatch(anime, requestedGenres).length > 0)
      .map((anime) => ({
        anime,
        score: scoreAnimeCandidate(anime, promptTerms, requestedGenres, genreWeights, maxGenreWeight),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)

    if (candidates.length === 0) {
      return c.json({
        source: 'algorithm', model: null, aiStatus: 'not_needed',
        profile: { ratedAnime: reviewRows.length, trackedAnime: trackedRows.length, favoriteGenres: preferredGenres, requestedGenres, personalized: trackedRows.length + reviewRows.length > 0 },
        recommendations: [],
        message: requestedGenres.length
          ? 'No candidates in the current popular catalogue matched those genres. Try another prompt or browse anime by genre.'
          : 'No recommendations are available in the current catalogue page. Try again shortly.',
      })
    }

    const gemini = await getGeminiAnimeReasons(c.env, prompt, preferredGenres, candidates)
    const recommendationCandidates = gemini.reasons
      ? candidates.filter(({ anime }) => gemini.reasons?.has(anime.id)).slice(0, 8)
      : candidates
    const recommendations = recommendationCandidates.map(({ anime, score }) => ({
      anime,
      score,
      reason: gemini.reasons?.get(anime.id) ?? animeFallbackReason(anime, requestedGenres, preferredGenres),
    }))
    return c.json({
      source: gemini.reasons ? 'gemini' : 'algorithm',
      model: gemini.reasons ? (c.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash') : null,
      aiStatus: gemini.status,
      aiDiagnostic: gemini.diagnostic ?? null,
      profile: {
        ratedAnime: reviewRows.length,
        trackedAnime: trackedRows.length,
        favoriteGenres: preferredGenres,
        requestedGenres,
        personalized: trackedRows.length + reviewRows.length > 0,
      },
      recommendations,
    })
  } catch (error) {
    if (error instanceof KitsuApiError) return kitsuErrorResponse(c, error)
    console.error('Could not generate anime recommendations:', error)
    return c.json({ error: 'could_not_generate_anime_recommendations' }, 500)
  }
})



// -----------------------------------------------------------------------------
// Friends and social features. All personal data is scoped to the active member.
// -----------------------------------------------------------------------------

function sortedPair(firstId: string, secondId: string) {
  return firstId.localeCompare(secondId) < 0
    ? { userAId: firstId, userBId: secondId }
    : { userAId: secondId, userBId: firstId }
}

async function getSocialFriendRows(env: AppBindings, userId: string) {
  const db = getDb(env)
  return db.select({
    id: schema.friendships.id,
    userAId: schema.friendships.userAId,
    userBId: schema.friendships.userBId,
    requestedById: schema.friendships.requestedById,
    status: schema.friendships.status,
    createdAt: schema.friendships.createdAt,
  }).from(schema.friendships)
    .where(or(eq(schema.friendships.userAId, userId), eq(schema.friendships.userBId, userId)))
    .orderBy(desc(schema.friendships.createdAt))
    .limit(200)
}

app.get('/api/social/members', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    // Guests cannot access the member directory.
    if (member.isAnonymous || member.role === 'guest') {
      return c.json({ members: [] })
    }
    const db = getDb(c.env)
    const query = (c.req.query('query') ?? '').trim().slice(0, 60)
    const whereClause = query.length >= 2
      ? and(eq(schema.authUser.approvalStatus, 'approved'), eq(schema.authUser.isAnonymous, false), ne(schema.authUser.id, member.id), like(schema.authUser.name, `%${query.replace(/[%_]/g, '')}%`))
      : and(eq(schema.authUser.approvalStatus, 'approved'), eq(schema.authUser.isAnonymous, false), ne(schema.authUser.id, member.id))
    const [users, relationships] = await Promise.all([
      db.select({ id: schema.authUser.id, name: schema.authUser.name, image: schema.authUser.image, createdAt: schema.authUser.createdAt })
        .from(schema.authUser).where(whereClause).orderBy(desc(schema.authUser.createdAt)).limit(50),
      getSocialFriendRows(c.env, member.id),
    ])
    const relationByOther = new Map<string, { status: string; friendshipId: string }>()
    for (const relation of relationships) {
      const otherId = relation.userAId === member.id ? relation.userBId : relation.userAId
      relationByOther.set(otherId, {
        status: relation.status === 'accepted'
          ? 'friends'
          : relation.status === 'pending'
            ? (relation.requestedById === member.id ? 'outgoing' : 'incoming')
            : 'none',
        friendshipId: relation.id,
      })
    }
    return c.json({
      members: users.map((user) => ({
        ...user,
        relationship: relationByOther.get(user.id)?.status ?? 'none',
        friendshipId: relationByOther.get(user.id)?.friendshipId ?? null,
      }))
    })
  } catch (error) {
    console.error('Could not search social members:', error)
    return c.json({ error: 'could_not_search_members' }, 500)
  }
})

app.get('/api/social/friends', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const db = getDb(c.env)
    const relations = await getSocialFriendRows(c.env, member.id)
    const otherIds = [...new Set(relations.map((row) => row.userAId === member.id ? row.userBId : row.userAId))]
    const users = otherIds.length
      ? await db.select({ id: schema.authUser.id, name: schema.authUser.name, image: schema.authUser.image })
        .from(schema.authUser).where(inArray(schema.authUser.id, otherIds))
      : []
    const userById = new Map(users.map((user) => [user.id, user]))
    const decorate = (row: typeof relations[number]) => {
      const otherId = row.userAId === member.id ? row.userBId : row.userAId
      return { id: row.id, status: row.status, createdAt: row.createdAt, requestedByMe: row.requestedById === member.id, member: userById.get(otherId) ?? null }
    }
    return c.json({
      friends: relations.filter((row) => row.status === 'accepted').map(decorate),
      incomingRequests: relations.filter((row) => row.status === 'pending' && row.requestedById !== member.id).map(decorate),
      outgoingRequests: relations.filter((row) => row.status === 'pending' && row.requestedById === member.id).map(decorate),
    })
  } catch (error) {
    console.error('Could not load friends:', error)
    return c.json({ error: 'could_not_load_friends' }, 500)
  }
})

app.post('/api/social/requests', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    if (
      member.isAnonymous ||
      member.approvalStatus !== 'approved'
    ) {
      return c.json(
        {
          error: 'approval_required',
          message: 'Friend requests are available only to approved members.',
        },
        403,
      )
    }
    const body = await c.req.json().catch(() => null) as { targetUserId?: unknown } | null
    const targetUserId = typeof body?.targetUserId === 'string' ? body.targetUserId.trim() : ''
    if (!targetUserId || targetUserId === member.id) return c.json({ error: 'invalid_target_user' }, 400)
    const db = getDb(c.env)
    const [target] = await db
      .select({ id: schema.authUser.id })
      .from(schema.authUser)
      .where(
        and(
          eq(schema.authUser.id, targetUserId),
          eq(schema.authUser.approvalStatus, 'approved'),
          eq(schema.authUser.isAnonymous, false),
        ),
      )
      .limit(1)
    if (!target) return c.json({ error: 'member_not_found' }, 404)
    const [preferences] = await db.select({ allowFriendRequests: schema.socialPrivacy.allowFriendRequests })
      .from(schema.socialPrivacy).where(eq(schema.socialPrivacy.userId, targetUserId)).limit(1)
    if (preferences?.allowFriendRequests === false) return c.json({ error: 'friend_requests_disabled' }, 403)
    const pair = sortedPair(member.id, targetUserId)
    const [existing] = await db.select({ id: schema.friendships.id, status: schema.friendships.status, requestedById: schema.friendships.requestedById })
      .from(schema.friendships).where(and(eq(schema.friendships.userAId, pair.userAId), eq(schema.friendships.userBId, pair.userBId))).limit(1)
    if (existing) return c.json({ error: 'relationship_exists', status: existing.status }, 409)
    const now = Date.now()
    const id = crypto.randomUUID()
    await db.insert(schema.friendships).values({ id, ...pair, requestedById: member.id, status: 'pending', createdAt: now, updatedAt: now })
    return c.json({ status: 'pending', friendshipId: id }, 201)
  } catch (error) {
    console.error('Could not send friend request:', error)
    return c.json({ error: 'could_not_send_friend_request' }, 500)
  }
})

app.post('/api/social/requests/:requestId/accept', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const db = getDb(c.env)
    const [request] = await db.select().from(schema.friendships)
      .where(and(eq(schema.friendships.id, c.req.param('requestId')), eq(schema.friendships.status, 'pending'))).limit(1)
    if (!request || (request.userAId !== member.id && request.userBId !== member.id)) return c.json({ error: 'request_not_found' }, 404)
    if (request.requestedById === member.id) return c.json({ error: 'cannot_accept_own_request' }, 403)
    await db.update(schema.friendships).set({ status: 'accepted', updatedAt: Date.now() }).where(eq(schema.friendships.id, request.id))
    return c.json({ status: 'accepted' })
  } catch (error) {
    console.error('Could not accept friend request:', error)
    return c.json({ error: 'could_not_accept_friend_request' }, 500)
  }
})

app.post('/api/social/requests/:requestId/decline', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const db = getDb(c.env)
    const [request] = await db.select().from(schema.friendships)
      .where(and(eq(schema.friendships.id, c.req.param('requestId')), eq(schema.friendships.status, 'pending'))).limit(1)
    if (!request || (request.userAId !== member.id && request.userBId !== member.id)) return c.json({ error: 'request_not_found' }, 404)
    if (request.requestedById === member.id) return c.json({ error: 'cannot_decline_own_request' }, 403)
    await db.delete(schema.friendships).where(eq(schema.friendships.id, request.id))
    return c.json({ status: 'declined' })
  } catch (error) {
    console.error('Could not decline friend request:', error)
    return c.json({ error: 'could_not_decline_friend_request' }, 500)
  }
})

app.delete('/api/social/requests/:requestId', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const db = getDb(c.env)
    const [request] = await db.select({ id: schema.friendships.id })
      .from(schema.friendships).where(and(
        eq(schema.friendships.id, c.req.param('requestId')),
        eq(schema.friendships.requestedById, member.id),
        eq(schema.friendships.status, 'pending'),
      )).limit(1)
    if (!request) return c.json({ error: 'request_not_found' }, 404)
    await db.delete(schema.friendships).where(eq(schema.friendships.id, request.id))
    return c.json({ status: 'cancelled' })
  } catch (error) {
    console.error('Could not cancel friend request:', error)
    return c.json({ error: 'could_not_cancel_friend_request' }, 500)
  }
})

app.delete('/api/social/friends/:friendUserId', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const friendUserId = c.req.param('friendUserId')
    const pair = sortedPair(member.id, friendUserId)
    const db = getDb(c.env)
    await db.delete(schema.friendships).where(and(
      eq(schema.friendships.userAId, pair.userAId),
      eq(schema.friendships.userBId, pair.userBId),
      eq(schema.friendships.status, 'accepted'),
    ))
    return c.json({ status: 'removed' })
  } catch (error) {
    console.error('Could not remove friend:', error)
    return c.json({ error: 'could_not_remove_friend' }, 500)
  }
})

app.get('/api/social/privacy', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const db = getDb(c.env)
    const [privacy] = await db.select().from(schema.socialPrivacy).where(eq(schema.socialPrivacy.userId, member.id)).limit(1)
    return c.json({ privacy: privacy ?? { userId: member.id, shareActivity: false, allowFriendRequests: true } })
  } catch (error) {
    console.error('Could not load social privacy:', error)
    return c.json({ error: 'could_not_load_social_privacy' }, 500)
  }
})

app.put('/api/social/privacy', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const body = await c.req.json().catch(() => null) as { shareActivity?: unknown; allowFriendRequests?: unknown } | null
    if (typeof body?.shareActivity !== 'boolean' || typeof body?.allowFriendRequests !== 'boolean') {
      return c.json({ error: 'invalid_privacy_settings' }, 400)
    }
    const db = getDb(c.env)
    const now = Date.now()
    await db.insert(schema.socialPrivacy).values({
      userId: member.id,
      shareActivity: body.shareActivity,
      allowFriendRequests: body.allowFriendRequests,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: schema.socialPrivacy.userId,
      set: { shareActivity: body.shareActivity, allowFriendRequests: body.allowFriendRequests, updatedAt: now },
    })
    return c.json({ privacy: { shareActivity: body.shareActivity, allowFriendRequests: body.allowFriendRequests } })
  } catch (error) {
    console.error('Could not update social privacy:', error)
    return c.json({ error: 'could_not_update_social_privacy' }, 500)
  }
})

app.get('/api/social/feed', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const db = getDb(c.env)
    const relationships = await getSocialFriendRows(c.env, member.id)
    const friendIds = relationships.filter((row) => row.status === 'accepted')
      .map((row) => row.userAId === member.id ? row.userBId : row.userAId)
    if (friendIds.length === 0) return c.json({ activities: [] })
    const visibleRows = await db.select({ userId: schema.socialPrivacy.userId })
      .from(schema.socialPrivacy).where(and(inArray(schema.socialPrivacy.userId, friendIds), eq(schema.socialPrivacy.shareActivity, true)))
    const visibleIds = visibleRows.map((row) => row.userId)
    if (visibleIds.length === 0) return c.json({ activities: [] })
    const [profiles, movieRows, animeRows] = await Promise.all([
      db.select({ id: schema.authUser.id, name: schema.authUser.name, image: schema.authUser.image }).from(schema.authUser).where(inArray(schema.authUser.id, visibleIds)),
      db.select({ userId: schema.watchlistItems.userId, title: schema.movies.title, poster: schema.movies.posterPath, status: schema.watchlistItems.status, updatedAt: schema.watchlistItems.updatedAt, rating: schema.userReviews.rating, review: schema.userReviews.review })
        .from(schema.watchlistItems)
        .innerJoin(schema.movies, eq(schema.watchlistItems.movieId, schema.movies.id))
        .leftJoin(schema.userReviews, and(eq(schema.userReviews.userId, schema.watchlistItems.userId), eq(schema.userReviews.movieId, schema.watchlistItems.movieId)))
        .where(inArray(schema.watchlistItems.userId, visibleIds)).orderBy(desc(schema.watchlistItems.updatedAt)).limit(40),
      db.select({ userId: schema.animeWatchlistItems.userId, title: schema.animeCatalog.title, poster: schema.animeCatalog.posterUrl, status: schema.animeWatchlistItems.status, updatedAt: schema.animeWatchlistItems.updatedAt, rating: schema.animeReviews.rating, review: schema.animeReviews.review })
        .from(schema.animeWatchlistItems)
        .innerJoin(schema.animeCatalog, eq(schema.animeWatchlistItems.animeId, schema.animeCatalog.kitsuId))
        .leftJoin(schema.animeReviews, and(eq(schema.animeReviews.userId, schema.animeWatchlistItems.userId), eq(schema.animeReviews.animeId, schema.animeWatchlistItems.animeId)))
        .where(inArray(schema.animeWatchlistItems.userId, visibleIds)).orderBy(desc(schema.animeWatchlistItems.updatedAt)).limit(40),
    ])
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
    const activities = [
      ...movieRows.map((row) => ({ user: profileById.get(row.userId), mediaType: 'movie', title: row.title, poster: row.poster, status: row.status, rating: row.rating, review: row.review, updatedAt: row.updatedAt })),
      ...animeRows.map((row) => ({ user: profileById.get(row.userId), mediaType: 'anime', title: row.title, poster: row.poster, status: row.status, rating: row.rating, review: row.review, updatedAt: row.updatedAt })),
    ].filter((activity) => activity.user).sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt)).slice(0, 40)
    return c.json({ activities })
  } catch (error) {
    console.error('Could not load social activity:', error)
    return c.json({ error: 'could_not_load_social_feed' }, 500)
  }
})

app.get('/api/social/shares/inbox', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const db = getDb(c.env)
    const shares = await db.select({
      id: schema.sharedRecommendations.id,
      mediaType: schema.sharedRecommendations.mediaType,
      mediaId: schema.sharedRecommendations.mediaId,
      title: schema.sharedRecommendations.title,
      posterUrl: schema.sharedRecommendations.posterUrl,
      message: schema.sharedRecommendations.message,
      createdAt: schema.sharedRecommendations.createdAt,
      readAt: schema.sharedRecommendations.readAt,
      senderId: schema.authUser.id,
      senderName: schema.authUser.name,
      senderImage: schema.authUser.image,
    }).from(schema.sharedRecommendations)
      .innerJoin(schema.authUser, eq(schema.sharedRecommendations.senderId, schema.authUser.id))
      .where(eq(schema.sharedRecommendations.recipientId, member.id))
      .orderBy(desc(schema.sharedRecommendations.createdAt)).limit(50)
    return c.json({ shares })
  } catch (error) {
    console.error('Could not load shared recommendations:', error)
    return c.json({ error: 'could_not_load_shared_recommendations' }, 500)
  }
})

app.post('/api/social/shares', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const body = await c.req.json().catch(() => null) as {
      recipientId?: unknown; mediaType?: unknown; mediaId?: unknown; title?: unknown; posterUrl?: unknown; message?: unknown
    } | null
    const recipientId = typeof body?.recipientId === 'string' ? body.recipientId.trim() : ''
    const mediaType = body?.mediaType
    const mediaId = typeof body?.mediaId === 'string' || typeof body?.mediaId === 'number' ? String(body.mediaId).trim() : ''
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const posterUrl = typeof body?.posterUrl === 'string' && body.posterUrl.startsWith('https://') ? body.posterUrl.slice(0, 700) : null
    const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 400) : ''
    if (!recipientId || recipientId === member.id || (mediaType !== 'movie' && mediaType !== 'anime') || !mediaId || mediaId.length > 80 || !title || title.length > 200) {
      return c.json({ error: 'invalid_shared_recommendation' }, 400)
    }
    const pair = sortedPair(member.id, recipientId)
    const db = getDb(c.env)
    const [friendship] = await db.select({ id: schema.friendships.id }).from(schema.friendships).where(and(
      eq(schema.friendships.userAId, pair.userAId), eq(schema.friendships.userBId, pair.userBId), eq(schema.friendships.status, 'accepted'),
    )).limit(1)
    if (!friendship) return c.json({ error: 'recipient_must_be_an_accepted_friend' }, 403)
    const id = crypto.randomUUID()
    await db.insert(schema.sharedRecommendations).values({
      id, senderId: member.id, recipientId, mediaType, mediaId, title, posterUrl, message, createdAt: Date.now(), readAt: null,
    })
    return c.json({ status: 'shared', id }, 201)
  } catch (error) {
    console.error('Could not share recommendation:', error)
    return c.json({ error: 'could_not_share_recommendation' }, 500)
  }
})

app.post('/api/social/shares/:shareId/read', async (c) => {
  try {
    const member = await requireActiveMember(c)
    if (member instanceof Response) return member
    const db = getDb(c.env)
    await db.update(schema.sharedRecommendations).set({ readAt: Date.now() }).where(and(
      eq(schema.sharedRecommendations.id, c.req.param('shareId')),
      eq(schema.sharedRecommendations.recipientId, member.id),
    ))
    return c.json({ status: 'read' })
  } catch (error) {
    console.error('Could not mark shared recommendation as read:', error)
    return c.json({ error: 'could_not_mark_share_read' }, 500)
  }
})

app.notFound((c) => c.json({ error: 'API route not found' }, 404))
app.onError((error, c) => {
  console.error('Unhandled Movie Hunt API error:', error)
  return c.json({ error: 'Internal server error' }, 500)
})

async function cleanupExpiredAccounts(env: AppBindings) {
  const db = getDb(env)
  const now = Date.now()
  const expired = await db
    .select({ id: schema.authUser.id })
    .from(schema.authUser)
    .where(
      or(
        eq(schema.authUser.approvalStatus, 'rejected'),
        and(
          eq(schema.authUser.approvalStatus, 'pending'),
          lte(schema.authUser.approvalExpiresAt, now),
        ),
      ),
    )
    .limit(100)

  const ids = expired.map((row) => row.id)
  if (ids.length === 0) return

  // Remove child rows explicitly, then users. This does not rely on FK cascade settings.
  await db.delete(schema.watchlistItems).where(inArray(schema.watchlistItems.userId, ids))
  await db.delete(schema.userReviews).where(inArray(schema.userReviews.userId, ids))
  await db.delete(schema.animeWatchlistItems).where(inArray(schema.animeWatchlistItems.userId, ids))
  await db.delete(schema.animeReviews).where(inArray(schema.animeReviews.userId, ids))
  await db.delete(schema.sharedRecommendations).where(or(inArray(schema.sharedRecommendations.senderId, ids), inArray(schema.sharedRecommendations.recipientId, ids)))
  await db.delete(schema.friendships).where(or(inArray(schema.friendships.userAId, ids), inArray(schema.friendships.userBId, ids)))
  await db.delete(schema.socialPrivacy).where(inArray(schema.socialPrivacy.userId, ids))
  await db.delete(schema.authSession).where(inArray(schema.authSession.userId, ids))
  await db.delete(schema.authAccount).where(inArray(schema.authAccount.userId, ids))
  await db.delete(schema.authUser).where(inArray(schema.authUser.id, ids))
  console.log(`Movie Hunt cleanup deleted ${ids.length} expired/rejected account(s).`)
}

export default {
  fetch: (request: Request, env: AppBindings, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
  async scheduled(_controller: ScheduledController, env: AppBindings) {
    await cleanupExpiredAccounts(env)
  },
} satisfies ExportedHandler<AppBindings>
