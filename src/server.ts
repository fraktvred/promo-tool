import { mkdir, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { missingEnv, platforms } from './platforms/index.ts'
import type { Event } from './platforms/types.ts'

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type Result = { id: string; name: string; ok: boolean; url?: string; message?: string }
type FormValues = Partial<Record<keyof Event | 'lineupText', string>> & { selected?: string[] }

function page(values: FormValues = {}, results: Result[] = [], errors: string[] = []) {
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

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fraktvred Promo</title>
<style>
  :root { color-scheme: light dark; --fg:#111; --bg:#fafafa; --muted:#666; --line:#ccc; --ok:#1a7f37; --err:#c62828; }
  @media (prefers-color-scheme: dark) { :root { --fg:#eee; --bg:#141414; --muted:#999; --line:#444; --ok:#4cc26b; --err:#ff6b6b; } }
  body { font: 15px/1.45 system-ui, sans-serif; color: var(--fg); background: var(--bg); max-width: 760px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 22px; } fieldset { border: 1px solid var(--line); border-radius: 6px; margin: 0 0 16px; padding: 12px 14px; }
  label { display: block; margin: 8px 0 2px; font-weight: 600; }
  input[type=text], input[type=url], input[type=datetime-local], textarea { width: 100%; box-sizing: border-box; padding: 7px 8px; font: inherit; border: 1px solid var(--line); border-radius: 4px; background: transparent; color: inherit; }
  textarea { min-height: 110px; } .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 560px) { .row { grid-template-columns: 1fr; } }
  .platform { font-weight: 400; } .platform.disabled { color: var(--muted); } .platform small { color: var(--muted); }
  button { font: inherit; font-weight: 600; padding: 9px 18px; border-radius: 4px; border: 0; background: var(--fg); color: var(--bg); cursor: pointer; }
  ul.results { padding: 0; list-style: none; } ul.results li { padding: 8px 10px; border-left: 4px solid; margin-bottom: 6px; overflow-wrap: anywhere; }
  li.ok { border-color: var(--ok); } li.err { border-color: var(--err); } .errors { color: var(--err); }
</style></head><body>
<h1>Fraktvred Promo</h1>
${errors.length ? `<ul class="errors">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
${results.length ? `<h2>Results</h2><ul class="results">${resultRows}</ul>` : ''}
<form method="post" action="/publish" enctype="multipart/form-data">
  <fieldset><legend>Event</legend>
    <label for="title">Title</label><input type="text" id="title" name="title" required value="${v('title')}">
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
    <label for="image">Flyer image${values.imagePath ? ' <small>(re-select to resend it)</small>' : ''}</label>
    <input type="file" id="image" name="image" accept="image/png,image/jpeg">
  </fieldset>
  <fieldset><legend>Platforms</legend>${platformRows}</fieldset>
  <button type="submit">Publish</button>
</form>
</body></html>`
}

const app = new Hono()

app.get('/', (c) => c.html(page()))

app.post('/publish', async (c) => {
  const body = await c.req.parseBody({ all: true })
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')
  const selected = ([] as unknown[]).concat(body.platforms ?? []).filter((x): x is string => typeof x === 'string')

  const values: FormValues = {
    title: str('title'), start: str('start'), end: str('end'), venue: str('venue'), address: str('address'),
    postalCode: str('postalCode'), city: str('city'), description: str('description'), lineupText: str('lineup'),
    ticketUrl: str('ticketUrl'), price: str('price'), selected,
  }

  let imagePath: string | undefined
  const image = body.image
  if (image instanceof File && image.size > 0) {
    await mkdir('uploads', { recursive: true })
    imagePath = resolve('uploads', `${randomUUID()}${extname(image.name).toLowerCase() || '.jpg'}`)
    await writeFile(imagePath, Buffer.from(await image.arrayBuffer()))
  }

  const errors: string[] = []
  if (!selected.length) errors.push('Pick at least one platform.')
  if (values.start && values.end && values.end <= values.start) errors.push('End must be after start.')
  if (errors.length) return c.html(page(values, [], errors), 400)

  const event: Event = {
    title: values.title!, start: values.start!, end: values.end!, venue: values.venue!, address: values.address!,
    postalCode: values.postalCode || undefined, city: values.city!, description: values.description!,
    lineup: values.lineupText!.split('\n').map((l) => l.trim()).filter(Boolean),
    ticketUrl: values.ticketUrl || undefined, price: values.price || undefined, imagePath,
  }

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
  return c.html(page({ ...values, imagePath }, results))
})

const port = Number(process.env.PORT ?? 3000)
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }) as Server
// Manual-submit browser flows can keep a request open for a long time.
server.requestTimeout = 0
console.log(`Fraktvred promo tool on http://localhost:${port}`)
for (const p of platforms) {
  const missing = missingEnv(p)
  console.log(`  ${missing.length ? '·' : '✓'} ${p.name}${missing.length ? ` (missing ${missing.join(', ')})` : ''}`)
}

// As PID 1 in a container, node gets no default signal handling: exit explicitly on stop.
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => server.close(() => process.exit(0)) && setTimeout(() => process.exit(0), 2000).unref())
