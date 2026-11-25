import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Activity, Bell, Check, Film, LoaderCircle, Search, Send, ShieldCheck, Trash2, Tv, UserPlus, Users, X } from 'lucide-react'

type SocialMember = { id: string; name: string; image: string | null; relationship: 'friends' | 'incoming' | 'outgoing' | 'none'; friendshipId: string | null }
type Relationship = { id: string; status: string; createdAt: number; requestedByMe: boolean; member: { id: string; name: string; image: string | null } | null }
type ActivityItem = { user: { id: string; name: string; image: string | null }; mediaType: 'movie' | 'anime'; title: string; poster: string | null; status: string; rating: number | null; review: string | null; updatedAt: number }
type SharedItem = { id: string; mediaType: 'movie' | 'anime'; mediaId: string; title: string; posterUrl: string | null; message: string; createdAt: number; readAt: number | null; senderId: string; senderName: string; senderImage: string | null }
type Privacy = { shareActivity: boolean; allowFriendRequests: boolean }

async function socialRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
  return data
}

function Avatar({ name, image }: { name: string; image: string | null }) {
  return image
    ? <img src={image} alt="" className="h-10 w-10 rounded-full border border-white/10 object-cover" />
    : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-300/10 text-sm font-semibold text-violet-100">{name.slice(0, 1).toUpperCase()}</div>
}

export function SocialFriendsPage() {
  const [friends, setFriends] = useState<Relationship[]>([])
  const [incoming, setIncoming] = useState<Relationship[]>([])
  const [outgoing, setOutgoing] = useState<Relationship[]>([])
  const [members, setMembers] = useState<SocialMember[]>([])
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [shares, setShares] = useState<SharedItem[]>([])
  const [privacy, setPrivacy] = useState<Privacy>({ shareActivity: false, allowFriendRequests: true })
  const [query, setQuery] = useState('')
  const [shareRecipient, setShareRecipient] = useState('')
  const [shareType, setShareType] = useState<'movie' | 'anime'>('movie')
  const [shareId, setShareId] = useState('')
  const [shareTitle, setShareTitle] = useState('')
  const [shareMessage, setShareMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [canSendFriendRequests, setCanSendFriendRequests] = useState(false)
  const [isGuest, setIsGuest] = useState(false)

  const loadOverview = useCallback(async () => {
    const [friendData, feedData, shareData, privacyData, memberData, accountData] = await Promise.all([
      socialRequest<{ friends: Relationship[]; incomingRequests: Relationship[]; outgoingRequests: Relationship[] }>('/api/social/friends'),
      socialRequest<{ activities: ActivityItem[] }>('/api/social/feed'),
      socialRequest<{ shares: SharedItem[] }>('/api/social/shares/inbox'),
      socialRequest<{ privacy: Privacy }>('/api/social/privacy'),
      socialRequest<{ members: SocialMember[] }>('/api/social/members'),
      socialRequest<{ user: { isAnonymous: boolean; approvalStatus: string } }>('/api/me'),
    ])
    setFriends(friendData.friends)
    setIncoming(friendData.incomingRequests)
    setOutgoing(friendData.outgoingRequests)
    setActivities(feedData.activities)
    setShares(shareData.shares)
    setPrivacy(privacyData.privacy)
    setMembers(memberData.members)
    setIsGuest(accountData.user.isAnonymous === true)
    setCanSendFriendRequests(
      !accountData.user.isAnonymous &&
      accountData.user.approvalStatus === 'approved'
    )
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([
      socialRequest<{ friends: Relationship[]; incomingRequests: Relationship[]; outgoingRequests: Relationship[] }>('/api/social/friends'),
      socialRequest<{ activities: ActivityItem[] }>('/api/social/feed'),
      socialRequest<{ shares: SharedItem[] }>('/api/social/shares/inbox'),
      socialRequest<{ privacy: Privacy }>('/api/social/privacy'),
      socialRequest<{ members: SocialMember[] }>('/api/social/members'),
      socialRequest<{ user: { isAnonymous: boolean; approvalStatus: string } }>('/api/me'),
    ]).then(([friendData, feedData, shareData, privacyData, memberData, accountData,]) => {
      if (!active) return
      setFriends(friendData.friends)
      setIncoming(friendData.incomingRequests)
      setOutgoing(friendData.outgoingRequests)
      setActivities(feedData.activities)
      setShares(shareData.shares)
      setPrivacy(privacyData.privacy)
      setMembers(memberData.members)
      setIsGuest(accountData.user.isAnonymous === true)
      setCanSendFriendRequests(
        !accountData.user.isAnonymous &&
        accountData.user.approvalStatus === 'approved'
      )
      setError('')
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load your movie club.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  async function refresh() {
    setLoading(true)
    setError('')
    try { await loadOverview() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not refresh your movie club.') }
    finally { setLoading(false) }
  }

  async function searchMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusyId('search')
    setError('')
    try {
      const data = await socialRequest<{ members: SocialMember[] }>(`/api/social/members?query=${encodeURIComponent(query.trim())}`)
      setMembers(data.members)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not search members.') }
    finally { setBusyId('') }
  }

  async function sendRequest(userId: string) {
    setBusyId(userId); setError(''); setNotice('')
    try { await socialRequest('/api/social/requests', { method: 'POST', body: JSON.stringify({ targetUserId: userId }) }); setNotice('Friend request sent.'); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not send friend request.') }
    finally { setBusyId('') }
  }

  async function requestAction(id: string, action: 'accept' | 'decline' | 'cancel') {
    setBusyId(id); setError(''); setNotice('')
    try {
      const url = action === 'cancel' ? `/api/social/requests/${id}` : `/api/social/requests/${id}/${action}`
      await socialRequest(url, { method: action === 'cancel' ? 'DELETE' : 'POST' })
      setNotice(action === 'accept' ? 'Friend request accepted.' : action === 'decline' ? 'Friend request declined.' : 'Friend request cancelled.')
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update friend request.') }
    finally { setBusyId('') }
  }

  async function removeFriend(userId: string) {
    if (!window.confirm('Remove this friend? They will no longer see your shared activity.')) return
    setBusyId(userId); setError(''); setNotice('')
    try { await socialRequest(`/api/social/friends/${userId}`, { method: 'DELETE' }); setNotice('Friend removed.'); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not remove friend.') }
    finally { setBusyId('') }
  }

  async function updatePrivacy(next: Privacy) {
    setPrivacy(next); setError('')
    try {
      const data = await socialRequest<{ privacy: Privacy }>('/api/social/privacy', { method: 'PUT', body: JSON.stringify(next) })
      setPrivacy(data.privacy)
      setNotice('Privacy settings saved.')
      const feed = await socialRequest<{ activities: ActivityItem[] }>('/api/social/feed')
      setActivities(feed.activities)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save privacy settings.'); await refresh() }
  }

  async function shareRecommendation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusyId('share'); setError(''); setNotice('')
    try {
      await socialRequest('/api/social/shares', { method: 'POST', body: JSON.stringify({ recipientId: shareRecipient, mediaType: shareType, mediaId: shareId.trim(), title: shareTitle.trim(), message: shareMessage.trim() }) })
      setNotice('Recommendation shared with your friend.')
      setShareId(''); setShareTitle(''); setShareMessage('')
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not share recommendation.') }
    finally { setBusyId('') }
  }

  async function markShareRead(id: string) {
    try {
      await socialRequest(`/api/social/shares/${id}/read`, { method: 'POST' })
      setShares((items) => items.map((item) => item.id === id ? { ...item, readAt: Date.now() } : item))
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update recommendation.') }
  }

  const sectionClass = 'rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 sm:p-5'
  const headingClass = 'mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-100'

  if (loading) return <div className="flex min-h-[320px] items-center justify-center gap-3 text-sm text-zinc-500"><LoaderCircle className="animate-spin" size={18} /> Loading your movie club…</div>

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">Your private movie club</p><h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Friends & community.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">Find approved members, share recommendations and see the activity your friends choose to share.</p></div>
        <button onClick={() => void refresh()} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-white/5">Refresh</button>
      </header>
      {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-xs text-rose-200">{error}</p>}
      {notice && <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs text-emerald-200">{notice}</p>}

      {!canSendFriendRequests && (
        <div className="rounded-xl border border-violet-300/15 bg-violet-300/[0.05] p-4">
          <p className="text-sm font-semibold text-violet-200">
            Community access is limited
          </p>

          <p className="mt-1 text-xs leading-5 text-zinc-400">
            You can explore the community, but sending friend
            requests requires an approved Google account.
          </p>
        </div>
      )}

      <section className={sectionClass}>
        <h2 className={headingClass}><ShieldCheck size={17} className="text-violet-200" /> Your privacy</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-black/20 p-3"><input type="checkbox" checked={privacy.shareActivity} onChange={(event) => void updatePrivacy({ ...privacy, shareActivity: event.target.checked })} className="mt-1 accent-violet-400" /><span><span className="block text-xs font-semibold text-zinc-200">Share my activity with friends</span><span className="mt-1 block text-[11px] leading-5 text-zinc-500">Friends can see your existing and future movie/anime list statuses, ratings and review text. Off by default.</span></span></label>
          <label className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-black/20 p-3"><input type="checkbox" checked={privacy.allowFriendRequests} onChange={(event) => void updatePrivacy({ ...privacy, allowFriendRequests: event.target.checked })} className="mt-1 accent-violet-400" /><span><span className="block text-xs font-semibold text-zinc-200">Allow friend requests</span><span className="mt-1 block text-[11px] leading-5 text-zinc-500">Approved members can send you friend requests. On by default.</span></span></label>
        </div>
      </section>

      {!isGuest && (
        <section className={sectionClass}>
          <h2 className={headingClass}><Search size={17} className="text-violet-200" /> Find members</h2>
          <form onSubmit={searchMembers} className="mb-4 flex flex-col gap-2 sm:flex-row">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search approved members by name…" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-violet-300/40" />
            <button disabled={busyId === 'search'} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-300 px-4 py-2.5 text-xs font-bold text-zinc-950 disabled:opacity-60"><Search size={14} /> Search</button>
          </form>
          {members.length === 0 ? <p className="text-xs text-zinc-500">No matching members. Try another name.</p> : <div className="grid gap-2 sm:grid-cols-2">{members.map((person) => <div key={person.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/15 p-3"><Avatar name={person.name} image={person.image} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-zinc-100">{person.name}</p><p className="text-[10px] text-zinc-600">{person.relationship === 'friends' ? 'Friend' : person.relationship === 'incoming' ? 'Request received' : person.relationship === 'outgoing' ? 'Request sent' : 'Movie Hunt member'}</p></div>{person.relationship === 'none' && canSendFriendRequests && <button disabled={busyId === person.id} onClick={() => void sendRequest(person.id)} className="rounded-lg border border-violet-300/20 px-2.5 py-2 text-[10px] font-semibold text-violet-200 hover:bg-violet-300/10"><UserPlus size={13} /></button>}{person.relationship === 'incoming' && person.friendshipId && <button onClick={() => void requestAction(person.friendshipId!, 'accept')} className="rounded-lg bg-emerald-400/15 px-2.5 py-2 text-[10px] font-semibold text-emerald-200"><Check size={13} /></button>}{person.relationship === 'outgoing' && person.friendshipId && <button onClick={() => void requestAction(person.friendshipId!, 'cancel')} className="rounded-lg border border-white/10 px-2.5 py-2 text-[10px] text-zinc-400"><X size={13} /></button>}</div>)}</div>}
        </section>)}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={sectionClass}>
          <h2 className={headingClass}><Users size={17} className="text-violet-200" /> Your friends <span className="ml-auto rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-zinc-400">{friends.length}</span></h2>
          {friends.length === 0 ? <p className="text-xs text-zinc-500">You haven't added any friends yet.</p> : <div className="space-y-2">{friends.map((row) => row.member && <div key={row.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] p-3"><Avatar name={row.member.name} image={row.member.image} /><p className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100">{row.member.name}</p><button disabled={busyId === row.member.id} onClick={() => void removeFriend(row.member!.id)} className="rounded-lg border border-white/10 p-2 text-zinc-500 hover:border-rose-300/20 hover:text-rose-200" title="Remove friend"><Trash2 size={13} /></button></div>)}</div>}
        </section>
        <section className={sectionClass}>
          <h2 className={headingClass}><Bell size={17} className="text-violet-200" /> Friend requests <span className="ml-auto rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-zinc-400">{incoming.length + outgoing.length}</span></h2>
          {incoming.length === 0 && outgoing.length === 0 ? <p className="text-xs text-zinc-500">No pending requests.</p> : <div className="space-y-3">{incoming.map((row) => row.member && <div key={row.id} className="flex items-center gap-3"><Avatar name={row.member.name} image={row.member.image} /><p className="min-w-0 flex-1 text-xs text-zinc-200">{row.member.name}<span className="block text-[10px] text-zinc-600">Wants to connect</span></p><button onClick={() => void requestAction(row.id, 'accept')} className="rounded-lg bg-emerald-400/15 p-2 text-emerald-200"><Check size={14} /></button><button onClick={() => void requestAction(row.id, 'decline')} className="rounded-lg bg-rose-400/10 p-2 text-rose-200"><X size={14} /></button></div>)}{outgoing.map((row) => row.member && <div key={row.id} className="flex items-center gap-3"><Avatar name={row.member.name} image={row.member.image} /><p className="min-w-0 flex-1 text-xs text-zinc-300">{row.member.name}<span className="block text-[10px] text-zinc-600">Request pending</span></p><button onClick={() => void requestAction(row.id, 'cancel')} className="rounded-lg border border-white/10 px-2.5 py-2 text-[10px] text-zinc-400">Cancel</button></div>)}</div>}
        </section>
      </div>

      <section className={sectionClass}>
        <h2 className={headingClass}><Send size={17} className="text-violet-200" /> Share a recommendation</h2>
        {friends.length === 0 ? <p className="text-xs text-zinc-500">Add a friend before sharing a movie or anime recommendation.</p> : <form onSubmit={shareRecommendation} className="grid gap-3 sm:grid-cols-2">
          <select value={shareRecipient} onChange={(event) => setShareRecipient(event.target.value)} required className="rounded-xl border border-white/10 bg-[#17171a] px-3 py-2.5 text-xs text-zinc-200"><option value="">Choose a friend</option>{friends.map((row) => row.member && <option key={row.member.id} value={row.member.id}>{row.member.name}</option>)}</select>
          <select value={shareType} onChange={(event) => setShareType(event.target.value as 'movie' | 'anime')} className="rounded-xl border border-white/10 bg-[#17171a] px-3 py-2.5 text-xs text-zinc-200"><option value="movie">Movie (TMDB ID)</option><option value="anime">Anime (Kitsu ID)</option></select>
          <input value={shareId} onChange={(event) => setShareId(event.target.value)} placeholder={shareType === 'movie' ? 'TMDB movie ID' : 'Kitsu anime ID'} required className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-600" />
          <input value={shareTitle} onChange={(event) => setShareTitle(event.target.value)} placeholder="Movie or anime title" required className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-600" />
          <textarea value={shareMessage} onChange={(event) => setShareMessage(event.target.value)} placeholder="Add a message (optional)" maxLength={400} className="min-h-20 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 sm:col-span-2" />
          <button disabled={busyId === 'share'} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-300 px-4 py-2.5 text-xs font-bold text-zinc-950 disabled:opacity-60 sm:col-span-2"><Send size={14} /> Share recommendation</button>
        </form>}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={sectionClass}>
          <h2 className={headingClass}><Activity size={17} className="text-violet-200" /> Friends' activity</h2>
          {!privacy.shareActivity && activities.length === 0 ? <p className="text-xs leading-5 text-zinc-500">Your friends haven't enabled activity sharing yet. You can enable your own sharing above.</p> : activities.length === 0 ? <p className="text-xs text-zinc-500">No recent activity yet.</p> : <div className="space-y-3">{activities.map((item, index) => <div key={`${item.user.id}-${item.mediaType}-${item.title}-${item.updatedAt}-${index}`} className="flex gap-3 rounded-xl border border-white/[0.06] p-3"><Avatar name={item.user.name} image={item.user.image} /><div className="min-w-0 flex-1"><p className="text-xs text-zinc-300"><strong className="text-zinc-100">{item.user.name}</strong> {item.status === 'watched' || item.status === 'completed' ? 'watched' : item.status === 'watching' ? 'is watching' : item.status === 'dropped' ? 'dropped' : 'added'} <strong className="text-violet-100">{item.title}</strong></p><p className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">{item.mediaType === 'anime' ? <Tv size={11} /> : <Film size={11} />} {item.mediaType === 'anime' ? 'Anime' : 'Movie'} · {new Date(item.updatedAt).toLocaleDateString()}</p>{item.rating !== null && <p className="mt-1 text-[10px] text-amber-200">Rated {item.rating}/10</p>}{item.review && <p className="mt-2 line-clamp-3 text-[11px] leading-5 text-zinc-500">“{item.review}”</p>}</div></div>)}</div>}
        </section>
        <section className={sectionClass}>
          <h2 className={headingClass}><Send size={17} className="text-violet-200" /> Recommendations shared with you <span className="ml-auto rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-zinc-400">{shares.filter((share) => !share.readAt).length} new</span></h2>
          {shares.length === 0 ? <p className="text-xs text-zinc-500">Recommendations shared by your friends will appear here.</p> : <div className="space-y-3">{shares.map((share) => <div key={share.id} className={`rounded-xl border p-3 ${share.readAt ? 'border-white/[0.06]' : 'border-violet-300/20 bg-violet-300/[0.04]'}`}><div className="flex items-center gap-2"><Avatar name={share.senderName} image={share.senderImage} /><p className="min-w-0 flex-1 text-xs text-zinc-300"><strong className="text-zinc-100">{share.senderName}</strong> recommended</p>{!share.readAt && <button onClick={() => void markShareRead(share.id)} className="text-[10px] font-semibold text-violet-200">Mark read</button>}</div><div className="mt-3 flex items-center gap-3"><div className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/5">{share.posterUrl ? <img src={share.posterUrl} alt="" className="h-full w-full object-cover" /> : share.mediaType === 'anime' ? <Tv size={18} /> : <Film size={18} />}</div><div><p className="text-xs font-semibold text-white">{share.title}</p><p className="mt-1 text-[10px] text-zinc-500">{share.mediaType === 'anime' ? 'Anime' : 'Movie'} recommendation</p>{share.message && <p className="mt-2 text-[11px] text-zinc-400">{share.message}</p>}</div></div></div>)}</div>}
        </section>
      </div>
    </div>
  )
}
