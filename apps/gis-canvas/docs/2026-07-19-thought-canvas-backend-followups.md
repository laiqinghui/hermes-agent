# Thought Canvas — Backend Follow-Ups (detailed)

**Prepared:** 2026-07-19, from the GIS Generative Canvas "thought canvas" work.
**Context:** Phase A (cognition plane) is frontend-only and shipped on branch `gis/thought-canvas`.
During live verification, three issues surfaced whose root cause is in the **backend gateway / agent /
auth**, i.e. out of scope for the frontend branch. They are logged here in full so they can be picked
up directly. Ordered by impact.

All `server.py` line numbers are `tui_gateway/server.py` as of this writing — re-grep before editing,
they drift.

---

## 1. Real reasoning (`reasoning.available` summaries) does not reach the canvas session

### Symptom
The canvas "thinking star" cannot show the agent's real reasoning. The desktop Hermes UI, on an
equivalent GREY-LADY run, shows genuine reasoning summaries interleaved with steps:
- *"Preparing denodo-data-agent for query"*
- *"Planning query and rendering latest 20 positions"*
- *"Planning map and table rendering"*

The canvas never receives these. As a frontend stop-gap the star now falls back to the current step's
`context` (its stated intent); getting the *real* reasoning is this backend item.

### What was verified (evidence)
- **`reasoning.available` is NOT arriving at the canvas SPA.** With the SPA logging
  `reasoning.available` (it always has), the star showed only the "Composing…" placeholder — no
  reasoning items were ever derived for these turns.
- **`thinking.delta` DOES arrive but is decorative for these sessions.** `thinking_callback` is wired
  unconditionally (`server.py:3614` → `_emit("thinking.delta", …)`). Capturing it on the frontend
  surfaced only a decorative live indicator — `"(°□°) synthesizing…"` — not real reasoning. (That
  capture was reverted; commit `40ab34fd9`.)
- **`show_reasoning` is DISPLAY-ONLY — it does NOT gate emission.** The session flag is set at
  `server.py:4076` and `:4973` (`_load_show_reasoning()`, config `display.show_reasoning`, default
  **False**), toggled by the `/reasoning show|hide` handler (`:10012`–`:10052`), and only *reported*
  back in `session.info` (`:4396`, `:5225`) and the `/reasoning` status (`:10777`–`:10787`). It is
  **never read to decide whether reasoning is emitted.** Critically, `_make_agent(...)` (`:4206`) takes
  **no** `show_reasoning`/reasoning-display parameter — so flipping it (e.g. adding it as a
  session.create override at `:4973`) will **not** make real reasoning flow. Do not go down that path.
- **The relay path is fine.** `_agent_cbs(sid)` (`:3601`) wires `tool_progress_callback` →
  `_on_tool_progress` (`:3409`), which at `:3424` emits `reasoning.available` **iff** it is called with
  `event_type=="reasoning.available"` and a truthy `preview`. So the gateway will relay real reasoning
  the moment the **agent produces it**. The gap is upstream: the agent isn't producing reasoning-summary
  previews (non-empty `preview`) for the canvas session.

### Most likely root cause (hypothesis — needs runtime confirmation)
The agent's reasoning-summary generation depends on the **model's reasoning/thinking configuration**,
which differs between the desktop composer and the canvas `session.create`:
- Canvas creates its session with `session.create({cols: 96})` only (see
  `apps/gis-canvas/src/App.tsx`, the `session.create` request) — **no `reasoning_effort`**, so it uses
  the config default (`agent.reasoning_effort`, default `"medium"`, seen at `:10780`).
- `session.create` DOES honor a per-session `reasoning_effort` override (`server.py:4929`–`4935` →
  `create_reasoning_override`, built into the agent). The desktop composer ships this on every create
  (see the "PER-SESSION override" comment at `:4917`).
- The decorative `"(°□°) synthesizing…"` strongly suggests the model is **not** doing visible extended
  thinking / reasoning-summary emission for the canvas turns, whereas the desktop (higher/explicit
  effort, or reasoning-summaries on) is.
- Secondary suspect: the data path delegates to the **Denodo data agent over A2A** (a sub-agent). The
  real "Planning query…" reasoning is almost certainly the **parent** agent's, which should surface via
  the parent callbacks — but confirm the parent is actually emitting it and it's not being swallowed on
  the sub-agent boundary (memory: only `subagent.*` events carry `parent_id`/`depth`).

### How to investigate (do this first — it's the unknown)
1. **Trace what fires.** Temporarily log inside `_on_tool_progress` (`server.py:3409`) the
   `event_type` + `bool(preview)` + `sid`, and run the GREY-LADY prompt on BOTH the canvas session and
   a desktop session. Compare: does `reasoning.available` fire with a non-empty `preview` for the
   desktop `sid` but not the canvas `sid`? (Expected: yes.)
2. **Compare agent config per session.** Log the effective `reasoning_effort` / model / thinking flags
   the agent is built with for each `sid` (in `_make_agent`, `:4206`). Confirm the canvas session's
   effort/thinking differs from the desktop's.

### Proposed fix (in order of preference)
- **A (try first, smallest): make the canvas ask for reasoning at create.** Have the SPA pass a
  reasoning effort (and whatever enables reasoning summaries) on `session.create`, e.g.
  `session.create({ cols: 96, reasoning_effort: 'medium' })` — the override is already honored
  (`:4929`). If the desktop's real reasoning is purely an effort/summaries difference, this fixes it
  frontend-side with zero backend change. **Verify with step 1 above that this makes `preview`
  non-empty.**
- **B (if A insufficient): enable reasoning-summary emission in the agent build.** If the agent needs
  an explicit "emit reasoning previews" switch that the desktop sets but `session.create` doesn't pass
  through, thread it through `session.create` → `_make_agent` (mirror how `reasoning_effort` is
  threaded). This is a backend change but small and well-patterned.
- **C (fallback): surface the sub-agent's reasoning.** If the meaningful reasoning happens in the
  Denodo sub-agent and isn't relayed, add relaying of `subagent` reasoning to the parent session's
  `reasoning.available` (heavier; only if A/B don't cover it).

### Verification
Re-run the GREY-LADY prompt in the canvas. Success = the thinking star shows real summaries
(*"Preparing…"*, *"Planning query…"*, *"Planning map…"*), matching the desktop, and
`reasoning.available` events are observed arriving at the SPA. The frontend already renders
`reasoning.available` correctly (it fills the star and pushes `context` to the card), so **no frontend
change is needed once the events flow** — the fallback simply stops triggering.

---

## 2. Tool `context` is truncated to 80 characters

### Symptom
The step description shown on the canvas (and the dock) is cut off mid-word, e.g.
`"…retrieve the latest 20 position records for vess…"`. The canvas star (via the context fallback) and
the dock ticker both inherit this truncation.

### Root cause (exact)
`_tool_ctx(name, args)` (`server.py:3193`–`3199`) returns `build_tool_label(name, args, max_len=80)`.
The **`max_len=80`** is the cap. This context is emitted on `tool.start` (`:3351`) and is the only
human description of an in-flight step the frontend receives (raw `args` are only sent on
`tool.complete`, `:3363`, and `args_text` only in verbose mode, `:3353`–`:3356`).

### Proposed fix
Raise the cap in `_tool_ctx` — `max_len=80` → `~240` (or make it configurable via
`display.tool_context_max` with an 80 default). One-line, low-risk display change.
- File: `tui_gateway/server.py:3197`.

### Risk / scope
Low. `build_tool_label` output is also consumed by the TUI/desktop live views, which do their own
display truncation — confirm they don't assume ≤80 (they shouldn't; they truncate for their own width).
Slightly larger `tool.start` payloads. No data-plane impact.

### Verification
Dock ticker and canvas star show the full intent sentence, no `…` mid-word.

---

## 3. `data_query` 401 → the agent hand-rolls a raw `execute_code`/PKCE storm

### Symptom
On a data prompt, `data_query` returns `[TOOL_ERROR] … 401 Unauthorized`; the agent then abandons the
auth-free `data_query` and performs the **raw Denodo integration by hand** — PKCE token requests,
`read_file` of `data_agent_token.txt`, `execute_code` running `import requests
url='http://dev.com:8080/realms/…'`, etc. — producing **25+ steps** for one prompt. (The cognition
plane now stays bounded/readable through this, but the underlying behavior is still wrong.)

### Root cause (two parts)
1. **The 401 itself** — the BFF's per-user Denodo token for this session is expired/invalid (the
   services had been up a long time). Auth/session-lifetime issue in the BFF token store / OIDC refresh
   (`apps/gis-canvas-bff/`). The BFF already has one-shot refresh-and-retry on upstream 401
   (see the Phase-5 hardening notes) — check why it isn't recovering here (token fully expired? refresh
   token gone? wrong session mapping?).
2. **The fallback playbook** — even when it shouldn't, the agent reaches for the raw integration because
   the `denodo-data-agent` skill teaches that workflow. This is already written up in detail:
   **`apps/gis-canvas/docs/2026-07-17-denodo-skill-tuning-brief.md`** (make `data_query` the preferred,
   auth-free path; mark PKCE/`execute_code` as fallback-only; also flags a plaintext client secret in
   that skill to scrub).

### Proposed fixes
- **Auth:** diagnose and fix the 401 (token refresh / re-login) so `data_query` succeeds — see the BFF
  A2A proxy refresh path.
- **Skill:** apply `2026-07-17-denodo-skill-tuning-brief.md` (steer the agent to `data_query`).

### Verification
Re-run the GREY-LADY prompt: `data_query` succeeds (map + table render), the trace is a handful of
steps (`skill_view` → `data_query` → `render_view`), with **no** `execute_code`/PKCE steps.

---

## 4. (Repo-tracked, not strictly backend) `render_view` over-composition + hero guidance

Tracked already as **Phase C** of the thought-canvas design
(`apps/gis-canvas/docs/2026-07-17-thought-canvas-design.md`, §5): edit the `render_view` tool
description in `plugins/gis-canvas/tools_canvas.py` for "one table/map per dataset", the
`layer:'base'` hero rule, and "render_view always required". Listed here for completeness since it
also lives outside the Phase-A frontend branch.

---

## Quick reference

| # | Item | Key location | Fix size |
|---|------|--------------|----------|
| 1 | Real reasoning not reaching canvas | `server.py:3409/3424/3601/4206/4929`; SPA `session.create` | investigate → small |
| 2 | 80-char context cap | `server.py:3197` (`_tool_ctx` `max_len`) | 1 line |
| 3 | 401 → execute_code storm | `apps/gis-canvas-bff/` (auth) + `2026-07-17-denodo-skill-tuning-brief.md` (skill) | medium |
| 4 | render_view composition guidance | `plugins/gis-canvas/tools_canvas.py` | small (Phase C) |
