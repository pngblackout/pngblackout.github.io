# PNG Blackout Tracker

A lightweight community-driven power outage map for Papua New Guinea, starting with Port Moresby. Reports are approximate, community-submitted, and clearly labeled as unverified.

## GitHub Pages preview

The static frontend is published through GitHub Pages. The Cloudflare Worker/D1 backend is not connected yet, so the Pages preview intentionally shows an offline/API-placeholder state and does not submit reports. When the Worker is ready, set `window.POWER_API_BASE` before `public/app.js` loads to its HTTPS URL.

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
- `POST /api/outages` accepts `{ latitude, longitude, description, website }`. Coordinates and description length are validated server-side; `website` is a honeypot field.
- `POST /api/outages/:id/restore` marks an active report restored.

Reports are rate-limited per client address in the Worker isolate. This is basic spam protection, not an identity or moderation system. A production deployment should consider durable rate limiting and an admin review workflow.

## Deployment

Deployment is intentionally not performed by this project session. Before deploying, create a D1 database, update `database_id` in `wrangler.toml`, apply remote migrations, and configure the Worker through Cloudflare. Never commit tokens or `.dev.vars`.
