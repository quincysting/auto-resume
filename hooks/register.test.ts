import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const T0 = Date.parse('2026-10-26T12:00:00Z')

// The engine beneath the mod: a clock that moves only when told, a store in memory,
// a five-hour window spent until an hour from now, and a record of what gets submitted.
function world(on: On) {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const sent: string[] = []
  on('session.id', () => ({ value: 's1' }))
  on('session.usage', () => ({
    value: { startedAt: T0, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(T0 + HOUR).toISOString() }] } as never,
  }))
  on('command.register', () => ({ value: { command: 'auto-resume' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.StopFailure', () => ({}))
  on('classic.Stop', () => ({}))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } as never }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  return { clock, sent }
}

test('a turn stopped on the usage limit picks back up once, just after the reset', async ($, on) => {
  const { clock, sent } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.advance(HOUR - MINUTE)
  expect(sent).toEqual([])

  await clock.advance(3 * MINUTE)
  expect(sent.length).toBe(1)
  expect(sent[0]).toMatch(/usage limit has reset/)

  await clock.advance(HOUR)
  expect(sent.length).toBe(1)
})

test('an error that is not the usage limit is left alone', async ($, on) => {
  const { clock, sent } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.classic.StopFailure({ error: 'overloaded' })
  await clock.advance(3 * HOUR)
  expect(sent).toEqual([])
})
