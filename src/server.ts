import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { Hono, type Context } from 'hono'
import { serve } from '@hono/node-server'
import { missingEnv, platforms } from './platforms/index.ts'
import type { Event, Platform, PreviewItem } from './platforms/types.ts'

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Result = { id: string; name: string; ok: boolean; url?: string; message?: string }
type Preview = { platform: Platform; missing: string[]; items?: PreviewItem[]; error?: string }
type FormValues = Partial<Record<keyof Event | 'lineupText' | 'imageUpload' | 'motifUpload', string>> & {
  selected?: string[]
}

// ── uploads ───────────────────────────────────────────────────────────────
// Stored as uploads/<uuid>.<ext>. The bare file name doubles as a token in hidden form fields, so
// an image chosen once survives preview → publish → retry without picking it again.

const UPLOAD_DIR = resolve('uploads')
const UPLOAD_NAME = /^[0-9a-f-]{36}\.(png|jpe?g|gif|webp)$/
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

async function saveUpload(file: unknown): Promise<string | undefined> {
  if (!(file instanceof File) || file.size === 0) return undefined
  const ext = extname(file.name).toLowerCase().slice(1)
  await mkdir(UPLOAD_DIR, { recursive: true })
  const path = resolve(UPLOAD_DIR, `${randomUUID()}.${IMAGE_TYPES[ext] ? ext : 'jpg'}`)
  await writeFile(path, Buffer.from(await file.arrayBuffer()))
  return path
}

/** A previously stored upload, by its file name; anything else is ignored. */
async function keptUpload(name: string): Promise<string | undefined> {
  if (!UPLOAD_NAME.test(name)) return undefined
  const path = resolve(UPLOAD_DIR, name)
  return access(path).then(() => path, () => undefined)
}

// ── form ──────────────────────────────────────────────────────────────────

async function readForm(c: Context) {
  const body = await c.req.parseBody({ all: true })
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')
  const selected = ([] as unknown[]).concat(body.platforms ?? []).filter((x): x is string => typeof x === 'string')

  const imagePath = (await saveUpload(body.image)) ?? (await keptUpload(str('imageUpload')))
  const motifImagePath = (await saveUpload(body.motif)) ?? (await keptUpload(str('motifUpload')))

  const values: FormValues = {
    title: str('title'), shortTitle: str('shortTitle'), start: str('start'), end: str('end'), venue: str('venue'),
    address: str('address'), postalCode: str('postalCode'), city: str('city'), description: str('description'),
    lineupText: str('lineup'), ticketUrl: str('ticketUrl'), price: str('price'), selected,
    imageUpload: imagePath ? basename(imagePath) : '', motifUpload: motifImagePath ? basename(motifImagePath) : '',
  }
  const event: Event = {
    title: values.title!, start: values.start!, end: values.end!, venue: values.venue!, address: values.address!,
    postalCode: values.postalCode || undefined, city: values.city!, description: values.description!,
    lineup: values.lineupText!.split('\n').map((l) => l.trim()).filter(Boolean),
    ticketUrl: values.ticketUrl || undefined, price: values.price || undefined, imagePath,
    shortTitle: values.shortTitle || undefined, motifImagePath,
  }
  const errors: string[] = []
  if (values.start && values.end && values.end <= values.start) errors.push('End must be after start.')
  return { values, event, selected, errors }
}

// ── rendering ─────────────────────────────────────────────────────────────

function renderItem(item: PreviewItem): string {
  const label = `<div class="item-label">${esc(item.label)}</div>`
  if ('image' in item) return `${label}<img class="item-image" src="/uploads/${esc(basename(item.image))}" alt="${esc(item.label)}">`
  // HTML items are built by the platform modules from escaped input, so they render as-is.
  if ('html' in item) return `${label}<div class="item-html">${item.html}</div>`
  if ('json' in item) {
    return `<details><summary class="item-label">${esc(item.label)} <small>(JSON)</small></summary><pre>${esc(JSON.stringify(item.json, null, 2))}</pre></details>`
  }
  return `${label}<pre class="item-text">${esc(item.text)}</pre>`
}

function renderPreviews(previews: Preview[]): string {
  const status = (p: Preview) =>
    p.error ? '<span class="tag err">error</span>' : p.missing.length ? '<span class="tag">not configured</span>' : '<span class="tag ok">ready</span>'
  const nav = previews.map((p) => `<a href="#preview-${p.platform.id}">${esc(p.platform.name)} ${status(p)}</a>`).join('')
  const sections = previews
    .map(
      (p) => `<section class="preview" id="preview-${p.platform.id}">
        <h3>${esc(p.platform.name)} ${status(p)}</h3>
        ${p.missing.length ? `<p class="muted">Not sent until configured: ${p.missing.map(esc).join(', ')}</p>` : ''}
        ${p.error ? `<p class="errors">${esc(p.error)}</p>` : (p.items ?? []).map((i) => `<div class="item">${renderItem(i)}</div>`).join('')}
      </section>`,
    )
    .join('')
  return `<h2>Preview <small class="muted">— nothing has been sent</small></h2><nav class="preview-nav">${nav}</nav>${sections}`
}

function page(values: FormValues = {}, opts: { results?: Result[]; previews?: Preview[]; errors?: string[] } = {}) {
  const { results = [], previews = [], errors = [] } = opts
  const v = (k: keyof FormValues) => esc(values[k] as string)
  const selected = new Set(values.selected ?? platforms.filter((p) => !missingEnv(p).length).map((p) => p.id))
  const platformRows = platforms
    .map((p) => {
      const missing = missingEnv(p)
      return `<label class="platform${missing.length ? ' disabled' : ''}">
        <input type="checkbox" name="platforms" value="${p.id}" ${missing.length ? 'disabled' : selected.has(p.id) ? 'checked' : ''}>
        ${esc(p.name)}${missing.length ? ` <small>missing: ${missing.map(esc).join(', ')}</small>` : ''}
      </label>`
    })
    .join('')
  const resultRows = results
    .map(
      (r) => `<li class="${r.ok ? 'ok' : 'err'}"><strong>${r.ok ? '✓' : '✗'} ${esc(r.name)}</strong>
        ${r.url ? ` — <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>` : ''}
        ${r.message ? `<div>${esc(r.message)}</div>` : ''}</li>`,
    )
    .join('')
  const kept = (k: 'imageUpload' | 'motifUpload') =>
    values[k] ? ` <small class="muted">(kept from before — choose a file to replace it)</small>` : ''

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fraktvred Promo</title>
<style>
  :root { color-scheme: light dark; --fg:#111; --bg:#fafafa; --panel:#fff; --muted:#666; --line:#ccc; --ok:#1a7f37; --err:#c62828; }
  @media (prefers-color-scheme: dark) { :root { --fg:#eee; --bg:#141414; --panel:#1c1c1c; --muted:#999; --line:#444; --ok:#4cc26b; --err:#ff6b6b; } }
  body { font: 15px/1.45 system-ui, sans-serif; color: var(--fg); background: var(--bg); max-width: 820px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 22px; } h2 { font-size: 18px; } h3 { font-size: 16px; margin: 0 0 8px; }
  fieldset { border: 1px solid var(--line); border-radius: 6px; margin: 0 0 16px; padding: 12px 14px; }
  label { display: block; margin: 8px 0 2px; font-weight: 600; }
  input[type=text], input[type=url], input[type=datetime-local], textarea { width: 100%; box-sizing: border-box; padding: 7px 8px; font: inherit; border: 1px solid var(--line); border-radius: 4px; background: transparent; color: inherit; }
  textarea { min-height: 110px; } .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 560px) { .row { grid-template-columns: 1fr; } }
  .platform { font-weight: 400; } .platform.disabled, .muted { color: var(--muted); } .platform small { color: var(--muted); }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; }
  button { font: inherit; font-weight: 600; padding: 9px 18px; border-radius: 4px; border: 1px solid var(--fg); background: var(--fg); color: var(--bg); cursor: pointer; }
  button.secondary { background: transparent; color: var(--fg); }
  ul.results { padding: 0; list-style: none; } ul.results li { padding: 8px 10px; border-left: 4px solid; margin-bottom: 6px; overflow-wrap: anywhere; }
  li.ok { border-color: var(--ok); } li.err { border-color: var(--err); } .errors { color: var(--err); }
  .preview-nav { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 14px; }
  .preview-nav a { color: inherit; text-decoration: none; }
  .preview { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px 14px; margin-bottom: 14px; scroll-margin-top: 12px; }
  .tag { font-size: 12px; font-weight: 600; padding: 1px 6px; border-radius: 3px; border: 1px solid var(--line); color: var(--muted); }
  .tag.ok { color: var(--ok); border-color: var(--ok); } .tag.err { color: var(--err); border-color: var(--err); }
  .item { margin-top: 10px; } .item-label { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; margin-bottom: 3px; cursor: default; }
  details > summary.item-label { cursor: pointer; }
  pre { margin: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 4px; overflow-x: auto; font: 13px/1.45 ui-monospace, monospace; }
  pre.item-text { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
  .item-html { padding: 2px 10px; border: 1px solid var(--line); border-radius: 4px; overflow-wrap: anywhere; }
  .item-image { display: block; max-width: min(260px, 100%); max-height: 320px; border: 1px solid var(--line); border-radius: 4px; }
</style></head><body>
<h1>Fraktvred Promo</h1>
${errors.length ? `<ul class="errors">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
${results.length ? `<h2>Results</h2><ul class="results">${resultRows}</ul>` : ''}
${previews.length ? renderPreviews(previews) : ''}
<form method="post" action="/publish" enctype="multipart/form-data">
  <fieldset><legend>Event</legend>
    <label for="title">Title</label><input type="text" id="title" name="title" required value="${v('title')}">
    <label for="shortTitle">Short title <small>(max 16 characters — Ströer)</small></label>
    <input type="text" id="shortTitle" name="shortTitle" maxlength="16" value="${v('shortTitle')}">
    <div class="row">
      <div><label for="start">Start (Berlin time)</label><input type="datetime-local" id="start" name="start" required value="${v('start')}"></div>
      <div><label for="end">End</label><input type="datetime-local" id="end" name="end" required value="${v('end')}"></div>
    </div>
    <label for="venue">Venue</label><input type="text" id="venue" name="venue" required value="${v('venue')}">
    <label for="address">Street address</label><input type="text" id="address" name="address" required value="${v('address')}">
    <div class="row">
      <div><label for="postalCode">Postal code</label><input type="text" id="postalCode" name="postalCode" value="${v('postalCode')}"></div>
      <div><label for="city">City</label><input type="text" id="city" name="city" required value="${v('city') || 'Berlin'}"></div>
    </div>
    <label for="description">Description <small>(blank line = new paragraph)</small></label>
    <textarea id="description" name="description" required>${v('description')}</textarea>
    <label for="lineup">Lineup <small>(one act per line)</small></label>
    <textarea id="lineup" name="lineup">${v('lineupText')}</textarea>
    <div class="row">
      <div><label for="ticketUrl">Ticket URL</label><input type="url" id="ticketUrl" name="ticketUrl" value="${v('ticketUrl')}"></div>
      <div><label for="price">Price (€ or FREE / PWYC)</label><input type="text" id="price" name="price" value="${v('price')}"></div>
    </div>
    <label for="image">Flyer image${kept('imageUpload')}</label>
    <input type="file" id="image" name="image" accept="image/png,image/jpeg">
    <input type="hidden" name="imageUpload" value="${v('imageUpload')}">
    <label for="motif">Text-free image <small>(Ströer: no title, date, venue or logos in the picture)</small>${kept('motifUpload')}</label>
    <input type="file" id="motif" name="motif" accept="image/png,image/jpeg">
    <input type="hidden" name="motifUpload" value="${v('motifUpload')}">
  </fieldset>
  <fieldset><legend>Platforms</legend>${platformRows}</fieldset>
  <div class="actions">
    <button type="submit" class="secondary" formaction="/preview">Preview</button>
    <button type="submit">Publish</button>
  </div>
</form>
</body></html>`
}

// ── routes ────────────────────────────────────────────────────────────────

const app = new Hono()

app.get('/', (c) => c.html(page()))

app.get('/uploads/:name', async (c) => {
  const path = await keptUpload(c.req.param('name'))
  if (!path) return c.notFound()
  const type = IMAGE_TYPES[extname(path).slice(1)] ?? 'application/octet-stream'
  return c.body(await readFile(path), 200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' })
})

// Every platform, configured or not: shows what would be sent. Sends nothing.
app.post('/preview', async (c) => {
  const { values, event, errors } = await readForm(c)
  if (errors.length) return c.html(page(values, { errors }), 400)
  const previews: Preview[] = platforms.map((platform) => {
    const missing = missingEnv(platform)
    try {
      return { platform, missing, items: platform.preview(event) }
    } catch (err) {
      return { platform, missing, error: (err as Error).message }
    }
  })
  return c.html(page(values, { previews }))
})

app.post('/publish', async (c) => {
  const { values, event, selected, errors } = await readForm(c)
  if (!selected.length) errors.push('Pick at least one platform.')
  if (errors.length) return c.html(page(values, { errors }), 400)

  const chosen = platforms.filter((p) => selected.includes(p.id) && !missingEnv(p).length)
  // Independent: one platform failing must not stop the others.
  const settled = await Promise.allSettled(chosen.map((p) => p.publish(event)))
  const results: Result[] = settled.map((s, i) => {
    const p = chosen[i]
    if (s.status === 'fulfilled') return { id: p.id, name: p.name, ok: true, url: s.value.url, message: s.value.note }
    console.error(`[${p.id}]`, s.reason)
    return { id: p.id, name: p.name, ok: false, message: (s.reason as Error)?.message ?? String(s.reason) }
  })
  // Pre-tick only the failures so a second click retries just those.
  values.selected = results.filter((r) => !r.ok).map((r) => r.id)
  return c.html(page(values, { results }))
})

const port = Number(process.env.PORT ?? 3000)
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }) as Server
// Several platforms run in one request (browser automation, uploads); don't cut it off.
server.requestTimeout = 0
console.log(`Fraktvred promo tool on http://localhost:${port}`)
for (const p of platforms) {
  const missing = missingEnv(p)
  console.log(`  ${missing.length ? '·' : '✓'} ${p.name}${missing.length ? ` (missing ${missing.join(', ')})` : ''}`)
}

// As PID 1 in a container, node gets no default signal handling: exit explicitly on stop.
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => server.close(() => process.exit(0)) && setTimeout(() => process.exit(0), 2000).unref())
