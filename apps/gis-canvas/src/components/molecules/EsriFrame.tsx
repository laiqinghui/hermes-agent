import type { ReactNode } from 'react'

// Chrome-only framing for ESRI Calcite widgets (map / legend / feature-table).
// Renders around the Calcite custom element, never into its shadow DOM — the
// widget itself is themed only via Calcite CSS custom properties + the
// `calcite-mode-dark` class switch (see index.css / use-theme.ts).
export function EsriFrame({
  title,
  meta,
  corners = false,
  children
}: {
  title?: string
  meta?: string
  corners?: boolean
  children: ReactNode
}) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-gc-md border border-hairline bg-surface">
      {title ? (
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-3 py-2">
          <span className="font-display text-xs font-semibold uppercase tracking-wide text-primary">{title}</span>
          {meta ? <span className="font-mono text-[10px] text-tertiary">{meta}</span> : null}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {children}
        {corners ? <CornerBrackets /> : null}
      </div>
    </div>
  )
}

function CornerBrackets() {
  const base = 'pointer-events-none absolute h-4 w-4 border-accent/70 z-6'
  return (
    <>
      <span aria-hidden className={`${base} left-2 top-2 border-l-2 border-t-2`} />
      <span aria-hidden className={`${base} right-2 top-2 border-r-2 border-t-2`} />
      <span aria-hidden className={`${base} bottom-2 left-2 border-b-2 border-l-2`} />
      <span aria-hidden className={`${base} bottom-2 right-2 border-b-2 border-r-2`} />
    </>
  )
}
