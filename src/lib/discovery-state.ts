import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'

export function useStoredDiscoveryState<T extends object>(
  storageKey: string,
  defaults: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return defaults

    try {
      const saved = window.localStorage.getItem(storageKey)

      if (!saved) return defaults

      const parsed: unknown = JSON.parse(saved)

      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        return defaults
      }

      return { ...defaults, ...parsed } as T
    } catch {
      return defaults
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      // Storage may be unavailable or full; Discovery still works in memory.
    }
  }, [storageKey, state])

  return [state, setState]
}
