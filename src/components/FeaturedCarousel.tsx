import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'

export type FeaturedCarouselSlide = {
  id: string
  title: string
  description: string
  image: string | null
  href: string
  meta?: string
}

type FeaturedCarouselProps = {
  eyebrow: string
  slides: FeaturedCarouselSlide[]
  fallbackTitle: string
  fallbackDescription: string
  accent: 'amber' | 'violet'
  exploreHref: string
  exploreLabel: string
  libraryHref: string
  libraryLabel: string
}

export function FeaturedCarousel({
  eyebrow,
  slides,
  fallbackTitle,
  fallbackDescription,
  accent,
  exploreHref,
  exploreLabel,
  libraryHref,
  libraryLabel,
}: FeaturedCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  const theme =
    accent === 'amber'
      ? {
          border: 'border-amber-200/10',
          badge: 'border-amber-200/15 bg-amber-200/[0.06] text-amber-200',
          title: 'text-amber-300',
          button: 'bg-amber-400 text-zinc-950 hover:bg-amber-300',
          dot: 'bg-amber-300',
          hover: 'hover:text-amber-200',
          glow: 'bg-[radial-gradient(ellipse_at_80%_40%,rgba(190,112,43,0.22),transparent_45%)]',
          line: 'bg-amber-400/70',
        }
      : {
          border: 'border-violet-300/10',
          badge: 'border-violet-200/15 bg-violet-200/[0.06] text-violet-200',
          title: 'text-violet-300',
          button: 'bg-violet-300 text-zinc-950 hover:bg-violet-200',
          dot: 'bg-violet-300',
          hover: 'hover:text-violet-200',
          glow: 'bg-[radial-gradient(ellipse_at_80%_40%,rgba(139,92,246,0.23),transparent_45%)]',
          line: 'bg-violet-300/70',
        }

  useEffect(() => {
    if (paused || slides.length <= 1) return

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length)
    }, 5000)

    return () => window.clearInterval(timer)
  }, [paused, slides.length])

  const safeIndex = slides.length > 0 ? activeIndex % slides.length : 0

  function moveSlide(direction: -1 | 1) {
    if (slides.length <= 1) return

    setActiveIndex(
      (current) => (current + direction + slides.length) % slides.length,
    )
  }

  return (
    <section
      role="region"
      aria-roledescription="carousel"
      aria-label={eyebrow}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`relative isolate overflow-hidden rounded-[26px] border bg-[#151311] ${theme.border}`}
    >
      {/* 1. Sliding Background Track */}
      {slides.length > 0 && (
        <div
          className="absolute inset-0 -z-20 flex transition-transform duration-700 ease-out"
          style={{ transform: `translateX(-${safeIndex * 100}%)` }}
        >
          {slides.map((slide) => (
            <div
              key={slide.id}
              className="h-full w-full shrink-0 bg-cover bg-center"
              style={
                slide.image
                  ? {
                      backgroundImage: `linear-gradient(90deg, rgba(9,9,11,.97) 5%, rgba(9,9,11,.82) 48%, rgba(9,9,11,.28) 100%), url("${slide.image}")`,
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      <div className={`pointer-events-none absolute inset-0 -z-10 ${theme.glow}`} />

      {/* Main Layout Container */}
      <div className="flex min-h-[440px] flex-col justify-between py-8 sm:py-10 lg:min-h-[480px] lg:py-12">
        {/* Top Stationary Eyebrow */}
        <div className="px-6 sm:px-9 lg:px-12">
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${theme.badge}`}
          >
            <Sparkles size={12} />
            {eyebrow}
          </div>
        </div>

        {/* 2. Sliding Content Track */}
        <div className="my-6 overflow-hidden" aria-live="off">
          {slides.length > 0 ? (
            <div
              className="flex transition-transform duration-700 ease-out"
              style={{ transform: `translateX(-${safeIndex * 100}%)` }}
            >
              {slides.map((slide, index) => {
                const isActive = index === safeIndex
                return (
                  <div
                    key={slide.id}
                    aria-hidden={!isActive}
                    className="w-full shrink-0 px-6 sm:px-9 lg:px-12"
                  >
                    <div className="max-w-3xl">
                      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                        Featured pick
                      </p>

                      <h1 className="max-w-2xl text-4xl font-semibold leading-[1.08] tracking-[-0.045em] text-white sm:text-5xl lg:text-[58px]">
                        <Link
                          to={slide.href}
                          tabIndex={isActive ? 0 : -1}
                          className="transition hover:text-zinc-200"
                        >
                          {slide.title}
                        </Link>
                      </h1>

                      <p className="mt-5 line-clamp-3 max-w-xl text-sm leading-7 text-zinc-300 sm:text-base">
                        {slide.description}
                      </p>

                      {slide.meta && (
                        <p className="mt-3 text-xs font-medium text-zinc-400">
                          {slide.meta}
                        </p>
                      )}

                      <Link
                        to={slide.href}
                        tabIndex={isActive ? 0 : -1}
                        className={`mt-4 inline-flex items-center gap-1.5 text-xs font-semibold transition ${theme.hover}`}
                      >
                        View details <ArrowUpRight size={14} />
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* Fallback Content */
            <div className="px-6 sm:px-9 lg:px-12">
              <div className="max-w-3xl">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                  Discover something new
                </p>
                <h1 className="max-w-2xl text-4xl font-semibold leading-[1.08] tracking-[-0.045em] text-white sm:text-5xl lg:text-[58px]">
                  {fallbackTitle}
                </h1>
                <p className="mt-5 line-clamp-3 max-w-xl text-sm leading-7 text-zinc-300 sm:text-base">
                  {fallbackDescription}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Stationary Action Buttons + Bottom Controls */}
        <div className="px-6 sm:px-9 lg:px-12">
          <div className="flex flex-wrap gap-3">
            <Link
              to={exploreHref}
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition ${theme.button}`}
            >
              {exploreLabel}
              <ArrowRight size={16} />
            </Link>

            <Link
              to={libraryHref}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.08]"
            >
              <Bookmark size={15} />
              {libraryLabel}
            </Link>
          </div>

          <div className="relative mt-10 flex flex-wrap items-center justify-between gap-4 sm:mt-12">
            <div className="flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">
              <span className={`h-px w-7 ${theme.line}`} />
              Discover · Track · Recommend · Share
            </div>

            {slides.length > 1 && (
              <div className="flex items-center gap-3">
                <span className="mr-1 text-[10px] tabular-nums text-zinc-400">
                  {String(safeIndex + 1).padStart(2, '0')}
                  {' / '}
                  {String(slides.length).padStart(2, '0')}
                </span>

                <div className="flex items-center gap-1.5">
                  {slides.map((slide, index) => (
                    <button
                      key={slide.id}
                      type="button"
                      aria-label={`Show slide ${index + 1}: ${slide.title}`}
                      aria-pressed={safeIndex === index}
                      onClick={() => setActiveIndex(index)}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        safeIndex === index
                          ? `w-6 ${theme.dot}`
                          : 'w-1.5 bg-white/30 hover:bg-white/60'
                      }`}
                    />
                  ))}
                </div>

                <div className="ml-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Previous featured title"
                    onClick={() => moveSlide(-1)}
                    className={`rounded-full border border-white/15 bg-black/30 p-2.5 text-zinc-300 transition ${theme.hover}`}
                  >
                    <ArrowLeft size={15} />
                  </button>

                  <button
                    type="button"
                    aria-label="Next featured title"
                    onClick={() => moveSlide(1)}
                    className={`rounded-full border border-white/15 bg-black/30 p-2.5 text-zinc-300 transition ${theme.hover}`}
                  >
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}