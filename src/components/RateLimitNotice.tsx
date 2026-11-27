
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, X, Clock3 } from 'lucide-react'
import { authClient } from '../lib/auth-client'
import type { RateLimitNoticeDetail } from '../lib/rate-limit-interceptor'

type RateLimitNoticeProps = {
  signedIn: boolean
  isGuest: boolean
}

function formatRetryAfter(seconds: number) {
  if (seconds >= 3600) {
    return `${Math.ceil(seconds / 3600)} hour(s)`
  }

  if (seconds >= 60) {
    return `${Math.ceil(seconds / 60)} minute(s)`
  }

  return `${seconds} seconds`
}

export function RateLimitNotice({
  signedIn,
  isGuest,
}: RateLimitNoticeProps) {
  const [notice, setNotice] =
    useState<RateLimitNoticeDetail | null>(null)

  useEffect(() => {
    let lastShownAt = 0

    function handleRateLimit(
      event: WindowEventMap['movie-hunt:rate-limit'],
    ) {
      const now = Date.now()

      if (now - lastShownAt < 8000) return

      lastShownAt = now
      setNotice(event.detail)
    }

    window.addEventListener(
      'movie-hunt:rate-limit',
      handleRateLimit,
    )

    return () => {
      window.removeEventListener(
        'movie-hunt:rate-limit',
        handleRateLimit,
      )
    }
  }, [])

  useEffect(() => {
    if (!notice || notice.retryAfter <= 0) return

    const timeoutId = window.setTimeout(() => {
      setNotice(null)
    }, notice.retryAfter * 1000)

    return () => window.clearTimeout(timeoutId)
  }, [notice])

  if (!notice) return null

  const isAuthEndpoint = notice.path.startsWith('/api/auth/')
  const isGenericLimit = notice.error === 'rate_limit_exceeded'

  let heading = 'Request limit reached'

  if (isAuthEndpoint) {
    heading = 'Too many sign-in attempts'
  }

  const message = isAuthEndpoint
    ? 'Please wait before trying to sign in again.'
    : !signedIn
      ? isGenericLimit
        ? 'You have reached the public request limit. Sign in with Google for higher browsing limits and a personal library.'
        : notice.message
      : isGuest
        ? isGenericLimit
          ? 'You have reached the guest request limit. Create a Google account to get higher browsing and daily allowances.'
          : `${notice.message} A Google account provides higher daily allowances.`
        : notice.message

  const retryMessage = notice.retryAfter > 0
    ? `You can try again in approximately ${formatRetryAfter(notice.retryAfter)}.`
    : ''

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <style>{`
  @keyframes rate-limit-alert-pulse {
    0%, 100% {
      box-shadow:
        0 0 24px rgba(239, 68, 68, 0.30),
        0 25px 50px -12px rgba(0, 0, 0, 0.75);
    }
    50% {
      box-shadow:
        0 0 38px rgba(239, 68, 68, 0.50),
        0 25px 50px -12px rgba(0, 0, 0, 0.75);
    }
  }

  .rate-limit-alert-pulse {
    animation: rate-limit-alert-pulse 2.2s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .rate-limit-alert-pulse {
      animation: none;
    }
  }
`}</style>

      <div
        role="alert"
        aria-live="assertive"
        className="rate-limit-alert-pulse w-[min(92vw,420px)] overflow-hidden rounded-2xl border border-red-500/45 bg-[#171719]"
      >
        <div className="flex items-start gap-3 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/35 bg-red-500/15 text-red-400">
            <AlertTriangle size={19} />
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white">
              {heading}
            </h3>

            <p className="mt-1.5 text-xs leading-5 text-zinc-300">
              {message}
            </p>

            {retryMessage && (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-red-300">
                <Clock3 size={12} />
                {retryMessage}
              </p>
            )}

            {!isAuthEndpoint && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {!signedIn && (
                  <Link
                    to="/login"
                    onClick={() => setNotice(null)}
                    className="rounded-lg bg-red-500 px-3.5 py-2 text-[11px] font-bold text-white hover:bg-red-400"
                  >
                    Sign in with Google
                  </Link>
                )}

                {signedIn && isGuest && (
                  <button
                    type="button"
                    onClick={() => {
                      void authClient.signIn.social({
                        provider: 'google',
                        callbackURL:
                          window.location.pathname +
                          window.location.search +
                          window.location.hash,
                      })
                    }}
                    className="rounded-lg bg-red-500 px-3.5 py-2 text-[11px] font-bold text-white hover:bg-red-400"
                  >
                    Create account
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  className="rounded-lg border border-white/10 px-3.5 py-2 text-[11px] font-semibold text-zinc-400 hover:bg-white/5 hover:text-white"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
            className="shrink-0 rounded-lg p-1 text-zinc-500 hover:bg-white/5 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}