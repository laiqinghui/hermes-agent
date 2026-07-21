# C2 Molecule Registry — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up ShadCN/Radix primitives (styled on the existing gc- theme) in `apps/gis-canvas`, establish the registry-extension convention, and ship a new agent-authorable `tabs` molecule end-to-end.

**Architecture:** Vendor ShadCN/Radix primitives into `src/components/ui/` but restyle their color classes onto the existing gc- Tailwind utilities (no parallel token layer, so light/`:root.dark` theming is inherited for free). A new `tabs` molecule composes those primitives and is wired through all five registry touch-points (schema, `types.ts`, `validator.py`, `registry.tsx`, `_CATALOG_HELP`). The `tabs` slot model is dynamic (one slot per agent-declared tab), generalizing the validator's fixed-slot check.

**Tech Stack:** React 19, Tailwind v4, Vite 8 (Rolldown), Vitest/jsdom (frontend); Python + jsonschema + pytest (plugin backend); Radix UI primitives; `class-variance-authority` + `clsx` + `tailwind-merge`.

**Spec:** `apps/gis-canvas/docs/2026-07-21-c2-molecules-foundation-design.md`

## Global Constraints

- **Branch:** all work on `gis/c2-molecules-foundation` (already created). Do not commit to `gis/main`.
- **Tailwind v4 only** — tokens live in `@theme` in `src/index.css`; **never** introduce a v3 `tailwind.config.js/ts`.
- **One token system** — vendored primitives use existing gc- utilities (`bg-accent`, `text-accent-fg`, `bg-surface`, `bg-surface-raised`, `text-primary/secondary/tertiary`, `border-hairline`, `border-hairline-strong`, `ring-accent`, `bg-negative`, `text-alert-fg`, `rounded-gc-sm/md`, `shadow-gc-raised/overlay`). Do **not** add `--color-primary/secondary/accent`-style ShadCN tokens (they collide with gc- meanings).
- **Path alias:** `@/*` → `src/*`, declared in **both** `tsconfig.json` and `vite.config.ts`.
- **optimizeDeps:** do **not** add Radix packages to `vite.config.ts` `optimizeDeps.exclude`; leave the existing ESRI/Polymer excludes untouched.
- **Primitives are not agent-facing** — nothing in `src/components/ui/` is added to `COMPONENT_REGISTRY`; only the `tabs` molecule is.
- **4-place type sync** — any molecule type must appear in `schema/canvas.schema.json`, `src/lib/types.ts`, `plugins/gis-canvas/validator.py` (`CATALOG` + `STATE_KEYS`), `src/components/registry.tsx`, and `plugins/gis-canvas/tools_canvas.py` (`_CATALOG_HELP`).
- **Dependency install** from repo root `c:\workspace\analyst\hermes-agent`: `npm install --workspace @hermes/gis-canvas <pkgs>`.
- **Test commands:** FE `npm run --workspace @hermes/gis-canvas test` and `npm run --workspace @hermes/gis-canvas typecheck`; backend `python -m pytest tests/plugins/gis_canvas -q`.

---

### Task 1: Toolchain scaffolding — path alias, `cn()` util, deps, `components.json`

**Files:**
- Modify: `apps/gis-canvas/tsconfig.json`
- Modify: `apps/gis-canvas/vite.config.ts`
- Create: `apps/gis-canvas/src/lib/utils.ts`
- Create: `apps/gis-canvas/components.json`
- Test: `apps/gis-canvas/src/lib/utils.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` from `@/lib/utils` — used by every `ui/*` primitive.
- Produces: the `@/*` → `src/*` alias resolving in tsc, vite, and vitest.

- [ ] **Step 1: Install dependencies**

Run from `c:\workspace\analyst\hermes-agent`:
```bash
npm install --workspace @hermes/gis-canvas \
  clsx tailwind-merge class-variance-authority \
  @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-scroll-area \
  @radix-ui/react-separator @radix-ui/react-slot
```
Expected: installs succeed; `apps/gis-canvas/package.json` `dependencies` now lists these packages.

- [ ] **Step 2: Add the `@/` path alias to `tsconfig.json`**

In `apps/gis-canvas/tsconfig.json`, add `baseUrl` + `paths` inside `compilerOptions` (after `"skipLibCheck": true,`):
```jsonc
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
```

- [ ] **Step 3: Add the alias to `vite.config.ts`**

In `apps/gis-canvas/vite.config.ts`, add the import at the top (after the existing imports) and a `resolve` block inside `defineConfig({...})` (place it right after `plugins: [...]`):
```ts
import { fileURLToPath, URL } from 'node:url'
```
```ts
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
```

- [ ] **Step 4: Write the `cn()` util**

Create `apps/gis-canvas/src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind class lists, letting later classes win conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 5: Add `components.json` (Tailwind v4, no config file)**

Create `apps/gis-canvas/components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```
(`"config": ""` marks Tailwind v4 — no `tailwind.config.*` exists or should be created.)

- [ ] **Step 6: Write the failing test**

Create `apps/gis-canvas/src/lib/utils.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('resolves the @/ alias and merges conflicting tailwind classes (last wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
  it('drops falsy values and keeps non-conflicting classes', () => {
    expect(cn('text-primary', false && 'hidden', 'font-mono')).toBe('text-primary font-mono')
  })
})
```

- [ ] **Step 7: Run the test**

Run: `npm run --workspace @hermes/gis-canvas test -- src/lib/utils.test.ts`
Expected: PASS (2 tests). If the `@/` import fails to resolve, re-check Steps 2–3.

- [ ] **Step 8: Typecheck**

Run: `npm run --workspace @hermes/gis-canvas typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/gis-canvas/tsconfig.json apps/gis-canvas/vite.config.ts \
  apps/gis-canvas/src/lib/utils.ts apps/gis-canvas/src/lib/utils.test.ts \
  apps/gis-canvas/components.json apps/gis-canvas/package.json \
  ../../package.json ../../package-lock.json
git commit -m "chore(gis-canvas): add @/ alias, cn() util, ShadCN deps + components.json"
```
(Adjust the lockfile/root paths if `git status` shows them at a different relative location; include whichever `package.json`/`package-lock.json` changed.)

---

### Task 2: Themed UI primitive layer (`src/components/ui/*`) + jsdom polyfills

**Files:**
- Create: `apps/gis-canvas/src/components/ui/button.tsx`
- Create: `apps/gis-canvas/src/components/ui/badge.tsx`
- Create: `apps/gis-canvas/src/components/ui/separator.tsx`
- Create: `apps/gis-canvas/src/components/ui/tabs.tsx`
- Create: `apps/gis-canvas/src/components/ui/tooltip.tsx`
- Create: `apps/gis-canvas/src/components/ui/scroll-area.tsx`
- Create: `apps/gis-canvas/src/components/ui/README.md`
- Modify: `apps/gis-canvas/src/test-setup.ts`
- Test: `apps/gis-canvas/src/components/ui/ui-primitives.test.tsx`

**Interfaces:**
- Produces: `Tabs, TabsList, TabsTrigger, TabsContent` from `../ui/tabs`; `ScrollArea` from `../ui/scroll-area` — consumed by the `tabs` molecule (Task 3).
- Produces: `Button, buttonVariants`, `Badge, badgeVariants`, `Separator`, `Tooltip, TooltipTrigger, TooltipContent, TooltipProvider` — available to later sub-projects.
- Consumes: `cn` from `@/lib/utils` (Task 1).

- [ ] **Step 1: Add jsdom polyfills Radix needs**

Append to `apps/gis-canvas/src/test-setup.ts`:
```ts

// Radix primitives (tabs roving-focus, scroll-area) use DOM APIs jsdom lacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
```

- [ ] **Step 2: Write `button.tsx`**

Create `apps/gis-canvas/src/components/ui/button.tsx`:
```tsx
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-gc-sm text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:bg-accent/90',
        secondary: 'border border-hairline bg-surface-raised text-secondary hover:bg-surface-raised/80',
        outline: 'border border-hairline-strong bg-surface text-primary hover:bg-surface-raised',
        ghost: 'text-primary hover:bg-surface-raised',
        destructive: 'bg-negative text-alert-fg hover:bg-negative/90'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { Button, buttonVariants }
```

- [ ] **Step 3: Write `badge.tsx`**

Create `apps/gis-canvas/src/components/ui/badge.tsx`:
```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-gc-sm border px-2 py-0.5 font-mono text-[11px] font-medium',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent text-accent-fg',
        secondary: 'border-transparent bg-surface-raised text-secondary',
        outline: 'border-hairline-strong text-primary',
        destructive: 'border-transparent bg-negative text-alert-fg'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
```

- [ ] **Step 4: Write `separator.tsx`**

Create `apps/gis-canvas/src/components/ui/separator.tsx`:
```tsx
import * as React from 'react'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cn } from '@/lib/utils'

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-hairline data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className
      )}
      {...props}
    />
  )
}

export { Separator }
```

- [ ] **Step 5: Write `tabs.tsx`**

Create `apps/gis-canvas/src/components/ui/tabs.tsx`:
```tsx
import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-2', className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('inline-flex h-9 w-fit items-center justify-center rounded-gc-md bg-surface-raised p-1 text-tertiary', className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-gc-sm px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-surface data-[state=active]:text-primary data-[state=active]:shadow-gc-raised',
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('flex-1 outline-none', className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
```

- [ ] **Step 6: Write `tooltip.tsx`**

Create `apps/gis-canvas/src/components/ui/tooltip.tsx`:
```tsx
import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

function TooltipProvider({ delayDuration = 0, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 overflow-hidden rounded-gc-sm border border-hairline-strong bg-surface-raised px-2.5 py-1 text-xs text-primary shadow-gc-overlay',
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
```

- [ ] **Step 7: Write `scroll-area.tsx`**

Create `apps/gis-canvas/src/components/ui/scroll-area.tsx`:
```tsx
import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { cn } from '@/lib/utils'

function ScrollArea({ className, children, ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport data-slot="scroll-area-viewport" className="h-full w-full rounded-[inherit]">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none select-none transition-colors',
        orientation === 'vertical' && 'h-full w-2 border-l border-l-transparent p-px',
        orientation === 'horizontal' && 'h-2 flex-col border-t border-t-transparent p-px',
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-hairline-strong" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
```

- [ ] **Step 8: Write the `ui/README.md` restyle-convention doc**

Create `apps/gis-canvas/src/components/ui/README.md`:
```markdown
# ui/ — vendored ShadCN/Radix primitives

Low-level primitives (Radix structure + `cva` variants + `data-slot` + `cn()`).
**Not agent-facing** — none of these are added to `COMPONENT_REGISTRY`; molecules
in `../molecules/` compose them.

## Theming rule (important)

We keep **one** token system: the gc- Tailwind utilities defined in
`src/index.css`. ShadCN's stock output references `bg-primary` / `bg-muted` /
`bg-accent` with meanings that COLLIDE with gc- (`--color-primary` is text,
`--color-accent` is brand teal). So when adding a primitive (by hand or via
`npx shadcn add <name>`), **restyle its color classes onto gc- utilities**:

| ShadCN role | gc- utility |
| --- | --- |
| brand / primary | `bg-accent text-accent-fg` (hover `bg-accent/90`) |
| secondary / muted surface | `bg-surface-raised` + `text-secondary` / `text-tertiary` |
| hover/active surface ("accent") | `bg-surface-raised` / `hover:bg-surface-raised` |
| background / foreground | `bg-surface` / `text-primary` |
| popover / card | `bg-surface-raised` / `bg-surface` |
| border / input / ring | `border-hairline` / `border-hairline-strong` / `ring-accent` |
| destructive | `bg-negative text-alert-fg` |
| radius | `rounded-gc-sm` / `rounded-gc-md` |

Because gc- utilities already flip under `:root.dark`, primitives are
theme-aware for free — do not add `--color-*` ShadCN tokens or a duplicate dark
block. Inside a `.gc-hud` glass panel, `bg-surface` becomes transparent by
design, so primitives glass correctly.
```

- [ ] **Step 9: Write the primitive test**

Create `apps/gis-canvas/src/components/ui/ui-primitives.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs'

describe('ui primitives', () => {
  it('Button uses the gc- brand utilities (bg-accent / text-accent-fg)', () => {
    render(<Button>Go</Button>)
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn.className).toContain('bg-accent')
    expect(btn.className).toContain('text-accent-fg')
  })

  it('Tabs shows the default panel and switches on trigger click', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel-a</TabsContent>
        <TabsContent value="b">panel-b</TabsContent>
      </Tabs>
    )
    expect(screen.getByText('panel-a')).toBeInTheDocument()
    expect(screen.queryByText('panel-b')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'B' }))
    expect(screen.getByText('panel-b')).toBeInTheDocument()
  })
})
```

- [ ] **Step 10: Run the test**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/ui/ui-primitives.test.tsx`
Expected: PASS (2 tests). If Radix throws on a missing DOM API, re-check Step 1 polyfills.

- [ ] **Step 11: Typecheck**

Run: `npm run --workspace @hermes/gis-canvas typecheck`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add apps/gis-canvas/src/components/ui apps/gis-canvas/src/test-setup.ts
git commit -m "feat(gis-canvas): vendor themed ShadCN/Radix ui primitive layer"
```

---

### Task 3: `tabs` molecule + registry + types wiring (frontend)

**Files:**
- Create: `apps/gis-canvas/src/components/molecules/TabsMolecule.tsx`
- Modify: `apps/gis-canvas/src/components/registry.tsx`
- Modify: `apps/gis-canvas/src/lib/types.ts:5`
- Test: `apps/gis-canvas/src/components/molecules/TabsMolecule.test.tsx`

**Interfaces:**
- Consumes: `Tabs, TabsList, TabsTrigger, TabsContent` (`../ui/tabs`), `ScrollArea` (`../ui/scroll-area`) from Task 2; `useCanvasActions` (`../HandlerContext`), `runHandler` (`../../lib/handlers`), `MoleculeProps` (`../registry`), `Handler`/`ComponentNode` (`../../lib/types`).
- Produces: `TabsMolecule` registered in `COMPONENT_REGISTRY` under key `'tabs'`; reads `props.tabs: {id,label?}[]`, `slots[tabId]`, `state.active`; on tab change calls `actions.reportInteraction(node.id, { active })` and runs optional `handlers.onChange`.

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/components/molecules/TabsMolecule.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HandlerProvider } from '../HandlerContext'
import { TabsMolecule } from './TabsMolecule'
import { COMPONENT_REGISTRY } from '../registry'
import type { CanvasActions } from '../../lib/handlers'
import type { ComponentNode } from '../../lib/types'

function actionsMock(over: Partial<CanvasActions> = {}): CanvasActions {
  return { setLocalState() {}, reportInteraction: vi.fn(), sendPrompt() {}, fetchData: vi.fn(), ...over }
}

const node: ComponentNode = {
  id: 'insp',
  type: 'tabs',
  props: { tabs: [{ id: 'overview', label: 'Overview' }, { id: 'props', label: 'Properties' }] },
  slots: {
    overview: [{ id: 'a', type: 'stat', props: { label: 'X', value: 1 } }],
    props: [{ id: 'b', type: 'stat', props: { label: 'Y', value: 2 } }]
  }
}

const renderChild = (n: ComponentNode) => <div key={n.id} data-testid={`child-${n.id}`}>{n.id}</div>

describe('TabsMolecule', () => {
  it('is registered under type "tabs"', () => {
    expect(COMPONENT_REGISTRY.tabs).toBe(TabsMolecule)
  })

  it('renders a trigger per tab and shows the first tab panel by default', () => {
    render(
      <HandlerProvider actions={actionsMock()}>
        <TabsMolecule node={node} renderChild={renderChild} />
      </HandlerProvider>
    )
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Properties' })).toBeInTheDocument()
    expect(screen.getByTestId('child-a')).toBeInTheDocument()
    expect(screen.queryByTestId('child-b')).toBeNull()
  })

  it('switches panels and reports the active tab on change', () => {
    const reportInteraction = vi.fn()
    render(
      <HandlerProvider actions={actionsMock({ reportInteraction })}>
        <TabsMolecule node={node} renderChild={renderChild} />
      </HandlerProvider>
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Properties' }))
    expect(screen.getByTestId('child-b')).toBeInTheDocument()
    expect(reportInteraction).toHaveBeenCalledWith('insp', { active: 'props' })
  })

  it('renders a graceful placeholder when no tabs are defined', () => {
    render(
      <HandlerProvider actions={actionsMock()}>
        <TabsMolecule node={{ id: 'empty', type: 'tabs', props: { tabs: [] } }} renderChild={() => null} />
      </HandlerProvider>
    )
    expect(screen.getByText(/no tabs/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/molecules/TabsMolecule.test.tsx`
Expected: FAIL — `TabsMolecule` module not found / `COMPONENT_REGISTRY.tabs` undefined.

- [ ] **Step 3: Write `TabsMolecule.tsx`**

Create `apps/gis-canvas/src/components/molecules/TabsMolecule.tsx`:
```tsx
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
```

- [ ] **Step 4: Register the molecule**

In `apps/gis-canvas/src/components/registry.tsx`, add the import after the other molecule imports (line 6 area):
```ts
import { TabsMolecule } from './molecules/TabsMolecule'
```
Then add the entry to `COMPONENT_REGISTRY` (after `select: SelectMolecule,`):
```ts
  tabs: TabsMolecule,
```

- [ ] **Step 5: Add `tabs` to the TS molecule type list**

In `apps/gis-canvas/src/lib/types.ts:5`, add `'tabs'` to `MOLECULE_TYPES`:
```ts
export const MOLECULE_TYPES = ['card', 'stat', 'data-table', 'select', 'tabs', 'esri:map', 'esri:legend', 'esri:feature-table'] as const
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/molecules/TabsMolecule.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the full FE suite + typecheck (no regressions)**

Run: `npm run --workspace @hermes/gis-canvas test`
Then: `npm run --workspace @hermes/gis-canvas typecheck`
Expected: all existing tests + the new ones pass; no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/gis-canvas/src/components/molecules/TabsMolecule.tsx \
  apps/gis-canvas/src/components/molecules/TabsMolecule.test.tsx \
  apps/gis-canvas/src/components/registry.tsx apps/gis-canvas/src/lib/types.ts
git commit -m "feat(gis-canvas): add agent-authorable tabs molecule (Radix tabs)"
```

---

### Task 4: Backend wiring — schema, validator (dynamic slots), awareness, agent catalog

**Files:**
- Modify: `plugins/gis-canvas/schema/canvas.schema.json:44`
- Modify: `plugins/gis-canvas/validator.py` (`CATALOG`, `STATE_KEYS`, slot check)
- Modify: `plugins/gis-canvas/awareness.py` (`_fmt_state`)
- Modify: `plugins/gis-canvas/tools_canvas.py` (`_CATALOG_HELP`)
- Test: `tests/plugins/gis_canvas/test_validator.py` (append)
- Test: `tests/plugins/gis_canvas/test_tools.py` (append)

**Interfaces:**
- Consumes: `plugin.validator.validate_doc(doc) -> list[str]`, `plugin.tools_canvas.render_view({"spec": ...}, task_id=...) -> json str` (existing fixtures/patterns).
- Produces: `tabs` accepted by schema + validator; `CATALOG["tabs"]` with `dynamic_slots: True`; validator rejects a slot whose name is not a declared tab id; `STATE_KEYS["tabs"] = {"active"}`; awareness prints `active=<id>`.

- [ ] **Step 1: Write the failing validator tests**

Append to `tests/plugins/gis_canvas/test_validator.py`:
```python
def _tabs_node():
    return {
        "id": "insp",
        "type": "tabs",
        "area": {"col": 1, "colSpan": 6, "row": 2, "rowSpan": 3},
        "props": {"tabs": [{"id": "overview", "label": "Overview"},
                           {"id": "props", "label": "Properties"}]},
        "slots": {
            "overview": [{"id": "t1", "type": "stat", "props": {"label": "A", "value": 1}}],
            "props": [{"id": "t2", "type": "stat", "props": {"label": "B", "value": 2}}],
        },
    }


def test_tabs_valid_doc_passes(plugin):
    doc = _minimal_doc()
    doc["components"].append(_tabs_node())
    assert plugin.validator.validate_doc(doc) == []


def test_tabs_missing_tabs_prop_rejected(plugin):
    doc = _minimal_doc()
    node = _tabs_node()
    node["props"] = {}
    doc["components"].append(node)
    errors = plugin.validator.validate_doc(doc)
    assert any("tabs" in e for e in errors)


def test_tabs_slot_without_matching_tab_rejected(plugin):
    doc = _minimal_doc()
    node = _tabs_node()
    node["slots"]["ghost"] = [{"id": "t3", "type": "stat", "props": {"label": "C", "value": 3}}]
    doc["components"].append(node)
    errors = plugin.validator.validate_doc(doc)
    assert any("ghost" in e for e in errors)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/plugins/gis_canvas/test_validator.py -q -k tabs`
Expected: FAIL — `tabs` not in the schema enum (schema error), so all three fail.

- [ ] **Step 3: Add `tabs` to the schema enum**

In `plugins/gis-canvas/schema/canvas.schema.json:44`, extend the `type` enum:
```json
        "type": { "enum": ["card", "stat", "data-table", "select", "tabs", "esri:map", "esri:legend", "esri:feature-table"] },
```

- [ ] **Step 4: Add the `CATALOG` + `STATE_KEYS` entries**

In `plugins/gis-canvas/validator.py`, add to `CATALOG` (after the `select` entry):
```python
    "tabs": {
        "container": True,
        "slots": set(),          # dynamic: one slot per props.tabs id (see dynamic_slots)
        "dynamic_slots": True,
        "required_props": ["tabs"],
        "required_bindings": [],
    },
```
And add to `STATE_KEYS` (after the `select` entry):
```python
    "tabs": {"active"},
```

- [ ] **Step 5: Generalize the slot check for dynamic slots**

In `plugins/gis-canvas/validator.py`, replace the slot-validation block inside `walk` (currently):
```python
        for slot_name, slot_kids in slots.items():
            if entry["container"] and slot_name not in entry["slots"]:
                errors.append(f"'{node_id}' ({node_type}): unknown slot '{slot_name}'")
            kids.extend(slot_kids)
```
with:
```python
        tab_ids = None
        if entry.get("dynamic_slots"):
            tab_ids = {t.get("id") for t in props.get("tabs", []) if isinstance(t, dict)}
        for slot_name, slot_kids in slots.items():
            if entry["container"]:
                if entry.get("dynamic_slots"):
                    if slot_name not in tab_ids:
                        errors.append(
                            f"'{node_id}' ({node_type}): slot '{slot_name}' has no matching tab in props.tabs"
                        )
                elif slot_name not in entry["slots"]:
                    errors.append(f"'{node_id}' ({node_type}): unknown slot '{slot_name}'")
            kids.extend(slot_kids)
```

- [ ] **Step 6: Run the validator tests to verify they pass**

Run: `python -m pytest tests/plugins/gis_canvas/test_validator.py -q`
Expected: PASS (all, including the three new `tabs` tests and the existing ones).

- [ ] **Step 7: Add `active` to awareness state formatting**

In `plugins/gis-canvas/awareness.py`, inside `_fmt_state`, add after the `value` block (before the `rowSelection` block):
```python
    if "active" in st:
        parts.append(f"active={st['active']}")
```

- [ ] **Step 8: Document `tabs` in the agent catalog**

In `plugins/gis-canvas/tools_canvas.py`, in the `_CATALOG_HELP` string, insert this sentence immediately before the `" (Phase 3 GIS) esri:map ..."` segment (i.e. right after the data-table `state.filter` sentence ends with `"'all' or empty means no filter)."`):
```python
    " (Container) tabs: {id, type:'tabs', props:{tabs:[{id,label},...]}, "
    "state:{active:'<tabId>'}, slots:{'<tabId>':[...child nodes]}} — a tabbed "
    "container; each slot key MUST equal a props.tabs id and holds that tab's "
    "children; the shown tab is tracked client-side in state.active (no agent "
    "turn); optional handlers.onChange fires on tab switch."
```

- [ ] **Step 9: Add the end-to-end tool test**

Append to `tests/plugins/gis_canvas/test_tools.py`:
```python
def test_render_view_accepts_tabs(plugin):
    spec = {
        "canvasVersion": 1,
        "layout": {"type": "grid", "cols": 12, "rowHeight": 80, "gap": 8},
        "components": [
            {
                "id": "insp",
                "type": "tabs",
                "area": {"col": 1, "colSpan": 6, "row": 1, "rowSpan": 3},
                "props": {"tabs": [{"id": "overview", "label": "Overview"}]},
                "slots": {"overview": [{"id": "s1", "type": "stat", "props": {"label": "A", "value": 1}}]},
            }
        ],
    }
    out = json.loads(plugin.tools_canvas.render_view({"spec": spec}, task_id="t1"))
    assert out["ok"] is True
    assert any(c["type"] == "tabs" for c in out["components_index"])
```

- [ ] **Step 10: Run the full backend suite**

Run: `python -m pytest tests/plugins/gis_canvas -q`
Expected: PASS (all, including the new `tabs` validator + tool tests).

- [ ] **Step 11: Commit**

```bash
git add plugins/gis-canvas/schema/canvas.schema.json plugins/gis-canvas/validator.py \
  plugins/gis-canvas/awareness.py plugins/gis-canvas/tools_canvas.py \
  tests/plugins/gis_canvas/test_validator.py tests/plugins/gis_canvas/test_tools.py
git commit -m "feat(gis-canvas): wire tabs molecule through schema/validator/awareness/catalog"
```

---

### Task 5: Registry-extension convention doc + final verification

**Files:**
- Create: `apps/gis-canvas/docs/registry-extension.md`

**Interfaces:**
- Consumes: everything from Tasks 1–4 (the completed `tabs` wiring is the worked example).
- Produces: the documented 8-step convention that makes sub-projects 1–3 mechanical.

- [ ] **Step 1: Write the convention doc**

Create `apps/gis-canvas/docs/registry-extension.md`:
```markdown
# Adding a molecule type to the GIS canvas registry

A molecule `type` is declared in several places that MUST stay in sync. Follow
these steps in order; the `tabs` molecule (2026-07-21) is the reference example.

1. **Schema enum** — add the type to the `type` enum in
   `plugins/gis-canvas/schema/canvas.schema.json`.
2. **TS mirror** — add it to `MOLECULE_TYPES` in
   `apps/gis-canvas/src/lib/types.ts`.
3. **Validator** — add a `CATALOG` entry in `plugins/gis-canvas/validator.py`
   (`container`, `slots`, optional `dynamic_slots`, `required_props`,
   `required_bindings`) and, if it carries live state, a `STATE_KEYS` entry.
   Add any per-type rule alongside the existing slot/area checks.
4. **Registry** — map `type -> component` in
   `apps/gis-canvas/src/components/registry.tsx` (lazy-wrap heavy/ESRI molecules).
5. **Agent catalog** — describe the type + one example in `_CATALOG_HELP` in
   `plugins/gis-canvas/tools_canvas.py`. The agent only knows types documented here.
6. **Component** — implement the molecule in
   `apps/gis-canvas/src/components/molecules/`, composing `../ui/` primitives
   (which are styled on gc- utilities — see `src/components/ui/README.md`).
7. **Tests** — a registry render/behavior test (FE) and validator accept/reject
   tests (Python); add a `render_view` acceptance test for the tool path.
8. **Awareness** — if the type carries live state, format it in `_fmt_state` in
   `plugins/gis-canvas/awareness.py` so the agent sees it each turn.

## Slot models

- **Fixed slots** (e.g. `card` → `{content, footer}`): list them in the
  `CATALOG` entry's `slots` set.
- **Dynamic slots** (e.g. `tabs`): set `dynamic_slots: True` and drive valid slot
  names from props — the validator asserts slot keys are a subset of the
  data-declared ids (for `tabs`, `props.tabs[].id`).
```

- [ ] **Step 2: Full cross-stack verification**

Run each and confirm green:
```bash
npm run --workspace @hermes/gis-canvas test
npm run --workspace @hermes/gis-canvas typecheck
python -m pytest tests/plugins/gis_canvas -q
```
Expected: all pass, no type errors.

- [ ] **Step 3: Manual two-theme visual smoke (drive the app)**

Use the `run` skill (or `npm run --workspace @hermes/gis-canvas dev`) to launch the
app, then have the agent author a canvas containing a `tabs` node with two tabs
(each slot holding a `stat`). Confirm:
- both triggers render, clicking switches panels;
- the primitive chrome reads correctly in light **and** `:root.dark` (toggle theme);
- placing the tabs node in a `dock`/`float` (`.gc-hud`) panel glasses correctly (no opaque band).
Record the result in the commit message / PR description.

- [ ] **Step 4: Commit**

```bash
git add apps/gis-canvas/docs/registry-extension.md
git commit -m "docs(gis-canvas): registry-extension convention (tabs as reference)"
```

---

## Self-Review

**Spec coverage:**
- ShadCN/Radix adoption + `@/` alias + `cn` + `components.json` → Task 1.
- Theming on gc- utilities (corrected, no `@theme inline` bridge) + primitive seed set (`button/badge/separator/tabs/tooltip/scroll-area`) + `ui/README.md` → Task 2.
- `tabs` molecule + registry + `types.ts` → Task 3.
- Schema + `CATALOG`/`STATE_KEYS` + `dynamic_slots` validator generalization + `awareness.py` + `_CATALOG_HELP` → Task 4.
- Registry-extension convention doc + verification (FE suite, typecheck, pytest, two-theme smoke, `.gc-hud` check) → Task 5.
- jsdom polyfills (ResizeObserver/hasPointerCapture/scrollIntoView) → Task 2 Step 1.
- Non-goals (ontology-lite, charts, ESRI depth) correctly excluded.

**Placeholder scan:** none — every code/step is concrete.

**Type consistency:** `TabsMolecule` signature (`MoleculeProps` = `{node, renderChild}`) matches registry usage; `reportInteraction(node.id, { active })` matches `CanvasActions` and the awareness `active=` key and `STATE_KEYS["tabs"] = {"active"}`; `props.tabs[].id` used identically in the molecule, validator `dynamic_slots` check, and tests; `dynamic_slots` flag set in `CATALOG` and read in the validator slot block.
