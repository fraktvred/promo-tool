import { basename } from 'node:path'
import nodemailer from 'nodemailer'
import type { Event, Platform } from './types.ts'
import { localParts } from '../time.ts'

const DEFAULT_TO = 'events@neo-group.de'

/** Pure: subject + plain-text body of the submission mail. */
export function neoGroupMail(e: Event) {
  const s = localParts(e.start)
  const en = localParts(e.end)
  const lines = [
    'Hallo Neo Group Team,',
    '',
    'wir möchten folgende Veranstaltung für euren Eventkalender einreichen:',
    '',
    `Titel: ${e.title}`,
    `Datum: ${s.dmy}, ${s.time} – ${en.date === s.date ? '' : `${en.dmy}, `}${en.time} Uhr`,
    `Ort: ${e.venue}, ${e.address}, ${[e.postalCode, e.city].filter(Boolean).join(' ')}`,
    ...(e.lineup.length ? [`Lineup: ${e.lineup.join(', ')}`] : []),
    ...(e.price ? [`Eintritt: ${/^\d+([.,]\d+)?$/.test(e.price.trim()) ? `${e.price.trim()} €` : e.price}`] : []),
    ...(e.ticketUrl ? [`Tickets: ${e.ticketUrl}`] : []),
    '',
    e.description.trim(),
    '',
    ...(e.imagePath ? ['Den Flyer findet ihr im Anhang.', ''] : []),
    'Vielen Dank und liebe Grüße',
    'Fraktvred',
  ]
  return { subject: `Veranstaltung: ${e.title} – ${s.dmy}`, text: lines.join('\n') }
}

export const neoGroup: Platform = {
  id: 'neo-group',
  name: 'Neo Group (email)',
  envVars: ['SMTP_URL', 'SMTP_FROM'],
  async publish(e) {
    const to = process.env.NEO_GROUP_TO || DEFAULT_TO
    const transport = nodemailer.createTransport(process.env.SMTP_URL)
    const { subject, text } = neoGroupMail(e)
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text,
      attachments: e.imagePath ? [{ filename: basename(e.imagePath), path: e.imagePath }] : [],
    })
    return { note: `Mail sent to ${to} (${info.messageId}).` }
  },
}
