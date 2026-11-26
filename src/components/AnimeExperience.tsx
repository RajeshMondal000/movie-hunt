import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  CalendarDays,
  Clock3,
  Film,
  ArrowUpRight,
  Users,
  Library,
  LoaderCircle,
  Play,
  Search,
  Sparkles,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { authClient } from '../lib/auth-client'
import { animeScore, animeYear, useAnimeData, type KitsuAnime, type KitsuAnimeList } from '../lib/anime'
import { FeaturedCarousel } from './FeaturedCarousel'
import { PageJump } from './PageJump'

import {
  prefetchCachedApiData,
  shouldPrefetchOptionalData,
} from '../lib/request-cache'

type AnimeStatus = 'want_to_watch' | 'watching' | 'watched' | 'dropped'
type AnimeWatchlistEntry = Pick<KitsuAnime,
  'title' | 'synopsis' | 'posterUrl' | 'coverUrl' | 'averageRating' | 'startDate' | 'episodeCount' | 'subtype' | 'genres'
> & {
  kitsuId: string
  status: AnimeStatus
  addedAt: number
  updatedAt: number
  watchedAt: number | null
  rating: number | null
  review: string | null
}

const statusLabels: Record<AnimeStatus, string> = {
  want_to_watch: 'Want to watch',
  watching: 'Watching',
  watched: 'Completed',
  dropped: 'Dropped',
}

function AnimePageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mb-8 max-w-3xl">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">{eyebrow}</div>
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
      <p className="mt-3 text-sm leading-7 text-zinc-500">{description}</p>
    </div>
  )
}

function AnimeEmpty({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-violet-300"><Icon size={23} /></div>
      <h2 className="mt-5 text-lg font-semibold text-zinc-200">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

function AnimeCard({ anime }: { anime: KitsuAnime }) {
  return (
    <article className="group min-w-0">
      <Link to={`/anime/${anime.id}`} className="block">
        <div className="relative aspect-[2/2.85] overflow-hidden rounded-xl border border-white/10 bg-zinc-900 shadow-lg shadow-black/20 transition duration-300 group-hover:-translate-y-1 group-hover:border-violet-300/30">
          {anime.posterUrl ? (
            <img src={anime.posterUrl} alt={`${anime.title} poster`} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-zinc-600">No poster available</div>
          )}
          {anime.averageRating > 0 && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/75 px-2 py-1 text-[10px] font-semibold text-amber-200 backdrop-blur"><Star size={10} fill="currentColor" /> {animeScore(anime.averageRating)}</span>}
        </div>
        <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-zinc-200 transition group-hover:text-violet-200">{anime.title}</h3>
        <p className="mt-1 text-[10px] text-zinc-500">{animeYear(anime.startDate)} · {anime.subtype ?? 'Anime'}{anime.episodeCount ? ` · ${anime.episodeCount} eps` : ''}</p>
      </Link>
    </article>
  )
}

function AnimeGrid({ anime, loading, error, emptyMessage }: { anime: KitsuAnime[]; loading: boolean; error: string; emptyMessage: string }) {
  if (loading) return <div className="flex items-center gap-2 py-12 text-sm text-zinc-500"><LoaderCircle size={17} className="animate-spin" /> Loading anime…</div>
  if (error) return <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-300">{error}</div>
  if (!anime.length) return <AnimeEmpty icon={Film} title="No anime found" description={emptyMessage} />
  return <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-5 lg:gap-5">{anime.map((item) => <AnimeCard key={item.id} anime={item} />)}</div>
}

function AnimeSectionTitle({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">{eyebrow}</div>
        <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h2>
      </div>
      {action}
    </div>
  )
}


export function AnimeHomePage() {
  const popular = useAnimeData<KitsuAnimeList>(
    '/api/anime/popular?page=1',
  )

  const featuredSlides = (popular.data?.results ?? [])
    .slice(0, 10)
    .map((anime) => ({
      id: anime.id,
      title: anime.title,
      description:
        anime.synopsis?.trim() ||
        'Discover this popular anime on Movie Hunt.',
      image: anime.coverUrl ?? anime.posterUrl,
      href: `/anime/${anime.id}`,
      meta: `${animeYear(anime.startDate)} · Kitsu ${animeScore(anime.averageRating)}`,
    }))

  return (
    <div className="space-y-10">
      <FeaturedCarousel
        eyebrow="Popular on Kitsu"
        slides={featuredSlides}
        fallbackTitle="Find your next favorite anime."
        fallbackDescription="Explore anime series and films, organize your anime list, and discover recommendations based on your taste."
        accent="violet"
        exploreHref="/discover"
        exploreLabel="Explore anime"
        libraryHref="/watchlist"
        libraryLabel="My anime list"
      />

      <section>
        <AnimeSectionTitle
          eyebrow="Most tracked on Kitsu"
          title="Popular anime"
          action={
            <Link
              to="/discover"
              className="inline-flex items-center gap-1 text-xs font-semibold text-violet-300 hover:text-violet-200"
            >
              Browse all <ArrowRight size={14} />
            </Link>
          }
        />

        <AnimeGrid
          anime={popular.data?.results ?? []}
          loading={popular.loading}
          error={popular.error}
          emptyMessage="Kitsu did not return catalogue entries. Please try again."
        />
      </section>


      <section className="grid gap-4 md:grid-cols-2">
        {/* Anime AI recommendation card */}
        <Link
          to="/ai"
          className="group rounded-2xl border border-violet-300/10 bg-gradient-to-br from-violet-500/[0.09] to-white/[0.02] p-6 transition hover:border-violet-300/20"
        >
          <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200">
            <Sparkles size={19} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-white">
              Not sure what to watch next?
            </h3>
            <ArrowUpRight
              size={17}
              className="shrink-0 text-zinc-500 transition group-hover:text-violet-200"
            />
          </div>

          <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
            Describe the kind of anime you want. Get recommendations based on
            your anime list and preferences.
          </p>
        </Link>

        {/* Anime community card */}
        <Link
          to="/friends"
          className="group rounded-2xl border border-violet-300/10 bg-gradient-to-br from-violet-500/[0.09] to-white/[0.02] p-6 transition hover:border-violet-300/20"
        >
          <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200">
            <Users size={19} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-white">
              Anime is better shared.
            </h3>
            <ArrowUpRight
              size={17}
              className="shrink-0 text-zinc-500 transition group-hover:text-violet-200"
            />
          </div>

          <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
            Invite your people, discover what your friends watch, and build
            a little anime club.
          </p>
        </Link>
      </section>

    </div>
  )
}



const ANIME_DISCOVERY_GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Friendship',
  'Magic',
  'Military',
  'Mystery',
  'Parody',
  'Police',
  'Psychological',
  'Romance',
  'School',
  'Sci-Fi',
  'Sports',
  'Super Power',
  'Supernatural',
  'Thriller',
] as const

function toKitsuGenreSlug(genre: string): string {
  return genre
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}


export function AnimeDiscoverPage() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedQuery(query.trim()),
      350,
    )

    return () => window.clearTimeout(timer)
  }, [query])

  const buildAnimePageUrl = useCallback(
    (targetPage: number) => {
      const genreParam = selectedGenre
        ? `&genre=${encodeURIComponent(toKitsuGenreSlug(selectedGenre))}`
        : ''

      return debouncedQuery
        ? `/api/anime/search?query=${encodeURIComponent(debouncedQuery)}&page=${targetPage}${genreParam}`
        : `/api/anime/popular?page=${targetPage}${genreParam}`
    },
    [debouncedQuery, selectedGenre],
  )

  const url = buildAnimePageUrl(page)
  const data = useAnimeData<KitsuAnimeList>(url)

  const maxPages = Math.min(
    data.data?.totalPages ?? 1,
    500,
  )

  useEffect(() => {
    if (
      !data.data ||
      query.trim() !== debouncedQuery ||
      !shouldPrefetchOptionalData()
    ) {
      return
    }

    const targetPages = [
      page - 2,
      page - 1,
      page + 1,
      page + 2,
    ].filter(
      (targetPage) =>
        targetPage >= 1 && targetPage <= maxPages,
    )

    for (const targetPage of targetPages) {
      void prefetchCachedApiData<KitsuAnimeList>(
        buildAnimePageUrl(targetPage),
      )
    }
  }, [
    buildAnimePageUrl,
    data.data,
    page,
    maxPages,
    query,
    debouncedQuery,
  ])

  function selectGenre(genre: string | null) {
    setSelectedGenre(genre)
    setPage(1)
  }

  const anime = data.data?.results ?? []

  return (
    <div>
      <AnimePageIntro
        eyebrow="Kitsu anime catalogue"
        title="Find your next series."
        description="Search anime titles and explore the catalogue using genre filters. Filters are applied across Kitsu's catalogue, not just the current page."
      />

      {/* Search */}
      <div className="mb-6 flex max-w-2xl items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
        <Search size={17} className="shrink-0 text-zinc-500" />

        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(1)
          }}
          placeholder="Search anime titles..."
          className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
        />

        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setPage(1)
            }}
            className="text-xs text-zinc-500 hover:text-white"
          >
            Clear
          </button>
        )}
      </div>

      {/* Genre filters */}
      <div className="mb-7">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Browse by genre
          </div>

          {selectedGenre && (
            <button
              type="button"
              onClick={() => selectGenre(null)}
              className="text-xs text-violet-300 hover:text-violet-200"
            >
              Clear filter
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => selectGenre(null)}
            aria-pressed={selectedGenre === null}
            className={`rounded-full border px-3 py-2 text-xs transition ${selectedGenre === null
              ? 'border-violet-300/30 bg-violet-300/10 text-violet-200'
              : 'border-white/10 text-zinc-400 hover:bg-white/5'
              }`}
          >
            All genres
          </button>

          {ANIME_DISCOVERY_GENRES.map((genre) => (
            <button
              key={genre}
              type="button"
              aria-pressed={selectedGenre === genre}
              onClick={() => selectGenre(genre)}
              className={`rounded-full border px-3 py-2 text-xs transition ${selectedGenre === genre
                ? 'border-violet-300/30 bg-violet-300/10 text-violet-200'
                : 'border-white/10 text-zinc-400 hover:bg-white/5'
                }`}
            >
              {genre}
            </button>
          ))}
        </div>
      </div>

      {/* Results heading */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-300">
          {selectedGenre
            ? `${selectedGenre} anime`
            : debouncedQuery
              ? `Results for "${debouncedQuery}"`
              : 'Popular anime'}
        </h2>

        <span className="text-xs text-zinc-600">
          {data.data?.totalResults?.toLocaleString() ?? '—'} titles
        </span>
      </div>

      {/* No local filtering: Kitsu already returns filtered results. */}
      <AnimeGrid
        anime={anime}
        loading={
          data.loading ||
          (Boolean(query.trim()) && query.trim() !== debouncedQuery)
        }
        error={data.error}
        emptyMessage={
          selectedGenre
            ? `No anime found in ${selectedGenre}. Try another genre or clear the filter.`
            : 'Try another title or clear your search.'
        }
      />

      {/* Pagination uses the filtered total count. */}

      {data.data && maxPages > 1 && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            disabled={page <= 1 || data.loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-lg border border-white/10 px-4 py-2 text-xs text-zinc-300 disabled:opacity-30"
          >
            Previous
          </button>

          <span className="text-xs text-zinc-500">
            Page {page} of {maxPages}
          </span>

          <PageJump
            key={`${page}-${query}-${selectedGenre ?? 'all'}`}
            page={page}
            totalPages={maxPages}
            onGo={setPage}
            accent="violet"
          />

          <button
            disabled={page >= maxPages || data.loading}
            onClick={() => setPage((current) => Math.min(maxPages, current + 1))}
            className="rounded-lg border border-white/10 px-4 py-2 text-xs text-zinc-300 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}


      <p className="mt-5 text-[10px] text-zinc-600">
        Genre filtering, search and pagination are handled by Kitsu across the catalogue.
      </p>
    </div>
  )
}


function AnimeLibraryControls({ anime }: { anime: KitsuAnime }) {
  const { data: session, isPending } = authClient.useSession()
  const [status, setStatus] = useState<AnimeStatus | ''>('')
  const [rating, setRating] = useState('8')
  const [review, setReview] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!session?.user?.id) return
    let active = true
    fetch(`/api/anime/watchlist/${anime.id}`)
      .then(async (response) => {
        const data = await response.json() as { item?: { status: AnimeStatus | null; rating: number | null; review: string | null } | null; error?: string }
        if (!response.ok) throw new Error(data.error ?? 'Could not load your anime list status.')
        return data
      })
      .then((data) => {
        if (!active || !data.item) return
        setStatus(data.item.status ?? '')
        if (data.item.rating !== null) setRating(String(data.item.rating))
        setReview(data.item.review ?? '')
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load your anime list status.')
      })
    return () => { active = false }
  }, [anime.id, session?.user?.id])

  async function saveStatus(nextStatus: AnimeStatus) {
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch(status ? `/api/anime/watchlist/${anime.id}` : '/api/anime/watchlist', {
        method: status ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(status ? { status: nextStatus } : { kitsuId: anime.id, status: nextStatus }),
      })
      const data = await response.json() as { message?: string; error?: string }
      if (!response.ok) throw new Error(data.message ?? data.error ?? 'Could not update your anime list.')
      setStatus(nextStatus); setMessage('Anime list updated.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update your anime list.') }
    finally { setSaving(false) }
  }

  async function saveReview() {
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch(`/api/anime/reviews/${anime.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: Number(rating), review }),
      })
      const data = await response.json() as { message?: string; error?: string }
      if (!response.ok) throw new Error(data.message ?? data.error ?? 'Could not save your review.')
      setMessage('Your rating and review have been saved.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save your review.') }
    finally { setSaving(false) }
  }

  if (isPending) return <p className="mt-7 text-xs text-zinc-500">Checking your account…</p>
  if (!session?.user) return <div className="mt-7 rounded-2xl border border-white/10 bg-black/25 p-4"><p className="text-xs text-zinc-400">Sign in to add anime to your personal list and rate it.</p><Link to="/login" className="mt-3 inline-flex rounded-lg bg-violet-300 px-3 py-2 text-xs font-bold text-zinc-950">Sign in with Google</Link></div>

  return (
    <div className="mt-7 grid gap-4 xl:grid-cols-2">
      <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="text-xs font-semibold text-white">Your anime list</div>
        {status ? <div className="mt-3 flex flex-wrap items-center gap-2"><select value={status} onChange={(event) => void saveStatus(event.target.value as AnimeStatus)} disabled={saving} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2.5 text-xs text-zinc-200 outline-none">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" onClick={() => void saveStatus('want_to_watch')} disabled={saving} className="rounded-lg border border-white/10 px-3 py-2.5 text-xs text-zinc-300 hover:bg-white/5">Update</button></div> : <button type="button" disabled={saving} onClick={() => void saveStatus('want_to_watch')} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-300 px-3.5 py-2.5 text-xs font-bold text-zinc-950 hover:bg-violet-200 disabled:opacity-50"><Bookmark size={14} /> Add to anime list</button>}
        <p className="mt-2 text-[10px] text-zinc-500">Track anime as planned, watching, completed, or dropped.</p>
      </section>
      <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="text-xs font-semibold text-white">Your rating and review</div>
        <div className="mt-3 flex items-center gap-3"><label htmlFor="anime-rating" className="text-xs text-zinc-400">Rating</label><select id="anime-rating" value={rating} onChange={(event) => setRating(event.target.value)} className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none">{Array.from({ length: 10 }, (_, index) => 10 - index).map((value) => <option key={value} value={value}>{value} / 10</option>)}</select></div>
        <textarea value={review} onChange={(event) => setReview(event.target.value)} maxLength={2000} rows={3} placeholder="Write a short review (optional)…" className="mt-3 w-full resize-y rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2.5 text-xs leading-5 text-zinc-200 outline-none placeholder:text-zinc-600" />
        <div className="mt-2 flex items-center justify-between gap-3"><span className="text-[10px] text-zinc-600">{review.length}/2000 characters</span><button type="button" disabled={saving} onClick={() => void saveReview()} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-zinc-100 hover:bg-white/15 disabled:opacity-50">{saving ? 'Saving…' : 'Save review'}</button></div>
      </section>
      {(message || error) && <p className={`text-xs xl:col-span-2 ${error ? 'text-rose-300' : 'text-emerald-300'}`}>{error || message}</p>}
    </div>
  )
}

export function AnimeDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const detail = useAnimeData<{ anime: KitsuAnime }>(id ? `/api/anime/${encodeURIComponent(id)}` : null)
  if (detail.loading) return <div className="flex min-h-[45vh] items-center justify-center gap-3 text-sm text-zinc-400"><LoaderCircle className="animate-spin" size={20} /> Loading anime details…</div>
  if (detail.error || !detail.data?.anime) return <div><Link to="/discover" className="mb-6 inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-white"><ArrowLeft size={14} /> Back to anime</Link><AnimeEmpty icon={Film} title="Anime details unavailable" description={detail.error || 'This anime could not be found.'} /></div>
  const anime = detail.data.anime
  const heroImage = anime.coverUrl ?? anime.posterUrl
  const totalRuntime = anime.episodeCount && anime.episodeLength ? `${Math.floor(anime.episodeCount * anime.episodeLength / 60)}h ${anime.episodeCount * anime.episodeLength % 60}m total` : null
  return (
    <div className="space-y-9">
      <Link to="/discover" className="inline-flex items-center gap-2 text-xs text-zinc-400 transition hover:text-white"><ArrowLeft size={14} /> Back to anime</Link>
      <section className="relative isolate overflow-hidden rounded-[26px] border border-white/10 bg-zinc-900 bg-cover bg-center p-5 sm:p-8 lg:p-10" style={heroImage ? { backgroundImage: `linear-gradient(90deg, rgba(9,9,11,.98) 8%, rgba(9,9,11,.88) 55%, rgba(9,9,11,.48)), url(${heroImage})` } : undefined}>
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-950/20 to-zinc-950" />
        <div className="relative grid gap-7 sm:grid-cols-[190px_1fr] lg:grid-cols-[230px_1fr]">
          {anime.posterUrl ? <img src={anime.posterUrl} alt={`${anime.title} poster`} className="mx-auto w-full max-w-[210px] rounded-xl border border-white/10 shadow-2xl sm:mx-0 lg:max-w-[230px]" /> : <div className="flex aspect-[2/3] max-w-[210px] items-center justify-center rounded-xl bg-zinc-800 text-sm text-zinc-500">No poster available</div>}
          <div className="flex flex-col justify-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">Anime details · Kitsu</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">{anime.title} <span className="text-zinc-400">({animeYear(anime.startDate)})</span></h1>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-zinc-300">
              {anime.averageRating > 0 && <span className="inline-flex items-center gap-1.5 text-amber-200"><Star size={13} fill="currentColor" /> {animeScore(anime.averageRating)} / 10</span>}
              {anime.episodeCount && <span className="inline-flex items-center gap-1.5"><Film size={13} /> {anime.episodeCount} episodes</span>}
              {anime.episodeLength && <span className="inline-flex items-center gap-1.5"><Clock3 size={13} /> {anime.episodeLength} min / ep</span>}
              {anime.startDate && <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} /> {anime.startDate}</span>}
              {anime.subtype && <span className="rounded bg-white/10 px-2 py-1">{anime.subtype}</span>}
              {anime.ageRating && <span className="rounded bg-white/10 px-2 py-1">{anime.ageRating}</span>}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">{anime.genres.map((genre) => <span key={genre} className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-[11px] text-zinc-200">{genre}</span>)}</div>
            <h2 className="mt-7 text-sm font-semibold text-white">Synopsis</h2>
            <p className="mt-2 max-w-3xl whitespace-pre-line text-sm leading-7 text-zinc-300">{anime.synopsis || 'No synopsis is available for this anime.'}</p>
            {totalRuntime && <p className="mt-3 text-xs text-zinc-400">Approximate total runtime: {totalRuntime}</p>}
            <AnimeLibraryControls anime={anime} />
            {anime.youtubeVideoId && <a href={`https://www.youtube.com/watch?v=${anime.youtubeVideoId}`} target="_blank" rel="noreferrer" className="mt-5 inline-flex w-fit items-center gap-2 rounded-xl bg-violet-300 px-4 py-2.5 text-xs font-bold text-zinc-950 transition hover:bg-violet-200"><Play size={14} fill="currentColor" /> Watch trailer</a>}
          </div>
        </div>
      </section>
    </div>
  )
}

export function AnimeWatchlistPage() {
  const { data: session, isPending: sessionLoading } = authClient.useSession()
  const [items, setItems] = useState<AnimeWatchlistEntry[]>([])
  const [filter, setFilter] = useState<'all' | AnimeStatus>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const query = filter === 'all' ? '' : `?status=${encodeURIComponent(filter)}`

  useEffect(() => {
    if (!session?.user?.id) return
    let active = true
    fetch(`/api/anime/watchlist${query}`)
      .then(async (response) => {
        const data = await response.json() as { items?: AnimeWatchlistEntry[]; error?: string }
        if (!response.ok) throw new Error(data.error ?? 'Could not load your anime list.')
        return data
      })
      .then((data) => { if (active) { setItems(data.items ?? []); setError('') } })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : 'Could not load your anime list.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [query, session?.user?.id])

  async function updateStatus(kitsuId: string, status: AnimeStatus) {
    try {
      const response = await fetch(`/api/anime/watchlist/${kitsuId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not update this anime.')
      setItems((current) => current.map((item) => item.kitsuId === kitsuId ? { ...item, status, watchedAt: status === 'watched' ? Date.now() : null } : item))
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update this anime.') }
  }

  async function removeItem(kitsuId: string) {
    try {
      const response = await fetch(`/api/anime/watchlist/${kitsuId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Could not remove this anime.')
      setItems((current) => current.filter((item) => item.kitsuId !== kitsuId))
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not remove this anime.') }
  }

  const filters: Array<{ value: 'all' | AnimeStatus; label: string }> = [
    { value: 'all', label: 'All anime' },
    { value: 'want_to_watch', label: 'Want to watch' },
    { value: 'watching', label: 'Watching' },
    { value: 'watched', label: 'Completed' },
    { value: 'dropped', label: 'Dropped' },
  ]

  if (sessionLoading) return <div className="py-12 text-sm text-zinc-500">Checking your account…</div>
  if (!session?.user) return <div><AnimePageIntro eyebrow="Your personal anime library" title="Your anime list." description="Sign in to track series, films, ratings, and reviews." /><AnimeEmpty icon={Library} title="Sign in to access your anime list" description="Your anime list and reviews are private to your account." action={<Link to="/login" className="rounded-lg bg-violet-300 px-3 py-2 text-xs font-bold text-zinc-950">Sign in with Google</Link>} /></div>

  return (
    <div>
      <AnimePageIntro eyebrow="Your personal anime library" title="Your anime list." description="Track what you plan to watch, are watching, have completed, or dropped." />
      <div className="mb-6 flex flex-wrap gap-2">{filters.map((item) => <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={`rounded-full border px-3.5 py-2 text-xs font-medium transition ${filter === item.value ? 'border-violet-300/30 bg-violet-300/10 text-violet-200' : 'border-white/10 bg-white/[0.025] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'}`}>{item.label}</button>)}</div>
      {error && <p className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-300">{error}</p>}
      {loading ? <div className="flex items-center gap-2 py-12 text-sm text-zinc-500"><LoaderCircle size={17} className="animate-spin" /> Loading your anime…</div> : items.length === 0 ? <AnimeEmpty icon={Library} title={filter === 'all' ? 'Your anime list is empty' : 'No anime in this section'} description="Discover anime and add it to your personal list." action={<Link to="/discover" className="rounded-lg bg-violet-300 px-3 py-2 text-xs font-bold text-zinc-950">Discover anime</Link>} /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((item) => <article key={item.kitsuId} className="flex min-w-0 gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
          <Link to={`/anime/${item.kitsuId}`} className="h-32 w-[86px] shrink-0 overflow-hidden rounded-lg bg-zinc-900">{item.posterUrl ? <img src={item.posterUrl} alt={`${item.title} poster`} loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-2 text-center text-[10px] text-zinc-500">No poster</div>}</Link>
          <div className="flex min-w-0 flex-1 flex-col"><Link to={`/anime/${item.kitsuId}`} className="line-clamp-2 text-sm font-semibold text-zinc-100 hover:text-violet-200">{item.title}</Link><p className="mt-1 text-[10px] text-zinc-500">{animeYear(item.startDate)} · Kitsu {animeScore(item.averageRating)}</p>{item.rating !== null && <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-amber-200"><Star size={11} fill="currentColor" /> Your rating: {item.rating}/10</p>}{item.review && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">“{item.review}”</p>}<div className="mt-auto flex items-center gap-2 pt-3"><select aria-label={`Status for ${item.title}`} value={item.status} onChange={(event) => void updateStatus(item.kitsuId, event.target.value as AnimeStatus)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-[10px] text-zinc-300 outline-none">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" onClick={() => void removeItem(item.kitsuId)} title="Remove from your anime list" aria-label={`Remove ${item.title}`} className="rounded-lg border border-white/10 p-2 text-zinc-500 hover:border-rose-400/20 hover:text-rose-300"><Trash2 size={13} /></button></div></div>
        </article>)}</div>
      )}
      <p className="mt-5 text-[10px] text-zinc-600">Completed anime count as viewing history. Each member's anime list and reviews are private.</p>
    </div>
  )
}

type AnimeRecommendationResponse = {
  source: 'gemini' | 'algorithm'
  model: string | null
  aiStatus: string
  aiDiagnostic?: string | null
  profile: { ratedAnime: number; trackedAnime: number; favoriteGenres: string[]; requestedGenres: string[]; personalized: boolean }
  recommendations: Array<{ anime: KitsuAnime; score: number; reason: string }>
  message?: string
}

export function AnimeAiPage() {
  const { data: session, isPending: sessionLoading } = authClient.useSession()
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AnimeRecommendationResponse | null>(null)
  const examples = [
    'A dark psychological thriller with a strong story',
    'An emotional fantasy adventure with great characters',
    'A clever mystery anime with unexpected twists',
    'A fun action anime with excellent world-building',
  ]

  async function generateRecommendations(requestText = prompt) {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/anime/recommendations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: requestText.trim() }) })
      const data = await response.json() as AnimeRecommendationResponse & { error?: string }
      if (!response.ok) throw new Error(data.message ?? data.error ?? 'Could not generate anime recommendations.')
      setResult(data)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not generate anime recommendations.') }
    finally { setLoading(false) }
  }

  if (sessionLoading) return <div className="py-12 text-sm text-zinc-500">Checking your account…</div>
  if (!session?.user) return <div><AnimePageIntro eyebrow="Anime recommendation assistant" title="Find your next anime." description="Sign in to get recommendations based on your own anime history." /><AnimeEmpty icon={Sparkles} title="Sign in to get personalized picks" description="Your anime list and ratings help tailor suggestions." action={<Link to="/login" className="rounded-lg bg-violet-300 px-3 py-2 text-xs font-bold text-zinc-950">Sign in with Google</Link>} /></div>

  return (
    <div>
      <AnimePageIntro eyebrow="Anime recommendation assistant" title="What should you watch next?" description="The anime recommender uses your Kitsu catalogue preferences and private D1 watchlist, then Gemini adds explanations when available." />
      <div className="rounded-2xl border border-violet-300/10 bg-gradient-to-br from-violet-500/[0.10] via-white/[0.025] to-transparent p-5 sm:p-7">
        <label htmlFor="anime-prompt" className="text-sm font-semibold text-white">Describe the anime you're looking for</label>
        <textarea id="anime-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={240} rows={3} placeholder="Example: A tense psychological thriller with a strong story…" className="mt-3 w-full resize-y rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-300/40" />
        <div className="mt-2 flex items-center justify-between gap-3"><span className="text-[10px] text-zinc-600">{prompt.length}/240</span><button type="button" disabled={loading} onClick={() => void generateRecommendations()} className="inline-flex items-center gap-2 rounded-xl bg-violet-300 px-4 py-2.5 text-xs font-bold text-zinc-950 hover:bg-violet-200 disabled:opacity-50">{loading ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}{loading ? 'Finding anime…' : 'Recommend anime'}</button></div>
        <div className="mt-5 flex flex-wrap gap-2">{examples.map((example) => <button key={example} type="button" onClick={() => { setPrompt(example); setError('') }} className="rounded-full border border-violet-200/10 bg-black/20 px-3 py-2 text-[11px] text-zinc-400 hover:border-violet-200/25 hover:text-violet-200">{example}</button>)}</div>
      </div>
      {error && <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-300">{error}</p>}
      {result && <section className="mt-9">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">Personalized anime picks</div><h2 className="text-2xl font-semibold text-white">Picked for your next anime night.</h2><p className="mt-2 text-xs text-zinc-500">{result.profile.ratedAnime} rated · {result.profile.trackedAnime} tracked · {result.profile.favoriteGenres.slice(0, 4).join(', ') || 'Building your taste profile'}</p></div><span className="rounded-full border border-violet-300/20 bg-violet-300/[0.07] px-3 py-2 text-[10px] font-semibold text-violet-200">{result.source === 'gemini' ? `Gemini · ${result.model ?? 'AI'}` : 'Taste-based algorithm'}</span></div>
        {result.message && <p className="mb-4 text-xs text-zinc-400">{result.message}</p>}
        <div className="grid gap-4 lg:grid-cols-2">{result.recommendations.map((item, index) => <article key={item.anime.id} className="overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.025]"><div className="flex gap-4 p-4"><Link to={`/anime/${item.anime.id}`} className="h-36 w-[96px] shrink-0 overflow-hidden rounded-lg bg-zinc-900">{item.anime.posterUrl ? <img src={item.anime.posterUrl} alt={`${item.anime.title} poster`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">No poster</div>}</Link><div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">Pick #{index + 1}</p><Link to={`/anime/${item.anime.id}`} className="mt-2 block text-sm font-semibold text-white hover:text-violet-200">{item.anime.title}</Link><p className="mt-1 text-[10px] text-zinc-500">{animeYear(item.anime.startDate)} · Kitsu {animeScore(item.anime.averageRating)}</p><span className="mt-3 inline-flex rounded-lg bg-amber-300/10 px-2.5 py-1.5 text-[10px] font-semibold text-amber-200"><Star size={11} fill="currentColor" className="mr-1" /> Match score {item.score}%</span></div></div><div className="border-t border-white/[0.07] px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Why this anime?</p><p className="mt-2 text-xs leading-6 text-zinc-300">{item.reason}</p><Link to={`/anime/${item.anime.id}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-200 hover:text-white">View anime details <ArrowRight size={13} /></Link></div></article>)}</div>
        {result.source === 'algorithm' && result.aiStatus !== 'not_needed' && <p className="mt-4 text-[10px] text-zinc-600">Gemini was unavailable or returned no usable anime list ({result.aiStatus}{result.aiDiagnostic ? ` · ${result.aiDiagnostic}` : ''}). Prompt-aware local recommendations are shown instead.</p>}
      </section>}
    </div>
  )
}
