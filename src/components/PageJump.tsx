
import { useState } from 'react'

type PageJumpProps = {
  page: number
  totalPages: number
  onGo: (page: number) => void
  accent: 'amber' | 'violet'
}

export function PageJump({
  page,
  totalPages,
  onGo,
  accent,
}: PageJumpProps) {
  const [input, setInput] = useState(String(page))

  const maxPage = Math.min(totalPages, 500)
  const targetPage = Number(input)

  const valid =
    input.trim() !== '' &&
    Number.isInteger(targetPage) &&
    targetPage >= 1 &&
    targetPage <= maxPage

  const buttonStyle =
    accent === 'amber'
      ? 'bg-amber-400 text-zinc-950 hover:bg-amber-300'
      : 'bg-violet-300 text-zinc-950 hover:bg-violet-200'

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()

        if (valid) {
          onGo(targetPage)
        }
      }}
      className="flex items-center gap-2"
    >
      <label
        htmlFor="discovery-page-jump"
        className="whitespace-nowrap text-xs text-zinc-500"
      >
        Go to
      </label>

      <input
        id="discovery-page-jump"
        type="number"
        min={1}
        max={maxPage}
        step={1}
        inputMode="numeric"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        aria-label={`Go to page, available pages 1 to ${maxPage}`}
        className="w-[68px] rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-center text-xs text-zinc-200 outline-none focus:border-white/30"
      />

      <button
        type="submit"
        disabled={!valid}
        className={`rounded-lg px-3.5 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-30 ${buttonStyle}`}
      >
        Go
      </button>
    </form>
  )
}
