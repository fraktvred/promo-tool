import type { Page } from 'playwright'
import { browserPlatform, env } from '../browser.ts'
import { localParts } from '../time.ts'
import type { Event } from './types.ts'

// Public form, no account. https://keepitrollin.de/add-event/ embeds a ProcessWire FormBuilder
// iframe; we open the iframe's page directly. Selectors from the live markup (2026-11-10).

const FORM_URL = 'https://keepitrollin.de/form-builder/form_event_add/'
// An inline CKEditor that ProcessWire only initialises on focus; on submit it copies the
// editor's HTML into the hidden `promo_richtext` input. It requires at least 50 characters.
const PROMO_EDITOR = '#Inputfield_promo_richtext_ckeditor'

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function keepItRollinPromoHtml(e: Event, venueMatched: boolean): string {
  const parts = e.description.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`)
  if (e.lineup.length) parts.push(`<p><strong>Lineup:</strong> ${e.lineup.map(escapeHtml).join(', ')}</p>`)
  // The location dropdown only knows venues KeepItRollin already lists; otherwise say where it is.
  if (!venueMatched) parts.push(`<p><strong>Location:</strong> ${escapeHtml(`${e.venue}, ${e.address}, ${[e.postalCode, e.city].filter(Boolean).join(' ')}`)}</p>`)
  if (e.price) parts.push(`<p><strong>Entry:</strong> ${escapeHtml(/^\d+([.,]\d+)?$/.test(e.price.trim()) ? `${e.price.trim()} €` : e.price)}</p>`)
  return parts.join('')
}

async function selectVenue(page: Page, venue: string): Promise<boolean> {
  const wanted = venue.trim().toLowerCase()
  const options = await page.locator('#Inputfield_location option').evaluateAll((os) =>
    os.map((o) => ({ value: (o as HTMLOptionElement).value, label: o.textContent?.trim() ?? '' })),
  )
  // Option labels look like "About Blank (Markgrafendamm 24c, 10245 Berlin - Friedrichshain)".
  const match = options.find((o) => o.value && o.label.toLowerCase().split(' (')[0] === wanted)
  if (!match) return false
  await page.locator('#Inputfield_location').selectOption(match.value)
  return true
}

export const keepItRollin = browserPlatform({
  id: 'keepitrollin',
  name: 'KeepItRollin',
  envVars: ['CONTACT_EMAIL'],
  async fill(page, e) {
    if (!e.imagePath) throw new Error('KeepItRollin requires a flyer image.')
    await page.goto(FORM_URL)

    await page.locator('#Inputfield_title').fill(e.title)
    const venueMatched = await selectVenue(page, e.venue)

    const s = localParts(e.start)
    await page.locator('#Inputfield_doors_open').fill(s.date)
    await page.locator('#Inputfield_doors_open__time').fill(s.time)

    await page.locator('#Inputfield_flyer').setInputFiles(e.imagePath)

    const genres = (process.env.KEEPITROLLIN_GENRES ?? 'Drum&Bass').split(',').map((g: string) => g.trim()).filter(Boolean)
    for (const g of genres) await page.getByLabel(g, { exact: true }).check()

    const html = keepItRollinPromoHtml(e, venueMatched)
    await page.locator(PROMO_EDITOR).click()
    const editorFor = (sel: string) =>
      Object.values((window as any).CKEDITOR?.instances ?? {}).find((i: any) => i.element?.$ === document.querySelector(sel)) as any
    await page.waitForFunction(`(${editorFor})(${JSON.stringify(PROMO_EDITOR)})?.status === 'ready'`)
    await page.evaluate(`(${editorFor})(${JSON.stringify(PROMO_EDITOR)}).setData(${JSON.stringify(html)})`)

    if (e.ticketUrl) await page.locator('#Inputfield_link').fill(e.ticketUrl)
    await page.locator('#Inputfield_mail').fill(env('CONTACT_EMAIL'))
  },
  async submit(page) {
    await Promise.all([page.waitForLoadState('load'), page.locator('button[name="form_event_add_submit"]').click()])
    const errors = page.locator('.InputfieldError, .FormBuilderErrors')
    if (await errors.count()) throw new Error(`KeepItRollin rejected the form: ${(await errors.allInnerTexts()).join(' / ')}`)
    return { note: 'Submitted — KeepItRollin reviews entries before publishing.' }
  },
})
