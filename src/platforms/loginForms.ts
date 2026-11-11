import type { Page } from 'playwright'
import { acceptCookies, browserPlatform, env, fillByLabel, loginWithForm } from '../browser.ts'
import { localParts } from '../time.ts'
import type { Event, Platform } from './types.ts'

// Platforms behind an account whose submit forms have NOT been recorded yet (no credentials at
// build time). These log in, open the form, and fill what they can find by label, then hand the
// window over to you: they never click submit themselves. They need HEADLESS=false.
//
// To graduate one: `npx playwright codegen <submit url>`, then write a dedicated module with exact
// selectors and a real submit step, like inMuenchen.ts / keepItRollin.ts.

type Spec = { id: string; name: string; prefix: string; defaultLoginUrl?: string }

const LABELS: Array<[RegExp, (e: Event) => string | undefined]> = [
  [/^(event ?)?(title|name|titel)|veranstaltungs(titel|name)/i, (e) => e.title],
  [/^(start ?)?(date|datum)|beginn.*datum/i, (e) => localParts(e.start).date],
  [/start ?(time|zeit)|beginn|einlass|doors/i, (e) => localParts(e.start).time],
  [/end ?(time|zeit)|ende/i, (e) => localParts(e.end).time],
  [/venue|location|veranstaltungsort|spielstätte/i, (e) => e.venue],
  [/address|adresse|straße|street/i, (e) => e.address],
  [/postal|plz|zip/i, (e) => e.postalCode],
  [/^(city|stadt|ort)$/i, (e) => e.city],
  [/description|beschreibung|details|info/i, (e) => [e.description.trim(), e.lineup.length ? `Lineup: ${e.lineup.join(', ')}` : ''].filter(Boolean).join('\n\n')],
  [/lineup|artists|künstler/i, (e) => e.lineup.join(', ')],
  [/ticket.*(url|link)|tickets?$/i, (e) => e.ticketUrl],
  [/price|preis|eintritt/i, (e) => e.price],
]

const unfilled = new WeakMap<Page, string[]>()

function labelFormPlatform(spec: Spec): Platform {
  const v = (suffix: string) => `${spec.prefix}_${suffix}`
  return browserPlatform({
    id: spec.id,
    name: `${spec.name} (manual submit)`,
    envVars: [v('USER'), v('PASSWORD'), v('SUBMIT_URL'), ...(spec.defaultLoginUrl ? [] : [v('LOGIN_URL')])],
    login: (page) =>
      loginWithForm(page, {
        url: process.env[v('LOGIN_URL')] || spec.defaultLoginUrl!,
        user: env(v('USER')),
        password: env(v('PASSWORD')),
      }),
    async fill(page, e) {
      await page.goto(env(v('SUBMIT_URL')))
      await acceptCookies(page)
      const missing: string[] = []
      for (const [label, value] of LABELS) {
        if (value(e) && !(await fillByLabel(page, label, value(e)))) missing.push(label.source)
      }
      if (e.imagePath) {
        const file = page.locator('input[type=file]').first()
        if (await file.count()) await file.setInputFiles(e.imagePath)
        else missing.push('image upload')
      }
      unfilled.set(page, missing)
    },
    async submit(page) {
      if (process.env.HEADLESS !== 'false') {
        throw new Error(`${spec.name}: selectors not recorded yet — run with HEADLESS=false to finish the form by hand.`)
      }
      // Hand over: you review, fix, submit, then close the window.
      await page.waitForEvent('close', { timeout: 0 })
      const missing = unfilled.get(page) ?? []
      return { note: `Filled by label and handed over for manual submit.${missing.length ? ` Not found: ${missing.length} field(s).` : ''}` }
    },
  })
}

export const residentAdvisor = labelFormPlatform({
  id: 'resident-advisor',
  name: 'Resident Advisor',
  prefix: 'RA',
  defaultLoginUrl: 'https://ra.co/login',
})
export const visitBerlin = labelFormPlatform({ id: 'visitberlin', name: 'visitBerlin', prefix: 'VISITBERLIN' })
export const bandsintown = labelFormPlatform({
  id: 'bandsintown',
  name: 'Bandsintown',
  prefix: 'BANDSINTOWN',
  defaultLoginUrl: 'https://artists.bandsintown.com/login',
})
export const stroeer = labelFormPlatform({ id: 'stroeer', name: 'Ströer Kulturkalender', prefix: 'STROEER' })
