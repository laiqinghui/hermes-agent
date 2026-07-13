import type { MoleculeProps } from '../registry'

export function CardMolecule({ node, renderChild }: MoleculeProps) {
  const { title } = (node.props ?? {}) as { title?: string }
  const slots = node.slots ?? {}
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-gc-md border border-hairline bg-surface shadow-gc-raised">
      {title ? (
        <div className="truncate border-b border-hairline px-3 py-2 font-display text-sm font-semibold text-primary">{title}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto p-3">{(slots.content ?? []).map(renderChild)}</div>
      {slots.footer?.length ? (
        <div className="border-t border-hairline px-3 py-2">{slots.footer.map(renderChild)}</div>
      ) : null}
    </div>
  )
}
