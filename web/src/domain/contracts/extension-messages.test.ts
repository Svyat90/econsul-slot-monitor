import { describe, expect, it } from 'vitest'
import { appMessageSchema, extMessageSchema } from './extension-messages.ts'

const ext = (m: Record<string, unknown>) => ({ source: 'econsul-ext', ...m })
const app = (m: Record<string, unknown>) => ({ source: 'econsul-app', ...m })

const draft = {
  url: 'https://my.e-consul.gov.ua/tasks/1',
  taskId: '1',
  step: 'slots',
  createdAt: null,
  expiresAt: 1760000000000,
  foundAt: 1759990000000,
}

describe('extMessageSchema', () => {
  it.each([
    ext({ type: 'ext:hello', version: '1.2.3' }),
    ext({ type: 'ext:auth', loggedIn: true, exp: 1760000000000 }),
    ext({ type: 'ext:auth', loggedIn: false, exp: null, reason: 'api', alert: true }),
    ext({ type: 'ext:auth', loggedIn: null, exp: null, reason: null }),
    ext({ type: 'ext:token', token: 'x', exp: 1760000000000 }),
    ext({ type: 'ext:draft', draft }),
    ext({ type: 'ext:draft', draft: null }),
    ext({ type: 'ext:mute' }),
    ext({ type: 'ext:slots-received', count: 2 }),
    ext({ type: 'ext:settings', autoBook: true, paused: false }),
    ext({ type: 'ext:slot-selected', slot: { date: '2026-10-16', time: '10:30' } }),
    ext({ type: 'ext:slot-booked', slot: { date: '2026-10-16', time: '10:30' } }),
    ext({ type: 'ext:slot-failed', error: 'no-slot', text: 'Немає слота', test: false }),
  ])('parses %j', (msg) => {
    expect(extMessageSchema.safeParse(msg).success).toBe(true)
  })

  it('rejects ext:token without a token', () => {
    expect(extMessageSchema.safeParse(ext({ type: 'ext:token', exp: 1 })).success).toBe(false)
  })

  it('rejects the app source', () => {
    expect(extMessageSchema.safeParse({ source: 'econsul-app', type: 'ext:mute' }).success).toBe(false)
  })

  it('rejects an unknown type (including the dropped ext:booking)', () => {
    expect(extMessageSchema.safeParse(ext({ type: 'ext:booking', state: 'selected' })).success).toBe(false)
    expect(extMessageSchema.safeParse(ext({ type: 'ext:nope' })).success).toBe(false)
  })
})

describe('appMessageSchema', () => {
  const monitor = {
    running: true,
    nextAt: 0,
    nextKind: 'regular',
    checking: false,
    lastResult: null,
    stoppedBy: null,
    institution: 'Генеральне консульство',
    nextRelease: { at: 1760000000000, opening: true },
  }

  it.each([
    app({ type: 'app:hello', audioReady: true }),
    app({ type: 'app:hello' }),
    app({
      type: 'app:selection',
      selection: { institutionCode: '1', institutionName: 'N', countryName: 'C', serviceCode: '2', serviceName: 'S' },
    }),
    app({ type: 'app:auth-failed', status: 401, soundPlayed: false, token: 't' }),
    app({ type: 'app:auth-failed', status: 403 }),
    app({ type: 'app:slots', slots: [{ date: '2026-10-16', time: '10:30', consulIpnHash: 'h' }], range: { from: '2026-10-16' }, test: false }),
    app({ type: 'app:slots', slots: [{ date: '2026-10-16', time: '10:30' }], range: {} }),
    app({ type: 'app:monitor', audioReady: false, monitor }),
    app({ type: 'app:received', exp: 1760000000000 }),
    app({ type: 'app:received', draftUrl: 'https://x' }),
    app({ type: 'app:login' }),
    app({ type: 'app:mute' }),
    app({ type: 'app:test-sound', sound: 'glass' }),
    app({ type: 'app:settings', patch: { autoBook: true } }),
  ])('parses %j', (msg) => {
    expect(appMessageSchema.safeParse(msg).success).toBe(true)
  })

  it('rejects the ext source and unknown types', () => {
    expect(appMessageSchema.safeParse({ source: 'econsul-ext', type: 'app:login' }).success).toBe(false)
    expect(appMessageSchema.safeParse(app({ type: 'app:nope' })).success).toBe(false)
  })

  it('rejects an unknown test sound', () => {
    expect(appMessageSchema.safeParse(app({ type: 'app:test-sound', sound: 'boom' })).success).toBe(false)
  })
})
