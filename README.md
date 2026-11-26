# SriLead CRM — Frontend

React + Vite (TypeScript) UI for SriLead CRM. The API lives in [crm-backend](https://github.com/klareitlabs/crm-backend).

## Project structure

```
src/
  app/              # Root app, legacy bootstrap
  components/
    layout/         # Shell chrome (sidebar, header, overlays)
  constants/        # Shared enums and view metadata
  features/
    legacy/         # Original SPA (migrating view-by-view to React)
  hooks/            # React hooks
  lib/
    api/            # HTTP client and SriStore (/api/state)
  styles/           # Global CSS
  types/            # Shared TypeScript types
```

Import paths use the `@/` alias (see `vite.config.ts`).

Screens still live in `src/features/legacy/app.js` while each view moves into `src/features/<name>/`.

## Run locally

Requires Node.js 20+ and, when `VITE_API_TARGET=local`, the [backend API](https://github.com/klareitlabs/crm-backend) on port **8589**.

```bash
npm install
npm run dev    # http://localhost:5173 — proxies /api → http://localhost:8589
```

The `.env` file selects the API target for the Vite proxy. Set `VITE_API_TARGET=dev`
to send `/api` requests to `https://synaflo.srizon.org` instead, or set it back to
`local` to use the backend on port 8589. Restart the dev server after changing it.

Start PostgreSQL and the backend first (see the backend repo README).

## Production

Deployed at **https://synaflo.srizon.org** (same host should reverse-proxy `/api` to the backend).

## Build

```bash
npm run build    # output in dist/
```

Serve `dist/` behind that domain; API requests use same-origin `/api`.

## Data layer

The browser talks to `/api/state` through `src/lib/api/sriStore.ts` (`SriStore.load / save / reset`), attached on `window.SriStore` for the legacy layer during migration.