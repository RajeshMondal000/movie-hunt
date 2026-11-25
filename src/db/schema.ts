import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/**
 * Better Auth user table extended with server-managed Movie Hunt fields.
 * Times on approvalExpiresAt/approvedAt are Unix epoch milliseconds.
 */
export const authUser = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    isAnonymous: integer('is_anonymous', {mode: 'boolean', }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    role: text('role').notNull().default('user'),
    approvalStatus: text('approval_status').notNull().default('pending'),
    approvalExpiresAt: integer('approval_expires_at').notNull().default(0),
    approvedAt: integer('approved_at'),
  },
  (table) => [uniqueIndex('user_email_unique').on(table.email)],
)

export const authSession = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('session_token_unique').on(table.token),
    index('session_user_id_idx').on(table.userId),
  ],
)

export const authAccount = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    uniqueIndex('account_provider_account_unique').on(table.providerId, table.accountId),
  ],
)

export const authVerification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

/** Cached movie metadata from TMDB. */
export const movies = sqliteTable('movies', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tmdbId: integer('tmdb_id').notNull().unique(),
    title: text('title').notNull(),
    originalTitle: text('original_title'),
    overview: text('overview').notNull().default(''),
    posterPath: text('poster_path'),
    backdropPath: text('backdrop_path'),
    releaseDate: text('release_date'),
    originalLanguage: text('original_language'),
    popularity: real('popularity').notNull().default(0),
    voteAverage: real('vote_average').notNull().default(0),
    voteCount: integer('vote_count').notNull().default(0),
    isAdult: integer('is_adult', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

/** TMDB genre catalogue. */
export const genres = sqliteTable('genres', {
  tmdbId: integer('tmdb_id').primaryKey(),
  name: text('name').notNull(),
})

/** Many-to-many relationship between cached movies and genres. */
export const movieGenres = sqliteTable(
  'movie_genres',
  {
    movieId: integer('movie_id')
      .notNull()
      .references(() => movies.id, { onDelete: 'cascade' }),
    genreId: integer('genre_id')
      .notNull()
      .references(() => genres.tmdbId, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.movieId, table.genreId] })],
)

/** Small application-level settings store; never store credentials here. */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})


/** A member's personal movie list. Watched entries also provide viewing history. */
export const watchlistItems = sqliteTable(
  'watchlist_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    movieId: integer('movie_id')
      .notNull()
      .references(() => movies.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('want_to_watch'),
    addedAt: integer('added_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    watchedAt: integer('watched_at'),
  },
  (table) => [
    uniqueIndex('watchlist_user_movie_unique').on(table.userId, table.movieId),
    index('watchlist_user_status_idx').on(table.userId, table.status),
    index('watchlist_movie_idx').on(table.movieId),
  ],
)

/** A member's personal rating and review for a movie. */
export const userReviews = sqliteTable(
  'user_reviews',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    movieId: integer('movie_id')
      .notNull()
      .references(() => movies.id, { onDelete: 'cascade' }),
    rating: real('rating').notNull(),
    review: text('review').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('user_reviews_user_movie_unique').on(table.userId, table.movieId),
    index('user_reviews_movie_idx').on(table.movieId),
  ],
)

/** Kitsu metadata cached only when a member adds an anime to their personal library. */
export const animeCatalog = sqliteTable('anime_catalog', {
  kitsuId: text('kitsu_id').primaryKey(),
  title: text('title').notNull(),
  synopsis: text('synopsis').notNull().default(''),
  posterUrl: text('poster_url'),
  coverUrl: text('cover_url'),
  averageRating: real('average_rating').notNull().default(0),
  startDate: text('start_date'),
  episodeCount: integer('episode_count'),
  episodeLength: integer('episode_length'),
  subtype: text('subtype'),
  status: text('status'),
  ageRating: text('age_rating'),
  genresJson: text('genres_json').notNull().default('[]'),
  userCount: integer('user_count').notNull().default(0),
  youtubeVideoId: text('youtube_video_id'),
  slug: text('slug'),
  updatedAt: integer('updated_at').notNull(),
})

/** Anime watchlist is intentionally separate from TMDB movie tracking. */
export const animeWatchlistItems = sqliteTable(
  'anime_watchlist_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    animeId: text('anime_id')
      .notNull()
      .references(() => animeCatalog.kitsuId, { onDelete: 'cascade' }),
    status: text('status').notNull().default('want_to_watch'),
    addedAt: integer('added_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    watchedAt: integer('watched_at'),
  },
  (table) => [
    uniqueIndex('anime_watchlist_user_anime_unique').on(table.userId, table.animeId),
    index('anime_watchlist_user_status_idx').on(table.userId, table.status),
    index('anime_watchlist_anime_idx').on(table.animeId),
  ],
)

/** A member's personal rating and review for an anime. */
export const animeReviews = sqliteTable(
  'anime_reviews',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    animeId: text('anime_id')
      .notNull()
      .references(() => animeCatalog.kitsuId, { onDelete: 'cascade' }),
    rating: real('rating').notNull(),
    review: text('review').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('anime_reviews_user_anime_unique').on(table.userId, table.animeId),
    index('anime_reviews_anime_idx').on(table.animeId),
  ],
)


/** A relationship between two approved Movie Hunt members. userAId/userBId are sorted to enforce one relationship per pair. */
export const friendships = sqliteTable(
  'friendships',
  {
    id: text('id').primaryKey(),
    userAId: text('user_a_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
    userBId: text('user_b_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
    requestedById: text('requested_by_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('friendships_user_pair_unique').on(table.userAId, table.userBId),
    index('friendships_user_a_status_idx').on(table.userAId, table.status),
    index('friendships_user_b_status_idx').on(table.userBId, table.status),
    index('friendships_requested_by_idx').on(table.requestedById),
  ],
)

/** Privacy defaults are conservative: members do not appear in friends' activity until they opt in. */
export const socialPrivacy = sqliteTable('social_privacy', {
  userId: text('user_id').primaryKey().references(() => authUser.id, { onDelete: 'cascade' }),
  shareActivity: integer('share_activity', { mode: 'boolean' }).notNull().default(false),
  allowFriendRequests: integer('allow_friend_requests', { mode: 'boolean' }).notNull().default(true),
  updatedAt: integer('updated_at').notNull(),
})

/** Private media recommendations sent from one accepted friend to another. */
export const sharedRecommendations = sqliteTable(
  'shared_recommendations',
  {
    id: text('id').primaryKey(),
    senderId: text('sender_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
    recipientId: text('recipient_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
    mediaType: text('media_type').notNull(),
    mediaId: text('media_id').notNull(),
    title: text('title').notNull(),
    posterUrl: text('poster_url'),
    message: text('message').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    readAt: integer('read_at'),
  },
  (table) => [
    index('shared_recommendations_recipient_created_idx').on(table.recipientId, table.createdAt),
    index('shared_recommendations_sender_idx').on(table.senderId),
  ],
)

export const rateLimitCounters = sqliteTable(
  'rate_limit_counters',
  {
    bucketKey: text('bucket_key').notNull(),
    windowKey: text('window_key').notNull(),
    count: integer('count').notNull().default(0),
    expiresAt: integer('expires_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bucketKey, table.windowKey] }),
    index('rate_limit_counters_expires_at_idx').on(table.expiresAt),
  ],
)
