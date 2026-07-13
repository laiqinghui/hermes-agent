export function Skeleton({ className = '', rows }: { className?: string; rows?: number }) {
  if (rows && rows > 0) {
    return (
      <div data-testid="skeleton" className="flex flex-col gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={`gc-skeleton h-4 w-full rounded-gc-sm ${className}`} />
        ))}
      </div>
    )
  }
  return <div data-testid="skeleton" className={`gc-skeleton rounded-gc-sm ${className}`} />
}
