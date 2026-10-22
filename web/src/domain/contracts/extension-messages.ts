import { z } from 'zod'

// Protocol of window.postMessage between the app and the extension bridge
// (extension/plans/extension-plan.md §8). Field shapes follow what the extension really
// sends (background.js) and what slots.html really sends (postToExt); ext:booking is gone.
// Loose objects: the extension may add fields without the app breaking. An unknown `type`
// fails the parse, and the receiver drops the message.

const slotSchema = z.looseObject({ date: z.string(), time: z.string() })

const draftSchema = z.looseObject({
  url: z.string(),
  taskId: z.string().optional(),
  step: z.string().optional(),
  createdAt: z.number().nullable().optional(),
  expiresAt: z.number().nullable().optional(),
  foundAt: z.number().optional(),
})

const ext = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.looseObject({ source: z.literal('econsul-ext'), type: z.literal(type), ...shape })

const app = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.looseObject({ source: z.literal('econsul-app'), type: z.literal(type), ...shape })

// Extension -> app
export const extMessageSchema = z.discriminatedUnion('type', [
  ext('ext:hello', { version: z.string().optional() }),
  ext('ext:auth', {
    loggedIn: z.boolean().nullable(),
    exp: z.number().nullable().optional(),
    reason: z.string().nullable().optional(),
    // the app, not the extension, plays the «broken glass» sound
    alert: z.boolean().optional(),
  }),
  ext('ext:token', { token: z.string().min(1), exp: z.number().nullable().optional() }),
  ext('ext:draft', { draft: draftSchema.nullable() }),
  // The extension fills steps 1–3 of a new application itself: running, failed (with the reason), or null when done / idle
  ext('ext:draft-job', {
    status: z.enum(['running', 'failed']).nullable(),
    error: z.string().nullable().optional(),
    text: z.string().nullable().optional(),
  }),
  ext('ext:mute', {}),
  // The reminder fired shortly before the location opens new days (`at`: the opening moment, epoch ms)
  ext('ext:alarm', { at: z.number(), opening: z.string().nullable().optional() }),
  ext('ext:slots-received', { count: z.number() }),
  ext('ext:settings', {
    autoBook: z.boolean(),
    // v0.9: no press limit, one press per slot, 5 min quarantine; off when the session ends
    aggressiveBook: z.boolean().optional(),
    paused: z.boolean(),
    // v0.5: a draft made after a login, and the alarm that makes one before the location opens
    autoDraft: z.boolean().optional(),
    autoMonitor: z.boolean().optional(),
    alarmEnabled: z.boolean().optional(),
    alarmLeadMin: z.number().optional(),
  }),
  ext('ext:slot-selected', { slot: slotSchema }),
  ext('ext:slot-booked', { slot: slotSchema }),
  ext('ext:slot-failed', {
    error: z.string().optional(),
    text: z.string().optional(),
    test: z.boolean().optional(),
  }),
])
export type ExtMessage = z.infer<typeof extMessageSchema>

export type AppSlot = { date: string; time: string; consulIpnHash?: string }

const appSlotSchema = z.object({
  date: z.string(),
  time: z.string(),
  consulIpnHash: z.string().optional(),
})

const monitorSchema = z.looseObject({
  running: z.boolean(),
  nextAt: z.number(),
  nextKind: z.string().nullable().optional(),
  checking: z.boolean(),
  lastResult: z.string().nullable().optional(),
  stoppedBy: z.string().nullable().optional(),
  institution: z.string().nullable(),
  nextRelease: z.object({ at: z.number(), opening: z.string() }).nullable(), // opening: consulate time, '09:00'
  // v0.14: the extension selects slots from the calendar itself at the opening, only within this range
  dateRange: z.object({ from: z.string().nullable(), to: z.string().nullable() }).optional(),
})

// App -> extension
export const appMessageSchema = z.discriminatedUnion('type', [
  app('app:hello', { audioReady: z.boolean().optional() }),
  app('app:selection', {
    selection: z.object({
      institutionCode: z.string(),
      institutionName: z.string(),
      countryName: z.string(),
      serviceCode: z.string(),
      serviceName: z.string(),
    }),
  }),
  app('app:auth-failed', {
    status: z.number(),
    soundPlayed: z.boolean().optional(),
    // an old token pasted by hand: the extension compares it with the site's valid one
    token: z.string().optional(),
  }),
  app('app:slots', {
    slots: z.array(appSlotSchema),
    range: z.object({ from: z.string().optional(), to: z.string().optional() }),
    test: z.boolean().optional(),
    // every free slot offered to a new draft, not only new ones: tried after new slots
    all: z.boolean().optional(),
  }),
  app('app:monitor', { audioReady: z.boolean(), monitor: monitorSchema }),
  app('app:received', { exp: z.number().nullable().optional(), draftUrl: z.string().optional() }),
  app('app:login', {}),
  app('app:create-draft', {}),
  app('app:mute', {}),
  app('app:test-sound', { sound: z.enum(['selected', 'glass']) }),
  app('app:settings', {
    patch: z.object({
      autoBook: z.boolean().optional(),
      aggressiveBook: z.boolean().optional(),
      autoDraft: z.boolean().optional(),
      autoMonitor: z.boolean().optional(),
      alarmEnabled: z.boolean().optional(),
      alarmLeadMin: z.number().optional(),
    }),
  }),
])
export type AppMessage = z.infer<typeof appMessageSchema>
