import { useEffect, useState } from 'react'

// '/' opens the agent overlay (unless focus is already in a text input),
// Escape closes it — the only persistent chat surface is the collapsed dock.
export function useOverlayShortcut(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if (e.key === '/' && !typing && !open) {
        e.preventDefault()
        setOpen(true)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return [open, setOpen]
}
