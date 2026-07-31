# Testing & Component Guide
## Kothadi — Modular Architecture Breakdown & Step-by-Step Testing Plan

> **How to use this guide:** Work bottom-up — database first, then API, then auth/integrations, then frontend components. Each layer depends on the one below it. Never skip a layer if the one beneath it is failing.

---

## Table of Contents

1. [Modular Architecture Overview](#1-modular-architecture-overview)
2. [Layer 1 — Database & Models](#2-layer-1--database--models)
3. [Layer 2 — API Server & Backend Services](#3-layer-2--api-server--backend-services)
4. [Layer 3 — Real-Time (SSE)](#4-layer-3--real-time-sse)
5. [Layer 4 — Third-Party Integrations (Clerk Auth)](#5-layer-4--third-party-integrations-clerk-auth)
6. [Layer 5 — State Management & API Client](#6-layer-5--state-management--api-client)
7. [Layer 6 — UI Components](#7-layer-6--ui-components)
8. [Layer 7 — Pages & End-to-End Flows](#8-layer-7--pages--end-to-end-flows)
9. [Environment & Pre-flight Checks](#9-environment--pre-flight-checks)
10. [Troubleshooting Quick Reference](#10-troubleshooting-quick-reference)

---

## 1. Modular Architecture Overview

The application is a **pnpm monorepo** split into isolated packages. Understanding the boundaries prevents confusion when a failure in one layer surfaces as a symptom in another.

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 7: Pages & E2E flows (Home, Sanctuary, Onboarding)   │
├──────────────────────────────────────────────────────────────┤
│  Layer 6: UI Components (ChatView, PostboxView, Sidebar…)   │
├──────────────────────────────────────────────────────────────┤
│  Layer 5: State Management (TanStack Query + Orval hooks)   │
├────────────────────────────┬─────────────────────────────────┤
│  Layer 4: Clerk Auth       │  Layer 3: SSE Real-Time        │
├────────────────────────────┴─────────────────────────────────┤
│  Layer 2: Express API Server (REST endpoints)               │
├──────────────────────────────────────────────────────────────┤
│  Layer 1: PostgreSQL Database (Drizzle ORM)                 │
└──────────────────────────────────────────────────────────────┘
```

### Package Map

| Package | Path | Responsibility |
|---------|------|----------------|
| `@workspace/db` | `lib/db/` | Drizzle schema definitions + DB client |
| `@workspace/api-zod` | `lib/api-zod/` | Zod validation schemas shared between API and client |
| `@workspace/api-spec` | `lib/api-spec/` | OpenAPI contract definition |
| `@workspace/api-client-react` | `lib/api-client-react/` | Orval-generated TanStack Query hooks |
| `@workspace/api-server` | `artifacts/api-server/` | Express server, all REST + SSE routes |
| `@workspace/sanctuary` | `artifacts/sanctuary/` | React frontend (Vite + Wouter + Clerk) |

### Dependency Flow (read: "depends on")
```
sanctuary → api-client-react → api-zod → api-spec
sanctuary → Clerk (external)
api-server → db → PostgreSQL
api-server → Clerk (external, for token verification)
```

---

## 2. Layer 1 — Database & Models

### Responsibilities
Raw data persistence. All application state ultimately lives here. The API server is the only process that writes to the database.

### Schema Summary

| Table | Primary Key | Key Columns | Relationships |
|-------|------------|-------------|---------------|
| `spaces` | `id` (serial) | `name`, `sortOrder` | has many `tags` |
| `tags` | `id` (serial) | `spaceId`, `name`, `slug`, `type` (postbox\|chat), `isAdminOnly`, `sortOrder` | belongs to `spaces`; has many `letters` (via `letter_tags`), `messages`, `message_reads` |
| `letters` | `id` (serial) | `title`, `content` (jsonb), `authorId`, `authorName`, `reactions` (jsonb) | many-to-many `tags` via `letter_tags`; has many `letter_comments`, `letter_reads`, `letter_attachments` |
| `letter_tags` | `(letterId, tagId)` | — | join table |
| `letter_reads` | `(letterId, userId)` | `readAt` | tracks who has read which letter |
| `letter_comments` | `id` (serial) | `letterId`, `userId`, `authorName`, `content` | belongs to `letters` |
| `letter_attachments` | `id` (serial) | `letterId`, `url`, `filename`, `mimeType`, `size` | belongs to `letters` |
| `messages` | `id` (serial) | `tagId`, `authorId`, `authorName`, `content`, `createdAt` | belongs to `tags`; has many `message_reactions` |
| `message_reactions` | `(messageId, userId, emoji)` | `createdAt` | join table |
| `message_reads` | `(tagId, userId)` | `lastReadMessageId` | tracks last-read position per user per channel |
| `user_profiles` | `userId` (text) | `displayName`, `isProfileComplete`, `lastActivitySeenAt` | one per Clerk user |

### What to Test

1. Database connectivity
2. All tables exist with correct columns
3. Foreign key constraints are enforced
4. Unique constraints on `tags.slug` and `message_reactions` composite PK

### How to Test

**Step 1.1 — Verify the database is reachable**

```bash
# From the project root
pnpm --filter @workspace/db exec node -e "
const { db } = require('./dist/index.js');
db.execute('SELECT 1 as ok').then(r => console.log('DB OK:', r)).catch(e => console.error('DB FAIL:', e.message));
"
```

Or connect directly with psql (get the connection string from Replit secrets):
```bash
psql $DATABASE_URL -c "SELECT version();"
```

**Step 1.2 — Verify all tables exist**

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expected output (11 tables):
```
letter_attachments
letter_comments
letter_reads
letter_tags
letters
message_reactions
message_reads
messages
spaces
tags
user_profiles
```

**Step 1.3 — Verify foreign key constraints**

```sql
-- This should fail with a foreign key violation
INSERT INTO tags (space_id, name, slug, type, sort_order)
VALUES (99999, 'test', 'test-slug', 'chat', 0);
-- Expected: ERROR: insert or update on table "tags" violates foreign key constraint
```

**Step 1.4 — Verify unique constraint on tags.slug**

```sql
-- Insert a tag, then try to insert another with the same slug
INSERT INTO spaces (name, sort_order) VALUES ('Test Space', 0) RETURNING id;
-- Use returned id below
INSERT INTO tags (space_id, name, slug, type, sort_order) VALUES (<id>, 'Tag A', 'duplicate-slug', 'chat', 0);
INSERT INTO tags (space_id, name, slug, type, sort_order) VALUES (<id>, 'Tag B', 'duplicate-slug', 'chat', 1);
-- Expected: ERROR: duplicate key value violates unique constraint "tags_slug_unique"
```

**Step 1.5 — Clean up test data**

```sql
DELETE FROM tags WHERE slug = 'duplicate-slug';
DELETE FROM spaces WHERE name = 'Test Space';
```

### Expected Outcome
- `SELECT 1` returns successfully
- All 11 tables are present
- FK and unique constraint violations produce errors (not silent failures)

### Troubleshooting
| Symptom | Check |
|---------|-------|
| `ECONNREFUSED` on DB connect | `DATABASE_URL` secret is set; Replit DB is provisioned |
| Table not found | Run `pnpm db:push` or `pnpm db:migrate` from `lib/db/` |
| FK constraints not enforced | Drizzle may have created tables without constraints; inspect with `\d+ tags` in psql |

---

## 3. Layer 2 — API Server & Backend Services

### Responsibilities
All business logic. Validates input (Zod), enforces auth (Clerk JWT), reads/writes the database, and returns JSON. The frontend never touches the database directly.

### Server Setup
- **Framework:** Express
- **Port:** `process.env.PORT` (assigned by Replit)
- **Middleware stack (in order):**
  1. `pino-http` — request logging
  2. `cors` — cross-origin headers
  3. `cookieParser` — cookie parsing
  4. `express.json` — JSON body parsing
  5. `clerkMiddleware` — populates `req.auth` from Bearer token
  6. Route handlers
  7. `requireAuth` middleware — on protected routes, rejects if no valid Clerk session

### Auth Model
- `requireAuth` — validates Clerk JWT; injects `req.userId` (Clerk user ID string)
- `requireAdmin` — additionally checks `req.userId === process.env.ADMIN_USER_ID`

### What to Test (All Endpoints)

#### Pre-flight: Get a valid auth token

Every protected endpoint needs a Bearer token. Get one from the browser:

1. Sign in to the app in a browser
2. Open DevTools → Application → Cookies → find the `__session` or `__clerk_db_jwt` cookie
3. Alternatively, in DevTools Console run:
```javascript
const token = await window.Clerk.session.getToken();
console.log(token);
```
4. Copy the token. Use it as `$TOKEN` in all curl commands below.

Also find your base API URL (the dev domain):
```bash
# In Replit shell
echo "https://$REPLIT_DEV_DOMAIN/api-server"
# Use this as $API_URL in curl commands
```

---

### Step-by-Step Endpoint Tests

#### Step 2.1 — Health / Profile

**GET /me** — Returns current user profile
```bash
curl -s -H "Authorization: Bearer $TOKEN" $API_URL/me | jq .
```
Expected:
```json
{
  "userId": "user_xxx",
  "email": "you@example.com",
  "displayName": "Your Name",
  "isProfileComplete": true
}
```

**PATCH /profile** — Update display name
```bash
curl -s -X PATCH $API_URL/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName": "TestName"}' | jq .
```
Expected: `{ "displayName": "TestName", "isProfileComplete": true, ... }`

---

#### Step 2.2 — Spaces

**GET /spaces**
```bash
curl -s -H "Authorization: Bearer $TOKEN" $API_URL/spaces | jq .
```
Expected: Array of space objects, each with nested `tags` array and `unreadCount` per tag.

**POST /spaces**
```bash
curl -s -X POST $API_URL/spaces \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Space", "sortOrder": 99}' | jq .
```
Expected: `{ "id": <number>, "name": "Test Space", "sortOrder": 99 }`
Save the `id` as `$SPACE_ID`.

**PATCH /spaces/:spaceId**
```bash
curl -s -X PATCH $API_URL/spaces/$SPACE_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Renamed Space"}' | jq .
```
Expected: Updated space object with `"name": "Renamed Space"`.

---

#### Step 2.3 — Tags (Channels)

**POST /tags** — Create a chat channel
```bash
curl -s -X POST $API_URL/tags \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"spaceId": '$SPACE_ID', "name": "Test Chat", "type": "chat", "sortOrder": 0}' | jq .
```
Expected: `{ "id": <number>, "name": "Test Chat", "type": "chat", "slug": "test-chat", ... }`
Save the `id` as `$TAG_ID`.

**POST /tags** — Create a postbox channel
```bash
curl -s -X POST $API_URL/tags \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"spaceId": '$SPACE_ID', "name": "Test Postbox", "type": "postbox", "sortOrder": 1}' | jq .
```
Save this `id` as `$POSTBOX_TAG_ID`.

---

#### Step 2.4 — Messages (Chat)

**GET /messages** — Paginated message list
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/messages?tagId=$TAG_ID&limit=20" | jq .
```
Expected: Array (empty if new channel): `[]`

**POST /messages** — Send a message
```bash
curl -s -X POST $API_URL/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tagId": '$TAG_ID', "content": "Hello from test"}' | jq .
```
Expected: `{ "id": <number>, "content": "Hello from test", "authorName": "...", ... }`
Save the `id` as `$MSG_ID`.

**PATCH /messages/:messageId** — Edit a message
```bash
curl -s -X PATCH $API_URL/messages/$MSG_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Edited content"}' | jq .
```
Expected: Updated message with `"content": "Edited content"`.

**POST /messages/:messageId/react** — Add a reaction
```bash
curl -s -X POST $API_URL/messages/$MSG_ID/react \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"emoji": "❤️"}' | jq .
```
Expected: `{ "messageId": ..., "emoji": "❤️", ... }`

**POST /messages/:messageId/react** — Toggle reaction off (same emoji again)
```bash
# Same command as above
```
Expected: `{ "removed": true }` or empty 204 (reaction toggled off).

**DELETE /messages/:messageId** — Delete a message
```bash
curl -s -X DELETE $API_URL/messages/$MSG_ID \
  -H "Authorization: Bearer $TOKEN" | jq .
```
Expected: `{ "success": true }` or 204.

---

#### Step 2.5 — Letters (Postbox)

**POST /letters** — Create a letter
```bash
curl -s -X POST $API_URL/letters \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Letter",
    "content": [{"type": "paragraph", "content": "Hello, this is a test."}],
    "tagIds": ['$POSTBOX_TAG_ID']
  }' | jq .
```
Expected: `{ "id": <number>, "title": "Test Letter", ... }`
Save `id` as `$LETTER_ID`.

**GET /letters?tagId=X** — List letters
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_URL/letters?tagId=$POSTBOX_TAG_ID" | jq .
```
Expected: Array containing the letter just created.

**GET /letters/:letterId** — Read a letter (marks as read)
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  $API_URL/letters/$LETTER_ID | jq .
```
Expected: Full letter object with `content` array, `reactions`, `comments`, `isRead: true`.

**POST /letters/:letterId/react** — Add letter reaction
```bash
curl -s -X POST $API_URL/letters/$LETTER_ID/react \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"emoji": "🌸"}' | jq .
```
Expected: Updated reactions object.

**POST /letters/:letterId/comments** — Add a comment
```bash
curl -s -X POST $API_URL/letters/$LETTER_ID/comments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "This is a note on the letter."}' | jq .
```
Expected: `{ "id": <number>, "content": "This is a note...", "authorName": "...", ... }`

**GET /letters/:letterId/comments** — List comments
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  $API_URL/letters/$LETTER_ID/comments | jq .
```
Expected: Array with the comment just added.

**DELETE /letters/:letterId** — Delete a letter
```bash
curl -s -X DELETE $API_URL/letters/$LETTER_ID \
  -H "Authorization: Bearer $TOKEN" | jq .
```
Expected: `{ "success": true }` or 204.

---

#### Step 2.6 — Notifications

**GET /notifications** — Unread activity counts
```bash
curl -s -H "Authorization: Bearer $TOKEN" $API_URL/notifications | jq .
```
Expected:
```json
{
  "newMessageReactions": 0,
  "newLetterComments": 0,
  "totalLetterReactions": 0
}
```

**POST /notifications/seen** — Mark all seen
```bash
curl -s -X POST $API_URL/notifications/seen \
  -H "Authorization: Bearer $TOKEN" | jq .
```
Expected: `{ "success": true }` or 204.

---

#### Step 2.7 — Admin Endpoints

These require the caller's `userId` to equal `ADMIN_USER_ID` env var.

**DELETE /messages/clear?tagId=X** — Clear chat history (admin)
```bash
curl -s -X DELETE "$API_URL/messages/clear?tagId=$TAG_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```
Expected (admin): `{ "success": true }`
Expected (non-admin): `403 Forbidden`

**DELETE /spaces/:spaceId** — Delete space (admin)
```bash
curl -s -X DELETE $API_URL/spaces/$SPACE_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```

**DELETE /tags/:tagId** — Delete tag (admin)
```bash
curl -s -X DELETE $API_URL/tags/$TAG_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```

---

#### Step 2.8 — Auth Rejection Tests

**No token**
```bash
curl -s $API_URL/me
```
Expected: `401 Unauthorized`

**Invalid token**
```bash
curl -s -H "Authorization: Bearer invalid.token.here" $API_URL/me
```
Expected: `401 Unauthorized`

### Expected Outcomes for Layer 2
- All endpoints return correct HTTP status codes (200/201/204 for success, 401 for missing auth, 403 for non-admin on admin routes, 404 for missing resources, 422 for invalid input)
- Response shapes match the documented JSON structure
- Auth rejection tests return 401

### Troubleshooting

| Symptom | Check |
|---------|-------|
| `ECONNREFUSED` on API URL | API Server workflow is running in Replit |
| `401` on all requests | Token is expired — re-fetch from `window.Clerk.session.getToken()` |
| `500` on any endpoint | Check API server logs (`RefreshAllLogs` in Replit Agent); usually a DB error |
| `403` on admin endpoint | `ADMIN_USER_ID` env var is not set, or caller's userId doesn't match |
| CORS error in browser | `cors()` middleware is missing or not configured for the dev domain |
| Zod validation error (`422`) | Request body is missing required fields; check the schema in `lib/api-zod/` |

---

## 4. Layer 3 — Real-Time (SSE)

### Responsibilities
Push new events to connected clients without polling. The `messageBus.ts` module is an in-process event emitter. When a message is POSTed, the bus broadcasts to all active SSE connections for that `tagId`.

### Architecture
```
POST /messages
    └─→ insert into DB
    └─→ messageBus.emit('tagId', { type: 'new', message })
            └─→ GET /messages/stream (all active connections for tagId)
                    └─→ writes `data: {...}\n\n` to each response stream
```

### SSE Event Types

| Event `type` | Triggered by |
|-------------|-------------|
| `connected` | Client opens the stream |
| `new` | New message posted |
| `edit` | Message edited |
| `delete` | Message deleted |
| `reaction` | Reaction added/removed |
| `clear` | Admin cleared history |

### What to Test

1. SSE connection opens successfully
2. Heartbeat arrives every ~25 seconds
3. Sending a message triggers a `new` event on the stream
4. Editing a message triggers an `edit` event
5. Deleting a message triggers a `delete` event
6. Connection closes cleanly when client disconnects

### How to Test

**Step 3.1 — Open an SSE stream in the terminal**

```bash
# This keeps the connection open and prints events as they arrive
curl -N -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/event-stream" \
  "$API_URL/messages/stream?tagId=$TAG_ID"
```

Expected initial output:
```
data: {"type":"connected","tagId":"1"}

: heartbeat
```

**Step 3.2 — Send a message in a second terminal tab while stream is open**

```bash
curl -s -X POST $API_URL/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tagId": '$TAG_ID', "content": "SSE test message"}' | jq .
```

Expected: The first terminal (with the open stream) immediately prints:
```
data: {"type":"new","message":{"id":...,"content":"SSE test message",...}}
```

**Step 3.3 — Edit the message**

```bash
curl -s -X PATCH $API_URL/messages/$MSG_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Edited via SSE test"}' | jq .
```

Expected stream event: `data: {"type":"edit","message":{...,"content":"Edited via SSE test"}}`

**Step 3.4 — Delete the message**

```bash
curl -s -X DELETE $API_URL/messages/$MSG_ID \
  -H "Authorization: Bearer $TOKEN"
```

Expected stream event: `data: {"type":"delete","messageId":<id>}`

**Step 3.5 — Heartbeat check**

Leave the stream open for 30 seconds. Expected:
```
: heartbeat
```
appearing every ~25 seconds.

**Step 3.6 — Disconnect test**

Press `Ctrl+C` to close the curl connection. Check the API server logs — it should log a client disconnect without crashing.

### Expected Outcome
- Stream connects and returns `connected` event immediately
- Every write operation on messages produces a matching SSE event within ~100ms
- Heartbeat fires every 25 seconds
- Server handles disconnects without errors

### Troubleshooting

| Symptom | Check |
|---------|-------|
| Stream never opens (hangs) | `tagId` query param is present and valid |
| No events after sending a message | `messageBus` is in-process — make sure you're talking to the same server instance; in dev there's only one |
| `401` on stream | Token must be in the Authorization header, not a cookie |
| Stream drops after ~60s | Replit proxy may time out idle SSE connections; the heartbeat prevents this — check it's firing |
| `new` event arrives but UI doesn't update | See Layer 5 (React Query invalidation) |

---

## 5. Layer 4 — Third-Party Integrations (Clerk Auth)

### Responsibilities
Clerk handles all identity: user creation, login, session tokens, and JWT verification. The backend uses Clerk's Node SDK to verify tokens on every request. The frontend uses Clerk's React SDK for the sign-in UI and session management.

### What to Test

1. Sign-in overlay appears when unauthenticated user clicks "Enter"
2. Successful sign-in redirects to `/sanctuary`
3. Signed-in user on home page auto-redirects to workspace
4. Signing out returns user to landing page
5. Expired/invalid session is handled gracefully (no infinite spinner)
6. API rejects requests with invalid tokens (tested in Layer 2 Step 2.8)

### How to Test

**Step 4.1 — Sign-in overlay**

1. Open the app in an incognito/private window (ensures no active session)
2. Navigate to the root URL
3. Confirm you see the landing page with "Enter" button and "Sign In" top-right
4. Click "Enter" — the Clerk sign-in form should appear as a dark overlay
5. Click the ✕ button — overlay should close without navigating away

Expected: Sign-in overlay appears and closes cleanly.

**Step 4.2 — Successful sign-in**

1. From the overlay, enter valid credentials
2. Click "Continue" / "Sign In"

Expected:
- Overlay closes
- Page navigates to `/sanctuary` (the workspace)
- Your display name appears in the sidebar

**Step 4.3 — Already signed in**

1. With an active session, navigate to the root URL
2. Wait up to 400ms

Expected: Automatic redirect to `/sanctuary` without clicking Enter.

**Step 4.4 — Sign out**

1. In the workspace, find the sign-out action (sidebar/profile area)
2. Click "Sign Out"

Expected:
- Session is cleared
- Redirected to the landing page
- "Sign In" link reappears in the header

**Step 4.5 — Expired session handling**

1. Sign in normally
2. Manually clear the Clerk session cookies in DevTools (Application → Cookies → delete `__session`)
3. Navigate to the root URL or refresh

Expected: No infinite spinner. The `OnboardingGate` detects `isError` from `useGetMe` and redirects to `/` (landing page).

**Step 4.6 — Verify Clerk token in API**

```bash
# Get a fresh token
# In browser console: await window.Clerk.session.getToken()

# Test with valid token
curl -s -H "Authorization: Bearer $FRESH_TOKEN" $API_URL/me | jq .
# Expected: your profile

# Test with tampered token (change last character)
curl -s -H "Authorization: Bearer ${FRESH_TOKEN}X" $API_URL/me
# Expected: 401
```

### Expected Outcome
- Sign-in overlay opens and closes correctly
- Credentials result in a session that the API accepts
- Signed-out state is clean
- Expired sessions degrade gracefully to the landing page

### Troubleshooting

| Symptom | Check |
|---------|-------|
| Overlay doesn't appear on "Enter" click | Check browser console for JS errors; confirm `@clerk/react` is installed |
| Sign-in succeeds but redirects to wrong page | `afterSignInUrl` prop on `<SignIn>` should be `${basePath}/sanctuary` |
| Infinite spinner after bad session | Ensure `isError` branch in `OnboardingGate` exists and calls `<Redirect to="/" />` |
| `VITE_CLERK_PUBLISHABLE_KEY` missing | Set this secret in Replit; it must start with `pk_test_` or `pk_live_` |
| Clerk "development keys" warning | Normal in dev; does NOT affect functionality |
| API returns 401 even with fresh token | `CLERK_SECRET_KEY` env var not set on the API server |

---

## 6. Layer 5 — State Management & API Client

### Responsibilities
`@workspace/api-client-react` provides Orval-generated TanStack Query hooks. Every API call in the frontend goes through these hooks. TanStack Query handles caching, background refetch, and cache invalidation. There is no Redux or Zustand — server state is the source of truth.

### Key Hooks

| Hook | Endpoint | Used in |
|------|----------|---------|
| `useGetMe` | `GET /me` | `OnboardingGate`, `App.tsx` |
| `useGetSpaces` | `GET /spaces` | `Sidebar.tsx` |
| `useGetMessages` | `GET /messages` | `ChatView.tsx` |
| `usePostMessages` | `POST /messages` | `ChatView.tsx` |
| `useGetLetters` | `GET /letters` | `PostboxView.tsx` |
| `usePostLetters` | `POST /letters` | `LetterComposer.tsx` |
| `useGetLetter` | `GET /letters/:id` | `LetterReader.tsx` |
| `useGetNotifications` | `GET /notifications` | `Home.tsx` |
| `useMarkNotificationsSeen` | `POST /notifications/seen` | `Home.tsx` |
| `useGetLetterComments` | `GET /letters/:id/comments` | `LetterReader.tsx` |
| `useAddLetterComment` | `POST /letters/:id/comments` | `LetterReader.tsx` |
| `useReactToMessage` | `POST /messages/:id/react` | `ChatView.tsx` |

### What to Test

1. Hooks return data matching the API response shapes
2. Loading states render a spinner (not a crash)
3. Error states render gracefully (not a white screen)
4. Mutations invalidate the correct query keys, causing a refetch
5. SSE events update the message list without a full refetch

### How to Test

**Step 5.1 — Inspect React Query state in DevTools**

1. Install the React Query DevTools browser extension, or check if the app mounts `ReactQueryDevtools`
2. Open the workspace and select a chat channel
3. In the DevTools panel, find `["messages", { tagId: X }]`

Expected: Status is `success`, data is an array of message objects.

**Step 5.2 — Verify cache invalidation on mutation**

1. Open a chat channel in the app
2. Send a message via the input box
3. Observe the message list

Expected: The new message appears immediately (optimistic update) or within 1–2 seconds (after refetch triggered by the POST mutation's `onSuccess` handler).

**Step 5.3 — Verify SSE updates the cache**

1. Open the same chat channel in two separate browser tabs (both signed in as User A)
2. In Tab 2, send a message
3. Observe Tab 1

Expected: Tab 1's message list updates in real time without a page refresh.

**Step 5.4 — Loading state**

1. Throttle the network to "Slow 3G" in Chrome DevTools (Network tab → throttle dropdown)
2. Navigate to a postbox channel

Expected: A loading spinner or skeleton appears while `useGetLetters` is in `isLoading` state.

**Step 5.5 — Error state**

1. Stop the API server workflow in Replit
2. Navigate to the workspace (or refresh)

Expected: An error message is shown in the UI. The app does not crash with a white screen.

**Step 5.6 — Clerk session cache invalidation**

1. Sign out
2. Sign back in as a different user (if testing two accounts)

Expected: All React Query caches are cleared (the `ClerkQueryClientCacheInvalidator` component calls `queryClient.clear()` on auth state change).

### Expected Outcome
- Every hook returns `{ data, isLoading, isError }` as expected
- Mutations trigger correct refetches
- SSE events update the React Query cache in real time
- Auth changes clear all cached data

### Troubleshooting

| Symptom | Check |
|---------|-------|
| Hook returns `isLoading: true` forever | API server is not running; check workflow status |
| Data appears stale after mutation | Mutation's `onSuccess` may not be calling `queryClient.invalidateQueries` with the right key |
| SSE events arrive but UI doesn't update | The SSE event handler in `ChatView.tsx` must call `queryClient.setQueryData` or `invalidateQueries` |
| TypeScript errors on hook imports | Run `pnpm --filter @workspace/api-client-react build` to regenerate Orval output |
| Stale data after sign-out | `ClerkQueryClientCacheInvalidator` must be mounted inside `ClerkProvider`; check `App.tsx` |

---

## 7. Layer 6 — UI Components

### Responsibilities
Each component has a single visual/interaction responsibility. Components call hooks from Layer 5; they do not fetch data directly.

### Component Inventory & Test Steps

---

#### 7.1 OnboardingModal

**Responsibility:** Collect `displayName` on first login. Blocks all workspace access until complete.

**What to test:**
- Modal appears for users where `isProfileComplete = false`
- Submitting an empty name shows a validation error
- Submitting a valid name calls `PATCH /profile` and dismisses the modal

**How to test:**
1. Create a fresh Clerk account or temporarily set `isProfileComplete = false` in the DB:
   ```sql
   UPDATE user_profiles SET is_profile_complete = false WHERE user_id = 'user_xxx';
   ```
2. Navigate to the workspace
3. Expected: OnboardingModal blocks the view
4. Submit empty name → Expected: validation error shown
5. Enter "TestUser" and submit → Expected: modal closes, workspace is accessible, display name "TestUser" appears in sidebar

---

#### 7.2 Sidebar

**Responsibility:** Navigation, space/tag management, unread badges.

**What to test:**
- Spaces and channels render correctly
- Unread count badges appear on channels with new content
- Clicking a channel switches the main view
- Inline rename works for spaces and channels
- Drag-and-drop reordering persists after refresh
- Creating a new channel appears in the sidebar

**How to test:**
1. **Render check:** Open the workspace. Confirm all existing spaces and channels appear.
2. **Unread badge:** Send a message as User A in a chat channel. Log in as User B — the channel should show an unread badge.
3. **Channel switch:** Click a postbox channel → PostboxView renders. Click a chat channel → ChatView renders.
4. **Rename:** Double-click (or click rename icon) on a channel → type a new name → press Enter. Refresh the page → name should persist.
5. **Reorder:** Drag a channel above/below another → release. Refresh → order should persist.
6. **Create:** Click "New channel" → fill in name and type → submit. New channel appears in the sidebar.

---

#### 7.3 ChatView

**Responsibility:** Real-time message display, send, edit, delete, react.

**What to test:**
- Messages render with sender name and timestamp
- Message input sends on Enter key press
- Message input sends on button click
- Input is cleared after send
- Edit: pencil icon appears on hover on own messages; edited message updates inline
- Delete: trash icon on own messages; unseen messages can be deleted; seen messages cannot
- Reactions: clicking emoji picker opens the full emoji panel; selecting an emoji adds it; clicking same emoji removes it
- Read receipts: `seenByPartner` indicator updates when partner reads

**How to test:**
1. Open a chat channel. Confirm existing messages render with name + timestamp.
2. Type "Test message" in the input and press Enter. Confirm the message appears and input is cleared.
3. Hover over your own message. Click the pencil icon. Edit the text and save. Confirm the edited text replaces the original.
4. Hover and click the delete icon. Confirm the message is removed from the list.
5. Click the emoji button on any message. Confirm the emoji-mart picker opens. Select 🔥. Confirm the reaction appears below the message.
6. Click 🔥 again. Confirm the reaction is removed (toggle).

---

#### 7.4 PostboxView

**Responsibility:** Letter archive grid, unread indicators.

**What to test:**
- Letters render as cards with title, excerpt, author, and timestamp
- Unread letters show a glow/dot indicator
- Clicking a letter opens LetterReader
- Delete button (own letters only) removes the card

**How to test:**
1. Navigate to a postbox channel. Confirm letter cards render.
2. As User B, open a letter authored by User A that has not been read → glow indicator should be visible.
3. Click the letter → LetterReader opens. Navigate back → glow indicator is gone.
4. On own letter, click the delete button → confirm prompt → letter is removed.
5. On partner's letter, confirm no delete button is visible.

---

#### 7.5 LetterComposer

**Responsibility:** Compose and send a letter.

**What to test:**
- Content editor accepts text input
- Channel selector shows available postbox channels
- "Seal & Send" creates the letter and navigates back to PostboxView
- Submitting with no content shows a validation error

**How to test:**
1. Click the compose button. LetterComposer opens.
2. Select a channel from the tag selector.
3. Type content in the editor.
4. Click "Seal & Send".
5. Expected: navigated back to PostboxView; new letter card appears.
6. Open composer again. Leave content empty. Click "Seal & Send".
7. Expected: validation error, no API call made.

---

#### 7.6 LetterReader

**Responsibility:** Immersive letter reading, reactions, and notes.

**What to test:**
- Full letter content renders correctly
- Emoji reaction picker opens and toggles reactions
- Notes (comments) are displayed chronologically
- Adding a note appears inline without page refresh
- Marks the letter as read on open

**How to test:**
1. Open any letter. Confirm full content is visible.
2. Click the reaction button. Select 💌. Confirm the reaction appears.
3. Click 💌 again. Confirm it is removed.
4. In the notes section, type "This is a note" and submit. Confirm the note appears below.
5. Refresh the page and reopen the letter. Confirm the note persists.
6. Log in as User B and check whether the letter's `isRead` status changed.

---

#### 7.7 IdleOverlay

**Responsibility:** Show a clock screen after 2 minutes of inactivity.

**What to test:**
- Overlay appears after 2 minutes of no mouse/keyboard activity
- Any interaction dismisses the overlay

**How to test:**
1. Log in and sit idle in the workspace for 2 minutes (or temporarily change the idle threshold in code to 10 seconds for testing).
2. Expected: Full-screen overlay appears showing the current time/date.
3. Move the mouse or press any key.
4. Expected: Overlay dismisses and the workspace reappears.

---

### Expected Outcome for Layer 6
- Every component renders without console errors
- Interactive elements (buttons, inputs, drag handles) respond correctly
- All mutations reflect in the UI within 1–2 seconds
- No white-screen crashes on any component

### Troubleshooting

| Symptom | Check |
|---------|-------|
| Component renders blank | Check browser console for JS errors; usually a failed hook or missing prop |
| Emoji picker doesn't open | `EmojiPickerPopup` is `React.lazy` — check if the Suspense boundary is wrapping it |
| Drag-and-drop reorder doesn't persist | The `PATCH /spaces/:id` or `PATCH /tags/:id` call may be failing; check Network tab |
| Message doesn't appear after send | SSE event handler or query invalidation broken; see Layer 5 troubleshooting |
| Letter shows as unread after being opened | `GET /letters/:id` must create a `letter_reads` row; check the API route logic |

---

## 8. Layer 7 — Pages & End-to-End Flows

### What to Test (Full User Journeys)

#### Flow A — New User First Time

1. Open app (incognito) → Landing page with "Enter" button
2. Click "Enter" → Sign-in overlay
3. Create a new account (or sign in for the first time)
4. Redirected to workspace → OnboardingModal appears
5. Enter display name → Modal closes → Workspace is accessible
6. Sidebar shows existing spaces/channels

**Expected:** All 6 steps succeed without any redirect loops, white screens, or console errors.

---

#### Flow B — Returning User with Notifications

1. As User A: send 2 chat messages, add a reaction to a letter
2. Log out of User A
3. Log in as User B → Home page with notification banner: *"2 new reactions on your messages"*
4. Click "Enter" → Workspace loads → Badge on chat channel

**Expected:** Notification count is accurate and disappears after clicking Enter.

---

#### Flow C — Real-Time Chat Between Two Users

1. Open the app in two browser tabs (Tab A = User A, Tab B = User B)
2. Both navigate to the same chat channel
3. User A types "Hello" and sends
4. Observe Tab B

**Expected:** "Hello" appears in Tab B within ~1 second without any refresh.

5. User B types "Hi back" and sends
6. Observe Tab A

**Expected:** "Hi back" appears in Tab A within ~1 second.

---

#### Flow D — Letter Lifecycle

1. User A composes and sends a letter in a postbox channel
2. User A sees the letter in PostboxView with a glow on User B's side
3. User B opens PostboxView → sees the unread glow on the new letter
4. User B opens the letter (glow disappears)
5. User B adds a reaction 💌 and a note "Beautiful."
6. User A opens the landing page → notification banner shows "1 new note on your letters"
7. User A reads the note in LetterReader

**Expected:** All 7 steps succeed; notifications are accurate.

---

#### Flow E — Auth Edge Cases

| Scenario | Action | Expected |
|----------|--------|----------|
| Session expired | Delete `__session` cookie; navigate to `/sanctuary` | Redirect to landing page (no infinite spinner) |
| Direct URL to workspace (signed out) | Navigate to `/sanctuary` directly | Redirect to landing page |
| Direct URL to root (signed in) | Navigate to `/` | Auto-redirect to workspace after 400ms |

---

### Expected Outcome for Layer 7
- All end-to-end flows complete without errors
- State is consistent across both user accounts
- No data leaks between users (User A cannot see User B's profile, only shared workspace content)

---

## 9. Environment & Pre-flight Checks

Before running any tests, verify the following:

### Required Secrets / Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | API Server | PostgreSQL connection string |
| `CLERK_PUBLISHABLE_KEY` | API Server | Clerk backend verification |
| `CLERK_SECRET_KEY` | API Server | Clerk backend SDK |
| `VITE_CLERK_PUBLISHABLE_KEY` | Sanctuary (frontend) | Clerk React SDK |
| `SESSION_SECRET` | API Server | Cookie signing |
| `ADMIN_USER_ID` | API Server | Clerk user ID of the admin user |
| `PORT` | Both (auto-set by Replit) | Server port binding |

### Pre-flight Checklist

```bash
# 1. All workflows running
# Check in Replit: artifacts/sanctuary: web, artifacts/api-server: API Server

# 2. Database reachable
psql $DATABASE_URL -c "SELECT count(*) FROM user_profiles;"

# 3. API server responding
curl -s $API_URL/me
# Expected: 401 (good — auth is working)

# 4. Frontend serving
curl -s https://$REPLIT_DEV_DOMAIN/sanctuary/ | grep -c "Kothadi"
# Expected: 1

# 5. Clerk keys present
curl -s -H "Authorization: Bearer $TOKEN" $API_URL/me | jq .userId
# Expected: your Clerk user ID string
```

---

## 10. Troubleshooting Quick Reference

### By Symptom

| Symptom | Most Likely Layer | First Check |
|---------|------------------|-------------|
| Blank white screen on any page | Layer 6 / Layer 5 | Browser console for JS error |
| Infinite spinner on load | Layer 4 / Layer 5 | `useGetMe` returning error; check API server is running |
| "401 Unauthorized" from API | Layer 4 | Token expired; re-fetch with `window.Clerk.session.getToken()` |
| Messages not appearing in real time | Layer 3 | SSE stream open? Check Network tab for `messages/stream` request |
| Reactions not persisting | Layer 2 | Check `/messages/:id/react` in Network tab; look for 4xx/5xx |
| Letter not marked as read | Layer 2 | `GET /letters/:id` must insert a `letter_reads` row |
| Sidebar missing channels | Layer 2 / Layer 1 | `GET /spaces` returning empty or erroring; check DB has data |
| Onboarding modal won't dismiss | Layer 2 | `PATCH /profile` may be failing; check Network tab |
| Notifications show wrong count | Layer 2 / Layer 1 | `lastActivitySeenAt` not being updated; check `POST /notifications/seen` |
| Drag-and-drop reorder doesn't save | Layer 2 | `PATCH /spaces/:id` or `PATCH /tags/:id` 4xx/5xx |
| Deploy works but dev is broken | Layer 4 | Check `VITE_CLERK_PUBLISHABLE_KEY` is set for dev environment |

### Debug Command Cheatsheet

```bash
# Get fresh Clerk token (run in browser console)
window.Clerk.session.getToken().then(t => console.log(t))

# Watch API server logs live
# → Use Replit's workflow log panel

# Check all tables have data
psql $DATABASE_URL -c "
  SELECT 'spaces' as t, count(*) FROM spaces UNION ALL
  SELECT 'tags', count(*) FROM tags UNION ALL
  SELECT 'messages', count(*) FROM messages UNION ALL
  SELECT 'letters', count(*) FROM letters UNION ALL
  SELECT 'user_profiles', count(*) FROM user_profiles;
"

# Test SSE stream (stays open)
curl -N -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/event-stream" \
  "$API_URL/messages/stream?tagId=1"

# Verify CORS headers
curl -I -H "Origin: https://$REPLIT_DEV_DOMAIN" \
  -H "Authorization: Bearer $TOKEN" \
  $API_URL/me | grep -i "access-control"
```

---

*Document generated: July 2026 | App version: Kothadi 1.0*
