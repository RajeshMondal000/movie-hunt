# Movie Hunt Rate-Limit Policy

**Policy version:** 1.0  
**Default AI model:** `gemini-3.5-flash-lite`  
**Deployment target:** Cloudflare Workers Free + D1 Free  
**Scope:** Movie Hunt API, including TMDB, Kitsu, Gemini, watchlists, reviews, profile, and social features.

## 1. Goals

The policy is designed to:

- Protect the shared TMDB, Kitsu, and Gemini credentials from accidental loops and abuse.
- Give the sole Movie Hunt administrator a substantially higher allowance than guests and normal members.
- Keep guest access useful while limiting the impact of disposable accounts.
- Protect D1 from excessive writes.
- Preserve local algorithmic recommendations when Gemini quotas are exhausted.
- Avoid adding Redis, Upstash, paid Durable Objects, or another paid rate-limiting service.

## 2. Account tiers

| Tier | Identification | Application access |
|---|---|---|
| Public visitor | No active session; keyed by Cloudflare client IP | Public discovery only |
| Guest | Better Auth anonymous account (`isAnonymous = true`) | Discovery, personal lists, reviews, AI fallback/AI within quota; no member directory, friend requests, or recommendation sharing |
| Registered member | Google account; pending or approved | Normal member limits for ordinary features. Social actions still require approval. |
| Administrator | `role = admin` | Highest application limits; admin endpoints still enforce the admin role |

Pending Google accounts receive registered-member limits for ordinary discovery, library, and AI features. They cannot send friend requests or share recommendations until approved.

## 3. Minute-level limits

All values below are per account identity (or per IP for public visitors/authentication) and use a 60-second window.

### General API and discovery

| Category | Public | Guest | Registered | Administrator |
|---|---:|---:|---:|---:|
| General API | 30/min | 60/min | 180/min | 600/min |
| Catalogue discovery (popular/trending/details/genres) | 20/min | 20/min | 60/min | 180/min |
| Movie/anime search | 8/min | 8/min | 24/min | 60/min |
| Watchlist/review mutations | — | 10/min | 30/min | 120/min |
| AI recommendation submissions | — | 1/min | 3/min | 10/min |
| Member directory and social reads | — | Guest write limiter (10/min) | 30/min | 120/min |
| Profile update | — | Blocked | 5/min | 30/min |
| Admin endpoints | — | — | General limit only; admin role is still required | 30/min |

The general allowance applies to all non-authentication API requests. The category allowance is an additional endpoint-specific bucket, not a replacement for the general allowance. Discovery includes TMDB trending, popular, discover, genres and movie details, plus Kitsu popular and anime details. Search routes receive a separate search bucket.

### Authentication and guest creation

| Operation | Limit |
|---|---:|
| Google sign-in attempts | 5/min/IP |
| Guest sign-in attempts | 2/min/IP |
| Guest account creation | 10/day/IP |

Authentication and guest-creation limits use a SHA-256-derived key from Cloudflare's `cf-connecting-ip` header. The raw address is not stored in D1, and the application does not trust browser-supplied `X-Forwarded-For` values.

## 4. Daily D1 quotas

Daily quotas use D1 counters and reset at midnight Pacific Time. They are shared across the Movies and Anime libraries where indicated.

| Operation | Guest | Registered | Administrator |
|---|---:|---:|---:|
| Watchlist and review mutation attempts combined | 40/day | 120/day | 2,000/day |
| Friend requests | Not allowed | 10/day (approved only) | 50/day |
| Recommendation shares | Not allowed | 20/day (approved only) | 100/day |

The daily library quota counts mutation attempts to the movie/anime watchlist and review endpoints. This is deliberately conservative: invalid mutation attempts can consume an allowance too, preventing repeated malformed requests from becoming a cheap write-amplification path.

The admin dashboard is additionally capped at 30 requests/minute. The 2,000/day library budget is not an authorization grant: all admin operations continue to require `role = admin`.

## 5. Gemini safeguards

| Model | RPM | TPM | RPD |
|---|---:|---:|---:|
| Gemini 3.5 Flash-Lite | 15 | 250,000 | 500 |

Movie Hunt uses `gemini-3.5-flash-lite` as its default because it provides a much larger request allowance for this short structured recommendation/explanation task.

### Application-level Gemini limits

| Limit | Guest | Registered | Administrator |
|---|---:|---:|---:|
| AI submissions/minute (Cloudflare local burst limit) | 1 | 3 | 10 |
| AI recommendation submissions/day (D1 counter) | 3 | 12 | 400 |

Additional project-wide D1 counters enforce:

- **12 actual Gemini API attempts in any rolling 60-second window** across Movie and Anime recommendations.
- **450 actual Gemini API attempts per Pacific calendar day** across all Movie Hunt users.

An AI submission is one request to Movie Hunt's Movie or Anime recommendation endpoint. It consumes one per-user daily allowance. An actual Gemini attempt means one outbound `generateContent` request. A retry consumes another shared provider attempt, but does not consume another per-user submission. This distinction prevents one flaky Gemini response from using up all of a member's daily recommendation submissions.

The shared 450/day application ceiling leaves a 50-request margin below the 500 RPD shown in the owner's AI Studio screenshot. The 12/min application ceiling leaves headroom below the 15 RPM shown there. These are safeguards, not a guarantee that Google's quota will never change or be consumed by another application using the same Google project.

When the shared Gemini provider budget is exhausted, Movie Hunt returns the existing prompt-aware local recommendations. The separate per-user AI-submission allowance is a hard daily submission cap; once reached, the recommendation endpoint returns HTTP 429 until the Pacific-time daily reset.

If D1 is unavailable at the per-user AI-submission gate, the route returns HTTP 503 before doing recommendation work. If D1 is unavailable when reserving a shared Gemini attempt, the Gemini call is blocked and the existing local algorithm fallback is returned. The provider quota store is fail-closed so a temporary D1 failure cannot silently bypass the shared model budget.

## 6. Enforcement architecture

### Cloudflare Rate Limiting bindings

Used for minute-level burst protection after the Worker starts. Bindings are keyed by authenticated user ID; unauthenticated requests and authentication endpoints use the Cloudflare client IP.

Cloudflare documents these bindings as approximate and location-local. They are intentionally not the authoritative daily quota system. A burst may exceed a configured value while local counters synchronize, and different Cloudflare locations maintain separate counters.

### D1 `rate_limit_counters`

The D1 table stores compact counters keyed by `(bucket_key, window_key)`. It is used only for low-volume quotas:

- guest account creation per IP/day;
- combined library writes per user/day;
- friend requests and recommendation shares per user/day;
- per-user AI recommendation submissions/day;
- shared Gemini actual attempts/day and per-minute.

The Gemini reservation helper atomically inserts one event into the shared daily bucket and one event into the rolling 60-second bucket. If a later reservation fails, it compensates for earlier reservations. Per-user AI submission limits use a separate counter written once before recommendation processing. A failed compensation can only over-count and deny early; it cannot grant extra quota.

Expired counter rows are deleted by the existing 15-minute scheduled cleanup.

## 7. HTTP response behavior

Minute-level and daily quota denials return HTTP `429` with JSON similar to:

```json
{
  "error": "daily_write_limit_exceeded",
  "message": "You have reached your daily watchlist and review update limit. Please try again after the daily reset.",
  "retryAfter": 3600
}
```

The response includes a `Retry-After` header and `Cache-Control: no-store`.

If D1 is unavailable while a strict quota must be checked, the Worker returns HTTP `503` with `quota_store_unavailable` rather than allowing an unmetered operation.

Gemini quota exhaustion is different: the recommendation endpoint returns the normal recommendation response with its algorithmic source/status so the UI can show local recommendations.

## 8. Free-tier considerations

Cloudflare's published Workers Free limit is 100,000 requests/day. D1 Free includes 5 million rows read/day and 100,000 rows written/day, with daily limits enforced. The rate-limit implementation avoids D1 writes on ordinary GET/search requests; D1 counters are used only for daily mutations, guest account creation, and actual Gemini API attempts.

At the 450-attempt/day Gemini ceiling, each actual outbound Gemini attempt performs two conditional event-row inserts (global-day and rolling 60-second window), plus only occasional compensation updates. A separate per-user AI-submission counter is written once per Movie Hunt recommendation submission, not once per Gemini retry. This is a small fraction of D1's 100,000-row daily write allowance, before counting normal application writes.

Cloudflare Rate Limiting bindings are configured in Wrangler and do not require a separate Redis or third-party service. Their accuracy limitations remain important; the strict Gemini quotas are enforced by D1 instead.
