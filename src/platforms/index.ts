import { eventbrite } from './eventbrite.ts'
import { fraktvred } from './fraktvred.ts'
import { inMuenchen } from './inMuenchen.ts'
import { keepItRollin } from './keepItRollin.ts'
import { bandsintown, residentAdvisor, stroeer, visitBerlin } from './loginForms.ts'
import { neoGroup } from './neoGroup.ts'
import type { Platform } from './types.ts'

export const platforms: Platform[] = [
  fraktvred,
  eventbrite,
  neoGroup,
  keepItRollin,
  inMuenchen,
  residentAdvisor,
  visitBerlin,
  bandsintown,
  stroeer,
]

export const missingEnv = (p: Platform) => p.envVars.filter((v) => !process.env[v])
