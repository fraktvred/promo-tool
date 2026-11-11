# Fraktvred promo tool

Enter an event once, push it to every promo platform with one click.

```bash
npm install
npx playwright install chromium
cp .env.example .env   # fill in what you have; platforms without their vars are greyed out
npm start              # http://localhost:3000
npm test               # payload-mapping unit tests
```

**Preview** shows, for every platform (configured or not), exactly what would be sent: emails,
descriptions, field values, request bodies and images. It sends nothing, and it shows validation
errors such as Ströer's 16-character title limit. Uploaded images are kept between preview and publish.

## Platforms

| Platform | How | Status |
|---|---|---|
| fraktvred.com | Sanity API, creates a **draft** (publish it in the Studio), links existing venue/artists by name | mapping unit-tested |
| Eventbrite | REST API: venue → logo → event → ticket class → publish (always: Spotify only sees published events). Only there so Spotify lists the event: the ticket shows the real price but needs a 99-ticket minimum order, so nobody buys through it (sales go via pretix) | mapping unit-tested |
| Neo Group | Email with flyer to events@neo-group.de (`NEO_GROUP_TO` overrides) | mail body unit-tested |
| visitBerlin | Email with flyer to events@visitberlin.de (`VISITBERLIN_TO` overrides) | mail body unit-tested |
| KeepItRollin | Playwright, public form | fill verified against live form (dry run) |
| Ströer Kulturkalender Berlin | REST API of Ströer's service portal; needs the 16-char short title + a text-free image | mapping unit-tested |

## Debugging browser platforms

- `DRY_RUN=1`: fill everything, never click submit (saves a screenshot of the filled form)
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

When bumping `playwright` in package.json, bump the `FROM mcr.microsoft.com/playwright:vX.Y.Z` tag
in the Dockerfile to the same version (the dependency is pinned exactly for this reason).

## Not supported

In-München (Cloudflare Turnstile captcha on every submission) and Resident Advisor (Cloudflare
blocks headless browsers) would need evading bot protection, so they are left out on purpose.
Bandsintown was dropped as well.
