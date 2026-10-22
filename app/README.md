# Document Intelligence app (Next.js)

The Document Intelligence web app. This page covers running and testing it on your laptop while you change the UI. To deploy, use the scripts at the repo root (see the main [README](../README.md)).

## Run locally

Deploy the database objects first (`./deploy.sh` from the repo root), or the pages will have no data.

```bash
cd app/
npm install
npm run dev
```

The app uses your default Snowflake CLI connection (`~/.snowflake/config.toml` or `connections.toml`). To pick another:

```bash
SNOWFLAKE_CONNECTION_NAME=myconn npm run dev
```

The agent and search routes call Snowflake REST APIs, so locally they also need your account URL in `app/.env.local`:

```
SNOWFLAKE_HOST=https://your-account.snowflakecomputing.com
```

- The deployed app sets this for you.
- See `.env.example` for the other settings you can use locally.
- The deployed app does not read `.env` files; branding goes in `theme.config.ts`.

## Test

```bash
npm test             # unit tests (vitest)
npx tsc --noEmit     # type check
npm run build        # production build
```

## Where things are

| Path | What |
|---|---|
| `app/` | Pages (App Router) and API routes under `app/api/` |
| `components/` | Shared UI, including the sidebar and page guard |
| `lib/app-pages.ts` | The tab list |
| `lib/field-labels.ts` | On-screen names for extracted fields |
| `lib/entitlements.ts` | App-role access checks |
| `lib/snowflake.ts` | Snowflake connection (caller's rights in the deployed app) |
| `theme.config.ts` | Branding |
