# Movie Hunt

## Live app:** <https://movie-hunt.rjmn.workers.dev/>  

> Movie Hunt is a full-stack, friends-oriented movie and anime discovery platform. It combines a React single-page application with a Cloudflare Worker API, persistent D1 storage, Google sign-in, third-party media catalogues, and a hybrid recommendation flow.

![Main Interface](docs\screenshots\01-movies-home.png)

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


## Rate Limiting and Usage Quotas

Movie Hunt implements tier-based rate limiting to protect its APIs, external service credentials, and database resources while maintaining a usable experience for guests and registered members.

### Minute-Level API Rate Limits

| API Category | Public Visitor | Guest | Registered Member | Administrator |
|---|---:|---:|---:|---:|
| General API requests | 30/min | 60/min | 180/min | 600/min |
| Catalogue discovery (popular, trending, details, genres) | 30/min | 30/min | 90/min | 180/min |
| Movie and anime search | 12/min | 12/min | 36/min | 60/min |
| Watchlist and review mutations | — | 10/min | 30/min | 120/min |
| AI recommendation submissions | — | 1/min | 3/min | 10/min |
| Social and member-directory reads | — | Restricted | 30/min | 120/min |
| Profile updates | — | Blocked | 5/min | 30/min |
| Administrative endpoints | — | — | — | 30/min |

**Note:** General API and category-specific limits are cumulative. Each applicable request consumes from both buckets. Public visitors and guests share the same Discovery and Search category limits.

### Daily Usage Quotas

| Operation | Guest | Registered Member | Administrator |
|---|---:|---:|---:|
| Combined movie/anime watchlist and review mutations | 40/day | 120/day | 2,000/day |
| AI recommendation submissions | 3/day | 12/day | 400/day |
| Friend requests | Not allowed | 10/day* | 50/day |
| Recommendation sharing | Not allowed | Not allowed | 100/day* |

*Friend requests and recommendation sharing require an approved account.*

### Authentication Protection

| Operation | Limit |
|---|---:|
| Google sign-in attempts | 5/min/IP |
| Guest sign-in attempts | 2/min/IP |
| Guest account creation | 10/day/IP |

### Gemini API Protection

| Resource | Application-Level Limit |
|---|---:|
| Gemini API attempts | 12 per rolling 60 seconds |
| Gemini API attempts | 450 per Pacific calendar day |
| Guest AI submissions | 3/day |
| Registered member AI submissions | 12/day |
| Administrator AI submissions | 400/day |

The shared Gemini request limits apply across both Movie and Anime recommendation systems. When the provider-level application quota is exhausted, Movie Hunt uses its local recommendation algorithm as a fallback.

### Enforcement Architecture

- **Cloudflare Rate Limiting bindings:** Provide minute-level burst protection using account or IP-based identities. These counters are approximate and location-local.
- **Cloudflare D1:** Maintains authoritative daily counters for library mutations, AI submissions, social actions, guest creation, and Gemini API attempts.
- **Client-side caching:** Reuses previously loaded catalogue responses for five minutes and avoids unnecessary repeat requests during navigation.
- **Background preloading:** Fetches neighbouring Discovery pages to improve navigation responsiveness.
- **Rate-limit notifications:** Displays contextual notifications when an API request is rejected, including sign-in guidance for public visitors and guests.

Daily application quotas reset at midnight Pacific Time.


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