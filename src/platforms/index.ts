import { eventbrite } from './eventbrite.ts'
import { fraktvred } from './fraktvred.ts'
import { keepItRollin } from './keepItRollin.ts'
import { stroeer } from './stroeer.ts'
import { neoGroup, visitBerlin } from './email.ts'
import type { Platform } from './types.ts'

export const platforms: Platform[] = [
  fraktvred,
  eventbrite,
  neoGroup,
  visitBerlin,
  stroeer,
  keepItRollin,
]

export const missingEnv = (p: Platform) => p.envVars.filter((v) => !process.env[v])
