import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs'
import { ScrollArea } from '../ui/scroll-area'
import { useCanvasActions } from '../HandlerContext'
import { runHandler } from '../../lib/handlers'
import type { Handler } from '../../lib/types'
import type { MoleculeProps } from '../registry'

interface TabDef {
  id: string
  label?: string
}

export function TabsMolecule({ node, renderChild }: MoleculeProps) {
  const actions = useCanvasActions()
  const tabs = ((node.props?.tabs as TabDef[] | undefined) ?? []).filter(t => t && t.id)
  const slots = node.slots ?? {}

  if (!tabs.length) {
    return (
      <div
        data-molecule="tabs"
        className="flex h-full items-center justify-center rounded-gc-md border border-hairline bg-surface p-2 text-xs text-tertiary"
      >
        no tabs
      </div>
    )
  }

  const active = node.state?.active as string | undefined
  const initial = active && tabs.some(t => t.id === active) ? active : tabs[0].id
  const onChange = node.handlers?.onChange as Handler | undefined

  return (
    <Tabs
      key={initial}
      defaultValue={initial}
      data-molecule="tabs"
      className="flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-gc-md border border-hairline bg-surface p-2 shadow-gc-raised"
      onValueChange={v => {
        actions.reportInteraction(node.id, { active: v })
        if (onChange) runHandler(onChange, node, actions, { value: v })
      }}
    >
      <TabsList className="shrink-0 self-start">
        {tabs.map(t => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label ?? t.id}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map(t => (
        <TabsContent key={t.id} value={t.id} className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-2">{(slots[t.id] ?? []).map(renderChild)}</div>
          </ScrollArea>
        </TabsContent>
      ))}
    </Tabs>
  )
}
