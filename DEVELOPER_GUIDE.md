# Developer Guide — Kothadi (The Social Media Room)

> A comprehensive reference for understanding, running, and taking full ownership of this codebase.

---

## Table of Contents

1. [Project Overview & Tech Stack](#1-project-overview--tech-stack)
2. [Complete File Structure](#2-complete-file-structure)
3. [Workflow & Data Flow](#3-workflow--data-flow)
4. [Code Walkthrough](#4-code-walkthrough)
5. [Local Development Setup](#5-local-development-setup)
6. [How to Export & Take Control](#6-how-to-export--take-control)

---

## 1. Project Overview & Tech Stack

### What Is This App?

**Kothadi** is a private, dark-mode web application built exclusively for two people. It combines:

- **Real-time chat** — instant messaging inside named channels, with emoji reactions, quote-replies, and view-once photo messages.
- **Postbox (Letters)** — a long-form letter writing system where users compose rich notes delivered to named postboxes. Letters support emoji reactions, comment threads ("leave a note"), and file attachments.
- **Spaces & Channels** — a sidebar-driven workspace with drag-and-drop reorderable sections and channels.
- **Notification system** — a landing page that counts unread messages, unread letters, new reactions, and new comments since the user last visited, and blocks auto-redirect if anything is waiting.
- **Admin controls** — a single designated admin (by email) can manage users and delete their own letters.
- **Change channels** — any user can reassign a sent letter to different postbox channels, individually or in bulk via multi-select.

### Architecture

```
Browser (React SPA)
       │
       │  HTTPS / SSE
       ▼
Express API Server  ──►  PostgreSQL (via Drizzle ORM)
       │
       ▼
  Clerk (Auth)       ──►  Validates every request
```

The frontend is a Vite-bundled React SPA. The backend is an Express server. They share a type-safe API contract defined in a single OpenAPI YAML file, from which React Query hooks and Zod schemas are auto-generated.

### Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend framework** | React 19 + TypeScript | UI |
| **Build tool** | Vite | Dev server + production bundler |
| **Routing** | Wouter | Lightweight client-side routing |
| **Server state** | TanStack React Query v5 | Data fetching, caching, mutations |
| **Styling** | Tailwind CSS v4 | Utility-first dark-mode design system |
| **Authentication** | Clerk (`@clerk/react` + `@clerk/express`) | User identity — frontend + backend |
| **Backend framework** | Express.js + TypeScript | REST API + SSE streaming |
| **Database** | PostgreSQL | Primary data store |
| **ORM** | Drizzle ORM | Type-safe schema + queries |
| **Migrations** | Drizzle Kit (`drizzle-kit push`) | Schema sync |
| **API contract** | OpenAPI 3.0 YAML | Single source of truth for all endpoints |
| **Code generation** | Orval | Generates React Query hooks + Zod schemas from OpenAPI |
| **Real-time** | Server-Sent Events (SSE) | Live chat message delivery |
| **File uploads** | Multer | Multipart form handling for letter attachments |
| **Logging** | Pino | Structured JSON logging on the server |
| **Emoji picker** | `@emoji-mart/react` | In-chat and in-letter emoji insertion |
| **Package manager** | pnpm (workspaces) | Monorepo management |

---

## 2. Complete File Structure

```
workspace/
│
├── artifacts/                        # Deployable apps ("artifacts")
│   │
│   ├── api-server/                   # Express REST + SSE backend
│   │   ├── src/
│   │   │   ├── index.ts              # Entry point — binds to PORT
│   │   │   ├── app.ts                # Express app setup (CORS, body parsing, routes)
│   │   │   ├── lib/
│   │   │   │   ├── messageBus.ts     # In-process pub/sub for SSE broadcasting
│   │   │   │   └── logger.ts         # Pino logger instance
│   │   │   ├── middlewares/
│   │   │   │   ├── requireAuth.ts    # Clerk token validation → attaches userId to req
│   │   │   │   ├── requireAdmin.ts   # Admin gate — checks ADMIN_EMAIL env var
│   │   │   │   └── clerkProxyMiddleware.ts  # Proxies Clerk JS for custom domain
│   │   │   └── routes/
│   │   │       ├── index.ts          # Registers all routers under /api
│   │   │       ├── health.ts         # GET /healthz
│   │   │       ├── me.ts             # GET /me — current user profile + isAdmin flag
│   │   │       ├── profile.ts        # POST /profile — onboarding, display name
│   │   │       ├── spaces.ts         # CRUD for workspace spaces
│   │   │       ├── tags.ts           # CRUD for channels (chat/postbox)
│   │   │       ├── messages.ts       # Chat: GET/POST/PATCH/DELETE + SSE stream
│   │   │       ├── letters.ts        # Postbox: CRUD, reactions, comments, attachments
│   │   │       ├── notifications.ts  # GET /notifications + POST /notifications/seen
│   │   │       ├── upload.ts         # POST /upload — file upload via Multer
│   │   │       └── admin.ts          # GET/DELETE /admin/users (admin only)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── sanctuary/                    # React frontend — the main app
│   │   ├── index.html                # HTML shell
│   │   ├── vite.config.ts            # Vite config (proxy, base path, HMR)
│   │   ├── tailwind.config.ts        # Tailwind + custom CSS variables
│   │   └── src/
│   │       ├── main.tsx              # React DOM root mount
│   │       ├── App.tsx               # ClerkProvider + QueryClientProvider + routing
│   │       ├── index.css             # Global CSS, custom scrollbar, animations
│   │       ├── pages/
│   │       │   └── Home.tsx          # Landing page: notifications, auth entry
│   │       └── components/
│   │           ├── OnboardingGate.tsx       # Blocks app until profile is complete
│   │           ├── Workspace.tsx            # Main layout shell after login
│   │           ├── Sidebar.tsx              # Navigation: spaces, channels, admin panel
│   │           ├── ChatView.tsx             # Real-time chat + SSE client + quote-reply
│   │           ├── PostboxView.tsx          # Letter grid — multi-select, ⋮ menu, Change channels
│   │           ├── LetterReader.tsx         # Full-screen letter reader + reactions + notes
│   │           ├── LetterComposer.tsx       # Full-screen letter editor
│   │           ├── EmojiPickerPopup.tsx     # Shared lazy-loaded emoji picker portal
│           └── ChannelPickerPopup.tsx   # Fixed-position popup: reassign letter channels
│   │
│   └── mockup-sandbox/              # Dev-only: isolated component preview server
│
├── lib/                              # Shared libraries (workspace packages)
│   │
│   ├── api-spec/                     # The API contract — edit this first
│   │   ├── openapi.yaml              # Full OpenAPI 3.0 spec (all endpoints + schemas)
│   │   └── orval.config.ts           # Code generation config (input → output paths)
│   │
│   ├── api-client-react/             # Auto-generated (DO NOT hand-edit)
│   │   └── src/generated/
│   │       ├── api.ts                # React Query hooks (useGetMessages, useCreateLetter, …)
│   │       └── api.schemas.ts        # TypeScript types matching the OpenAPI schemas
│   │
│   ├── api-zod/                      # Auto-generated (DO NOT hand-edit)
│   │   └── src/generated/
│   │       └── *.ts                  # Zod validation schemas for backend request parsing
│   │
│   └── db/                           # Database layer — shared by api-server
│       ├── drizzle.config.ts         # Drizzle Kit config (points to DATABASE_URL)
│       └── src/
│           ├── index.ts              # Re-exports db client + all schema tables
│           ├── client.ts             # Creates and exports the drizzle(pool) instance
│           └── schema/
│               ├── spaces.ts         # spaces table
│               ├── tags.ts           # tags table (channels)
│               ├── messages.ts       # messages + message_reads tables
│               ├── messageReactions.ts  # message_reactions join table
│               ├── letters.ts        # letters + letter_tags + letter_reads + letter_attachments
│               ├── letterComments.ts # letter_comments table
│               └── userProfiles.ts   # user_profiles table (display name, cursor, etc.)
│
├── pnpm-workspace.yaml               # Declares all workspace packages
├── package.json                      # Root devDependencies (TypeScript, etc.)
├── DEVELOPER_GUIDE.md                # This file
└── replit.md                         # Replit-specific project notes
```

---

## 3. Workflow & Data Flow

### 3.1 Authentication Flow

```
User visits app
       │
       ▼
ClerkProvider (App.tsx)
       │
       ├─ Not signed in ──► Home.tsx renders Sign In / Sign Up buttons (Clerk modal)
       │
       └─ Signed in
              │
              ▼
       OnboardingGate
              │
              ├─ No display name set ──► Shows onboarding form → POST /api/profile
              │
              └─ Profile complete ──► Renders Workspace.tsx
```

Every API request from the frontend is sent with Clerk's session token in the `Authorization: Bearer <token>` header (handled automatically by Clerk's React SDK).

On the backend, `requireAuth` middleware calls Clerk's `getAuth(req)` to extract and verify the token. If invalid, it returns `401`. If valid, it attaches `userId` (Clerk's user ID string) to `req` for all downstream handlers.

---

### 3.2 Real-Time Chat Flow (SSE)

This is the most complex data flow in the app. Here's exactly how a message travels:

```
User types + hits Enter
         │
         ▼
handleSend() in ChatView.tsx
         │
         ├─ 1. Optimistic update: inserts message into React Query cache immediately
         │      (the UI shows the message before the server confirms)
         │
         ▼
POST /api/messages  { tagId, content, replyToId? }
         │
         ▼
api-server/routes/messages.ts
         │
         ├─ 2. Inserts row into `messages` table
         │
         └─ 3. Calls broadcast(tagId, { type: "new", payload: serializedMessage })
                        │
                        ▼
                 messageBus.ts
                        │
                 ┌──────┴────────────────────────────┐
                 │  All SSE clients subscribed to     │
                 │  this tagId receive the event      │
                 └──────┬────────────────────────────┘
                        │
                        ▼
         Partner's browser — EventSource in ChatView.tsx
                        │
                        ├─ Receives: event: new\ndata: {...}
                        │
                        └─ 4. useChatStream hook appends the new message
                               to the React Query cache without a network refetch
```

The SSE connection is opened at `GET /api/messages/stream?tagId=X`. The server keeps this HTTP connection alive and writes events as they arrive from the message bus. When the component unmounts (user switches channels), the `EventSource` is closed and the server-side listener is cleaned up.

**SSE event types:**

| Event | Trigger | Payload |
|---|---|---|
| `new` | Message sent | Full message object |
| `edit` | Message edited | `{ id, content }` |
| `delete` | Message deleted | `{ id }` |
| `clear` | Admin clears chat | `{}` |
| `reaction` | Emoji reaction toggled | `{ messageId, reactions }` |
| `read` | Partner read up to a message | `{ upToId }` |
| `view-once-viewed` | Partner opened a view-once photo | `{ messageId }` |

---

### 3.3 Letter (Postbox) Flow

Letters are not real-time — they use standard REST polling via React Query.

```
User opens LetterComposer → writes title + content → picks a postbox tag → "Seal & Send"
         │
         ▼
POST /api/letters  { title, content: EditorJS JSON, tagIds: [id] }
         │
         ▼
api-server/routes/letters.ts
         │
         ├─ Inserts into `letters` table
         └─ Inserts into `letter_tags` join table (one row per selected tag)
                        │
                        ▼
PostboxView.tsx  useGetLetters({ tagId })
         │
         └─ React Query refetches on mutation success → letter appears in grid
```

When the letter is opened (`LetterReader`), a `POST /api/letters/:id/read` call marks it as read. Reactions are stored as a JSON column `{ "❤️": ["userId1", "userId2"] }` directly on the `letters` row — toggling your own reaction adds/removes your user ID from the array.

**Channel reassignment** — after a letter is sent, either user can reassign it to different postbox channels:

```
User opens PostboxView → hovers a card → clicks ⋮ → "Change channels"
  (or selects multiple cards → floating bulk bar → "Change channels")
         │
         ▼
ChannelPickerPopup.tsx  (fixed-position portal)
         │
         ├─ Renders all postbox tags as checkboxes
         │   checked      = ALL selected letters have this tag
         │   indeterminate = SOME selected letters have this tag
         │   unchecked    = NO  selected letters have this tag
         │
         ▼
PATCH /api/letters/:id/tags  { tagIds: [id, id, …] }   (one call per letter)
         │
         ▼
letters.ts route
         │
         ├─ Deletes existing letter_tags rows for this letter
         └─ Inserts new letter_tags rows (at least 1 tag always enforced client-side)
                        │
                        ▼
React Query invalidates getGetLettersQueryKey for every postbox tag
```

---

### 3.4 Notification Flow

The landing page (`Home.tsx`) calls `GET /api/notifications` on mount. The server calculates four signals:

```
GET /api/notifications
         │
         ▼
notifications.ts route
         │
         ├─ newMessages:        partner's messages in any channel since lastActivitySeenAt
         ├─ newLetters:         partner's letters in any postbox since lastActivitySeenAt
         ├─ newMessageReactions: reactions on your messages since lastActivitySeenAt
         └─ newLetterComments:  comments on your letters since lastActivitySeenAt
         │
         ▼
Home.tsx
         │
         ├─ totalNew === 0  ──► Auto-redirects to workspace after 1.5 s
         └─ totalNew  > 0  ──► Shows notification banner, stays on landing page

When user enters workspace:
POST /api/notifications/seen  →  updates user_profiles.lastActivitySeenAt = NOW()
```

---

### 3.5 API Code Generation Pipeline

This is how you add a new API endpoint end-to-end:

```
1. Edit lib/api-spec/openapi.yaml
        │  Add your path, method, request/response schemas
        ▼
2. Run:  pnpm --filter @workspace/api-spec run codegen
        │  Orval reads openapi.yaml
        ├─ Writes React Query hooks → lib/api-client-react/src/generated/api.ts
        └─ Writes Zod schemas      → lib/api-zod/src/generated/*.ts
        ▼
3. Implement the route in artifacts/api-server/src/routes/
4. Register it in artifacts/api-server/src/routes/index.ts
5. Import and use the generated hook in the frontend component
```

**Never hand-edit** `lib/api-client-react/src/generated/` or `lib/api-zod/src/generated/`. They are overwritten on every codegen run.

---

## 4. Code Walkthrough

### 4.1 `messageBus.ts` — The SSE Engine

```typescript
// A Map from tagId → Set of listener functions
const subscribers = new Map<number, Set<Listener>>();

// Called by the SSE route handler when a client connects
export function subscribe(tagId: number, listener: Listener): () => void {
  // Adds this client's callback to the Set for this channel
  // Returns an unsubscribe function (called when the client disconnects)
}

// Called after every message write/edit/delete/react
export function broadcast(tagId: number, event: BusEvent): void {
  // Calls every listener registered for this tagId
  // Each listener writes the event to its HTTP response stream
}
```

This is **in-process only** — it only works because the API server is a single Node.js process. If you ever scale to multiple server instances, you would need to replace this with Redis Pub/Sub.

---

### 4.2 `requireAuth.ts` — Authentication Middleware

```typescript
export async function requireAuth(req, res, next) {
  const { userId } = getAuth(req);   // Clerk extracts + verifies the JWT
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  (req as AuthedRequest).userId = userId;  // Attach to request
  next();
}
```

Every protected route starts with `router.get("/path", requireAuth, async (req, res) => { ... })`. Inside the handler, you access the authenticated user via `const { userId } = req as AuthedRequest`.

---

### 4.3 `requireAdmin.ts` — Admin Gate

```typescript
// Async version — used in route handlers (fetches email from Clerk API)
export async function isAdmin(userId: string): Promise<boolean> {
  const user = await clerkClient.users.getUser(userId);
  const email = user.emailAddresses[0]?.emailAddress ?? "";
  return email === process.env.ADMIN_EMAIL;
}

// Sync version — used when email is already known (e.g. in /me route)
export function isAdminByEmail(email: string): boolean {
  return email === process.env.ADMIN_EMAIL;
}
```

To change who the admin is, update the `ADMIN_EMAIL` environment variable. No code changes needed.

---

### 4.4 `App.tsx` — The Root Component

```typescript
<ClerkProvider publishableKey={...} routerPush={...} routerReplace={...}>
  <QueryClientProvider client={queryClient}>
    <Switch>
      <Route path="/sanctuary">
        <SignedIn>
          <OnboardingGate>  {/* Blocks until display name is set */}
            <Workspace />   {/* The full app */}
          </OnboardingGate>
        </SignedIn>
        <SignedOut>
          <Home />          {/* Landing page */}
        </SignedOut>
      </Route>
    </Switch>
  </QueryClientProvider>
</ClerkProvider>
```

`ClerkProvider` wraps everything so Clerk hooks (`useUser`, `useAuth`, etc.) work anywhere in the tree. `QueryClientProvider` wraps everything so React Query hooks work anywhere in the tree.

---

### 4.5 `ChatView.tsx` — The Real-Time Chat

This is the most feature-rich component. Key internal pieces:

```
State:
  input           → current text in the compose bar
  replyingTo      → { id, authorName, content } if a quote-reply is pending
  inputPickerAnchor → DOMRect of emoji button (null = picker closed)
  pickerAnchor    → { msgId, rect } for the reaction picker

Refs:
  textareaRef     → auto-resizes and is targeted by emoji insertion
  messageRefs     → Map<messageId, HTMLElement> — used for scroll-to-message

Key functions:
  handleSend()          → optimistic update + POST /api/messages
  insertEmojiAtCursor() → splices emoji at textarea selection position
  scrollToMessage()     → scrolls + flashes a highlighted message (for quote-reply jump)
  handleReact()         → POST /api/messages/:id/react

SSE subscription (useChatStream hook):
  Opens EventSource to /api/messages/stream?tagId=X
  On "new"      → appends to React Query cache
  On "edit"     → updates content in cache
  On "delete"   → removes from cache
  On "reaction" → updates reactions object in cache
  On "clear"    → empties the entire message list in cache
```

---

---

### 4.6 `PostboxView.tsx` + `ChannelPickerPopup.tsx` — Letter Grid & Channel Reassignment

`PostboxView` renders the letter grid for one postbox channel and owns the selection and channel-picker state:

```
State:
  selectedIds        → Set<number> — which letter cards are selected
  menuOpenId         → number | null — which card's ⋮ dropdown is open
  menuAnchor         → DOMRect of the ⋮ button (positions the dropdown via fixed CSS)
  confirmDeleteId    → number | null — two-step delete confirmation
  pickerAnchor       → DOMRect | null — positions ChannelPickerPopup
  pickerLetterIds    → number[] — which letters the picker will act on (1 or many)

UX modes:
  Normal             → hover reveals ⋮ button (top-right) and checkmark (top-left)
  Selection          → selectedIds.size > 0; checkmarks always visible;
                       floating bulk-action bar slides in from bottom
  Menu open          → fixed-position dropdown with "Change channels" + optional "Delete"

Three-dot menu opens at the button's DOMRect so it doesn't clip inside the card.
```

`ChannelPickerPopup` is a self-contained fixed-position portal:

```
Props:
  anchor          → DOMRect — positions the popup near the trigger button
  selectedLetters → { id, tagIds }[] — 1 or more letters to act on
  onClose         → () => void

Checkbox logic (per tag):
  allHave         → every selected letter has this tagId  → checked   ✓
  someHave (not all) → at least one does                   → indeterminate –
  noneHave        → no selected letter has this tagId     → unchecked  □

On toggle:
  "add"   (indeterminate or unchecked) → union of existing tagIds + this tagId
  "remove" (checked)                   → filter this tagId out (guarded: never empties)
  Fires PATCH /api/letters/:id/tags for each selected letter, then invalidates
  getGetLettersQueryKey for all postbox tags so every view refreshes.
```

### 4.7 Database Schema Summary

| Table | Key Columns | Notes |
|---|---|---|
| `spaces` | `id`, `name`, `sortOrder` | Top-level workspace sections |
| `tags` | `id`, `spaceId`, `name`, `slug`, `type`, `isAdminOnly`, `icon`, `sortOrder` | Channels — type is `"chat"` or `"postbox"` |
| `messages` | `id`, `tagId`, `authorId`, `authorName`, `content`, `replyToId`, `viewOnceUrl` | Chat messages; `replyToId` is nullable |
| `message_reads` | `tagId`, `userId`, `lastReadMessageId` | Tracks read position per user per channel |
| `message_reactions` | `messageId`, `userId`, `emoji` | Join table for per-user emoji reactions on messages |
| `letters` | `id`, `title`, `content (JSONB)`, `authorId`, `reactions (JSONB)` | Long-form letters; reactions stored as `{ emoji: userId[] }` |
| `letter_tags` | `letterId`, `tagId` | Many-to-many: a letter can appear in multiple postboxes |
| `letter_reads` | `letterId`, `userId`, `readAt` | Tracks who has opened each letter |
| `letter_attachments` | `id`, `letterId`, `url`, `filename`, `mimeType`, `size` | Files uploaded with a letter |
| `letter_comments` | `id`, `letterId`, `authorId`, `authorName`, `content`, `createdAt` | The "leave a note" comment thread |
| `user_profiles` | `userId`, `displayName`, `lastActivitySeenAt`, `avatarUrl` | App-level profile (not Clerk metadata) |

---

### 4.8 API Endpoints Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/healthz` | None | Health check |
| `GET` | `/me` | ✓ | Current user profile + isAdmin |
| `POST` | `/profile` | ✓ | Create/update display name |
| `GET` | `/spaces` | ✓ | List all spaces |
| `POST` | `/spaces` | ✓ | Create a space |
| `PATCH` | `/spaces/:id` | ✓ | Rename / reorder a space |
| `DELETE` | `/spaces/:id` | ✓ | Delete a space |
| `GET` | `/tags` | ✓ | List all channels |
| `POST` | `/tags` | ✓ | Create a channel |
| `PATCH` | `/tags/:id` | ✓ | Update a channel |
| `DELETE` | `/tags/:id` | ✓ | Delete a channel |
| `GET` | `/unread-counts` | ✓ | Unread message counts per channel |
| `GET` | `/messages` | ✓ | Fetch messages for a channel |
| `POST` | `/messages` | ✓ | Send a message |
| `PATCH` | `/messages/:id` | ✓ | Edit a message |
| `DELETE` | `/messages/:id` | ✓ | Delete a message |
| `POST` | `/messages/:id/react` | ✓ | Toggle emoji reaction on a message |
| `GET` | `/messages/stream` | ✓ | SSE stream for a channel |
| `POST` | `/messages/clear` | ✓ Admin | Clear all messages in a channel |
| `GET` | `/letters` | ✓ | List letters in a postbox |
| `POST` | `/letters` | ✓ | Write a letter |
| `GET` | `/letters/:id` | ✓ | Read a letter |
| `DELETE` | `/letters/:id` | ✓ Admin | Delete a letter |
| `PATCH` | `/letters/:id/tags` | ✓ | Replace a letter's channel assignments |
| `POST` | `/letters/:id/react` | ✓ | Toggle emoji reaction on a letter |
| `GET` | `/letters/:id/comments` | ✓ | Fetch comments on a letter |
| `POST` | `/letters/:id/comments` | ✓ | Post a comment on a letter |
| `POST` | `/upload` | ✓ | Upload a file (returns URL) |
| `GET` | `/notifications` | ✓ | Get unread notification summary |
| `POST` | `/notifications/seen` | ✓ | Mark all notifications as seen |
| `GET` | `/admin/users` | ✓ Admin | List all users (Clerk) |
| `DELETE` | `/admin/users/:userId` | ✓ Admin | Delete a user |

---

## 5. Local Development Setup

### Prerequisites

Make sure the following are installed on your machine:

- **Node.js** v20 or later — [nodejs.org](https://nodejs.org)
- **pnpm** v9 or later — install with `npm install -g pnpm`
- **PostgreSQL** v15 or later — [postgresql.org](https://www.postgresql.org/download/) or use [Neon](https://neon.tech) / [Supabase](https://supabase.com) for a hosted database

---

### Step 1 — Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME
```

---

### Step 2 — Install Dependencies

```bash
pnpm install
```

This installs all dependencies for every workspace package simultaneously.

---

### Step 3 — Configure Environment Variables

The project needs two `.env` files — one for the API server and one for the frontend.

#### `artifacts/api-server/.env`

```env
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/kothadi

# Clerk (get these from https://dashboard.clerk.com)
CLERK_SECRET_KEY=sk_test_...

# Admin user — the email address of the admin account
ADMIN_EMAIL=your@email.com

# Server port (defaults to 3001 if not set)
PORT=3001
```

#### `artifacts/sanctuary/.env`

```env
# Clerk publishable key (get this from https://dashboard.clerk.com)
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# Points the frontend to your local API server
VITE_API_BASE_URL=http://localhost:3001
```

---

### Step 4 — Set Up Clerk

1. Go to [dashboard.clerk.com](https://dashboard.clerk.com) and create a new application.
2. Choose **Email + Password** as the authentication method (or add Google/GitHub if preferred).
3. Copy your **Publishable Key** → paste into `VITE_CLERK_PUBLISHABLE_KEY`.
4. Copy your **Secret Key** → paste into `CLERK_SECRET_KEY`.
5. In Clerk Dashboard → **Domains**, add `http://localhost:5173` as an allowed origin.

---

### Step 5 — Initialize the Database

```bash
# Push the Drizzle schema to your PostgreSQL database (creates all tables)
pnpm --filter @workspace/db run db:push
```

> If this command isn't available, run:
> ```bash
> cd lib/db && npx drizzle-kit push --config=drizzle.config.ts
> ```

---

### Step 6 — Run the Application

Open **two terminal windows**:

**Terminal 1 — API Server:**
```bash
pnpm --filter @workspace/api-server run dev
# Server starts on http://localhost:3001
```

**Terminal 2 — Frontend:**
```bash
pnpm --filter @workspace/sanctuary run dev
# App starts on http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

### Step 7 — (Optional) Regenerate API Client

If you change `lib/api-spec/openapi.yaml`, regenerate the hooks and schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

### Useful Commands Reference

```bash
# Run all packages in dev mode (if configured)
pnpm run dev

# Push schema changes to the database
pnpm --filter @workspace/db run db:push

# Open Drizzle Studio (visual DB browser)
pnpm --filter @workspace/db run db:studio

# Regenerate API hooks + Zod schemas
pnpm --filter @workspace/api-spec run codegen

# Build the API server for production
pnpm --filter @workspace/api-server run build

# Build the frontend for production
pnpm --filter @workspace/sanctuary run build
```

---

## 6. How to Export & Take Control

### Step 1 — Create a GitHub Repository

1. Go to [github.com/new](https://github.com/new).
2. Create a new **private** repository (recommended for a personal app like this).
3. Do **not** initialize it with a README or .gitignore — you already have one.

---

### Step 2 — Download the Code from Replit

In the Replit workspace, click the three-dot menu (⋯) in the file explorer and select **Download as ZIP**, or use the Replit shell:

```bash
# From the Replit shell — pack everything except node_modules and dist
zip -r kothadi.zip . \
  --exclude "*/node_modules/*" \
  --exclude "*/dist/*" \
  --exclude "*/.git/*" \
  --exclude "*/uploads/*"
```

Download the zip and extract it locally.

---

### Step 3 — Push to GitHub

```bash
cd kothadi   # the extracted folder

# Initialize git (if not already initialized)
git init
git add .
git commit -m "Initial commit — full Kothadi codebase"

# Connect to your GitHub repo
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

---

### Step 4 — Add a `.gitignore`

Create a `.gitignore` file in the root if one doesn't exist:

```gitignore
node_modules/
dist/
.env
.env.local
*.env
uploads/
*.tsbuildinfo
.drizzle/
```

---

### Step 5 — Managing Secrets Outside Replit

When running outside Replit, your secrets need to be managed yourself:

- **Local development** — use `.env` files as described in Section 5. Never commit these to git.
- **Production** — use your hosting provider's secret manager:
  - **Vercel** → Project Settings → Environment Variables
  - **Railway** → Variables tab
  - **Render** → Environment tab
  - **Self-hosted VPS** → Use a `.env` file on the server, or a tool like `dotenv-vault`

---

### Step 6 — Deploying to Production

The app has two services that need to be deployed:

#### Option A: Railway (Recommended — supports both services)
1. Connect your GitHub repo to [railway.app](https://railway.app).
2. Create two services: one for `artifacts/api-server`, one for `artifacts/sanctuary`.
3. Set the root directory for each service accordingly.
4. Add a PostgreSQL plugin in Railway and copy the `DATABASE_URL`.
5. Add all environment variables from Section 5 to each service.

#### Option B: Separate hosts
- **Frontend** → Deploy to [Vercel](https://vercel.com) or [Netlify](https://netlify.com).
  - Build command: `pnpm --filter @workspace/sanctuary run build`
  - Output directory: `artifacts/sanctuary/dist`
- **Backend** → Deploy to [Render](https://render.com) or a VPS.
  - Start command: `pnpm --filter @workspace/api-server run build && node artifacts/api-server/dist/index.js`

#### Database
- [Neon](https://neon.tech) — free serverless PostgreSQL, works perfectly with this stack.
- [Supabase](https://supabase.com) — free tier, includes a dashboard for browsing data.

---

### Step 7 — Ongoing Development Workflow

Once the code is on GitHub, this is the recommended day-to-day workflow:

```
1. Make changes locally (or in Replit)
2. Run pnpm --filter @workspace/api-spec run codegen  (if you changed the API spec)
3. Test locally with both dev servers running
4. git add . && git commit -m "describe your change"
5. git push origin main
6. Your hosting platform auto-deploys from main
```

---

*This guide was generated from the live codebase. If the code evolves significantly, re-generate this file to keep it accurate.*
