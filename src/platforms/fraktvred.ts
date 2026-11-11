import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient, type SanityClient } from '@sanity/client'
import type { Event, Platform } from './types.ts'
import { berlinToUtc, localParts } from '../time.ts'

// Mapping follows schemaTypes/event.ts in fraktvred/studio-fraktvred-website.
//
// The document is created as a DRAFT (`drafts.<id>`), never published: the studio's rules forbid
// publishing live content without a human's approval, and the website picks up published events
// within 60s via ISR. Review and publish it in the Studio.

const STUDIO_URL = 'https://fraktvred.sanity.studio'
const MAIN_FLOOR_TITLE = 'Main Floor'

const key = () => randomBytes(6).toString('hex')

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/&/g, ' and ')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** An existing artist document a lineup name resolved to. */
export type ArtistMatch = { _id: string; _type: 'artist' | 'nonRosterArtist' }

export type SanityRefs = {
  slug: string
  venueId?: string
  posterAssetId?: string
  /** Keyed by `normalizeName(lineup entry)`. */
  artists?: Map<string, ArtistMatch>
  makeKey?: () => string
}

/** Pure: build the event document body (without `_id`). */
export function toSanityEvent(e: Event, refs: SanityRefs) {
  const k = refs.makeKey ?? key
  const start = localParts(e.start)
  const end = localParts(e.end)

  const performerRow = (name: string) => {
    const match = refs.artists?.get(normalizeName(name))
    const performer: Record<string, unknown> = { _key: k(), _type: 'performer' }
    if (match?._type === 'artist') Object.assign(performer, { linkType: 'internal', artist: { _type: 'reference', _ref: match._id } })
    else if (match?._type === 'nonRosterArtist') Object.assign(performer, { linkType: 'guest', guest: { _type: 'reference', _ref: match._id } })
    else Object.assign(performer, { linkType: 'none', act: name })
    return { _key: k(), _type: 'runningOrderRow', performers: [performer] }
  }

  const priceTier = () => {
    const raw = e.price?.trim()
    if (!raw) return undefined
    const n = Number(raw.replace(',', '.').replace(/\s*€$/, ''))
    return {
      _key: k(),
      _type: 'priceTier',
      name: 'GENERAL ADMISSION',
      status: 'active',
      ...(Number.isFinite(n) ? { amount: n } : { amountOverride: raw.toUpperCase() }),
    }
  }

  const tier = priceTier()
  const paragraphs = e.description.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)

  return {
    _type: 'event',
    title: e.title,
    slug: { _type: 'slug', current: refs.slug },
    isFraktvredEvent: false,
    date: berlinToUtc(e.start).toISOString(),
    doorsOpen: start.time,
    doorsClose: end.time,
    ...(refs.venueId
      ? { venueRef: { _type: 'reference', _ref: refs.venueId } }
      : { venueName: e.venue, address: e.address, city: e.city, ...(e.postalCode ? { postalCode: e.postalCode } : {}) }),
    ...(e.lineup.length
      ? { lineups: [{ _key: k(), _type: 'lineupFloor', title: MAIN_FLOOR_TITLE, runningOrder: e.lineup.map(performerRow) }] }
      : {}),
    ...(tier ? { priceTiers: [tier] } : {}),
    ...(e.ticketUrl ? { ticketLink: e.ticketUrl } : {}),
    blurb: paragraphs.map((text) => ({
      _key: k(),
      _type: 'block',
      style: 'normal',
      markDefs: [],
      children: [{ _key: k(), _type: 'span', text: text.replace(/\n/g, ' '), marks: [] }],
    })),
    ...(refs.posterAssetId
      ? { poster: { _type: 'image', asset: { _type: 'reference', _ref: refs.posterAssetId }, alt: `Poster: ${e.title}` } }
      : {}),
  }
}

async function freeSlug(client: SanityClient, title: string, date: string): Promise<string> {
  const base = slugify(title)
  const taken = (s: string) => client.fetch<boolean>('defined(*[_type == "event" && slug.current == $s][0]._id)', { s })
  if (!(await taken(base))) return base
  const dated = `${base}-${date}`
  if (!(await taken(dated))) return dated
  return `${dated}-${key().slice(0, 4)}`
}

export const fraktvred: Platform = {
  id: 'fraktvred',
  name: 'fraktvred.com (Sanity draft)',
  envVars: ['SANITY_PROJECT_ID', 'SANITY_DATASET', 'SANITY_TOKEN'],
  preview(e) {
    let n = 0
    const doc = toSanityEvent(e, {
      slug: slugify(e.title),
      posterAssetId: e.imagePath ? '<uploaded flyer>' : undefined,
      makeKey: () => `k${n++}`,
    })
    return [
      {
        label: 'On publish',
        text: 'Created as a DRAFT. Venue and lineup names are linked to existing venue / artist documents when the names match; if the slug is taken, the date is appended.',
      },
      ...(e.imagePath ? [{ label: 'Poster', image: e.imagePath }] : []),
      { label: 'Document', json: doc },
    ]
  },
  async publish(e) {
    const client = createClient({
      projectId: process.env.SANITY_PROJECT_ID!,
      dataset: process.env.SANITY_DATASET!,
      token: process.env.SANITY_TOKEN!,
      apiVersion: '2025-02-19',
      useCdn: false,
    })

    const venueId = await client.fetch<string | null>(
      '*[_type == "venue" && lower(name) == lower($name) && !(_id in path("drafts.**"))][0]._id',
      { name: e.venue.trim() },
    )
    const names = e.lineup.map(normalizeName)
    const found = await client.fetch<Array<ArtistMatch & { name: string }>>(
      '*[_type in ["artist", "nonRosterArtist"] && lower(name) in $names && !(_id in path("drafts.**"))]{_id, _type, name}',
      { names },
    )
    // Roster artists win over guests with the same name.
    const artists = new Map<string, ArtistMatch>()
    const rank = (a: ArtistMatch) => (a._type === 'artist' ? 1 : 0)
    for (const a of found.sort((x, y) => rank(x) - rank(y))) artists.set(normalizeName(a.name), a)

    const posterAssetId = e.imagePath
      ? (await client.assets.upload('image', createReadStream(e.imagePath), { filename: basename(e.imagePath) }))._id
      : undefined

    const slug = await freeSlug(client, e.title, localParts(e.start).date)
    const id = `drafts.${randomUUID()}`
    const body: Record<string, unknown> = toSanityEvent(e, { slug, venueId: venueId ?? undefined, posterAssetId, artists })
    await client.create({ ...body, _id: id, _type: 'event' })

    const matched = [venueId ? 'venue' : null, artists.size ? `${artists.size} artist(s)` : null].filter(Boolean)
    return {
      url: `${STUDIO_URL}/structure/event;${id.replace(/^drafts\./, '')}`,
      note: `Draft created — review & publish in the Studio.${matched.length ? ` Linked existing ${matched.join(' + ')}.` : ''}`,
    }
  },
}
