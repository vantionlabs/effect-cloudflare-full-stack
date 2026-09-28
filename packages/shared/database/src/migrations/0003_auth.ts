/**
 * better-auth's schema. GENERATED — do not hand-edit.
 *
 * Produced by `bun scripts/auth-schema.ts` from the INSTALLED better-auth via
 * `getAuthTables`, not from @better-auth/cli (which lags the library by three minors and could
 * emit a schema the runtime does not expect).
 *
 * Regenerate after any better-auth upgrade or plugin change; `bun run auth:check` fails CI if
 * this file has drifted from what the installed library implies.
 *
 * These tables are better-auth's. Ours carry `organization_id` with NO foreign key into them,
 * so their upgrades never become our migration problem (plan risk R9).
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists "user" (
      "id" text primary key,
      "name" text not null,
      "email" text not null unique,
      "emailVerified" boolean not null default false,
      "image" text,
      "createdAt" timestamptz not null,
      "updatedAt" timestamptz not null
    )
  `

  yield* sql`
    create table if not exists "session" (
      "id" text primary key,
      "expiresAt" timestamptz not null,
      "token" text not null unique,
      "createdAt" timestamptz not null,
      "updatedAt" timestamptz not null,
      "ipAddress" text,
      "userAgent" text,
      "userId" text not null references "user"("id") on delete cascade,
      "activeOrganizationId" text
    )
  `

  yield* sql`
    create table if not exists "account" (
      "id" text primary key,
      "accountId" text not null,
      "providerId" text not null,
      "userId" text not null references "user"("id") on delete cascade,
      "accessToken" text,
      "refreshToken" text,
      "idToken" text,
      "accessTokenExpiresAt" timestamptz,
      "refreshTokenExpiresAt" timestamptz,
      "scope" text,
      "password" text,
      "createdAt" timestamptz not null,
      "updatedAt" timestamptz not null
    )
  `

  yield* sql`
    create table if not exists "verification" (
      "id" text primary key,
      "identifier" text not null,
      "value" text not null,
      "expiresAt" timestamptz not null,
      "createdAt" timestamptz not null,
      "updatedAt" timestamptz not null
    )
  `

  yield* sql`
    create table if not exists "organization" (
      "id" text primary key,
      "name" text not null,
      "slug" text not null unique,
      "logo" text,
      "createdAt" timestamptz not null,
      "metadata" text
    )
  `

  yield* sql`
    create table if not exists "member" (
      "id" text primary key,
      "organizationId" text not null references "organization"("id") on delete cascade,
      "userId" text not null references "user"("id") on delete cascade,
      "role" text not null default 'member',
      "createdAt" timestamptz not null
    )
  `

  yield* sql`
    create table if not exists "invitation" (
      "id" text primary key,
      "organizationId" text not null references "organization"("id") on delete cascade,
      "email" text not null,
      "role" text,
      "status" text not null default 'pending',
      "expiresAt" timestamptz not null,
      "createdAt" timestamptz not null,
      "inviterId" text not null references "user"("id") on delete cascade
    )
  `

  yield* sql`
    create index if not exists "session_userId_idx" on "session" ("userId")
  `

  yield* sql`
    create index if not exists "account_userId_idx" on "account" ("userId")
  `

  yield* sql`
    create index if not exists "verification_identifier_idx" on "verification" ("identifier")
  `

  yield* sql`
    create index if not exists "organization_slug_idx" on "organization" ("slug")
  `

  yield* sql`
    create index if not exists "member_organizationId_idx" on "member" ("organizationId")
  `

  yield* sql`
    create index if not exists "member_userId_idx" on "member" ("userId")
  `

  yield* sql`
    create index if not exists "invitation_organizationId_idx" on "invitation" ("organizationId")
  `

  yield* sql`
    create index if not exists "invitation_email_idx" on "invitation" ("email")
  `

  yield* sql`
    create index if not exists "invitation_inviterId_idx" on "invitation" ("inviterId")
  `

  yield* sql`
    grant select, insert, update, delete on "user", "session", "account", "verification", "organization", "member", "invitation" to effect_ai_app
  `
})
