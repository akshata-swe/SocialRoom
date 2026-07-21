# The Social Media Room — Sanctuary

A private, intentional digital sanctuary for exactly two people. A "Google Drive inside Slack" for deep, asynchronous relationship communication — no algorithms, no feeds, no noise.

## Run & Operate

- `pnpm --filter @workspace/sanctuary run dev` — run the frontend (port auto-assigned)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite (artifacts/sanctuary)
- API: Express 5 (artifacts/api-server)
- Auth: Clerk (Replit-managed, magic link / email)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle schema: spaces, tags, letters, letter_tags, letter_reads, letter_attachments, messages, message_reads
- `artifacts/api-server/src/routes/` — Express route handlers (spaces, tags, letters, messages, me, upload)
- `artifacts/api-server/src/middlewares/requireAuth.ts` — Clerk auth guard
- `artifacts/sanctuary/src/` — React frontend with Clerk auth, permanent dark mode

## Architecture decisions

- **Dual-user only**: No per-user data isolation beyond `authorId`. Auth enforces that only the two registered users can access the space.
- **Postbox vs Chat channels**: Tags have a `type` field (`postbox` | `chat`) that switches the right panel between a letter grid and a linear chat stream.
- **Unread counts are silent**: Computed server-side per tag per user; the frontend polls `/api/unread-counts` every 10s with no popups or banners.
- **Letter content is JSON blocks**: Stored as `{ blocks: [{ id, type: "paragraph", data: { text } }] }` — decoupled from HTML rendering.
- **File uploads are local**: Files are stored in `artifacts/api-server/uploads/` and served via `/api/uploads/:filename`. For production, switch to object storage.

## Product

- **Landing page** — public, introduces the sanctuary concept, CTA to sign in
- **Sanctuary shell** — Discord/Slack-style: 260px sidebar + dynamic right panel
- **Postbox view** — grid of warm envelope-style letter cards for archive channels
- **Letter reader overlay** — full-page distraction-free reading with emoji reactions
- **Letter composer** — full-page writing canvas with title, long-form text, tag selector
- **Chat view** — bottom-anchored message stream with no typing indicators or read receipts
- **Sidebar** — spaces as collapsible headers, tags with silent unread badges, user profile at bottom

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After changing `lib/db/src/schema/`, run `pnpm run typecheck:libs` before the API server typecheck or you'll get stale declaration errors.
- The Clerk dev-keys console warning is expected in development — not a real error.
- Express 5 types `req.params` values as `string | string[]` — always cast with `as string` before `parseInt()`.
- Seed data uses placeholder `authorId` values (`seed_author_1`, `seed_author_2`). Real users will see unread counts against these.
