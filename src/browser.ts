import { mkdir } from 'node:fs/promises'
import { chromium, type Locator, type Page } from 'playwright'
import type { Event, Platform, PublishResult } from './platforms/types.ts'

// Shared Playwright plumbing for platforms without an API.
//
//   HEADLESS=false  show the browser (needed to solve captchas / Cloudflare Turnstile by hand)
//   DRY_RUN=1       fill every field but never click the final submit button; with
//                   HEADLESS=false the window stays open for inspection until you close it
//   SLOW_MO=<ms>    slow every action down for watching

const headless = () => process.env.HEADLESS !== 'false'
export const isDryRun = () => process.env.DRY_RUN === '1'

export type BrowserSpec = {
  id: string
  name: string
  envVars: string[]
  /** Optional login step, run before `fill`. */
  login?: (page: Page) => Promise<void>
  /** Navigate to the form and fill it. Must not click the final submit. */
  fill: (page: Page, e: Event) => Promise<void>
  /** Click the final submit and wait for confirmation; returns what to show in the UI. */
  submit: (page: Page) => Promise<PublishResult>
}

export function browserPlatform(spec: BrowserSpec): Platform & { spec: BrowserSpec } {
  return {
    spec,
    id: spec.id,
    name: spec.name,
    envVars: spec.envVars,
    async publish(e) {
      const browser = await chromium.launch({ headless: headless(), slowMo: Number(process.env.SLOW_MO ?? 0) })
      const page = await browser.newPage({ locale: 'de-DE', timezoneId: 'Europe/Berlin' })
      page.setDefaultTimeout(20_000)
      try {
        if (spec.login) await spec.login(page)
        await spec.fill(page, e)
        if (isDryRun()) {
          await screenshot(page, spec.id, 'dry-run')
          if (!headless()) await page.waitForEvent('close', { timeout: 0 })
          return { note: 'DRY_RUN: form filled, not submitted.' }
        }
        return await spec.submit(page)
      } catch (err) {
        const shot = await screenshot(page, spec.id, 'failure').catch(() => undefined)
        throw new Error(`${(err as Error).message}${shot ? ` (screenshot: ${shot})` : ''}`)
      } finally {
        await browser.close()
      }
    },
  }
}

async function screenshot(page: Page, id: string, kind: string): Promise<string> {
  await mkdir('failures', { recursive: true })
  const path = `failures/${id}-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
  await page.screenshot({ path, fullPage: true })
  return path
}

/** Generic username/password login. Selectors default to the common shapes. */
export async function loginWithForm(
  page: Page,
  opts: { url: string; user: string; password: string; userSelector?: string; passwordSelector?: string; submitSelector?: string },
) {
  await page.goto(opts.url)
  await acceptCookies(page)
  await page
    .locator(opts.userSelector ?? 'input[type=email], input[name*=user i], input[name*=login i], input[name*=email i]')
    .first()
    .fill(opts.user)
  await page.locator(opts.passwordSelector ?? 'input[type=password]').first().fill(opts.password)
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.locator(opts.submitSelector ?? 'button[type=submit], input[type=submit]').first().click(),
  ])
}

/** Best effort: dismiss a cookie banner if one is in the way. */
export async function acceptCookies(page: Page) {
  const btn = page.getByRole('button', { name: /^(alle )?(akzeptieren|accept( all)?|zustimmen|einverstanden|allow all|alle erlauben)/i })
  await btn.first().click({ timeout: 3000 }).catch(() => {})
}

/**
 * Fill the first visible field whose label matches. For forms we have not recorded selectors for
 * yet: label-based lookup survives markup changes better than guessed CSS, but still verify each
 * site once with `npx playwright codegen <url>` and replace with exact selectors.
 */
export async function fillByLabel(page: Page, label: RegExp, value: string | undefined): Promise<boolean> {
  if (!value) return false
  const candidates: Locator[] = [page.getByLabel(label), page.getByPlaceholder(label)]
  for (const c of candidates) {
    const el = c.first()
    if (await el.isVisible().catch(() => false)) {
      await el.fill(value)
      return true
    }
  }
  return false
}

/** Required env var, read lazily at publish time. */
export const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}
