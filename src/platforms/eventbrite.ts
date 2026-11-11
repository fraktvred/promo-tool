import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Event, Platform } from './types.ts'
import { TIME_ZONE, utcIsoSeconds } from '../time.ts'

const API = 'https://www.eventbriteapi.com/v3'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function descriptionHtml(e: Event): string {
  const paras = e.description.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const html = paras.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
  if (e.lineup.length) html.push(`<p><strong>Lineup:</strong><br>${e.lineup.map(escapeHtml).join('<br>')}</p>`)
  if (e.ticketUrl) html.push(`<p>Tickets: <a href="${escapeHtml(e.ticketUrl)}">${escapeHtml(e.ticketUrl)}</a></p>`)
  return html.join('')
}

/** Pure: request body for POST /organizations/{org}/events/. */
export function toEventbriteEvent(e: Event, refs: { venueId?: string; logoId?: string }) {
  return {
    event: {
      name: { html: escapeHtml(e.title) },
      description: { html: descriptionHtml(e) },
      start: { timezone: TIME_ZONE, utc: utcIsoSeconds(e.start) },
      end: { timezone: TIME_ZONE, utc: utcIsoSeconds(e.end) },
      currency: 'EUR',
      online_event: false,
      listed: true,
      shareable: true,
      ...(refs.venueId ? { venue_id: refs.venueId } : {}),
      ...(refs.logoId ? { logo_id: refs.logoId } : {}),
    },
  }
}

// Eventbrite is not a sales channel: tickets are sold in our own pretix shop (the ticket URL in the
// description). The event only exists on Eventbrite so Spotify lists it on each artist's page, and
// Eventbrite needs a ticket class to publish. The class shows the real price but requires an order
// of at least 99 tickets, which in practice makes it unbuyable. Max per order = min, since Eventbrite
// rejects a minimum above the maximum, and the total must cover one such order.
export const BLOCKING_ORDER_SIZE = 99

/** Pure: request body for POST /events/{id}/ticket_classes/. Price in euros → "EUR,1500" (cents). */
export function toTicketClass(
  e: Event,
  capacity: number,
): {
  ticket_class: {
    name: string
    quantity_total: number
    minimum_quantity: number
    maximum_quantity: number
    cost?: string
    free?: boolean
  }
} {
  const n = Number(e.price?.trim().replace(',', '.').replace(/\s*€$/, ''))
  const paid = e.price?.trim() && Number.isFinite(n) && n > 0
  return {
    ticket_class: {
      name: 'General Admission',
      quantity_total: Math.max(capacity, BLOCKING_ORDER_SIZE),
      minimum_quantity: BLOCKING_ORDER_SIZE,
      maximum_quantity: BLOCKING_ORDER_SIZE,
      ...(paid ? { cost: `EUR,${Math.round(n * 100)}` } : { free: true }),
    },
  }
}

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${process.env.EVENTBRITE_TOKEN}`, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Eventbrite ${path} → ${res.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text) as T
}

async function uploadLogo(imagePath: string): Promise<string> {
  const instr = await api<{
    upload_url: string
    upload_token: string
    upload_data: Record<string, string>
    file_parameter_name: string
  }>('/media/upload/?type=image-event-logo')
  const form = new FormData()
  for (const [k, v] of Object.entries(instr.upload_data)) form.append(k, v)
  form.append(instr.file_parameter_name, new Blob([await readFile(imagePath)]), basename(imagePath))
  const up = await fetch(instr.upload_url, { method: 'POST', body: form })
  if (!up.ok) throw new Error(`Eventbrite logo upload → ${up.status}: ${(await up.text()).slice(0, 300)}`)
  const media = await api<{ id: string }>('/media/upload/', { body: { upload_token: instr.upload_token } })
  return media.id
}

export const eventbrite: Platform = {
  id: 'eventbrite',
  name: 'Eventbrite',
  envVars: ['EVENTBRITE_TOKEN', 'EVENTBRITE_ORG_ID'],
  async publish(e) {
    const org = process.env.EVENTBRITE_ORG_ID
    const venue = await api<{ id: string }>(`/organizations/${org}/venues/`, {
      body: {
        venue: {
          name: e.venue,
          address: { address_1: e.address, city: e.city, postal_code: e.postalCode, country: 'DE' },
        },
      },
    })
    const logoId = e.imagePath ? await uploadLogo(e.imagePath) : undefined
    const created = await api<{ id: string; url: string }>(`/organizations/${org}/events/`, {
      body: toEventbriteEvent(e, { venueId: venue.id, logoId }),
    })
    await api(`/events/${created.id}/ticket_classes/`, {
      body: toTicketClass(e, Number(process.env.EVENTBRITE_CAPACITY ?? 200)),
    })

    // Always publish: Spotify only picks up published events.
    await api(`/events/${created.id}/publish/`, { method: 'POST' })
    return { url: created.url, note: 'Published.' }
  },
}
