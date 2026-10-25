import type { EngineInterface, Register } from 'claude-code'

// When a turn stops on the usage limit, wait for the limit to reset, then pick the work
// back up with a prompt of its own, so nobody has to sit there waiting to type "continue".

const POLL_MS = 20_000
const SLACK_MS = 90_000 // a little past the reset, so the first request isn't refused again
const FALLBACK_MS = 5 * 60_000 // a 429 that names no spent window: try again in five minutes
const MAX_TRIES = 6
const STALE_MS = 8 * 24 * 3_600_000
export const NUDGE = 'The usage limit has reset. Continue the task you were working on, from where you left off.'

// `at`: when to resume; 0 once the resume prompt went out and its turn hasn't finished.
type Pending = { at: number; tries: number; since: number }
type Off = { since: number }

const keyOf = async ($: EngineInterface, kind: 'pending' | 'off') => `${kind}:${await $.session.id()}`
const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

let firing = false

// The latest reset among the windows that are spent (five-hour and weekly can both be).
async function resumeAt($: EngineInterface, now: number): Promise<number> {
  const { rateLimits } = await $.session.usage()
  const resets = rateLimits
    .filter(w => w.percentUsed >= 100 && w.resetsAt)
    .map(w => Date.parse(w.resetsAt as string))
    .filter(Number.isFinite)
  return resets.length ? Math.max(...resets) + SLACK_MS : now + FALLBACK_MS
}

async function tick($: EngineInterface): Promise<void> {
  if (firing) return
  const key = await keyOf($, 'pending')
  const pending = (await $.store.get(key)) as Pending | undefined
  if (!pending?.at) {
    void $.ui.status(undefined)
    return
  }
  if ((await $.clock.now()) < pending.at) {
    void $.ui.status(`auto-resume at ${timeOf(pending.at)}`)
    return
  }
  firing = true
  try {
    await $.store.set(key, { ...pending, at: 0 } satisfies Pending)
    void $.ui.status(undefined)
    void $.ui.notify('The usage limit reset, so the work was picked back up.', { title: 'auto-resume' })
    await $.prompt.submit({ text: NUDGE })
  } finally {
    firing = false
  }
}

async function prune($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    const value = (await $.store.get(key)) as { since?: number } | undefined
    if (!value?.since || now - value.since > STALE_MS) await $.store.delete(key)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'auto-resume', description: 'Pick work back up when the usage limit resets: status, on or off' })
    void prune($)
    $.clock.every(POLL_MS, () => tick($))
    void tick($)
    return started
  })

  on('classic.StopFailure', async ($, e, next) => {
    const result = await next(e)
    if (e.error !== 'rate_limit' || (await $.store.get(await keyOf($, 'off')))) return result
    const key = await keyOf($, 'pending')
    const now = await $.clock.now()
    const tries = (((await $.store.get(key)) as Pending | undefined)?.tries ?? 0) + 1
    if (tries > MAX_TRIES) {
      await $.store.delete(key)
      void $.ui.toast(`auto-resume: still limited after ${MAX_TRIES} tries, standing down`)
      return result
    }
    const at = await resumeAt($, now)
    await $.store.set(key, { at, tries, since: now } satisfies Pending)
    void $.ui.toast(`Usage limit hit: picking back up at ${timeOf(at)}`)
    void tick($)
    return result
  })

  // The resumed turn finished cleanly: the wait is over, and the try count starts again.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    const key = await keyOf($, 'pending')
    if (((await $.store.get(key)) as Pending | undefined)?.at === 0) await $.store.delete(key)
    return result
  })

  // The person picked it up themselves (a prompt, not a slash command): stand down.
  on('prompt.submit', async ($, e, next) => {
    if (!e.command && (e.origin.kind === 'composer' || e.origin.kind === 'bridge')) {
      await $.store.delete(await keyOf($, 'pending'))
      void tick($)
    }
    return next(e)
  })

  on('command.run', { command: 'auto-resume' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const offKey = await keyOf($, 'off')
    const key = await keyOf($, 'pending')
    if (word === 'off') {
      await $.store.set(offKey, { since: await $.clock.now() } satisfies Off)
      await $.store.delete(key)
      void tick($)
      return { text: 'Auto-resume is off for this session.' }
    }
    if (word === 'on') {
      await $.store.delete(offKey)
      return { text: 'Auto-resume is on: a turn that stops on the usage limit picks back up when it resets.' }
    }
    if (await $.store.get(offKey)) return { text: 'Auto-resume is off for this session; `/auto-resume on` turns it back on.' }
    const pending = (await $.store.get(key)) as Pending | undefined
    if (pending?.at) return { text: `Picking back up at ${timeOf(pending.at)} (try ${pending.tries} of ${MAX_TRIES}).` }
    return { text: 'Auto-resume is on. Nothing is waiting on the usage limit right now.' }
  })
}
