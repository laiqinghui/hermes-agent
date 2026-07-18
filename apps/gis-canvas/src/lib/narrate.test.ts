import { describe, it, expect } from 'vitest'
import { narrateStep } from './narrate'
import type { BuildStep } from './activity'

const mk = (label: string, extra: Partial<BuildStep> = {}): BuildStep =>
  ({ id: 1, label, status: 'done', ...extra })

describe('narrateStep', () => {
  it('skill_view names the skill from args', () => {
    const n = narrateStep(mk('skill_view', { args: { name: 'denodo-data-agent' } }))
    expect(n.text).toBe('Read skill · denodo-data-agent')
    expect(n.outcome).toBe('ok')
    expect(n.glyph).toBe('✓')
  })

  it('data_query names the table and row count on success', () => {
    const n = narrateStep(mk('data_query', { args: { table: 'admin.vessel_positions' }, result: { rows: [{ a: 1 }, { a: 2 }] } }))
    expect(n.text).toBe('Queried admin.vessel_positions · 2 rows')
    expect(n.outcome).toBe('ok')
  })

  it('data_query marks an error result', () => {
    const n = narrateStep(mk('data_query', { args: { table: 'admin.vessel_positions' }, result: { error: '401 Unauthorized' } }))
    expect(n.text.startsWith('Queried admin.vessel_positions')).toBe(true)
    expect(n.outcome).toBe('error')
    expect(n.glyph).toBe('✕')
  })

  it('exposes a compact outcome tail (row count / error) for a "<label> · <tail>" card', () => {
    expect(narrateStep(mk('data_query', { args: { table: 't' }, result: { rows: [{ a: 1 }, { a: 2 }] } })).tail).toBe('2 rows')
    expect(narrateStep(mk('data_query', { result: { error: '401 Unauthorized' } })).tail).toBe('401 Unauthorized')
    expect(narrateStep(mk('skill_view', { status: 'running' })).tail).toBe('') // running: no result yet
  })

  it('search_files reports the match count from result.total_count', () => {
    expect(narrateStep(mk('search_files', { result: { total_count: 50, files: ['a', 'b'] } })).text)
      .toBe('Searched files · 50 matches')
    expect(narrateStep(mk('search_files', { result: { total_count: 1, files: ['a'] } })).text)
      .toBe('Searched files · 1 match')
  })

  it('read_file shows the basename of the path', () => {
    expect(narrateStep(mk('read_file', { args: { path: 'C:/Users/UserAdmin/data_agent_token.txt' } })).text)
      .toBe('Read data_agent_token.txt')
  })

  it('execute_code / terminal describe the run', () => {
    expect(narrateStep(mk('execute_code', { args: { language: 'python' } })).text).toBe('Ran python')
    expect(narrateStep(mk('terminal', { args: { command: 'python -c "x"' } })).text).toBe('Ran python')
  })

  it('render_view and browser_navigate read naturally', () => {
    expect(narrateStep(mk('render_view')).text).toBe('Rendered the canvas')
    expect(narrateStep(mk('browser_navigate', { args: { url: 'http://dev.com:8080/realms/master' } })).text)
      .toBe('Opened dev.com:8080')
  })

  it('running steps report a running outcome and a neutral glyph', () => {
    const n = narrateStep(mk('data_query', { status: 'running', args: { table: 'x' } }))
    expect(n.outcome).toBe('running')
    expect(n.glyph).toBe('·')
    expect(n.text).toBe('Queried x')
  })

  it('unknown tools fall back to a humanized label plus outcome tail', () => {
    const n = narrateStep(mk('forecast_weather', { result: { rows: [{ a: 1 }, { a: 2 }, { a: 3 }] } }))
    expect(n.text).toBe('Forecast Weather · 3 rows')
    expect(n.outcome).toBe('ok')
  })
})
