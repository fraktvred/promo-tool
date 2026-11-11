export const TIME_ZONE = 'Europe/Berlin'

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Wall-clock time of `instant` in Berlin, read back as if it were UTC (ms). */
function berlinWallClockMs(instant: Date): number {
  const p = Object.fromEntries(partsFormatter.formatToParts(instant).map((x) => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
}

/** "2026-11-20T23:00" (Berlin wall clock) → the UTC instant. */
export function berlinToUtc(local: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!m) throw new Error(`Invalid local datetime: ${local}`)
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  // Guess with the offset at the naive instant, then correct once more for DST edges.
  let utc = naive - (berlinWallClockMs(new Date(naive)) - naive)
  utc = naive - (berlinWallClockMs(new Date(utc)) - utc)
  return new Date(utc)
}

/** Same instant as ISO without milliseconds: "2026-11-20T22:00:00Z" (Eventbrite rejects ms). */
export function utcIsoSeconds(local: string): string {
  return berlinToUtc(local).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Local parts as typed: { date: "2026-11-20", time: "23:00", dmy: "20.11.2026" }. */
export function localParts(local: string) {
  const [date, rest] = local.split('T')
  const time = rest.slice(0, 5)
  const [y, mo, d] = date.split('-')
  return { date, time, dmy: `${d}.${mo}.${y}` }
}
