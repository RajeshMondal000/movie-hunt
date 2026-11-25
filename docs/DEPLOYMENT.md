# Deployment

Movie Hunt is deployed at <https://movie-hunt.rjmn.workers.dev/> using Cloudflare Workers with static assets and a D1 database. The checked-in `wrangler.jsonc` defines the Worker entry point, SPA asset fallback, API routing, D1 binding, and scheduled account-cleanup trigger.

## Runtime configuration

The supplied `wrangler.jsonc` configures:

- Worker name: `movie-hunt`
- Entry point: `worker/index.ts`
- Static assets: SPA fallback for client-side routes
- API routing: `/api/*` runs through the Worker first
- D1 binding: `movie_hunt_db`
- D1 database name: `movie-hunt-db`
- Migration directory: `migrations`
- Cron schedule: `*/15 * * * *` (every 15 minutes)

## Local development

### Prerequisites

- Node.js and npm
- Git
- A Cloudflare account for Wrangler login and D1 operations
- Google OAuth credentials
- TMDB API Read Access Token
- Gemini API key

Kitsu's public catalogue endpoints used by the application do not require a separate key.

### Install and configure

```bash
git clone https://github.com/RajeshMondal000/movie-hunt.git
cd movie-hunt
npm install
```

Create a local secrets file:

```cmd
copy .dev.vars.example .dev.vars
```

Set the values in `.dev.vars`:

```env
BETTER_AUTH_SECRET=your_random_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
ADMIN_EMAILS=your-admin-email@gmail.com
TMDB_ACCESS_TOKEN=your_tmdb_api_read_access_token
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash
```


### Run locally

```bash
npx wrangler login
npm run cf-typegen
npm run db:migrate:local
npm run lint
npm run build
npm run dev
```

Open <http://localhost:5173/>. The local D1 database is stored under `.wrangler/state`; preserve it if you want to keep local test data between development sessions.

### Database changes

After changing `src/db/schema.ts`, generate and apply a local migration:

```bash
npm run db:generate
npm run db:migrate:local
npm run cf-typegen
npm run lint
npm run build
```

Review the generated SQL before using it in production.

## Production D1 migrations

Production migrations are separate from Worker deployments. Review the migration SQL, take a remote D1 export, and only then apply the migration:

```bash
npx wrangler d1 export movie-hunt-db --remote --output=../movie-hunt-backup.sql
npm run db:migrate:remote
npx wrangler d1 migrations list movie-hunt-db --remote
```

The checked-in migration set `0000`–`0004` was applied to the production D1 database during the initial deployment. New schema changes should use new migration files; never rewrite an already-applied migration.

## Cloudflare Workers Builds with GitHub

For automatic deployment on pushes, connect `RajeshMondal000/movie-hunt` to **Workers & Pages → Create application → Connect to Git** in the Cloudflare dashboard.

Recommended build settings:

| Setting | Value |
|---|---|
| Worker name | `movie-hunt` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run lint && npm run build` |
| Deploy command | `npx wrangler deploy` |

Cloudflare installs dependencies from the lockfile as part of the build. Confirm the Workers Builds integration is connected and the production branch is `main`; only then will a push to `main` trigger automatic production deployment.

If Workers Builds is not configured, deploy manually from the project root:

```bash
npm run deploy
```

Typical source-control workflow:

```bash
git add .
git commit -m "feat: describe the change"
git push origin main
```

A Git push does not apply D1 migrations automatically. Keep application deployment and schema migration as separate reviewed operations.

## Production secrets and variables

In Cloudflare, open **Workers & Pages → movie-hunt → Settings → Variables and Secrets**. Configure these runtime values:

| Name | Type |
|---|---|
| `BETTER_AUTH_SECRET` | Secret |
| `GOOGLE_CLIENT_ID` | Variable |
| `GOOGLE_CLIENT_SECRET` | Secret |
| `ADMIN_EMAILS` | Variable |
| `TMDB_ACCESS_TOKEN` | Secret |
| `GEMINI_API_KEY` | Secret |
| `GEMINI_MODEL` | Variable |

Use the same intended values as your local configuration, but enter them in Cloudflare's dashboard. Do not put secrets in source files, GitHub Actions variables that are not needed by the build, or frontend environment variables.

## Google OAuth production callback

For the deployed Worker domain, configure the Google OAuth client with:

- Authorized JavaScript origin: `https://movie-hunt.rjmn.workers.dev`
- Authorized redirect URI: `https://movie-hunt.rjmn.workers.dev/api/auth/callback/google`

If a custom domain is added later, add its origin and callback URI as well. Confirm the deployed Better Auth base URL matches the public domain.

## Post-deployment checks

1. Open `https://movie-hunt.rjmn.workers.dev/api/health` and confirm `status: ok` and `database: connected`.
2. Sign in with Google and confirm `/api/me` returns the expected role and approval state.
3. Test a movie and anime search.
4. Add a movie and anime to separate watchlists; refresh and sign in again to verify persistence.
5. Test ratings/reviews, AI recommendations and local fallback.
6. Test friend requests, activity sharing and recommendation inbox.
7. Check Worker logs and scheduled-event logs for the cleanup trigger.

The cleanup Cron Trigger is configured for every 15 minutes. Access checks also reject expired pending and rejected accounts; the scheduled job performs periodic cleanup of their related records.
