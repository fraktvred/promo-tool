/**
 * The one event shape every platform module receives.
 *
 * `start` / `end` are wall-clock times in Europe/Berlin as typed into the form
 * ("YYYY-MM-DDTHH:mm", the value of an <input type="datetime-local">). Use the helpers in
 * `src/time.ts` to get UTC instants or the local date/time parts a form field wants.
 */
export type Event = {
  title: string
  start: string
  end: string
  venue: string
  address: string
  postalCode?: string
  city: string
  description: string
  lineup: string[]
  ticketUrl?: string
  /** Free text: "15", "12.50", "FREE", "PWYC". Numeric values are euros. */
  price?: string
  /** Absolute path of the uploaded flyer on disk. */
  imagePath?: string
  /** Short title for tight slots (Ströer: max 16 characters). */
  shortTitle?: string
  /** Image without any text/logos (Ströer lays title + venue over it). */
  motifImagePath?: string
}

export type PublishResult = { url?: string; note?: string }

export interface Platform {
  id: string
  name: string
  /** All of these must be set for the platform to be offered in the UI. */
  envVars: string[]
  publish(e: Event): Promise<PublishResult>
}
