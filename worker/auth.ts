import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../src/db/schema.js'

export type AuthBindings = {
  movie_hunt_db: D1Database
  BETTER_AUTH_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  ADMIN_EMAILS?: string
}

const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000

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
          type: ['user', 'admin'],
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
            const isAdmin = adminEmails.has(user.email.trim().toLowerCase())

            return {
              data: {
                ...user,
                role: isAdmin ? 'admin' : 'user',
                approvalStatus: isAdmin ? 'approved' : 'pending',
                approvalExpiresAt: now + APPROVAL_WINDOW_MS,
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
  })
}
