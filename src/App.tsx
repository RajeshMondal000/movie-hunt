import { useCallback, useEffect, useState } from 'react'
import {
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  Trash2,
  ChevronRight,
  Clapperboard,
  CalendarDays,
  Clock3,
  Compass,
  Film,
  Heart,
  Home,
  Library,
  LoaderCircle,
  Search,
  Sparkles,
  Star,
  Play,
  Users,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { authClient } from './lib/auth-client'

import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom'
import { tmdbImage, useTmdbData, type TmdbGenre, type TmdbMovie, type TmdbMovieDetails, type TmdbMovieList } from './lib/tmdb'
import { AnimeAiPage, AnimeDetailsPage, AnimeDiscoverPage, AnimeHomePage, AnimeWatchlistPage } from './components/AnimeExperience'
import { SocialFriendsPage } from './components/SocialExperience'


type ProfileStats = {
  tracked: number
  wantToWatch: number
  watching: number
  watched: number
  dropped: number
  reviewed: number
  averageRating: number
}

type ProfileActivity = {
  mediaId: string | number
  mediaType: 'movie' | 'anime'
  title: string
  poster: string | null
  status: string
  updatedAt: number
  rating: number | null
}

type ProfileData = {
  user: {
    id: string
    name: string
    email: string
    image: string | null
    role: string
    approvalStatus: string
    createdAt: number
    approvedAt: number | null
  }
  stats: {
    friends: number
    movies: ProfileStats
    anime: ProfileStats
  }
  favoriteGenres: {
    movies: { name: string; averageRating: number; reviewCount: number }[]
    anime: { name: string; averageRating: number; reviewCount: number }[]
  }
  recentActivity: ProfileActivity[]
  privacy: {
    shareActivity: boolean
    allowFriendRequests: boolean
  }
}

type NavItem = {
  label: string
  to: string
  icon: LucideIcon
}

type MediaMode = 'movies' | 'anime'

function getNavItems(mode: MediaMode): NavItem[] {
  return [
    { label: 'Home', to: '/', icon: Home },
    { label: 'Discover', to: '/discover', icon: Compass },
    { label: mode === 'movies' ? 'My watchlist' : 'My anime list', to: '/watchlist', icon: Bookmark },
    { label: mode === 'movies' ? 'AI picks' : 'Anime picks', to: '/ai', icon: Sparkles },
    { label: 'Friends', to: '/friends', icon: Users },
    { label: 'Profile', to: '/profile', icon: UserRound },
  ]
}


function ApiStatus() {
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true

    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable')
        return response.json() as Promise<{ database?: string }>
      })
      .then((data) => {
        if (active) setConnected(data.database === 'connected')
      })
      .catch(() => {
        if (active) setConnected(false)
      })

    return () => {
      active = false
    }
  }, [])

  const label =
    connected === null
      ? 'Checking services'
      : connected
        ? 'Database connected'
        : 'Backend setup pending'

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.035] px-3 py-1.5 text-xs text-zinc-400">
      <span
        className={`h-1.5 w-1.5 rounded-full ${connected === null
          ? 'animate-pulse bg-amber-400'
          : connected
            ? 'bg-emerald-400'
            : 'bg-zinc-500'
          }`}
      />
      {label}
    </div>
  )
}

function Sidebar({ mode, onModeChange }: { mode: MediaMode; onModeChange: (mode: MediaMode) => void }) {
  const navItems = getNavItems(mode)
  return (
    <aside className="hidden min-h-screen w-[248px] shrink-0 flex-col border-r border-white/[0.07] bg-black/20 px-5 py-7 lg:flex">
      <Link to="/" className="mb-9 flex items-center gap-3 px-2">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-zinc-950 shadow-lg ${mode === 'movies' ? 'bg-amber-500 shadow-amber-950/30' : 'bg-violet-300 shadow-violet-950/30'}`}>
          <Clapperboard size={21} strokeWidth={2.3} />
        </div>
        <div>
          <div className="text-[17px] font-bold tracking-tight text-white">movie<span className={mode === 'movies' ? 'text-amber-400' : 'text-violet-300'}>hunt</span></div>
          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">your movie & anime club</div>
        </div>
      </Link>

      <div className="mb-6">
        <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">Switch library</div>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.07] bg-black/30 p-1">
          <button type="button" aria-pressed={mode === 'movies'} onClick={() => onModeChange('movies')} className={`rounded-lg px-2 py-2.5 text-xs font-semibold transition ${mode === 'movies' ? 'bg-amber-400 text-zinc-950 shadow' : 'text-zinc-500 hover:text-zinc-200'}`}>Movies</button>
          <button type="button" aria-pressed={mode === 'anime'} onClick={() => onModeChange('anime')} className={`rounded-lg px-2 py-2.5 text-xs font-semibold transition ${mode === 'anime' ? 'bg-violet-300 text-zinc-950 shadow' : 'text-zinc-500 hover:text-zinc-200'}`}>Anime</button>
        </div>
      </div>

      <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">Menu</div>
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium transition ${isActive
                ? mode === 'movies' ? 'bg-amber-400/10 text-amber-300 ring-1 ring-amber-300/10' : 'bg-violet-300/10 text-violet-200 ring-1 ring-violet-300/10'
                : 'text-zinc-500 hover:bg-white/[0.045] hover:text-zinc-200'}`
            }>
              <Icon size={17} strokeWidth={1.8} />
              {item.label}
              {(item.label === 'AI picks' || item.label === 'Anime picks') && <span className={`ml-auto rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${mode === 'movies' ? 'bg-amber-400/10 text-amber-300' : 'bg-violet-300/10 text-violet-200'}`}>AI</span>}
            </NavLink>
          )
        })}
      </nav>

      <div className={`mt-auto rounded-2xl border border-white/[0.07] p-4 ${mode === 'movies' ? 'bg-gradient-to-br from-amber-500/[0.10] to-transparent' : 'bg-gradient-to-br from-violet-500/[0.12] to-transparent'}`}>
        <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ${mode === 'movies' ? 'bg-amber-400/10 text-amber-300' : 'bg-violet-300/10 text-violet-200'}`}><Heart size={16} /></div>
        <p className="text-sm font-semibold text-zinc-200">{mode === 'movies' ? 'Movies are better together.' : 'Anime is better shared.'}</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">Invite your people and build a little watch club.</p>
        <Link to="/friends" className={`mt-3 inline-flex items-center gap-1.5 text-xs font-semibold ${mode === 'movies' ? 'text-amber-300 hover:text-amber-200' : 'text-violet-200 hover:text-violet-100'}`}>Explore the club <ArrowUpRight size={13} /></Link>
      </div>
      <div className="mt-5 px-2 text-[10px] text-zinc-700">MOVIE HUNT · STUDENT PROJECT</div>
    </aside>
  )
}

function MobileNav({ mode, onModeChange }: { mode: MediaMode; onModeChange: (mode: MediaMode) => void }) {
  const mobileItems = getNavItems(mode).slice(0, 5)
  return (
    <nav className="fixed inset-x-3 bottom-3 z-30 rounded-2xl border border-white/10 bg-[#141416]/95 p-2 shadow-2xl shadow-black/50 backdrop-blur-xl lg:hidden">
      <div className="mb-1 grid grid-cols-2 gap-1 rounded-xl border border-white/[0.07] bg-black/30 p-1">
        <button type="button" aria-pressed={mode === 'movies'} onClick={() => onModeChange('movies')} className={`rounded-lg py-2 text-[10px] font-semibold transition ${mode === 'movies' ? 'bg-amber-400 text-zinc-950' : 'text-zinc-500 hover:text-zinc-200'}`}>Movies</button>
        <button type="button" aria-pressed={mode === 'anime'} onClick={() => onModeChange('anime')} className={`rounded-lg py-2 text-[10px] font-semibold transition ${mode === 'anime' ? 'bg-violet-300 text-zinc-950' : 'text-zinc-500 hover:text-zinc-200'}`}>Anime</button>
      </div>
      <div className="flex items-center justify-around">
        {mobileItems.map((item) => {
          const Icon = item.icon
          return <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) =>
            `flex min-w-0 flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[9px] font-medium ${isActive ? mode === 'movies' ? 'text-amber-300' : 'text-violet-200' : 'text-zinc-500'}`
          }>
            <Icon size={18} />
            <span>{item.label === 'My watchlist' ? 'Watchlist' : item.label === 'My anime list' ? 'Anime list' : item.label === 'Anime picks' ? 'Anime AI' : item.label}</span>
          </NavLink>
        })}
      </div>
    </nav>
  )
}

function AuthControl() {
  const { data: session, isPending } = authClient.useSession()
  type AccountInfo = {
    role: string
    isAnonymous: boolean
    approvalStatus: string
    approvalExpiresAt: number | null
  }

  const [accountState, setAccountState] = useState<{
    userId: string
    account: AccountInfo | null
  } | null>(null)
  const currentUserId = session?.user?.id

  useEffect(() => {
    let active = true
    if (!currentUserId) {
      return () => {
        active = false
      }
    }

    fetch('/api/me')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load account status')
        return response.json() as Promise<{ user: AccountInfo }>
      })
      .then((data) => {
        if (active) setAccountState({ userId: currentUserId, account: data.user })
      })
      .catch(() => {
        if (active) setAccountState({ userId: currentUserId, account: null })
      })

    return () => {
      active = false
    }
  }, [currentUserId])

  const account =
    currentUserId && accountState?.userId === currentUserId
      ? accountState.account
      : null

  if (isPending) {
    return <span className="text-xs text-zinc-600">Checking account…</span>
  }

  if (!session?.user) {
    return (
      <Link
        to="/login"
        className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-bold text-zinc-950 transition hover:bg-amber-300"
      >
        Sign in with Google
      </Link>

    )
  }

  const isPendingApproval = account?.approvalStatus === 'pending'

  return (
    <div className="flex items-center gap-2">
      {account?.role === 'admin' && (
        <Link
          to="/admin"
          className="hidden rounded-lg border border-amber-400/20 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300 sm:inline-flex"
        >
          Admin
        </Link>
      )}
      {account?.isAnonymous && (
        <>
          <span className="rounded-lg border border-violet-400/20 bg-violet-400/5 px-2.5 py-1.5 text-[11px] text-violet-200">
            Guest mode · 5h
          </span>

          <button
            type="button"
            onClick={() => {
              void authClient.signIn.social({
                provider: 'google',
                callbackURL: '/',
              })
            }}
            className="rounded-lg bg-amber-400 px-3 py-2 text-[11px] font-bold text-zinc-950 hover:bg-amber-300"
          >
            Create account
          </button>
        </>
      )}

      {isPendingApproval && !account?.isAnonymous && (
        <span className="hidden rounded-lg border border-amber-400/20 bg-amber-400/5 px-2.5 py-1.5 text-[11px] text-amber-200 md:inline-flex">
          Awaiting approval
        </span>
      )}
      <button
        type="button"
        onClick={() => void authClient.signOut()}
        className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/5"
      >
        Sign out
      </button>
    </div>
  )
}

function LoginPage() {
  const { data: session, isPending } = authClient.useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function continueWithGoogle() {
    setBusy(true)
    setError('')
    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/',
      })
      if (result.error) setError(result.error.message ?? 'Google sign-in failed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  async function continueAsGuest() {
    setBusy(true)
    setError('')

    try {
      const result = await authClient.signIn.anonymous()

      if (result.error) {
        throw new Error(
          result.error.message ?? 'Could not start guest mode.'
        )
      }

      navigate('/')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not start guest mode.'
      )
    } finally {
      setBusy(false)
    }
  }

  if (session?.user) return <Navigate to="/" replace />

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400 text-zinc-950">
        <Clapperboard size={25} />
      </div>
      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-400">Welcome to the club</div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Your next favourite movie starts here.</h1>
      <p className="mt-3 max-w-md text-sm leading-7 text-zinc-500">
        Sign in with Google. New accounts receive a 24-hour approval window while the club admin reviews access.
      </p>
      <button
        type="button"
        disabled={busy || isPending}
        onClick={() => void continueWithGoogle()}
        className="mt-7 inline-flex items-center gap-3 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.73 7.18l7.64 5.93c4.46-4.12 7.13-10.2 7.13-17.58Z" />
          <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.87l-7.64-5.93c-2.12 1.42-4.84 2.27-8.26 2.27-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
        </svg>
        {busy ? 'Redirecting…' : 'Continue with Google'}
      </button>
      <button
        type="button"
        disabled={busy || isPending}
        onClick={() => void continueAsGuest()}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-50"
      >
        {busy ? 'Starting guest session…' : 'Continue as Guest'}
      </button>

      <p className="mt-3 text-xs leading-5 text-zinc-600">
        Explore Movie Hunt without registering. Guest accounts
        last for 5 hours. You can connect Google later to
        preserve your collection.
      </p>
      {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}
      <Link to="/" className="mt-6 text-xs text-zinc-500 hover:text-zinc-300">Back to Movie Hunt</Link>
    </div>
  )
}

type PendingUser = {
  id: string
  name: string
  email: string
  image: string | null
  createdAt: string | number | null
  approvalExpiresAt: number
}

async function fetchPendingUsers(): Promise<PendingUser[]> {
  const response = await fetch('/api/admin/pending-users')
  const data = await response.json() as { users?: PendingUser[]; error?: string }
  if (!response.ok) {
    throw new Error(data.error ?? 'Unable to load pending users. Make sure you are signed in as an admin.')
  }
  return data.users ?? []
}

function AdminPage() {
  const [users, setUsers] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadPendingUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setUsers(await fetchPendingUsers())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load pending users.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchPendingUsers()
      .then((pendingUsers) => {
        if (active) setUsers(pendingUsers)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load pending users.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function updateApproval(userId: string, action: 'approve' | 'reject') {
    setMessage('')
    setError('')
    try {
      const response = await fetch(`/api/admin/users/${userId}/${action}`, { method: 'POST' })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? `Could not ${action} user.`)
      setMessage(action === 'approve' ? 'User approved.' : 'User rejected and marked for deletion.')
      await loadPendingUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} user.`)
    }
  }

  return (
    <div>
      <PageIntro
        eyebrow="Club administration"
        title="Member approvals."
        description="Review new accounts. Approved members keep their accounts; unapproved accounts expire after 24 hours."
      />
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-zinc-300">Pending requests</span>
        <button onClick={() => void loadPendingUsers()} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5">Refresh</button>
      </div>
      {message && <p className="mb-4 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-300">{message}</p>}
      {error && <p className="mb-4 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-300">{error}</p>}
      {loading ? (
        <p className="text-sm text-zinc-500">Loading requests…</p>
      ) : users.length === 0 ? (
        <EmptyState icon={Users} title="No pending requests" description="New Google sign-ups will appear here for review." />
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <div key={user.id} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {user.image ? <img src={user.image} alt="" className="h-11 w-11 rounded-full object-cover" /> : <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-sm text-zinc-300">{user.name.slice(0, 1).toUpperCase()}</div>}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{user.name}</p>
                  <p className="truncate text-xs text-zinc-500">{user.email}</p>
                  <p className="mt-1 text-[11px] text-zinc-600">Expires: {new Date(user.approvalExpiresAt).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => void updateApproval(user.id, 'approve')} className="rounded-lg bg-emerald-400/15 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/25">Approve</button>
                <button onClick={() => void updateApproval(user.id, 'reject')} className="rounded-lg bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-400/20">Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [mode, setMode] = useState<MediaMode>(() => {
    if (typeof window === 'undefined') return 'movies'
    return window.localStorage.getItem('movie-hunt-mode') === 'anime' ? 'anime' : 'movies'
  })
  const navItems = getNavItems(mode)
  const pageTitle = navItems.find((item) => item.to === location.pathname)?.label
    ?? (location.pathname.startsWith('/movie/') ? 'Movie details'
      : location.pathname.startsWith('/anime/') ? 'Anime details' : 'Movie Hunt')

  function changeMode(nextMode: MediaMode) {
    setMode(nextMode)
    window.localStorage.setItem('movie-hunt-mode', nextMode)
    navigate('/')
  }

  return (
    <div className="min-h-screen text-zinc-100 lg:flex">
      <Sidebar mode={mode} onModeChange={changeMode} />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#09090b]/85 backdrop-blur-xl">
          <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-7 lg:px-10">
            <div className="flex items-center gap-3 lg:hidden">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-zinc-950 ${mode === 'movies' ? 'bg-amber-500' : 'bg-violet-300'}`}><Clapperboard size={19} /></div>
              <span className="font-bold tracking-tight text-white">movie<span className={mode === 'movies' ? 'text-amber-400' : 'text-violet-300'}>hunt</span></span>
            </div>
            <Link to="/discover" className="hidden h-10 w-full max-w-[390px] items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 text-sm text-zinc-500 transition hover:border-white/15 hover:text-zinc-300 sm:flex">
              <Search size={16} /> Search {mode === 'movies' ? 'movies' : 'anime'}, genres, people...
              <span className="ml-auto rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-zinc-600">/</span>
            </Link>
            <div className="ml-auto flex items-center gap-3"><ApiStatus /><AuthControl /></div>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 pb-36 pt-7 sm:px-7 sm:pt-9 lg:px-10 lg:pb-12">
          <div className="mb-7 flex items-center gap-2 text-xs text-zinc-600"><span>Movie Hunt</span><ChevronRight size={13} /><span className="text-zinc-400">{pageTitle}</span></div>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/" element={mode === 'movies' ? <HomePage /> : <AnimeHomePage />} />
            <Route path="/discover" element={mode === 'movies' ? <DiscoverPage /> : <AnimeDiscoverPage />} />
            <Route path="/movie/:id" element={<MovieDetailsPage />} />
            <Route path="/anime/:id" element={<AnimeDetailsPage />} />
            <Route path="/watchlist" element={mode === 'movies' ? <WatchlistPage /> : <AnimeWatchlistPage />} />
            <Route path="/ai" element={mode === 'movies' ? <AiPage /> : <AnimeAiPage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <footer className="mt-14 border-t border-white/[0.07] pt-6 text-center">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Credits &amp; attribution</p>
            {mode === 'movies' ? (
              <>
                <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center"><img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_long_2-9665a76b1ae401a510ec1e0ca40ddcb3b0cfe45f1d51b77a308fea0845885648.svg" alt="The Movie Database (TMDB)" className="h-5 w-auto" /></a>
                <p className="mt-2 text-[10px] text-zinc-600">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
              </>
            ) : (
              <>
                <a href="https://kitsu.io" target="_blank" rel="noreferrer" className="text-sm font-semibold text-violet-200 hover:text-violet-100">Kitsu</a>
                <p className="mt-2 text-[10px] text-zinc-600">Anime metadata provided by the Kitsu API. Movie Hunt is an independent student project.</p>
              </>
            )}
          </footer>
        </main>
        <MobileNav mode={mode} onModeChange={changeMode} />
      </div>
    </div>
  )
}

function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string
  title: string
  action?: ReactNode
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">
            {eyebrow}
          </div>
        )}
        <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h2>
      </div>
      {action}
    </div>
  )
}

function MovieCard({ movie }: { movie: TmdbMovie }) {
  const poster = tmdbImage(movie.poster_path, 'w500')
  const year = movie.release_date?.slice(0, 4) || 'Year unknown'
  return (
    <Link to={`/movie/${movie.id}`} className="group block min-w-0">
      <div className="relative aspect-[2/2.9] overflow-hidden rounded-xl border border-white/10 bg-zinc-900 shadow-lg shadow-black/20 transition duration-300 group-hover:-translate-y-1 group-hover:border-amber-300/30">
        {poster ? (
          <img src={poster} alt={`${movie.title} poster`} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-950 p-4 text-center text-sm font-semibold text-zinc-400">{movie.title}</div>
        )}
        <div className="absolute inset-x-2 top-2 flex justify-end">
          <span className="inline-flex items-center gap-1 rounded-md bg-black/75 px-2 py-1 text-[10px] font-semibold text-amber-200 backdrop-blur">
            <Star size={10} fill="currentColor" /> {movie.vote_average ? movie.vote_average.toFixed(1) : '—'}
          </span>
        </div>
      </div>
      <div className="mt-3 min-w-0">
        <h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-zinc-200 transition group-hover:text-amber-200">{movie.title}</h3>
        <p className="mt-1 text-xs text-zinc-500">{year}</p>
      </div>
    </Link>
  )
}

function MovieGrid({
  movies,
  loading,
  error,
  emptyMessage = 'No movies found.',
}: {
  movies: TmdbMovie[]
  loading: boolean
  error: string
  emptyMessage?: string
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
        <LoaderCircle size={17} className="animate-spin" /> Loading movies from TMDB…
      </div>
    )
  }
  if (error) {
    return <div className="rounded-xl border border-rose-400/15 bg-rose-400/5 p-4 text-sm text-rose-300">{error}</div>
  }
  if (movies.length === 0) {
    return <EmptyState icon={Film} title="Nothing to show" description={emptyMessage} />
  }
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-5 lg:gap-5">
      {movies.map((movie) => <MovieCard key={movie.id} movie={movie} />)}
    </div>
  )
}

function HomePage() {
  const trending = useTmdbData<TmdbMovieList>('/api/tmdb/trending?time_window=week')
  const popular = useTmdbData<TmdbMovieList>('/api/tmdb/popular')
  const featured = trending.data?.results?.[0]
  const featuredBackdrop = tmdbImage(featured?.backdrop_path, 'w1280')

  return (
    <div className="space-y-10">
      <section
        className="relative isolate overflow-hidden rounded-[26px] border border-amber-200/10 bg-[#17120e] bg-cover bg-center px-6 py-8 sm:px-9 sm:py-10 lg:px-12 lg:py-12"
        style={featuredBackdrop ? { backgroundImage: `linear-gradient(90deg, rgba(9,9,11,.97) 8%, rgba(9,9,11,.78) 55%, rgba(9,9,11,.25)), url(${featuredBackdrop})` } : undefined}
      >
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_78%_42%,rgba(190,112,43,0.25),transparent_42%),linear-gradient(110deg,rgba(12,12,14,0.98)_15%,rgba(21,17,15,0.9)_58%,rgba(16,14,14,0.75))]" />
        <div className="relative max-w-2xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-200/15 bg-amber-200/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200">
            <Sparkles size={12} /> This week on TMDB
          </div>
          <h1 className="max-w-xl text-4xl font-semibold leading-[1.08] tracking-[-0.045em] text-white sm:text-5xl lg:text-[58px]">
            Find your next <span className="block text-amber-300">favorite film.</span>
          </h1>
          {featured ? (
            <p className="mt-5 max-w-lg text-sm leading-7 text-zinc-300 sm:text-base">
              Trending now: <strong className="text-white">{featured.title}</strong>. Discover what people are watching and find your next movie night pick.
            </p>
          ) : (
            <p className="mt-5 max-w-lg text-sm leading-7 text-zinc-400 sm:text-base">
              Discover trending films, explore genres, and find something worth watching with your movie club.
            </p>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/discover" className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-zinc-950 transition hover:bg-amber-300">
              Explore movies <ArrowRight size={16} />
            </Link>
            <Link to="/watchlist" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.08]">
              <Bookmark size={15} /> My watchlist
            </Link>
          </div>
        </div>
        <div className="relative mt-9 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500 sm:mt-12">
          <span className="h-px w-7 bg-amber-400/70" /> Discover · Track · Recommend · Share
        </div>
      </section>

      <section>
        <SectionTitle
          eyebrow="Popular right now"
          title="Trending this week"
          action={<Link to="/discover" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-300 hover:text-amber-200">Browse all <ArrowUpRight size={14} /></Link>}
        />
        <MovieGrid movies={trending.data?.results ?? []} loading={trending.loading} error={trending.error} />
      </section>

      <section>
        <SectionTitle eyebrow="Discover something new" title="Popular movies" />
        <MovieGrid movies={popular.data?.results ?? []} loading={popular.loading} error={popular.error} />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Link to="/ai" className="group rounded-2xl border border-violet-300/10 bg-gradient-to-br from-violet-500/[0.09] to-white/[0.02] p-6 transition hover:border-violet-300/20">
          <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200"><Sparkles size={19} /></div>
          <div className="flex items-center justify-between"><h3 className="font-semibold text-white">Not sure what to watch?</h3><ArrowUpRight size={17} className="text-zinc-500 transition group-hover:text-violet-200" /></div>
          <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">Tell the AI what mood you're in and get movie ideas that fit.</p>
        </Link>
        <Link to="/friends" className="group rounded-2xl border border-amber-300/10 bg-gradient-to-br from-amber-500/[0.08] to-white/[0.02] p-6 transition hover:border-amber-300/20">
          <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-300/10 text-amber-200"><Users size={19} /></div>
          <div className="flex items-center justify-between"><h3 className="font-semibold text-white">Movies are better together</h3><ArrowUpRight size={17} className="text-zinc-500 transition group-hover:text-amber-200" /></div>
          <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">Build your private club and see what your friends recommend.</p>
        </Link>
      </section>
    </div>
  )
}

function DiscoverPage() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const genres = useTmdbData<{ genres: TmdbGenre[] }>('/api/tmdb/genres')

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 350)
    return () => window.clearTimeout(timeout)
  }, [query])

  const moviesUrl = debouncedQuery
    ? `/api/tmdb/search?query=${encodeURIComponent(debouncedQuery)}&page=${page}`
    : selectedGenre
      ? `/api/tmdb/discover?with_genres=${selectedGenre}&page=${page}`
      : `/api/tmdb/popular?page=${page}`
  const movies = useTmdbData<TmdbMovieList>(moviesUrl)

  function chooseGenre(id: number | null) {
    setSelectedGenre(id)
    setQuery('')
    setDebouncedQuery('')
    setPage(1)
  }

  return (
    <div>
      <PageIntro
        eyebrow="Explore the catalogue"
        title="Find something worth watching."
        description="Search the TMDB movie catalogue or browse popular films by genre."
      />
      <div className="mb-6 flex max-w-2xl items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
        <Search size={17} className="shrink-0 text-zinc-500" />
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(1) }}
          placeholder="Search movie titles..."
          className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
        />
        {query && <button type="button" onClick={() => setQuery('')} className="text-xs text-zinc-500 hover:text-white">Clear</button>}
      </div>

      <div className="mb-7">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Browse by genre</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => chooseGenre(null)} className={`rounded-full border px-3 py-2 text-xs transition ${selectedGenre === null ? 'border-amber-300/30 bg-amber-300/10 text-amber-200' : 'border-white/10 text-zinc-400 hover:bg-white/5'}`}>All movies</button>
          {genres.data?.genres?.map((genre) => (
            <button key={genre.id} onClick={() => chooseGenre(genre.id)} className={`rounded-full border px-3 py-2 text-xs transition ${selectedGenre === genre.id ? 'border-amber-300/30 bg-amber-300/10 text-amber-200' : 'border-white/10 text-zinc-400 hover:bg-white/5'}`}>
              {genre.name}
            </button>
          ))}
        </div>
        {genres.error && <p className="mt-2 text-xs text-rose-300">Could not load genres: {genres.error}</p>}
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-300">
          {debouncedQuery ? `Search results for “${debouncedQuery}”` : selectedGenre ? genres.data?.genres.find((genre) => genre.id === selectedGenre)?.name ?? 'Filtered movies' : 'Popular movies'}
        </h2>
        <span className="text-xs text-zinc-600">{movies.data?.total_results?.toLocaleString() ?? '—'} titles</span>
      </div>
      <MovieGrid movies={movies.data?.results ?? []} loading={movies.loading || (Boolean(query.trim()) && query.trim() !== debouncedQuery)} error={movies.error} emptyMessage="Try a different title or genre." />

      {movies.data && movies.data.total_pages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3">
          <button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-white/10 px-4 py-2 text-xs text-zinc-300 disabled:opacity-30">Previous</button>
          <span className="text-xs text-zinc-500">Page {page} of {Math.min(movies.data.total_pages, 500)}</span>
          <button disabled={page >= Math.min(movies.data.total_pages, 500)} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-white/10 px-4 py-2 text-xs text-zinc-300 disabled:opacity-30">Next</button>
        </div>
      )}
    </div>
  )
}

type WatchlistStatus = 'want_to_watch' | 'watching' | 'watched' | 'dropped'

type WatchlistEntry = {
  id: string
  tmdbId: number
  title: string
  overview: string
  posterPath: string | null
  backdropPath: string | null
  releaseDate: string | null
  voteAverage: number
  status: WatchlistStatus
  addedAt: number
  updatedAt: number
  watchedAt: number | null
  rating: number | null
  review: string | null
}

const watchlistStatusLabels: Record<WatchlistStatus, string> = {
  want_to_watch: 'Want to watch',
  watching: 'Watching',
  watched: 'Watched',
  dropped: 'Dropped',
}

function MovieLibraryControls({ movie }: { movie: TmdbMovieDetails }) {
  const { data: session, isPending: sessionLoading } = authClient.useSession()
  const [entry, setEntry] = useState<{ status: WatchlistStatus; watchedAt: number | null } | null>(null)
  const [rating, setRating] = useState('8')
  const [review, setReview] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingList, setSavingList] = useState(false)
  const [savingReview, setSavingReview] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const currentUserId = session?.user?.id

  useEffect(() => {
    if (!currentUserId) return
    let active = true
    fetch(`/api/watchlist/${movie.id}`)
      .then(async (response) => {
        const data = await response.json() as {
          item: { status: WatchlistStatus; watchedAt: number | null } | null
          review: { rating: number; review: string } | null
          message?: string
        }
        if (!response.ok) throw new Error(data.message ?? 'Could not load your movie data.')
        return data
      })
      .then((data) => {
        if (!active) return
        setEntry(data.item)
        if (data.review) {
          setRating(String(data.review.rating))
          setReview(data.review.review)
        }
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load your movie data.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [movie.id, currentUserId])

  async function saveWatchlist(status: WatchlistStatus) {
    setSavingList(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch(entry ? `/api/watchlist/${movie.id}` : '/api/watchlist', {
        method: entry ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry ? { status } : { tmdbId: movie.id, status }),
      })
      const data = await response.json() as { error?: string; message?: string }
      if (!response.ok) throw new Error(data.message ?? data.error ?? 'Could not save watchlist item.')
      setEntry({ status, watchedAt: status === 'watched' ? Date.now() : null })
      setMessage('Watchlist updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save watchlist item.')
    } finally {
      setSavingList(false)
    }
  }

  async function removeFromWatchlist() {
    setSavingList(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch(`/api/watchlist/${movie.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Could not remove this movie.')
      setEntry(null)
      setMessage('Removed from your watchlist.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this movie.')
    } finally {
      setSavingList(false)
    }
  }

  async function saveReview() {
    setSavingReview(true)
    setMessage('')
    setError('')
    try {
      const response = await fetch(`/api/reviews/${movie.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: Number(rating), review }),
      })
      const data = await response.json() as { error?: string; message?: string }
      if (!response.ok) throw new Error(data.message ?? data.error ?? 'Could not save your review.')
      setMessage('Your rating and review have been saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your review.')
    } finally {
      setSavingReview(false)
    }
  }

  if (sessionLoading) return <div className="mt-6 text-xs text-zinc-500">Checking your account…</div>
  if (!session?.user) {
    return <Link to="/login" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-3 text-xs font-bold text-zinc-950 hover:bg-amber-300"><Bookmark size={15} /> Sign in to save this movie</Link>
  }
  if (loading) return <div className="mt-6 text-xs text-zinc-500">Loading your library…</div>

  return (
    <div className="mt-7 grid gap-4 xl:grid-cols-2">
      <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="text-xs font-semibold text-white">Your watchlist</div>
        {entry ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={entry.status} disabled={savingList} onChange={(event) => void saveWatchlist(event.target.value as WatchlistStatus)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2.5 text-xs text-zinc-200 outline-none focus:border-amber-300/40">
              {Object.entries(watchlistStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button type="button" disabled={savingList} onClick={() => void removeFromWatchlist()} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/20 px-3 py-2.5 text-xs text-rose-300 hover:bg-rose-400/10 disabled:opacity-50"><Trash2 size={13} /> Remove</button>
          </div>
        ) : (
          <button type="button" disabled={savingList} onClick={() => void saveWatchlist('want_to_watch')} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-400 px-3.5 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-300 disabled:opacity-50"><Bookmark size={14} /> Add to watchlist</button>
        )}
        <p className="mt-2 text-[10px] text-zinc-500">Mark it as watching, watched, or dropped at any time.</p>
      </section>
      <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="text-xs font-semibold text-white">Your rating and review</div>
        <div className="mt-3 flex items-center gap-3">
          <label htmlFor="movie-rating" className="text-xs text-zinc-400">Rating</label>
          <select id="movie-rating" value={rating} onChange={(event) => setRating(event.target.value)} className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-amber-300/40">
            {Array.from({ length: 10 }, (_, index) => 10 - index).map((value) => <option key={value} value={value}>{value} / 10</option>)}
          </select>
        </div>
        <textarea value={review} onChange={(event) => setReview(event.target.value)} maxLength={2000} rows={3} placeholder="Write a short review (optional)…" className="mt-3 w-full resize-y rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2.5 text-xs leading-5 text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-amber-300/40" />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[10px] text-zinc-600">{review.length}/2000 characters</span>
          <button type="button" disabled={savingReview} onClick={() => void saveReview()} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-zinc-100 hover:bg-white/15 disabled:opacity-50">{savingReview ? 'Saving…' : 'Save review'}</button>
        </div>
      </section>
      {(message || error) && <p className={`text-xs xl:col-span-2 ${error ? 'text-rose-300' : 'text-emerald-300'}`}>{error || message}</p>}
    </div>
  )
}

function MovieDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const movie = useTmdbData<TmdbMovieDetails>(id ? `/api/tmdb/movie/${encodeURIComponent(id)}` : null)

  if (movie.loading) {
    return <div className="flex min-h-[45vh] items-center justify-center gap-3 text-sm text-zinc-400"><LoaderCircle className="animate-spin" size={20} /> Loading movie details…</div>
  }

  if (movie.error || !movie.data) {
    return (
      <div>
        <Link to="/discover" className="mb-6 inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-white"><ArrowLeft size={14} /> Back to discover</Link>
        <EmptyState icon={Film} title="Movie details unavailable" description={movie.error || 'This movie could not be found.'} action={<LinkButton to="/discover">Browse movies</LinkButton>} />
      </div>
    )
  }

  const item = movie.data
  const backdrop = tmdbImage(item.backdrop_path, 'w1280')
  const poster = tmdbImage(item.poster_path, 'w500')
  const trailer = item.videos?.results?.find((video) => video.site === 'YouTube' && video.type === 'Trailer')
  const directors = item.credits?.crew?.filter((person) => person.job === 'Director').map((person) => person.name) ?? []
  const runtime = item.runtime ? `${Math.floor(item.runtime / 60)}h ${item.runtime % 60}m` : null

  return (
    <div className="space-y-9">
      <Link to="/discover" className="inline-flex items-center gap-2 text-xs text-zinc-400 transition hover:text-white"><ArrowLeft size={14} /> Back to discover</Link>
      <section className="relative isolate overflow-hidden rounded-[26px] border border-white/10 bg-zinc-900 bg-cover bg-center p-5 sm:p-8 lg:p-10" style={backdrop ? { backgroundImage: `linear-gradient(90deg, rgba(9,9,11,.98) 8%, rgba(9,9,11,.88) 55%, rgba(9,9,11,.48)), url(${backdrop})` } : undefined}>
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-amber-950/20 to-zinc-950" />
        <div className="relative grid gap-7 sm:grid-cols-[190px_1fr] lg:grid-cols-[230px_1fr]">
          {poster ? <img src={poster} alt={`${item.title} poster`} className="mx-auto w-full max-w-[210px] rounded-xl border border-white/10 shadow-2xl sm:mx-0 lg:max-w-[230px]" /> : <div className="flex aspect-[2/3] max-w-[210px] items-center justify-center rounded-xl bg-zinc-800 text-sm text-zinc-500">No poster available</div>}
          <div className="flex flex-col justify-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">Movie details</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">{item.title} <span className="text-zinc-400">({item.release_date?.slice(0, 4) || '—'})</span></h1>
            {item.tagline && <p className="mt-3 text-sm italic text-zinc-300">{item.tagline}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-zinc-300">
              <span className="inline-flex items-center gap-1.5 text-amber-200"><Star size={13} fill="currentColor" /> {item.vote_average?.toFixed(1) ?? '—'} / 10</span>
              {runtime && <span className="inline-flex items-center gap-1.5"><Clock3 size={13} /> {runtime}</span>}
              {item.release_date && <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} /> {item.release_date}</span>}
              {item.original_language && <span className="rounded bg-white/10 px-2 py-1 uppercase">{item.original_language}</span>}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">{item.genres?.map((genre) => <span key={genre.id} className="rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-[11px] text-zinc-200">{genre.name}</span>)}</div>
            <h2 className="mt-7 text-sm font-semibold text-white">Overview</h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-zinc-300">{item.overview || 'No overview is available for this title.'}</p>
            <MovieLibraryControls movie={item} />
            {directors.length > 0 && <p className="mt-4 text-xs text-zinc-400">Directed by <span className="text-zinc-200">{directors.join(', ')}</span></p>}
            {trailer && <a href={`https://www.youtube.com/watch?v=${trailer.key}`} target="_blank" rel="noreferrer" className="mt-6 inline-flex w-fit items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-zinc-950 transition hover:bg-amber-300"><Play size={14} fill="currentColor" /> Watch trailer</a>}
          </div>
        </div>
      </section>

      {item.credits?.cast && item.credits.cast.length > 0 && (
        <section>
          <SectionTitle eyebrow="The people behind the film" title="Top cast" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {item.credits.cast.slice(0, 12).map((person) => (
              <div key={person.id} className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.025]">
                {person.profile_path ? <img src={tmdbImage(person.profile_path, 'w185') ?? ''} alt={person.name} loading="lazy" className="aspect-[4/5] w-full object-cover" /> : <div className="flex aspect-[4/5] items-center justify-center bg-zinc-900 text-xs text-zinc-600">No photo</div>}
                <div className="p-3"><p className="truncate text-xs font-semibold text-zinc-200">{person.name}</p><p className="mt-1 line-clamp-2 text-[10px] text-zinc-500">{person.character}</p></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {item.recommendations?.results && item.recommendations.results.length > 0 && (
        <section>
          <SectionTitle eyebrow="More like this" title="You might also like" />
          <MovieGrid movies={item.recommendations.results.slice(0, 10)} loading={false} error="" />
        </section>
      )}
    </div>
  )
}

function WatchlistPage() {
  const { data: session, isPending: sessionLoading } = authClient.useSession()
  const [items, setItems] = useState<WatchlistEntry[]>([])
  const [filter, setFilter] = useState<'all' | WatchlistStatus>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const currentUserId = session?.user?.id

  useEffect(() => {
    if (!currentUserId) return
    let active = true
    const query = filter === 'all' ? '' : `?status=${encodeURIComponent(filter)}`
    fetch(`/api/watchlist${query}`)
      .then(async (response) => {
        const data = await response.json() as { items?: WatchlistEntry[]; error?: string }
        if (!response.ok) throw new Error(data.error ?? 'Could not load your watchlist.')
        return data
      })
      .then((data) => {
        if (!active) return
        setItems(data.items ?? [])
        setError('')
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load your watchlist.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [filter, currentUserId])

  async function updateStatus(tmdbId: number, status: WatchlistStatus) {
    try {
      const response = await fetch(`/api/watchlist/${tmdbId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not update this movie.')
      setItems((current) => current.map((item) => item.tmdbId === tmdbId
        ? { ...item, status, watchedAt: status === 'watched' ? Date.now() : null }
        : item))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this movie.')
    }
  }

  async function removeItem(tmdbId: number) {
    try {
      const response = await fetch(`/api/watchlist/${tmdbId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Could not remove this movie.')
      setItems((current) => current.filter((item) => item.tmdbId !== tmdbId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this movie.')
    }
  }

  const filters: Array<{ value: 'all' | WatchlistStatus; label: string }> = [
    { value: 'all', label: 'All movies' },
    { value: 'want_to_watch', label: 'Want to watch' },
    { value: 'watching', label: 'Watching' },
    { value: 'watched', label: 'Watched history' },
    { value: 'dropped', label: 'Dropped' },
  ]

  if (sessionLoading) {
    return <div className="py-12 text-sm text-zinc-500">Checking your account…</div>
  }

  if (!session?.user) {
    return (
      <div>
        <PageIntro eyebrow="Your personal library" title="Your watchlist." description="Sign in to save movies, track your viewing history, and write personal reviews." />
        <EmptyState icon={Library} title="Sign in to access your library" description="Your watchlist and ratings are private to your account." action={<LinkButton to="/login">Sign in with Google</LinkButton>} />
      </div>
    )
  }

  return (
    <div>
      <PageIntro
        eyebrow="Your personal library"
        title="Your watchlist."
        description="Save films, track what you're watching, record what you've seen, and keep your personal reviews together."
      />
      <div className="mb-6 flex flex-wrap gap-2">
        {filters.map((item) => (
          <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={`rounded-full border px-3.5 py-2 text-xs font-medium transition ${filter === item.value ? 'border-amber-300/30 bg-amber-300/10 text-amber-200' : 'border-white/10 bg-white/[0.025] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'}`}>
            {item.label}
          </button>
        ))}
      </div>
      {error && <p className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-300">{error}</p>}
      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-zinc-500"><LoaderCircle size={17} className="animate-spin" /> Loading your movies…</div>
      ) : items.length === 0 ? (
        <EmptyState icon={Library} title={filter === 'all' ? 'Your watchlist is empty' : 'No movies in this section'} description="Discover a movie and add it to your personal library. You can also rate and review it from its details page." action={<LinkButton to="/discover">Discover movies</LinkButton>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const poster = tmdbImage(item.posterPath, 'w342')
            return (
              <article key={item.tmdbId} className="flex min-w-0 gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
                <Link to={`/movie/${item.tmdbId}`} className="h-32 w-[86px] shrink-0 overflow-hidden rounded-lg bg-zinc-900">
                  {poster ? <img src={poster} alt={`${item.title} poster`} loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-2 text-center text-[10px] text-zinc-500">No poster</div>}
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link to={`/movie/${item.tmdbId}`} className="line-clamp-2 text-sm font-semibold text-zinc-100 hover:text-amber-200">{item.title}</Link>
                  <p className="mt-1 text-[10px] text-zinc-500">{item.releaseDate?.slice(0, 4) || 'Year unknown'} · TMDB {item.voteAverage?.toFixed(1) ?? '—'}</p>
                  {item.rating !== null && <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-amber-200"><Star size={11} fill="currentColor" /> Your rating: {item.rating}/10</p>}
                  {item.review && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">“{item.review}”</p>}
                  <div className="mt-auto flex items-center gap-2 pt-3">
                    <select aria-label={`Status for ${item.title}`} value={item.status} onChange={(event) => void updateStatus(item.tmdbId, event.target.value as WatchlistStatus)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-2 py-2 text-[10px] text-zinc-300 outline-none focus:border-amber-300/40">
                      {Object.entries(watchlistStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <button type="button" onClick={() => void removeItem(item.tmdbId)} title="Remove from watchlist" aria-label={`Remove ${item.title}`} className="rounded-lg border border-white/10 p-2 text-zinc-500 hover:border-rose-400/20 hover:text-rose-300"><Trash2 size={13} /></button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
      <p className="mt-5 text-[10px] text-zinc-600">Watched history is based on movies marked as Watched. Each member's library and reviews are private to their account.</p>
    </div>
  )
}

type AiRecommendation = {
  movie: TmdbMovie
  score: number
  reason: string
}

type AiRecommendationResponse = {
  source: 'gemini' | 'algorithm'
  model: string | null
  aiStatus: 'used' | 'missing_key' | 'http_error' | 'invalid_response' | 'network_error' | 'blocked_response' | 'truncated_response'
  aiHttpStatus: number | null
  aiAttempts?: number
  aiDiagnostic?: string | null
  profile: {
    ratedMovies: number
    trackedMovies: number
    favoriteGenres: string[]
    requestedGenres: string[]
    personalized: boolean
  }
  recommendations: AiRecommendation[]
}

function AiPage() {
  const { data: session, isPending: sessionLoading } = authClient.useSession()
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AiRecommendationResponse | null>(null)

  const examplePrompts = [
    'A mind-bending science-fiction film with a clever twist',
    'A tense psychological thriller with a strong story',
    'An uplifting film that is not too predictable',
    'A mystery with atmosphere and memorable characters',
  ]

  async function generateRecommendations(requestText = prompt) {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: requestText.trim() }),
      })
      const data = await response.json() as AiRecommendationResponse & { message?: string; error?: string }
      if (!response.ok) {
        throw new Error(data.message ?? data.error ?? 'Could not generate recommendations.')
      }
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate recommendations.')
    } finally {
      setLoading(false)
    }
  }

  if (sessionLoading) {
    return <div className="py-12 text-sm text-zinc-500">Checking your account…</div>
  }

  if (!session?.user) {
    return (
      <div>
        <PageIntro eyebrow="Your movie companion" title="Recommendations that get your taste." description="Sign in to receive suggestions based on your own ratings and watch history." />
        <EmptyState icon={Sparkles} title="Your taste profile starts with you" description="Sign in and start rating movies. Your recommendations will be private to your account." action={<LinkButton to="/login">Sign in with Google</LinkButton>} />
      </div>
    )
  }

  return (
    <div className="space-y-7">
      <PageIntro
        eyebrow="Hybrid AI movie companion"
        title="What should we watch next?"
        description="The recommendation engine ranks real TMDB movies using your ratings and watch history, then asks Gemini to refine the shortlist and explain the matches."
      />

      <section className="rounded-2xl border border-violet-300/10 bg-gradient-to-br from-violet-500/[0.10] via-white/[0.025] to-transparent p-5 sm:p-7">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200"><Sparkles size={21} /></div>
          <div>
            <h2 className="font-semibold text-white">Tell us what you're in the mood for</h2>
            <p className="mt-1 text-xs text-zinc-500">Optional — leave blank to use your movie taste profile.</p>
          </div>
        </div>
        <form
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault()
            void generateRecommendations()
          }}
        >
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value.slice(0, 240))}
            maxLength={240}
            rows={3}
            placeholder="e.g. A cerebral sci-fi movie with an emotional story, preferably under 2.5 hours…"
            className="w-full resize-y rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-300/40"
          />
          <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-600">
            <span>Be as specific as you like.</span>
            <span>{prompt.length}/240</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {examplePrompts.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrompt(example)}
                className="rounded-full border border-violet-200/10 bg-black/20 px-3 py-2 text-left text-[11px] text-zinc-400 transition hover:border-violet-200/25 hover:text-violet-100"
              >
                {example}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-300 px-5 py-3 text-sm font-bold text-zinc-950 transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? 'Finding your next film…' : 'Generate recommendations'}
          </button>
        </form>
        <p className="mt-4 text-[10px] leading-5 text-zinc-600">
          Privacy: only your own movie titles, ratings and genre signals are used for personalization. When Gemini is configured, these preference signals and your optional prompt are sent to Google to generate recommendations. Your email and account details are not sent.
        </p>
      </section>

      {error && <div className="rounded-xl border border-rose-400/15 bg-rose-400/5 p-4 text-sm text-rose-300">{error}</div>}

      {loading && (
        <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.025] p-5 text-sm text-zinc-400">
          <LoaderCircle size={18} className="animate-spin text-violet-200" />
          Looking at your movie history and finding matching titles…
        </div>
      )}

      {result && !loading && (
        <section>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">Your recommendations</div>
              <h2 className="text-xl font-semibold text-white sm:text-2xl">Picked for your next movie night.</h2>
              <p className="mt-2 text-xs text-zinc-500">
                {result.profile.ratedMovies} rated · {result.profile.trackedMovies} tracked
                {result.profile.favoriteGenres.length > 0 ? ` · Taste: ${result.profile.favoriteGenres.join(', ')}` : ''}
                {result.profile.requestedGenres.length > 0 ? ` · Request focus: ${result.profile.requestedGenres.join(', ')}` : ''}
              </p>
            </div>
            <span className={`w-fit rounded-full border px-3 py-1.5 text-[10px] font-semibold ${result.source === 'gemini' ? 'border-violet-300/20 bg-violet-300/10 text-violet-200' : 'border-amber-300/20 bg-amber-300/10 text-amber-200'}`}>
              {result.source === 'gemini' ? `Gemini · ${result.model ?? 'AI reranked'}` : 'Taste-based algorithm'}
            </span>
          </div>

          {result.source === 'algorithm' && (
            <p className="mb-4 rounded-xl border border-amber-300/10 bg-amber-300/[0.04] p-3 text-xs leading-5 text-amber-100/75">
              {result.aiStatus === 'missing_key'
                ? 'Gemini is not configured. Showing prompt-aware local recommendations; add GEMINI_API_KEY to .dev.vars to enable AI reranking.'
                : result.aiStatus === 'http_error' && [500, 502, 503, 504].includes(result.aiHttpStatus ?? 0)
                  ? `Gemini is temporarily unavailable (HTTP ${result.aiHttpStatus}). We tried ${result.aiAttempts ?? 1} time(s); prompt-aware local recommendations are shown instead. Please try again shortly.`
                  : result.aiStatus === 'http_error' && result.aiHttpStatus === 429
                    ? 'Gemini rate limits or quota were reached. Check Google AI Studio usage and limits. Prompt-aware local recommendations are shown instead.'
                    : result.aiStatus === 'http_error' && [401, 403].includes(result.aiHttpStatus ?? 0)
                      ? 'Gemini rejected the API key or its permissions. Check GEMINI_API_KEY and the Google AI Studio project.'
                      : result.aiStatus === 'http_error' && result.aiHttpStatus === 404
                        ? 'The configured Gemini model was not found. Check GEMINI_MODEL against Google’s current model catalogue.'
                        : result.aiStatus === 'http_error'
                          ? `Gemini returned HTTP ${result.aiHttpStatus ?? 'error'}. Prompt-aware local recommendations are shown instead.`
                          : result.aiStatus === 'network_error'
                            ? 'Gemini could not be reached after retrying. Prompt-aware local recommendations are shown instead.'
                            : result.aiStatus === 'blocked_response'
                              ? 'Gemini did not return a candidate response for this request. Prompt-aware local recommendations are shown instead.'
                              : result.aiStatus === 'truncated_response'
                                ? 'Gemini stopped before completing its recommendation list. Prompt-aware local recommendations are shown instead.'
                                : `Gemini responded, but its JSON did not match the supplied movie candidates (${result.aiDiagnostic ?? 'unclassified response'}). Prompt-aware local recommendations are shown instead.`}
            </p>
          )}

          {!result.profile.personalized && (
            <p className="mb-4 rounded-xl border border-amber-300/10 bg-amber-300/[0.04] p-3 text-xs leading-5 text-amber-100/75">
              Your taste profile is still developing. Explicit request genres and catalogue quality are prioritized until more ratings and watch history are available.
            </p>
          )}

          {result.recommendations.length === 0 ? (
            <EmptyState icon={Sparkles} title="No recommendations found" description="Try a different request or add and rate a few movies first." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {result.recommendations.map((recommendation, index) => {
                const movie = recommendation.movie
                const poster = tmdbImage(movie.poster_path, 'w500')
                return (
                  <article key={movie.id} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
                    <Link to={`/movie/${movie.id}`} className="group flex gap-3 p-3">
                      <div className="h-36 w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
                        {poster ? <img src={poster} alt={`${movie.title} poster`} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center p-2 text-center text-xs text-zinc-500">No poster</div>}
                      </div>
                      <div className="min-w-0 flex-1 py-1">
                        <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.16em] text-violet-300">Pick #{index + 1}</div>
                        <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-100 group-hover:text-violet-200">{movie.title}</h3>
                        <p className="mt-1 text-[10px] text-zinc-500">{movie.release_date?.slice(0, 4) || 'Year unknown'} · TMDB {movie.vote_average?.toFixed(1) ?? '—'}</p>
                        <div className="mt-3 inline-flex items-center gap-1 rounded-md bg-amber-300/10 px-2 py-1 text-[10px] font-semibold text-amber-200"><Star size={10} fill="currentColor" /> Match score {recommendation.score}%</div>
                      </div>
                    </Link>
                    <div className="border-t border-white/[0.06] px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">Why this movie?</p>
                      <p className="mt-1.5 text-xs leading-5 text-zinc-400">{recommendation.reason}</p>
                      <Link to={`/movie/${movie.id}`} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-200 hover:text-amber-100">View movie details <ArrowRight size={12} /></Link>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}


function FriendsPage() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <div className="flex min-h-[300px] items-center justify-center gap-3 text-sm text-zinc-500">
        <LoaderCircle className="animate-spin" size={18} />
        Checking authentication…
      </div>
    )
  }

  if (!session?.user) {
    return (
      <div>
        <PageIntro
          eyebrow="Your private movie club"
          title="Friends & community."
          description="Connect with approved Movie Hunt members and share your favourite movies and anime."
        />

        <EmptyState
          icon={Users}
          title="Sign in to access your community"
          description="Your friends, incoming requests, shared recommendations and activity feed are available after signing in."
          action={
            <LinkButton to="/login">
              Sign in with Google
            </LinkButton>
          }
        />
      </div>
    )
  }

  return <SocialFriendsPage />
}


function ProfilePage() {
  const { data: session, isPending } = authClient.useSession()
  const userId = session?.user?.id

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingName, setSavingName] = useState(false)
  const [savingPrivacy, setSavingPrivacy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!userId) return

    let active = true

    fetch('/api/profile')
      .then(async (response) => {
        const data = await response.json() as ProfileData & {
          error?: string
        }

        if (!response.ok) {
          throw new Error(data.error ?? 'Could not load profile.')
        }

        return data
      })
      .then((data) => {
        if (!active) return
        setProfile(data)
        setName(data.user.name)
      })
      .catch((err) => {
        if (active) {
          setError(
            err instanceof Error ? err.message : 'Could not load profile.'
          )
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [userId])

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    setSavingName(true)

    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      const data = await response.json() as {
        name?: string
        message?: string
        error?: string
      }

      if (!response.ok) {
        throw new Error(data.message ?? data.error ?? 'Could not update name.')
      }

      setName(data.name ?? name)

      setProfile((current) =>
        current
          ? {
            ...current,
            user: { ...current.user, name: data.name ?? name },
          }
          : current
      )

      setNotice('Your profile name has been updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update name.')
    } finally {
      setSavingName(false)
    }
  }

  async function updatePrivacy(
    changes: Partial<ProfileData['privacy']>
  ) {
    if (!profile) return

    const nextPrivacy = {
      ...profile.privacy,
      ...changes,
    }

    setSavingPrivacy(true)
    setError('')
    setNotice('')

    try {
      const response = await fetch('/api/social/privacy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextPrivacy),
      })

      const data = await response.json() as {
        error?: string
        privacy?: ProfileData['privacy']
      }

      if (!response.ok) {
        throw new Error(data.error ?? 'Could not save privacy settings.')
      }

      setProfile((current) =>
        current
          ? { ...current, privacy: data.privacy ?? nextPrivacy }
          : current
      )

      setNotice('Privacy settings saved.')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not update privacy.'
      )
    } finally {
      setSavingPrivacy(false)
    }
  }

  if (isPending) {
    return <p className="text-sm text-zinc-500">Checking account…</p>
  }

  if (!session?.user) {
    return (
      <EmptyState
        icon={UserRound}
        title="Sign in to view your profile"
        description="Your movie collection, anime history and personal statistics live here."
        action={<LinkButton to="/login">Sign in</LinkButton>}
      />
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center gap-3 text-sm text-zinc-500">
        <LoaderCircle className="animate-spin" size={18} />
        Loading your profile…
      </div>
    )
  }

  if (!profile) {
    return (
      <EmptyState
        icon={UserRound}
        title="Couldn't load your profile"
        description={error || 'Please try refreshing the page.'}
      />
    )
  }

  const stats = [
    {
      label: 'Movies watched',
      value: profile.stats.movies.watched,
      icon: Film,
    },
    {
      label: 'Anime completed',
      value: profile.stats.anime.watched,
      icon: Heart,
    },
    {
      label: 'Total reviews',
      value:
        profile.stats.movies.reviewed +
        profile.stats.anime.reviewed,
      icon: Star,
    },
    {
      label: 'Friends',
      value: profile.stats.friends,
      icon: Users,
    },
  ]

  const genres = [
    ...profile.favoriteGenres.movies.map((genre) => ({
      ...genre,
      mediaType: 'Movie',
    })),
    ...profile.favoriteGenres.anime.map((genre) => ({
      ...genre,
      mediaType: 'Anime',
    })),
  ]

  return (
    <div className="space-y-8">
      <PageIntro
        eyebrow="Your account"
        title="Your movie identity."
        description="Your personal collection, movie history, anime journey and community profile."
      />

      {error && (
        <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {/* Account header */}
      <section className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-amber-400/[0.08] to-transparent p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {profile.user.image ? (
            <img
              src={profile.user.image}
              alt={profile.user.name}
              className="h-20 w-20 rounded-2xl border border-white/10 object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10 text-3xl font-semibold text-white">
              {profile.user.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold text-white">
                {profile.user.name}
              </h2>

              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase text-emerald-300">
                {profile.user.approvalStatus}
              </span>

              {profile.user.role === 'admin' && (
                <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase text-amber-300">
                  Administrator
                </span>
              )}
            </div>

            <p className="mt-1 text-sm text-zinc-400">
              {profile.user.email}
            </p>

            <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
              <CalendarDays size={14} />
              Member since{' '}
              {new Date(profile.user.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </section>

      {/* Statistics */}
      <section>
        <SectionTitle eyebrow="Your collection" title="Your statistics" />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((item) => {
            const Icon = item.icon

            return (
              <div
                key={item.label}
                className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"
              >
                <Icon size={19} className="text-amber-300" />
                <p className="mt-4 text-2xl font-semibold text-white">
                  {item.value}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {item.label}
                </p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Movie and anime statistics */}
      <section className="grid gap-4 lg:grid-cols-2">
        {[
          {
            title: 'Movie collection',
            stats: profile.stats.movies,
            color: 'text-amber-300',
          },
          {
            title: 'Anime collection',
            stats: profile.stats.anime,
            color: 'text-violet-300',
          },
        ].map((collection) => (
          <div
            key={collection.title}
            className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"
          >
            <h3 className="font-semibold text-white">
              {collection.title}
            </h3>

            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xl font-semibold text-white">
                  {collection.stats.tracked}
                </p>
                <p className="text-xs text-zinc-500">Tracked</p>
              </div>

              <div>
                <p className="text-xl font-semibold text-white">
                  {collection.stats.watching}
                </p>
                <p className="text-xs text-zinc-500">Watching</p>
              </div>

              <div>
                <p className="text-xl font-semibold text-white">
                  {collection.stats.watched}
                </p>
                <p className="text-xs text-zinc-500">Completed</p>
              </div>

              <div>
                <p className="text-xl font-semibold text-white">
                  {collection.stats.reviewed}
                </p>
                <p className="text-xs text-zinc-500">Reviews</p>
              </div>

              <div>
                <p className={`text-xl font-semibold ${collection.color}`}>
                  {collection.stats.averageRating.toFixed(1)}/10
                </p>
                <p className="text-xs text-zinc-500">Average rating</p>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Favourite genres */}
      <section>
        <SectionTitle
          eyebrow="Your taste"
          title="Favourite genres"
        />

        {genres.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-zinc-500">
            Rate some movies and anime to discover your favourite genres.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {genres.map((genre, index) => (
              <div
                key={`${genre.mediaType}-${genre.name}-${index}`}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <span className="text-sm font-medium text-zinc-200">
                  {genre.name}
                </span>
                <span className="ml-2 text-[10px] text-zinc-500">
                  {genre.mediaType} · {genre.averageRating}/10
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent activity */}
      <section>
        <SectionTitle eyebrow="Recently updated" title="Your activity" />

        {profile.recentActivity.length === 0 ? (
          <EmptyState
            icon={Clock3}
            title="Your journey starts here"
            description="Add movies or anime to your watchlist to see your activity here."
            action={<LinkButton to="/discover">Discover movies</LinkButton>}
          />
        ) : (
          <div className="space-y-3">
            {profile.recentActivity.map((item) => {
              const poster =
                item.mediaType === 'movie'
                  ? tmdbImage(item.poster, 'w92')
                  : item.poster

              const destination =
                item.mediaType === 'movie'
                  ? `/movie/${item.mediaId}`
                  : `/anime/${item.mediaId}`

              return (
                <Link
                  key={`${item.mediaType}-${item.mediaId}`}
                  to={destination}
                  className="flex items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 transition hover:bg-white/[0.05]"
                >
                  {poster ? (
                    <img
                      src={poster}
                      alt=""
                      className="h-16 w-11 rounded-md object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-16 w-11 items-center justify-center rounded-md bg-white/5">
                      <Film size={17} className="text-zinc-500" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs capitalize text-zinc-500">
                      {item.mediaType} · {item.status.replace(/_/g, ' ')}
                    </p>
                    <p className="mt-1 text-[10px] text-zinc-600">
                      {new Date(item.updatedAt).toLocaleDateString()}
                    </p>
                  </div>

                  {item.rating !== null && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-amber-300">
                      <Star size={13} fill="currentColor" />
                      {item.rating}/10
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Edit profile */}
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 sm:p-6">
        <SectionTitle eyebrow="Account settings" title="Edit profile" />

        <form onSubmit={(event) => void saveName(event)} className="max-w-lg">
          <label className="mb-2 block text-xs font-medium text-zinc-400">
            Display name
          </label>

          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={40}
            required
            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-400/50"
          />

          <button
            type="submit"
            disabled={savingName || name.trim().length < 2}
            className="mt-4 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-zinc-950 transition hover:bg-amber-300 disabled:opacity-50"
          >
            {savingName ? 'Saving…' : 'Save profile'}
          </button>
        </form>

        <p className="mt-3 text-xs text-zinc-600">
          Your Google email and account permissions cannot be changed here.
        </p>
      </section>

      {/* Privacy settings */}
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 sm:p-6">
        <SectionTitle eyebrow="Community" title="Privacy settings" />

        <div className="space-y-5">
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">
                Share my activity with friends
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                Let accepted friends see your movie and anime watchlist activity and reviews.
              </p>
            </div>

            <input
              type="checkbox"
              checked={profile.privacy.shareActivity}
              disabled={savingPrivacy}
              onChange={(event) =>
                void updatePrivacy({ shareActivity: event.target.checked })
              }
              className="mt-1 h-4 w-4 accent-amber-400"
            />
          </label>

          <div className="border-t border-white/[0.07]" />

          <label className="flex cursor-pointer items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">
                Allow friend requests
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                Let other approved Movie Hunt members send you friend requests.
              </p>
            </div>

            <input
              type="checkbox"
              checked={profile.privacy.allowFriendRequests}
              disabled={savingPrivacy}
              onChange={(event) =>
                void updatePrivacy({
                  allowFriendRequests: event.target.checked,
                })
              }
              className="mt-1 h-4 w-4 accent-amber-400"
            />
          </label>
        </div>

        {savingPrivacy && (
          <p className="mt-4 text-xs text-zinc-500">
            Saving privacy settings…
          </p>
        )}
      </section>
    </div>
  )
}


function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="mb-8 max-w-2xl">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">
        {eyebrow}
      </div>
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
      <p className="mt-3 text-sm leading-7 text-zinc-500">{description}</p>
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-amber-300">
        <Icon size={23} />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-zinc-200">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

function LinkButton({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-bold text-zinc-950 transition hover:bg-amber-300"
    >
      {children} <ArrowRight size={14} />
    </Link>
  )
}

export default function App() {
  return <AppShell />
}
