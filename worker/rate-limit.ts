/**
 * Movie Hunt rate limiting and daily quota helpers.
 *
 * Minute-level limits use Cloudflare Rate Limiting bindings (approximate,
 * location-local). Daily quotas use D1 counters and are the authoritative
 * limits for writes, social actions, and Gemini API attempts.
 */

export type RateLimitBinding = {
  limit(options: { key: string; delta?: number }): Promise<{ success: boolean }>
}

export type RateLimitBindings = {
  RL_GENERAL_PUBLIC?: RateLimitBinding
  RL_GENERAL_GUEST?: RateLimitBinding
  RL_GENERAL_MEMBER?: RateLimitBinding
  RL_GENERAL_ADMIN?: RateLimitBinding

  RL_DISCOVERY_GUEST?: RateLimitBinding
  RL_DISCOVERY_MEMBER?: RateLimitBinding
  RL_DISCOVERY_ADMIN?: RateLimitBinding

  RL_SEARCH_GUEST?: RateLimitBinding
  RL_SEARCH_MEMBER?: RateLimitBinding
  RL_SEARCH_ADMIN?: RateLimitBinding

  RL_WRITE_GUEST?: RateLimitBinding
  RL_WRITE_MEMBER?: RateLimitBinding
  RL_WRITE_ADMIN?: RateLimitBinding

  RL_AI_GUEST?: RateLimitBinding
  RL_AI_MEMBER?: RateLimitBinding
  RL_AI_ADMIN?: RateLimitBinding

  RL_SOCIAL_MEMBER?: RateLimitBinding
  RL_SOCIAL_ADMIN?: RateLimitBinding

  RL_PROFILE_MEMBER?: RateLimitBinding
  RL_PROFILE_ADMIN?: RateLimitBinding

  RL_ADMIN_ACTION?: RateLimitBinding
  RL_AUTH_IP?: RateLimitBinding
  RL_GUEST_CREATE_IP?: RateLimitBinding
}

export type RateLimitMember = {
  id: string
  role?: string
  approvalStatus?: string
  isAnonymous?: boolean
}

export type RateLimitEnv = RateLimitBindings & {
  movie_hunt_db: D1Database
}

type Tier = 'public' | 'guest' | 'member' | 'admin'
type Category = 'general' | 'discovery' | 'search' | 'write' | 'ai' | 'social' | 'profile' | 'admin'

type Counter = {
  bucketKey: string
  windowKey: string
  limit: number
  expiresAt: number
}

const DAY_TTL_MS = 9 * 24 * 60 * 60 * 1000

function getTier(member: RateLimitMember | null): Tier {
  if (!member) return 'public'
  if (member.role === 'admin') return 'admin'
  if (member.isAnonymous || member.role === 'guest') return 'guest'
  return 'member'
}

async function getClientIpKey(request: Request): Promise<string> {
  // Hash the Cloudflare-provided address so the D1 daily guest-creation quota
  // never stores a raw IP address. Do not trust browser-supplied forwarded headers.
  const address = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address))
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function getPacificDayKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function getPacificWallClockParts(instant: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]))
}

function getPacificOffsetMs(instant: Date): number {
  const parts = getPacificWallClockParts(instant)
  const wallClockAsUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  )
  return wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000
}

export function getDailyQuotaRetryAfterSeconds(now = new Date()): number {
  const local = getPacificWallClockParts(now)
  const nextMidnightAsUtc = Date.UTC(
    local.year ?? 1970,
    (local.month ?? 1) - 1,
    (local.day ?? 1) + 1,
    0,
    0,
    0,
  )

  // Start with today's Pacific offset, then correct against the formatted
  // target. This handles the 23/25-hour daylight-saving transition days.
  let target = nextMidnightAsUtc - getPacificOffsetMs(now)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getPacificWallClockParts(new Date(target))
    const actualWallAsUtc = Date.UTC(
      actual.year ?? 1970,
      (actual.month ?? 1) - 1,
      actual.day ?? 1,
      actual.hour ?? 0,
      actual.minute ?? 0,
      actual.second ?? 0,
    )
    const difference = actualWallAsUtc - nextMidnightAsUtc
    if (difference === 0) break
    target -= difference
  }

  return Math.max(1, Math.ceil((target - now.getTime()) / 1000))
}

function makeRateLimitResponse(
  error: string,
  message: string,
  retryAfterSeconds = 60,
): Response {
  return new Response(JSON.stringify({
    error,
    message,
    retryAfter: retryAfterSeconds,
  }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': String(retryAfterSeconds),
    },
  })
}

function makeUnavailableResponse(): Response {
  return new Response(JSON.stringify({
    error: 'quota_store_unavailable',
    message: 'Usage limits could not be checked. Please try again shortly.',
  }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '60',
    },
  })
}

async function hitBinding(
  binding: RateLimitBinding | undefined,
  key: string,
  label: string,
): Promise<Response | null> {
  if (!binding) {
    // Keep local development usable if a binding was not generated yet, but
    // make the missing production binding visible in Worker logs.
    console.error(`Rate-limit binding ${label} is missing; this limit is not active.`)
    return null
  }

  try {
    const result = await binding.limit({ key })
    return result.success
      ? null
      : makeRateLimitResponse('rate_limit_exceeded', 'Too many requests. Please slow down and try again.')
  } catch (error) {
    // Cloudflare's native limiter is burst protection, not the authoritative
    // daily quota store. If it fails, keep the app available and log it.
    console.error(`Rate-limit binding ${label} failed:`, error)
    return null
  }
}

function getGeneralBinding(env: RateLimitEnv, tier: Tier): RateLimitBinding | undefined {
  switch (tier) {
    case 'public': return env.RL_GENERAL_PUBLIC
    case 'guest': return env.RL_GENERAL_GUEST
    case 'admin': return env.RL_GENERAL_ADMIN
    default: return env.RL_GENERAL_MEMBER
  }
}

function getCategoryBinding(env: RateLimitEnv, tier: Tier, category: Category): RateLimitBinding | undefined {
  if (category === 'general') return undefined

  if (category === 'discovery') {
    return tier === 'admin' ? env.RL_DISCOVERY_ADMIN
      : tier === 'member' ? env.RL_DISCOVERY_MEMBER
        : env.RL_DISCOVERY_GUEST
  }

  if (category === 'search') {
    return tier === 'admin' ? env.RL_SEARCH_ADMIN
      : tier === 'member' ? env.RL_SEARCH_MEMBER
        : env.RL_SEARCH_GUEST
  }

  if (category === 'write') {
    return tier === 'admin' ? env.RL_WRITE_ADMIN
      : tier === 'member' ? env.RL_WRITE_MEMBER
        : env.RL_WRITE_GUEST
  }

  if (category === 'ai') {
    return tier === 'admin' ? env.RL_AI_ADMIN
      : tier === 'member' ? env.RL_AI_MEMBER
        : env.RL_AI_GUEST
  }

  if (category === 'social') {
    if (tier === 'admin') return env.RL_SOCIAL_ADMIN
    if (tier === 'member') return env.RL_SOCIAL_MEMBER
    // Guests can only hit the small, non-mutating subset of social routes.
    return env.RL_WRITE_GUEST
  }

  if (category === 'profile') {
    if (tier === 'admin') return env.RL_PROFILE_ADMIN
    if (tier === 'member') return env.RL_PROFILE_MEMBER
    return env.RL_WRITE_GUEST
  }

  return tier === 'admin' ? env.RL_ADMIN_ACTION : undefined
}

function classifyRequest(path: string, method: string): Category {
  if (path.startsWith('/api/admin/')) return 'admin'
  if (path === '/api/recommendations' || path === '/api/anime/recommendations') return 'ai'
  if (path.startsWith('/api/social/')) return 'social'
  if (path === '/api/profile' && method === 'PATCH') return 'profile'
  if (path.endsWith('/search')) return 'search'
  if (
    path === '/api/tmdb/trending' || path === '/api/tmdb/popular' ||
    path === '/api/tmdb/discover' || path === '/api/tmdb/genres' || path === '/api/movies' ||
    path.startsWith('/api/tmdb/movie/') || path === '/api/anime/popular' ||
    /^\/api\/anime\/\d+$/.test(path)
  ) return 'discovery'

  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  const isLibraryPath =
    path === '/api/watchlist' || path.startsWith('/api/watchlist/') ||
    path.startsWith('/api/reviews/') ||
    path === '/api/anime/watchlist' || path.startsWith('/api/anime/watchlist/') ||
    path.startsWith('/api/anime/reviews/')

  return isMutation && isLibraryPath ? 'write' : 'general'
}

async function incrementCounter(env: RateLimitEnv, counter: Counter): Promise<boolean> {
  const now = Date.now()
  const result = await env.movie_hunt_db.prepare(`
    INSERT INTO rate_limit_counters
      (bucket_key, window_key, count, expires_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(bucket_key, window_key) DO UPDATE SET
      count = rate_limit_counters.count + 1,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
    WHERE rate_limit_counters.count < ?
    RETURNING count
  `).bind(
    counter.bucketKey,
    counter.windowKey,
    counter.expiresAt,
    now,
    counter.limit,
  ).all<{ count: number }>()

  return (result.results?.length ?? 0) > 0
}

async function consumeDailyCounter(
  env: RateLimitEnv,
  bucketKey: string,
  limit: number,
  now = Date.now(),
): Promise<{ allowed: boolean; unavailable?: boolean }> {
  try {
    const allowed = await incrementCounter(env, {
      bucketKey,
      windowKey: getPacificDayKey(new Date(now)),
      limit,
      expiresAt: now + DAY_TTL_MS,
    })
    return { allowed }
  } catch (error) {
    console.error('Could not check daily quota:', error)
    return { allowed: false, unavailable: true }
  }
}

/**
 * Atomically insert one event only if fewer than `limit` events are still active.
 * Using per-attempt event rows gives the Gemini RPM guard a true rolling 60s
 * window instead of a fixed clock-minute bucket that could burst at boundaries.
 */
async function reserveRollingEvent(
  env: RateLimitEnv,
  bucketKey: string,
  limit: number,
  expiresAt: number,
  now: number,
): Promise<string | null> {
  const eventId = crypto.randomUUID()
  const result = await env.movie_hunt_db.prepare(`
    INSERT INTO rate_limit_counters
      (bucket_key, window_key, count, expires_at, updated_at)
    SELECT ?, ?, 1, ?, ?
    WHERE (
      SELECT COALESCE(SUM(count), 0)
      FROM rate_limit_counters
      WHERE bucket_key = ? AND expires_at > ?
    ) < ?
    RETURNING window_key
  `).bind(
    bucketKey,
    eventId,
    expiresAt,
    now,
    bucketKey,
    now,
    limit,
  ).all<{ window_key: string }>()

  return result.results?.[0]?.window_key ?? null
}

async function removeReservedEvent(
  env: RateLimitEnv,
  bucketKey: string,
  eventId: string,
): Promise<void> {
  await env.movie_hunt_db.prepare(`
    DELETE FROM rate_limit_counters WHERE bucket_key = ? AND window_key = ?
  `).bind(bucketKey, eventId).run()
}

function isLibraryMutation(path: string, method: string): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false
  return path === '/api/watchlist' || path.startsWith('/api/watchlist/') ||
    path.startsWith('/api/reviews/') ||
    path === '/api/anime/watchlist' || path.startsWith('/api/anime/watchlist/') ||
    path.startsWith('/api/anime/reviews/')
}

function getDailyWriteLimit(tier: Tier): number {
  if (tier === 'guest') return 40
  if (tier === 'admin') return 2_000
  return 120
}

/** Consume one AI recommendation submission per user (not per retry). */
export async function consumeAiSubmissionQuota(
  env: RateLimitEnv,
  member: RateLimitMember,
): Promise<{ allowed: boolean; reason?: string }> {
  const tier = getTier(member)
  const dailyLimit = tier === 'guest' ? 3 : tier === 'admin' ? 400 : 12
  const now = Date.now()
  const result = await consumeDailyCounter(
    env,
    `ai-submissions:user:${member.id}`,
    dailyLimit,
    now,
  )
  if (result.unavailable) return { allowed: false, reason: 'quota_store_unavailable' }
  return result.allowed ? { allowed: true } : { allowed: false, reason: 'user_daily_ai_limit' }
}

/**
 * Called once for every actual Gemini HTTP attempt, including retries.
 * The provider-wide 12 requests per rolling 60 seconds and 450 per Pacific day
 * are strict D1 event counters shared by Movies and Anime.
 */
export async function consumeGeminiAttemptQuota(
  env: RateLimitEnv,
): Promise<{ allowed: boolean; reason?: string }> {
  const now = Date.now()
  const dayKey = getPacificDayKey(new Date(now))
  const dailyBucket = `gemini:global:daily:${dayKey}`
  const minuteBucket = 'gemini:global:rolling-minute'
  let dailyEventId: string | null = null

  try {
    dailyEventId = await reserveRollingEvent(
      env,
      dailyBucket,
      450,
      now + DAY_TTL_MS,
      now,
    )
    if (!dailyEventId) return { allowed: false, reason: 'gemini_daily_limit' }

    const minuteEventId = await reserveRollingEvent(
      env,
      minuteBucket,
      12,
      now + 60_000,
      now,
    )
    if (!minuteEventId) {
      try { await removeReservedEvent(env, dailyBucket, dailyEventId) }
      catch (rollbackError) { console.error('Could not roll back Gemini daily event:', rollbackError) }
      return { allowed: false, reason: 'gemini_rpm_limit' }
    }

    return { allowed: true }
  } catch (error) {
    if (dailyEventId) {
      try { await removeReservedEvent(env, dailyBucket, dailyEventId) }
      catch (rollbackError) { console.error('Could not roll back Gemini daily event:', rollbackError) }
    }
    console.error('Could not check shared Gemini quota:', error)
    return { allowed: false, reason: 'quota_store_unavailable' }
  }
}

/**
 * Apply minute burst limits and low-volume D1 daily limits to an API request.
 * A null member means an unauthenticated public visitor.
 */
export async function enforceRequestRateLimits(
  request: Request,
  env: RateLimitEnv,
  member: RateLimitMember | null,
): Promise<Response | null> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method.toUpperCase()
  const tier = getTier(member)
  const identity = member
    ? `user:${member.id}`
    : `ip:${await getClientIpKey(request)}`

  const generalResponse = await hitBinding(
    getGeneralBinding(env, tier),
    identity,
    `general_${tier}`,
  )
  if (generalResponse) return generalResponse

  const category = classifyRequest(path, method)
  const categoryBinding = getCategoryBinding(env, tier, category)
  if (category === 'profile' && tier === 'guest' && method === 'PATCH') {
    return new Response(JSON.stringify({
      error: 'guest_profile_edit_unavailable',
      message: 'Create a Google account to edit your profile.',
    }), { status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
  }

  if (categoryBinding) {
    const categoryResponse = await hitBinding(categoryBinding, identity, `${category}_${tier}`)
    if (categoryResponse) return categoryResponse
  }

  // Daily write budget shared by movie and anime watchlist/review mutations.
  if (member && isLibraryMutation(path, method)) {
    const daily = await consumeDailyCounter(
      env,
      `library-writes:user:${member.id}`,
      getDailyWriteLimit(tier),
    )
    if (daily.unavailable) return makeUnavailableResponse()
    if (!daily.allowed) {
      return makeRateLimitResponse(
        'daily_write_limit_exceeded',
        'You have reached your daily watchlist and review update limit. Please try again after the daily reset.',
        getDailyQuotaRetryAfterSeconds(),
      )
    }
  }

  // Friend requests require an approved, non-guest account. The Worker route
  // independently enforces this rule; this block only meters valid-tier users.
  if (
    member && path === '/api/social/requests' && method === 'POST' &&
    !member.isAnonymous && member.role !== 'guest' && member.approvalStatus === 'approved'
  ) {
    const limit = tier === 'admin' ? 50 : 10
    const daily = await consumeDailyCounter(env, `friend-requests:user:${member.id}`, limit)
    if (daily.unavailable) return makeUnavailableResponse()
    if (!daily.allowed) {
      return makeRateLimitResponse(
        'daily_friend_request_limit_exceeded',
        'You have reached your daily friend-request limit.',
        getDailyQuotaRetryAfterSeconds(),
      )
    }
  }

  if (member && path === '/api/social/shares' && method === 'POST') {
    if (member.isAnonymous || member.role === 'guest' || member.approvalStatus !== 'approved') {
      return new Response(JSON.stringify({
        error: 'approval_required',
        message: 'Sharing recommendations requires an approved Google account.',
      }), { status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
    }
    const limit = tier === 'admin' ? 100 : 20
    const daily = await consumeDailyCounter(env, `recommendation-shares:user:${member.id}`, limit)
    if (daily.unavailable) return makeUnavailableResponse()
    if (!daily.allowed) {
      return makeRateLimitResponse(
        'daily_share_limit_exceeded',
        'You have reached your daily recommendation-sharing limit.',
        getDailyQuotaRetryAfterSeconds(),
      )
    }
  }

  return null
}

/** Apply IP-based protection to sign-in and anonymous account creation. */
export async function enforceAuthRateLimits(
  request: Request,
  env: RateLimitEnv,
): Promise<Response | null> {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()
  const path = url.pathname
  const isSignIn = method === 'POST' && path.startsWith('/api/auth/sign-in/')
  const isCallback = method === 'GET' && path.startsWith('/api/auth/callback/')
  if (!isSignIn && !isCallback) return null

  const ipKey = await getClientIpKey(request)
  const authResponse = await hitBinding(env.RL_AUTH_IP, `ip:${ipKey}`, 'auth_ip')
  if (authResponse) return authResponse

  if (path === '/api/auth/sign-in/anonymous') {
    const guestBurstResponse = await hitBinding(
      env.RL_GUEST_CREATE_IP,
      `ip:${ipKey}`,
      'guest_create_ip',
    )
    if (guestBurstResponse) return guestBurstResponse

    const daily = await consumeDailyCounter(env, `guest-create:ip:${ipKey}`, 10)
    if (daily.unavailable) return makeUnavailableResponse()
    if (!daily.allowed) {
      return makeRateLimitResponse(
        'daily_guest_creation_limit_exceeded',
        'This network has reached its daily guest-session creation limit. Please sign in with Google or try again after the daily reset.',
        getDailyQuotaRetryAfterSeconds(),
      )
    }
  }

  return null
}
