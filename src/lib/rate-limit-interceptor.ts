
export type RateLimitNoticeDetail = {
  error: string
  message: string
  retryAfter: number
  path: string
}

declare global {
  interface WindowEventMap {
    'movie-hunt:rate-limit': CustomEvent<RateLimitNoticeDetail>
  }
}

let installed = false

export function installRateLimitInterceptor() {
  if (typeof window === 'undefined' || installed) return

  installed = true

  const originalFetch = window.fetch.bind(window)

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const response = await originalFetch(input, init)

    if (response.status !== 429) return response

    const requestUrl =
      input instanceof Request ? input.url : String(input)

    let url: URL

    try {
      url = new URL(requestUrl, window.location.href)
    } catch {
      return response
    }

    // Only handle Movie Hunt API rate-limit responses.
    if (!url.pathname.startsWith('/api/')) return response

    const payload = await response.clone().json().catch(() => null) as {
      error?: string
      message?: string
      retryAfter?: number
    } | null

    const headerRetryAfter = Number(
      response.headers.get('Retry-After'),
    )

    const retryAfter =
      Number.isFinite(headerRetryAfter) && headerRetryAfter > 0
        ? headerRetryAfter
        : Number(payload?.retryAfter) > 0
          ? Number(payload?.retryAfter)
          : 60

    window.dispatchEvent(
      new CustomEvent<RateLimitNoticeDetail>(
        'movie-hunt:rate-limit',
        {
          detail: {
            error: payload?.error ?? 'rate_limit_exceeded',
            message:
              payload?.message ??
              'You have reached the current request limit.',
            retryAfter,
            path: url.pathname,
          },
        },
      ),
    )

    return response
  }
}
