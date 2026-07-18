import { useEffect, useRef, useState } from 'react'

/**
 * Pace a rapidly-changing value so it updates at most once per `minMs`, always
 * converging to the latest. Keeps the cognition stream readable: when the agent
 * emits thoughts/steps faster than they can be read, intermediate values
 * coalesce and only the newest is shown once the dwell elapses — the display
 * never flickers and never lags behind real progress by more than `minMs`.
 *
 * `key` is a cheap change-signal string; `value` is what to hold and return.
 * The first value is shown immediately; the initial value is then held for at
 * least `minMs` before the first change can replace it.
 */
export function useDwell<T>(value: T, key: string, minMs = 1200): T {
  const [held, setHeld] = useState<{ value: T; key: string }>({ value, key })
  // When the currently-shown value was last committed (mount time initially, so
  // the first change still respects a full dwell from mount).
  const shownAtRef = useRef(Date.now())

  useEffect(() => {
    if (key === held.key) return
    const wait = Math.max(0, minMs - (Date.now() - shownAtRef.current))
    const t = setTimeout(() => {
      shownAtRef.current = Date.now()
      setHeld({ value, key })
    }, wait)
    return () => clearTimeout(t)
  }, [key, value, held.key, minMs])

  return held.value
}
