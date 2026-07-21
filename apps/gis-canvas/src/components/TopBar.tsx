import type { ThemeMode } from '../lib/use-theme'

export function TopBar({
  theme,
  onToggleTheme,
  connected,
  isBusy,
  onLogout,
  onResetLayout,
  canReset
}: {
  theme: ThemeMode
  onToggleTheme: () => void
  connected: boolean
  isBusy: boolean
  onLogout: () => void
  onResetLayout: () => void
  canReset: boolean
}) {
  const statusLabel = isBusy ? 'COMPOSING' : connected ? 'AGENT · LIVE' : 'CONNECTING…'
  const statusColor = isBusy ? 'text-accent' : connected ? 'text-positive' : 'text-tertiary'

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-hairline bg-rail px-5 py-2.5">
      <div className="flex items-center gap-3.5">
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-gc-sm bg-accent font-display text-[15px] font-bold text-accent-fg">
          T
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-sm font-semibold tracking-wide text-primary">
            Thoughts <span className="text-accent">Canvas</span>
          </span>
          <span className="mt-0.5 font-mono text-[10.5px] text-tertiary">Reasoning, made visual</span>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {canReset && (
          <button
            data-testid="reset-layout"
            onClick={onResetLayout}
            className="rounded-gc-sm border border-hairline bg-surface px-2.5 py-1.5 font-sans text-[11.5px] text-secondary hover:text-primary"
          >
            ⤢ Reset layout
          </button>
        )}
        <button
          onClick={onToggleTheme}
          className="rounded-gc-sm border border-hairline bg-surface px-2.5 py-1.5 font-sans text-[11.5px] text-secondary hover:text-primary"
        >
          {theme === 'dark' ? '☾ Dark' : '☀ Light'}
        </button>
        <span
          data-testid="agent-status"
          data-connected={connected}
          className="flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2.5 py-1.5 font-mono text-[10.5px]"
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${isBusy ? 'bg-accent' : connected ? 'bg-positive' : 'bg-tertiary'} ${connected ? 'gc-anim-pulse' : ''}`}
            style={connected ? { animation: 'gc-pulse-dot 1.6s ease-in-out infinite' } : undefined}
          />
          <span className={statusColor}>{statusLabel}</span>
        </span>
        <button
          onClick={onLogout}
          className="rounded-gc-sm border border-hairline bg-transparent px-3 py-1.5 font-sans text-[11.5px] text-secondary hover:text-primary"
        >
          Log out
        </button>
      </div>
    </div>
  )
}
