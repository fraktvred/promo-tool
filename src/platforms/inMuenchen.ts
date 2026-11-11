import { acceptCookies, browserPlatform, env } from '../browser.ts'
import { localParts } from '../time.ts'

// Public form, no account: https://www.in-muenchen.de/eintragsformular
// Selectors taken from the live form markup (2026-11-10). The form is protected by Cloudflare
// Turnstile, which may refuse headless browsers; run with HEADLESS=false and solve it by hand.

const FORM_URL = 'https://www.in-muenchen.de/eintragsformular'

/** The form rejects ALL-CAPS titles ("keine VERSALIEN") and caps them at 60 characters. */
export function inMuenchenTitle(title: string): string {
  const shouting = /[A-ZÄÖÜ]{3}/.test(title) && title === title.toUpperCase()
  const t = shouting ? title.toLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (_, p, c) => p + c.toUpperCase()) : title
  return t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t
}

export const inMuenchen = browserPlatform({
  id: 'in-muenchen',
  name: 'In-München',
  envVars: ['CONTACT_EMAIL'],
  async fill(page, e) {
    if (!e.imagePath) throw new Error('In-München requires a flyer image.')
    await page.goto(FORM_URL)
    await acceptCookies(page)

    await page.locator('#title').fill(inMuenchenTitle(e.title))

    // Categories are loaded by script after page load.
    const category = new RegExp(process.env.IN_MUENCHEN_CATEGORY ?? 'party|club|nachtleben|disco', 'i')
    await page.waitForFunction(() => document.querySelectorAll('#theme option').length > 1)
    const options = await page.locator('#theme option').evaluateAll((os) =>
      os.map((o) => ({ value: (o as HTMLOptionElement).value, label: o.textContent?.trim() ?? '' })),
    )
    const pick = options.find((o) => o.value !== '0' && category.test(o.label))
    if (!pick) throw new Error(`No In-München category matches ${category}. Options: ${options.map((o) => o.label).join(', ')}`)
    await page.locator('#theme').selectOption(pick.value)

    const lineup = e.lineup.length ? `\n\nLineup: ${e.lineup.join(', ')}` : ''
    await page.locator('#description-editor [contenteditable="true"]').first().fill(`${e.description.trim()}${lineup}`)

    if (e.ticketUrl) await page.locator('#ticket-link').fill(e.ticketUrl)
    const price = e.price?.trim()
    const n = Number(price?.replace(',', '.').replace(/\s*€$/, ''))
    if (price && /^(free|frei|0)$/i.test(price)) await page.locator('#is-free').check()
    else if (price && Number.isFinite(n)) await page.locator('#ticket-price-min').fill(String(n))

    await page.locator('#location-name').fill(e.venue)
    await page.locator('#street').fill(e.address)
    await page.locator('#plz').fill(e.postalCode ?? '')
    await page.locator('#city').fill(e.city)

    // The "Serientermin" section reuses the same input names, so scope to the single-date list.
    const s = localParts(e.start)
    const end = localParts(e.end)
    const row = page.locator('#event-form__single-dates-list .js-event-form__single-date-item').first()
    await row.locator('input[name="date"]').fill(s.date)
    await row.locator('input[name="start-time"]').fill(s.time)
    await row.locator('input[name="end-time"]').fill(end.time)

    // FilePond uploads immediately and writes the stored URL into the hidden #image-url.
    await page.locator('#event-form input[type="file"]').first().setInputFiles(e.imagePath)
    await page.waitForFunction(() => (document.querySelector('#image-url') as HTMLInputElement | null)?.value, null, {
      timeout: 60_000,
    })
    await page.locator('#copyright').fill(process.env.IN_MUENCHEN_COPYRIGHT ?? 'Fraktvred')
    await page.locator('#image-upload-hint').check()

    await page.locator('#email').fill(env('CONTACT_EMAIL'))
    await page.locator('#privacy-policy').check()
  },
  async submit(page) {
    await page.locator('#submit-btn').click()
    const error = page.locator('#event-form__error-message')
    const success = page.getByText(/vielen dank|erfolgreich|eingegangen/i).first()
    await Promise.race([
      success.waitFor({ timeout: 60_000 }),
      error.filter({ hasText: /\S/ }).waitFor({ timeout: 60_000 }).then(async () => {
        throw new Error(`In-München rejected the form: ${(await error.innerText()).trim()}`)
      }),
    ])
    return { note: 'Submitted — In-München reviews entries before publishing.' }
  },
})
