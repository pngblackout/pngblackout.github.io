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
