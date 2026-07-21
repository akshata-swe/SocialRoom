---
name: Reactions and comments
description: How emoji reactions on messages, emoji+comment reactions on letters, and the landing-page notification banner are implemented.
---

## Message reactions
- `message_reactions` join table (messageId, userId, emoji, createdAt) — PK(messageId, userId, emoji).
- Toggle: DELETE first; if no rows deleted, INSERT. Returns updated `Record<string, string[]>` map.
- `GET /messages` includes `reactions` per message via a bulk query + in-memory join.
- SSE broadcasts a `"reaction"` event `{ messageId, reactions }` on every toggle.
- ChatView handles `"reaction"` SSE to update cache in real-time.
- Emoji picker (5 emojis) shown below partner's messages; reaction pills shown on any message.
- Users can only react to the OTHER person's messages (picker only renders for `!isMe`).

## Letter comments
- `letter_comments` join table (id, letterId, userId, authorName, content, createdAt).
- `GET /letters/:letterId/comments` + `POST /letters/:letterId/comments` routes.
- LetterReader shows existing comments and an inline textarea + send button below reactions.

## Notifications
- `user_profiles.last_activity_seen_at` timestamp tracks the notification cursor.
- `GET /api/notifications` counts new message reactions + letter comments since last_activity_seen_at on content authored by the current user.
- `POST /api/notifications/seen` updates the cursor.
- Home.tsx shows a `Bell` banner when `newMessageReactions + newLetterComments > 0`.
- If signed in with 0 new notifications, auto-redirects to `/spaces` after 100ms.
- If signed in with new notifications, stays on landing page until user clicks "Enter".
- `markSeenMutation.mutate()` — takes `void`, not `{}`.

## Clerk import
- `useUser` is from `@clerk/react`, not `@clerk/clerk-react`.

## Codegen + Vite cache
- After running orval, the Vite dev server must be restarted to pick up new hooks from the generated api.ts. HMR alone is not enough — stale pre-transform cache causes "Failed to reload" errors.

**Why:** The `@workspace/api-client-react` package exports directly from `./src/index.ts` (no build step). Vite's module cache holds a pre-transformed snapshot; after orval cleans and regenerates, the old snapshot still exists in memory until the server restarts.
