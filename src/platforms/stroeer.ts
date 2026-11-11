import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { localParts } from '../time.ts'
import type { Event, Platform } from './types.ts'

// Ströer Kulturkalender (Berlin) takes submissions as requests in Ströer's Jira Service Management
// portal ("Ströer Digital Service Portal", ticket.edgar.de). Plain REST with the organizer account's
// basic auth — no browser. The account must be a registered organizer (REGPORTAL "Registrierung
// Ströer Kulturkalender" approved). There is no approval step on Ströer's side beyond their review:
// a submitted request goes out on the city's ad screens.
//
// Field ids from GET /rest/servicedeskapi/servicedesk/30/requesttype/273/field (2026-11-11).

const BASE = 'https://ticket.edgar.de'
const SERVICE_DESK_ID = process.env.STROEER_SERVICEDESK_ID ?? '30' // "Kulturkalender Berlin"
const REQUEST_TYPE_ID = process.env.STROEER_REQUESTTYPE_ID ?? '273' // "Veranstaltung einreichen"

export const STROEER_TITLE_MAX = 16
export const STROEER_VENUE_MAX = 20
const CONFIRMATION_YES = '31700' // "Bestätigung": organizer indemnifies Ströer against third-party claims

/**
 * Date-only start/end. A club night running past midnight (ends next day before noon) is a one-day
 * event for the calendar, and the form asks to repeat the start date for one-day events.
 */
export function stroeerDates(e: Event): { start: string; end: string } {
  const s = localParts(e.start)
  const en = localParts(e.end)
  const nextDay = new Date(`${s.date}T00:00:00Z`)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  const overnight = en.date === nextDay.toISOString().slice(0, 10) && en.time < '12:00'
  return { start: s.date, end: overnight ? s.date : en.date }
}

/** Pure: request body for POST /rest/servicedeskapi/request. Throws on values the tile can't show. */
export function toStroeerRequest(e: Event, temporaryAttachmentId: string) {
  const title = (e.shortTitle || e.title).trim()
  if (title.length > STROEER_TITLE_MAX) {
    throw new Error(`Ströer allows ${STROEER_TITLE_MAX} characters for the title; "${title}" has ${title.length}. Fill in the short title.`)
  }
  const venue = e.venue.trim()
  if (venue.length > STROEER_VENUE_MAX) {
    throw new Error(`Ströer allows ${STROEER_VENUE_MAX} characters for the venue; "${venue}" has ${venue.length}.`)
  }
  const { start, end } = stroeerDates(e)
  return {
    serviceDeskId: SERVICE_DESK_ID,
    requestTypeId: REQUEST_TYPE_ID,
    requestFieldValues: {
      summary: title,
      customfield_32127: venue,
      customfield_32108: start,
      customfield_32109: end,
      attachment: [temporaryAttachmentId],
      ...(process.env.STROEER_COPYRIGHT ? { customfield_33204: process.env.STROEER_COPYRIGHT } : {}),
      customfield_32002: [{ id: CONFIRMATION_YES }],
    },
  }
}

const authHeader = () =>
  'Basic ' + Buffer.from(`${process.env.STROEER_USER}:${process.env.STROEER_PASSWORD}`).toString('base64')

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: authHeader(), Accept: 'application/json', ...init.headers },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Ströer ${path} → ${res.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text) as T
}

export const stroeer: Platform = {
  id: 'stroeer',
  name: 'Ströer Kulturkalender Berlin',
  envVars: ['STROEER_USER', 'STROEER_PASSWORD'],
  async publish(e) {
    if (!e.motifImagePath) {
      throw new Error('Ströer needs a text-free image (no title, date, venue or logos): upload one in "Text-free image".')
    }
    // Validate before uploading anything.
    toStroeerRequest(e, 'pending')

    const form = new FormData()
    form.append('file', new Blob([await readFile(e.motifImagePath)]), basename(e.motifImagePath))
    const upload = await call<{ temporaryAttachments: Array<{ temporaryAttachmentId: string }> }>(
      `/rest/servicedeskapi/servicedesk/${SERVICE_DESK_ID}/attachTemporaryFile`,
      { method: 'POST', body: form, headers: { 'X-ExperimentalApi': 'opt-in', 'X-Atlassian-Token': 'no-check' } },
    )
    const tempId = upload.temporaryAttachments[0].temporaryAttachmentId

    const created = await call<{ issueKey: string; _links?: { web?: string } }>('/rest/servicedeskapi/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toStroeerRequest(e, tempId)),
    })
    return { url: created._links?.web, note: `Request ${created.issueKey} created — Ströer reviews it before it airs.` }
  },
}
