# PNG Blackout Tracker

A lightweight community-driven power outage map for Papua New Guinea, starting with Port Moresby. Reports are approximate, community-submitted, and clearly labeled as unverified.

## GitHub Pages

The static frontend is published at [pngblackout.github.io](https://pngblackout.github.io). It uses the Cloudflare Worker backend configured in `public/index.html`; no frontend credentials or API tokens are required.

## Local development

Requirements: Node.js 18+ and npm. Wrangler 3 is pinned because it supports Node.js 18. Install dependencies and start the local Worker:

```sh
npm install
npx wrangler d1 migrations apply port-moresby-power --local
npm run dev
```

Open the URL Wrangler prints. The frontend uses Leaflet and OpenStreetMap from their public CDNs; no API keys are required.

Run checks and tests with:

```sh
npm run check
npm test
```

## API

- `GET /api/outages` returns active reports.
- `GET /api/outages?include=all` returns active and restored reports.
- `POST /api/outages` accepts GPS coordinates, structured city/suburb/locality fields, optional impact and duration values, and the `website` honeypot field. Coordinates, accuracy, and location combinations are validated server-side.
- `POST /api/outages/:id/restore` marks an active report restored.

Reports are rate-limited per client address in the Worker isolate. This is basic spam protection, not an identity or moderation system. A production deployment should consider durable rate limiting and an admin review workflow.

Restored report history older than 30 days is automatically deleted by the Worker’s daily scheduled cleanup. Ongoing reports are retained until they are restored.

## Deployment

Deployment is intentionally not performed by this project session. Before deploying, create a D1 database, update `database_id` in `wrangler.toml`, apply remote migrations, and configure the Worker through Cloudflare. Never commit tokens or `.dev.vars`.

## Admin placeholder

The placeholder at `/admin/` contains no moderation data or controls. GitHub Pages does not protect individual files, so do not treat it as protected when served from the public Pages site. Host it on a separate admin subdomain or Cloudflare Pages project and put that hostname behind a Cloudflare Access application before adding functionality.

### GitHub OAuth admin login

The Worker-hosted `/admin/` placeholder supports GitHub OAuth login. Create a GitHub OAuth App with callback URL `https://port-moresby-power-map.shipitandrei.workers.dev/api/admin/callback`, then configure secrets without committing them:

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_ALLOWED_LOGIN
```

`GITHUB_ALLOWED_LOGIN` must be the exact GitHub username allowed to administer the site. The OAuth client secret and session tokens are never sent to the browser or stored in the repository. The page is still only a login placeholder; moderation controls are not enabled yet.
