import { basename } from 'node:path'
import nodemailer from 'nodemailer'
import type { Event, Platform } from './types.ts'
import { localParts } from '../time.ts'

/** Pure: subject + plain-text body of the submission mail. */
export function submissionMail(e: Event, recipient: string) {
  const s = localParts(e.start)
  const en = localParts(e.end)
  const lines = [
    `Hallo ${recipient} Team,`,
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

/**
 * Calendars that take submissions by email. Every one gets the same German mail with the flyer
 * attached; `<PREFIX>_TO` overrides the recipient (send to yourself for testing).
 */
function emailPlatform(spec: { id: string; name: string; to: string; prefix: string }): Platform {
  return {
    id: spec.id,
    name: `${spec.name} (email)`,
    envVars: ['SMTP_URL', 'SMTP_FROM'],
    preview(e) {
      const { subject, text } = submissionMail(e, spec.name)
      return [
        { label: 'To', text: process.env[`${spec.prefix}_TO`] || spec.to },
        { label: 'Subject', text: subject },
        { label: 'Body', text },
        ...(e.imagePath ? [{ label: 'Attachment', image: e.imagePath }] : [{ label: 'Attachment', text: '(no flyer)' }]),
      ]
    },
    async publish(e) {
      const to = process.env[`${spec.prefix}_TO`] || spec.to
      const transport = nodemailer.createTransport(process.env.SMTP_URL)
      const { subject, text } = submissionMail(e, spec.name)
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
}

export const neoGroup = emailPlatform({ id: 'neo-group', name: 'Neo Group', to: 'events@neo-group.de', prefix: 'NEO_GROUP' })
export const visitBerlin = emailPlatform({ id: 'visitberlin', name: 'visitBerlin', to: 'events@visitberlin.de', prefix: 'VISITBERLIN' })
