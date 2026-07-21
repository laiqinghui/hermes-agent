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
