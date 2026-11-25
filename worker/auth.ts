import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../src/db/schema.js'
import { anonymous } from 'better-auth/plugins'

export type AuthBindings = {
  movie_hunt_db: D1Database
  BETTER_AUTH_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  ADMIN_EMAILS?: string
}

const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours
const GUEST_WINDOW_MS = 5 * 60 * 60 * 1000    // 5 hours

export function isAuthConfigured(env: AuthBindings): boolean {
  return Boolean(
    env.BETTER_AUTH_SECRET &&
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET,
  )
}

export function createAuth(env: AuthBindings, origin: string) {
  if (!isAuthConfigured(env)) {
    throw new Error('Authentication secrets are not configured.')
  }

  const db = drizzle(env.movie_hunt_db, { schema })
  const adminEmails = new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.authUser,
        session: schema.authSession,
        account: schema.authAccount,
        verification: schema.authVerification,
      },
    }),
    secret: env.BETTER_AUTH_SECRET!,
    baseURL: origin,
    trustedOrigins: [origin],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID!,
        clientSecret: env.GOOGLE_CLIENT_SECRET!,
        prompt: 'select_account',
      },
    },
    user: {
      additionalFields: {
        role: {
          type: ['user', 'admin', 'guest'],
          required: false,
          defaultValue: 'user',
          input: false,
        },
        approvalStatus: {
          type: ['pending', 'approved', 'rejected'],
          required: false,
          defaultValue: 'pending',
          input: false,
        },
        approvalExpiresAt: {
          type: 'number',
          required: false,
          input: false,
        },
        approvedAt: {
          type: 'number',
          required: false,
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const now = Date.now()

            const isGuest = user.isAnonymous === true

            const isAdmin =
              !isGuest &&
              adminEmails.has(user.email.trim().toLowerCase())

            return {
              data: {
                ...user,

                role: isGuest
                  ? 'guest'
                  : isAdmin
                    ? 'admin'
                    : 'user',

                approvalStatus: isAdmin
                  ? 'approved'
                  : 'pending',

                approvalExpiresAt: now + (
                  isGuest ? GUEST_WINDOW_MS : APPROVAL_WINDOW_MS
                ),

                approvedAt: isAdmin ? now : null,
              },
            }
          },
        },
      },
    },
    advanced: {
      database: {
        generateId: 'uuid',
      },
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip'],
      },
    },

    plugins: [
      anonymous({
        emailDomainName: 'guest.movie-hunt.invalid',

        generateName: () =>
          `Guest-${crypto.randomUUID().slice(0, 8)}`,

        onLinkAccount: async ({ anonymousUser, newUser }) => {
          const guestId = anonymousUser.user.id
          const accountId = newUser.user.id

          if (!guestId || !accountId || guestId === accountId) {
            return
          }

          // Copy guest data into the newly registered account.
          // INSERT OR IGNORE preserves existing account records
          // if the Google account already has the same movie/anime.

          await env.movie_hunt_db.batch([
            env.movie_hunt_db.prepare(`
            INSERT OR IGNORE INTO watchlist_items
              (id, user_id, movie_id, status, added_at, updated_at, watched_at)
            SELECT
              lower(hex(randomblob(16))), ?, movie_id, status,
              added_at, updated_at, watched_at
            FROM watchlist_items
            WHERE user_id = ?
          `).bind(accountId, guestId),

            env.movie_hunt_db.prepare(`
            INSERT OR IGNORE INTO user_reviews
              (id, user_id, movie_id, rating, review, created_at, updated_at)
            SELECT
              lower(hex(randomblob(16))), ?, movie_id, rating,
              review, created_at, updated_at
            FROM user_reviews
            WHERE user_id = ?
          `).bind(accountId, guestId),

            env.movie_hunt_db.prepare(`
            INSERT OR IGNORE INTO anime_watchlist_items
              (id, user_id, anime_id, status, added_at, updated_at, watched_at)
            SELECT
              lower(hex(randomblob(16))), ?, anime_id, status,
              added_at, updated_at, watched_at
            FROM anime_watchlist_items
            WHERE user_id = ?
          `).bind(accountId, guestId),

            env.movie_hunt_db.prepare(`
            INSERT OR IGNORE INTO anime_reviews
              (id, user_id, anime_id, rating, review, created_at, updated_at)
            SELECT
              lower(hex(randomblob(16))), ?, anime_id, rating,
              review, created_at, updated_at
            FROM anime_reviews
            WHERE user_id = ?
          `).bind(accountId, guestId),

            env.movie_hunt_db.prepare(`
            INSERT OR IGNORE INTO social_privacy
              (user_id, share_activity, allow_friend_requests, updated_at)
            SELECT
              ?, share_activity, allow_friend_requests, updated_at
            FROM social_privacy
            WHERE user_id = ?
          `).bind(accountId, guestId),

            // Remove the source guest records after copying them.
            env.movie_hunt_db.prepare(
              'DELETE FROM watchlist_items WHERE user_id = ?'
            ).bind(guestId),

            env.movie_hunt_db.prepare(
              'DELETE FROM user_reviews WHERE user_id = ?'
            ).bind(guestId),

            env.movie_hunt_db.prepare(
              'DELETE FROM anime_watchlist_items WHERE user_id = ?'
            ).bind(guestId),

            env.movie_hunt_db.prepare(
              'DELETE FROM anime_reviews WHERE user_id = ?'
            ).bind(guestId),

            env.movie_hunt_db.prepare(
              'DELETE FROM social_privacy WHERE user_id = ?'
            ).bind(guestId),
          ])
        },
      }),
    ]
  })
}
