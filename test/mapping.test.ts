import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugify, toSanityEvent } from '../src/platforms/fraktvred.ts'
import { toEventbriteEvent, toTicketClass } from '../src/platforms/eventbrite.ts'
import { submissionMail } from '../src/platforms/email.ts'
import { keepItRollinPromoHtml } from '../src/platforms/keepItRollin.ts'
import { berlinToUtc, utcIsoSeconds } from '../src/time.ts'
import type { Event } from '../src/platforms/types.ts'

const event: Event = {
  title: 'Bass & Bässe',
  start: '2026-11-20T23:00',
  end: '2026-11-21T06:00',
  venue: 'VOID Club + Hall',
  address: 'Musterstr. 1',
  postalCode: '10245',
  city: 'Berlin',
  description: 'First paragraph\nstill first.\n\nSecond <b>paragraph</b>.',
  lineup: ['Known Artist', 'Some Guest', 'Unknown Act'],
  ticketUrl: 'https://tix.fraktvred.com/x',
  price: '15',
}

test('berlin wall clock → UTC across DST', () => {
  assert.equal(berlinToUtc('2026-11-20T23:00').toISOString(), '2026-11-20T22:00:00.000Z') // CET
  assert.equal(berlinToUtc('2026-07-01T23:00').toISOString(), '2026-07-01T21:00:00.000Z') // CEST
  assert.equal(utcIsoSeconds('2026-03-29T03:30'), '2026-03-29T01:30:00Z') // just after spring-forward
})

test('slugify', () => {
  assert.equal(slugify('Bass & Bässe: Vol. 2!'), 'bass-and-baesse-vol-2')
})

test('sanity mapping: venue override, lineup links, price, blurb', () => {
  let n = 0
  const doc = toSanityEvent(event, {
    slug: 'bass-and-baesse',
    posterAssetId: 'image-abc-800x1200-jpg',
    artists: new Map([
      ['known artist', { _id: 'artist-1', _type: 'artist' as const }],
      ['some guest', { _id: 'guest-1', _type: 'nonRosterArtist' as const }],
    ]),
    makeKey: () => `k${n++}`,
  })
  assert.equal(doc._type, 'event')
  assert.equal(doc.date, '2026-11-20T22:00:00.000Z')
  assert.equal(doc.doorsOpen, '23:00')
  assert.equal(doc.doorsClose, '06:00')
  assert.equal((doc as any).venueName, 'VOID Club + Hall')
  assert.equal((doc as any).postalCode, '10245')
  assert.equal((doc as any).venueRef, undefined)
  const rows = (doc as any).lineups[0].runningOrder
  assert.equal((doc as any).lineups[0].title, 'Main Floor')
  assert.deepEqual(rows[0].performers[0].artist, { _type: 'reference', _ref: 'artist-1' })
  assert.equal(rows[0].performers[0].linkType, 'internal')
  assert.equal(rows[1].performers[0].linkType, 'guest')
  assert.deepEqual([rows[2].performers[0].linkType, rows[2].performers[0].act], ['none', 'Unknown Act'])
  assert.deepEqual((doc as any).priceTiers[0], { _key: (doc as any).priceTiers[0]._key, _type: 'priceTier', name: 'GENERAL ADMISSION', status: 'active', amount: 15 })
  assert.equal(doc.blurb.length, 2)
  assert.equal(doc.blurb[0].children[0].text, 'First paragraph still first.')
  assert.equal((doc as any).poster.asset._ref, 'image-abc-800x1200-jpg')
  assert.equal((doc as any).ticketLink, 'https://tix.fraktvred.com/x')
})

test('sanity mapping: referenced venue and non-numeric price', () => {
  const doc = toSanityEvent({ ...event, price: 'pwyc', lineup: [] }, { slug: 's', venueId: 'venue-void' })
  assert.deepEqual((doc as any).venueRef, { _type: 'reference', _ref: 'venue-void' })
  assert.equal((doc as any).venueName, undefined)
  assert.equal((doc as any).priceTiers[0].amountOverride, 'PWYC')
  assert.equal((doc as any).lineups, undefined)
})

test('eventbrite payload', () => {
  const body = toEventbriteEvent(event, { venueId: 'v1', logoId: 'l1' })
  assert.deepEqual(body.event.start, { timezone: 'Europe/Berlin', utc: '2026-11-20T22:00:00Z' })
  assert.deepEqual(body.event.end, { timezone: 'Europe/Berlin', utc: '2026-11-21T05:00:00Z' })
  assert.equal(body.event.name.html, 'Bass &amp; Bässe')
  assert.match(body.event.description.html, /<p>First paragraph<br>still first\.<\/p><p>Second &lt;b&gt;paragraph&lt;\/b&gt;\.<\/p>/)
  assert.match(body.event.description.html, /Known Artist<br>Some Guest/)
  assert.equal(body.event.venue_id, 'v1')
  assert.equal(body.event.logo_id, 'l1')
  assert.equal(toTicketClass(event, 200).ticket_class.cost, 'EUR,1500')
  assert.equal(toTicketClass({ ...event, price: '12,50' }, 200).ticket_class.cost, 'EUR,1250')
  assert.equal(toTicketClass({ ...event, price: 'FREE' }, 200).ticket_class.free, true)
  // Not a sales channel: every order would have to be 99 tickets.
  const tc = toTicketClass(event, 50).ticket_class
  assert.deepEqual([tc.minimum_quantity, tc.maximum_quantity, tc.quantity_total], [99, 99, 99])
})

test('submission mail (Neo Group, visitBerlin)', () => {
  const m = submissionMail(event, 'visitBerlin')
  assert.equal(m.subject, 'Veranstaltung: Bass & Bässe – 20.11.2026')
  assert.match(m.text, /^Hallo visitBerlin Team,/)
  assert.match(m.text, /Datum: 20\.11\.2026, 23:00 – 21\.11\.2026, 06:00 Uhr/)
  assert.match(m.text, /Eintritt: 15 €/)
})


test('keepitrollin promo text adds location only when the dropdown had no match', () => {
  assert.match(keepItRollinPromoHtml(event, false), /Location:<\/strong> VOID Club \+ Hall, Musterstr\. 1, 10245 Berlin/)
  assert.doesNotMatch(keepItRollinPromoHtml(event, true), /Location:/)
})

test('ströer: overnight club night is a one-day event', async () => {
  const { stroeerDates } = await import('../src/platforms/stroeer.ts')
  assert.deepEqual(stroeerDates(event), { start: '2026-11-20', end: '2026-11-20' })
  assert.deepEqual(stroeerDates({ ...event, end: '2026-11-22T18:00' }), { start: '2026-11-20', end: '2026-11-22' })
  assert.deepEqual(stroeerDates({ ...event, end: '2026-11-21T14:00' }), { start: '2026-11-20', end: '2026-11-21' })
})

test('ströer: request body and length limits', async () => {
  const { toStroeerRequest } = await import('../src/platforms/stroeer.ts')
  assert.throws(() => toStroeerRequest({ ...event, title: 'Berlin Bass Music Vibes' }, 't'), /16 characters/)
  const body = toStroeerRequest({ ...event, shortTitle: 'Bass & Bässe' }, 'temp-1')
  assert.deepEqual(body.requestFieldValues, {
    summary: 'Bass & Bässe',
    customfield_32127: 'VOID Club + Hall',
    customfield_32108: '2026-11-20',
    customfield_32109: '2026-11-20',
    attachment: ['temp-1'],
    customfield_32002: [{ id: '31700' }],
  })
  assert.throws(() => toStroeerRequest({ ...event, venue: 'A Very Long Venue Name Indeed' }, 't'), /20 characters/)
})

test('every platform previews without touching the network', async () => {
  const { platforms } = await import('../src/platforms/index.ts')
  const e = { ...event, shortTitle: 'Bass & Bässe', imagePath: '/x/flyer.png', motifImagePath: '/x/motif.png' }
  for (const p of platforms) {
    const items = p.preview(e)
    assert.ok(items.length > 0, p.id)
  }
  const stroeer = platforms.find((p) => p.id === 'stroeer')!
  assert.throws(() => stroeer.preview({ ...e, shortTitle: undefined, title: 'Berlin Bass Music Vibes' }), /16 characters/)
  assert.throws(() => stroeer.preview({ ...e, motifImagePath: undefined }), /text-free image/)
})
