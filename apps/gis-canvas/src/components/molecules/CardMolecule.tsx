import type { MoleculeProps } from '../registry'

export function CardMolecule({ node, renderChild }: MoleculeProps) {
  const { title } = (node.props ?? {}) as { title?: string }
  const slots = node.slots ?? {}
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
      {title ? <div className="border-b border-neutral-200 px-3 py-2 text-sm font-semibold">{title}</div> : null}
      <div className="min-h-0 flex-1 overflow-auto p-3">{(slots.content ?? []).map(renderChild)}</div>
      {slots.footer?.length ? (
        <div className="border-t border-neutral-200 px-3 py-2">{slots.footer.map(renderChild)}</div>
      ) : null}
    </div>
  )
}
