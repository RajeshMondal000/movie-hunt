# Movie Hunt

> Discover movies and anime, manage your watchlists, get personalized recommendations, and share picks with friends.

**Live app:** <https://movie-hunt.rjmn.workers.dev/>  
**Repository:** <https://github.com/RajeshMondal000/movie-hunt>

Movie Hunt is a full-stack, friends-oriented movie and anime discovery platform. It combines a React single-page application with a Cloudflare Worker API, persistent D1 storage, Google sign-in, third-party media catalogues, and a hybrid recommendation flow.

## Features

- **Two catalogues:** switch between Movies (TMDB) and Anime (Kitsu).
- **Discovery:** browse popular/trending titles, search, filter, and view title details.
- **Personal libraries:** maintain separate movie and anime lists with `Want to Watch`, `Watching`, `Watched`, and `Dropped` states.
- **Ratings and reviews:** save personal ratings and written reviews for movies and anime.
- **AI recommendations:** prompt-aware, profile-aware candidate ranking with Gemini-assisted explanations and a local algorithm fallback.
- **Friends and community:** discover approved members, send and manage friend requests, share recommendations, and optionally share activity.
- **Private membership:** Google OAuth sign-in, administrator approval, and expiry of unapproved accounts after 24 hours.
- **Serverless deployment:** frontend assets and API run on Cloudflare Workers; D1 stores persistent application data.

## Screenshots

Add the five current application captures to `docs/screenshots/` using the filenames below. The screenshot folder contains a short capture checklist.

| Screen | File |
|---|---|
| Movies home | `01-movies-home.png` |
| Anime discovery | `02-anime-discovery.png` |
| Movie watchlist | `03-movie-watchlist.png` |
| AI anime recommendations | `04-ai-anime-recommendation.png` |
| Friends and community | `05-friends-community.png` |

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 8 |
| Styling and UI | Tailwind CSS v4, Lucide React, Framer Motion |
| Routing / data | React Router, TanStack Query |
| API | Hono on Cloudflare Workers |
| Authentication | Better Auth with Google OAuth |
| Database | Cloudflare D1 (SQLite) |
| ORM / migrations | Drizzle ORM and Drizzle Kit |
| Movie catalogue | TMDB API |
| Anime catalogue | Kitsu API |
| AI recommendations | Google Gemini API with local fallback |
| Hosting | Cloudflare Workers with static assets |

## Architecture

The React app is delivered as static assets by the same Cloudflare Worker deployment that handles `/api/*`. The Hono API uses Better Auth for sessions, Drizzle for D1 access, and server-side requests to TMDB, Kitsu, and Gemini. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the verified system diagram and request flows.

## Database

D1 contains 16 application tables covering authentication, cached catalogue data, personal lists and reviews, and social features. Movie and anime records use separate catalogue and list tables. See [docs/DATABASE.md](docs/DATABASE.md) for the ER diagram, constraints, and migration history.

## Run locally

Prerequisites: Node.js and npm, a Cloudflare account for Wrangler operations, and API credentials for Google OAuth, TMDB, and Gemini.

```bash
git clone https://github.com/RajeshMondal000/movie-hunt.git
cd movie-hunt
npm install
```

Create `.dev.vars` from the example file and fill in your own development credentials:

```cmd
copy .dev.vars.example .dev.vars
```

Required local variables:

```env
BETTER_AUTH_SECRET=replace_with_a_random_secret
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
ADMIN_EMAILS=your-admin-email@gmail.com
TMDB_ACCESS_TOKEN=your_tmdb_api_read_access_token
GEMINI_API_KEY=your_google_ai_studio_api_key
GEMINI_MODEL=gemini-3.6-flash
```

Then run the app:

```bash
npm run cf-typegen
npm run db:migrate:local
npm run lint
npm run build
npm run dev
```

## Deployment

Movie Hunt is deployed at <https://movie-hunt.rjmn.workers.dev/>. The Worker, asset routing, D1 binding, and 15-minute account-cleanup Cron Trigger are configured in `wrangler.jsonc`.

For the full Cloudflare deployment and GitHub push workflow, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Production migrations are separate from code deployment and must be reviewed and applied deliberately.

## Project documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database design](docs/DATABASE.md)
- [Deployment guide](docs/DEPLOYMENT.md)

## Data-provider attribution

Movie metadata is provided by **The Movie Database (TMDB)**. Anime metadata is provided by **Kitsu**. Their names, logos, and data remain subject to their respective terms and attribution requirements. Movie Hunt is an independent project and is not endorsed by TMDB or Kitsu.