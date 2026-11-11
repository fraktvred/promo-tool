# Fraktvred promo tool

Enter an event once, push it to every promo platform with one click.

```bash
npm install
npx playwright install chromium
cp .env.example .env   # fill in what you have; platforms without their vars are greyed out
npm start              # http://localhost:3000
npm test               # payload-mapping unit tests
```

## Platforms

| Platform | How | Status |
|---|---|---|
| fraktvred.com | Sanity API, creates a **draft** (publish it in the Studio), links existing venue/artists by name | mapping unit-tested |
| Eventbrite | REST API: venue → logo → event → ticket class; draft unless `EVENTBRITE_PUBLISH=1` | mapping unit-tested |
| Neo Group | Email with flyer to events@neo-group.de (`NEO_GROUP_TO` overrides) | mail body unit-tested |
| KeepItRollin | Playwright, public form | fill verified against live form (dry run) |
| In-München | Playwright, public form; Cloudflare Turnstile may need `HEADLESS=false` | fill verified against live form (dry run) |
| Resident Advisor, visitBerlin, Bandsintown, Ströer Kulturkalender | Playwright: login, fill by label, **you submit by hand** (`HEADLESS=false`) | selectors not recorded yet |

To graduate a "manual submit" platform: `npx playwright codegen <submit url>`, then write a module with exact
selectors and a real `submit` step, modelled on `src/platforms/keepItRollin.ts`.

## Debugging browser platforms

- `HEADLESS=false`: show the browser
- `DRY_RUN=1`: fill everything, never click submit
- Failures save a screenshot to `failures/`

## Container

CI (`.github/workflows/docker.yml`) runs typecheck + tests, then builds the image and pushes it to
`ghcr.io/<owner>/<repo>` on pushes to `main` (`:main`, `:latest`, `:sha-…`) and on `v*` tags (`:1.2.3`, `:1.2`).
Pull requests only build.

```bash
docker run -d -p 3000:3000 --env-file .env \
  -v promo-uploads:/app/uploads -v promo-failures:/app/failures \
  ghcr.io/<owner>/<repo>:latest
```

The container is headless only: the "manual submit" platforms (`HEADLESS=false`) need a display,
so run those from a local `npm start` instead.

When bumping `playwright` in package.json, bump the `FROM mcr.microsoft.com/playwright:vX.Y.Z` tag
in the Dockerfile to the same version (the dependency is pinned exactly for this reason).
