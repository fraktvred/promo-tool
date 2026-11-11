import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import type { Event, Platform, PublishResult } from './platforms/types.ts'

// Shared Playwright plumbing for platforms without an API. Always headless: this runs on a server.
//
//   DRY_RUN=1  fill every field but never click the final submit button (a screenshot of the
//              filled form is saved to failures/ for inspection)

export const isDryRun = () => process.env.DRY_RUN === '1'

export type BrowserSpec = {
  id: string
  name: string
  envVars: string[]
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
      const browser = await chromium.launch()
      const page = await browser.newPage({ locale: 'de-DE', timezoneId: 'Europe/Berlin' })
      page.setDefaultTimeout(20_000)
      try {
        await spec.fill(page, e)
        if (isDryRun()) {
          const shot = await screenshot(page, spec.id, 'dry-run')
          return { note: `DRY_RUN: form filled, not submitted (screenshot: ${shot}).` }
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

/** Required env var, read lazily at publish time. */
export const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}
