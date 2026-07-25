# Product Requirements Document
## Kothadi — A Private Digital Room for Two

**Version:** 1.0  
**Date:** July 2026  
**Status:** Built & Live  

---

## 1. Overview

Kothadi is a permanent, invitation-only web application designed exclusively for two people. It provides a shared private space combining two communication modes: **Postbox** (long-form letters) and **Chat** (real-time messaging). The experience is intentionally quiet, intimate, and distraction-free — no social feeds, no follower counts, no public presence.

---

## 2. Goals & Non-Goals

### Goals
- Create a private, permanent space for two people to write and talk
- Support both asynchronous (letters) and synchronous (chat) communication
- Maintain a calm, dark, typographically rich aesthetic
- Notify users of new activity without requiring them to be online simultaneously
- Allow the two users to organise their space into named channels and sections

### Non-Goals
- No support for more than two users
- No public profiles, discovery, or social features
- No file or photo sharing (removed by design)
- No mobile native app (web only, responsive)
- No public sign-up — both accounts are pre-created

---

## 3. Users

| Role | Description |
|------|-------------|
| **User A / User B** | The two people who share the room. Both have equal permissions with one exception (see Admin below). |
| **Admin** | Either user can be designated admin. Admins can clear chat history and access admin-only channels. |

---

## 4. Authentication & Onboarding

### 4.1 Authentication
- Powered by **Clerk** (email/password)
- Sign-in appears as an **inline overlay** on the landing page — no separate sign-in URL
- On successful sign-in, users are redirected to the workspace
- Session invalidation is handled gracefully: expired sessions redirect to the landing page instead of looping indefinitely

### 4.2 Onboarding Gate
- On first login, users must complete a one-time onboarding step
- **Display Name** is collected separately from Clerk credentials (preserving privacy — the two users may know each other by nicknames)
- Display name is stored in the app's own database (`user_profiles` table), never in Clerk metadata
- Until onboarding is complete (`isProfileComplete = false`), the workspace is blocked

---

## 5. Landing Page

**Route:** `/`

- Dark, typographically minimal landing page
- Header: app name "Kothadi" (left), "Sign In" link (right, visible when signed out)
- Hero: *"A quiet room for two."* + *"Leave letters for each other."*
- **Enter button:**
  - Signed out → opens the inline sign-in overlay
  - Signed in with new activity → shows a notification banner before entering
  - Signed in with no new activity → auto-redirects to the workspace after 400 ms
- **Notification banner** (signed-in users only): shows counts of new message reactions, letter comments, and letter reactions since last visit
- Footer: *"A private, intentional digital space."*
- Background: subtle noise texture + radial gradient

---

## 6. Workspace

**Route:** `/sanctuary`  
**Access:** Signed-in + onboarding complete only

The workspace is a two-panel layout:

```
┌─────────────────┬──────────────────────────────────────┐
│   Sidebar       │   Main content area                  │
│   (navigation)  │   (Postbox or Chat view)             │
└─────────────────┴──────────────────────────────────────┘
```

### 6.1 Idle Overlay
- After **2 minutes of inactivity**, a full-screen minimalist clock/date screen replaces the workspace
- Any interaction dismisses it
- Designed to maintain a private, screen-safe atmosphere

---

## 7. Sidebar

The sidebar is the organisational backbone of the workspace.

### 7.1 Structure
- **Spaces** — top-level groupings (e.g. "Our Room")
- **Channels (Tags)** — live inside Spaces; each channel is either a Postbox or a Chat

### 7.2 Features
| Feature | Detail |
|---------|--------|
| Channel types | **Postbox** (letter archive) or **Chat** (live messages) |
| Unread badges | Shows count of unread letters or messages per channel |
| Create channel | Inline form to add a new Postbox or Chat channel within a Space |
| Rename | Inline rename for both Spaces and Channels |
| Reorder | Drag-and-drop reordering for both Spaces and Channels |
| Admin-only channels | Channels flagged `isAdminOnly` are read-only for non-admin users |
| Delete | Channels can be deleted (with confirmation) |

---

## 8. Postbox (Letters)

The Postbox is an asynchronous letter-writing system. Letters are long-form and permanent by default.

### 8.1 PostboxView (Letter Archive)
- Grid layout of letter cards per channel
- Each card shows: title/excerpt, author, timestamp
- **Unread glow indicator** on letters not yet opened by the partner
- Authors can delete their own letters
- Letters authored by the partner are read-only (no delete)

### 8.2 LetterComposer (Writing)
- Full-screen writing interface
- Block-based rich content editor (JSON stored in database)
- Channel (tag) selector — choose which Postbox to send to
- **"Seal & Send"** action to publish the letter
- No file attachments (removed)

### 8.3 LetterReader (Reading)
- Immersive full-screen reading view
- Displays full letter content
- **Emoji Reactions** — full Unicode emoji set via emoji-mart; reactions stored in a join table
- **Notes (Comments)** — threaded commenting system on each letter
  - Either user can leave a note
  - Notes are displayed chronologically below the letter
- Marks letter as read when opened by the partner

---

## 9. Chat (Real-Time Messaging)

The Chat is a live messaging interface using **Server-Sent Events (SSE)** — no polling, no WebSockets.

### 9.1 Features
| Feature | Detail |
|---------|--------|
| Real-time delivery | Messages appear instantly via SSE stream (`/api/messages/stream`) |
| Send message | Text input at the bottom; empty placeholder (intentionally blank) |
| Read receipts | `seenByPartner` flag shown as an indicator per message |
| Message editing | Authors can edit their own messages |
| Message deletion | Authors can delete; restricted after partner has viewed |
| Emoji reactions | Full emoji-mart picker; reactions stored per message in a join table |
| Sender identity | Each message shows the sender's display name |
| Admin: clear history | Admin users can clear all chat history for a channel |

### 9.2 SSE Architecture
- Backend broadcasts new messages via an **in-process message bus** (`messageBus.ts`)
- Frontend subscribes via `EventSource` in `ChatView.tsx`
- On `POST /api/messages`, the bus broadcasts to all active SSE subscribers

---

## 10. Reactions

Reactions use the **full Unicode emoji set** via `@emoji-mart/react` + `@emoji-mart/data`.

| Context | Storage | UI |
|---------|---------|-----|
| Chat messages | `message_reactions` join table | Emoji picker popup above/below trigger button |
| Letters | `letter_reactions` join table | Same picker in LetterReader |

- The picker is **lazy-loaded** (`React.lazy`) to avoid the ~1.8 MB emoji data blocking initial page load
- A portal positions the picker correctly relative to the trigger

---

## 11. Notifications

Notifications surface new activity since the user's last visit.

| Signal | Trigger |
|--------|---------|
| New message reactions | Partner reacted to one of your chat messages |
| New letter comments | Partner left a note on one of your letters |
| Letter reactions | Partner reacted to one of your letters |

- Counts are fetched on the **landing page** (`/api/notifications`)
- A notification banner appears on the landing page if there is any new activity
- Counts are marked seen (`lastActivitySeenAt` updated) when the user clicks Enter

---

## 12. Data Model

### Tables

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `user_profiles` | `userId`, `displayName`, `isProfileComplete`, `lastActivitySeenAt` | Per-user profile and notification state |
| `spaces` | `id`, `name`, `sortOrder` | Top-level workspace groupings |
| `tags` | `id`, `spaceId`, `name`, `type`, `isAdminOnly`, `sortOrder` | Channels (Postbox or Chat) |
| `letters` | `id`, `tagId`, `authorId`, `content` (jsonb), `isRead` | Long-form letters |
| `messages` | `id`, `tagId`, `senderId`, `content`, `seenByPartner` | Chat messages |
| `message_reactions` | `messageId`, `userId`, `emoji` | Per-message emoji reactions |
| `letter_comments` | `letterId`, `authorId`, `content` | Threaded notes on letters |

---

## 13. API Surface

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/me` | Current user profile |
| PUT | `/api/profile` | Update display name / complete onboarding |
| GET | `/api/notifications` | Unread activity counts |
| GET | `/api/spaces` | List all spaces |
| POST/PUT/DELETE | `/api/spaces/:id` | Create / rename / delete / reorder spaces |
| GET | `/api/tags` | List channels |
| POST/PUT/DELETE | `/api/tags/:id` | Create / rename / delete / reorder channels |
| GET | `/api/letters` | List letter summaries for a channel |
| GET | `/api/letters/:id` | Get full letter content |
| POST | `/api/letters` | Create a new letter |
| DELETE | `/api/letters/:id` | Delete a letter (author only) |
| POST | `/api/letters/:id/react` | Add / toggle emoji reaction on a letter |
| GET | `/api/letters/:id/comments` | List comments on a letter |
| POST | `/api/letters/:id/comments` | Add a comment to a letter |
| GET | `/api/messages` | List messages for a channel |
| GET | `/api/messages/stream` | SSE stream for real-time messages |
| POST | `/api/messages` | Send a new message |
| PUT | `/api/messages/:id` | Edit a message |
| DELETE | `/api/messages/:id` | Delete a message |
| POST | `/api/messages/:id/react` | Add / toggle emoji reaction on a message |
| DELETE | `/api/messages/clear` | Admin: clear all messages in a channel |

---

## 14. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | React 19 + TypeScript |
| Build tool | Vite |
| Routing | Wouter 3.x |
| Auth | Clerk (email/password, inline overlay) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| State / data fetching | TanStack Query (React Query) |
| API client | Orval-generated typed client (`@workspace/api-client-react`) |
| Real-time | Server-Sent Events (SSE) |
| Backend | Express (TypeScript) |
| Database | PostgreSQL via Drizzle ORM |
| Emoji picker | emoji-mart + @emoji-mart/data (lazy-loaded) |
| Monorepo | pnpm workspaces |
| Hosting | Replit |

---

## 15. Design Principles

1. **Two people only.** The system is not architected for scale. Every design decision assumes exactly two users who know each other.
2. **Dark by default.** No light mode. The environment is a quiet, evening room.
3. **No noise.** No public features, no discoverability, no notifications outside the app.
4. **Typography-first.** Letters are rendered with care; the reading experience is unhurried.
5. **Private by design.** Display names are decoupled from Clerk credentials. Nothing leaks to external services beyond auth.
6. **Performance aware.** Heavy assets (emoji data) are lazy-loaded. The initial bundle is kept lean.

---

## 16. Known Constraints & Decisions

| Decision | Rationale |
|----------|-----------|
| No file/photo sharing | Removed to keep the experience text-only and intimate |
| SSE over WebSockets | Simpler infra; sufficient for a 2-person chat |
| Clerk inline overlay (not a separate route) | Separate `/sign-in` route caused Clerk's path-routing to redirect unexpectedly due to wouter base-path conflicts |
| Display name stored in app DB (not Clerk) | Keeps user identity within the app's control; preserves the option for anonymity between the two users |
| Lazy-loaded emoji picker | `@emoji-mart/data` is ~1.8 MB; eager loading caused a noticeable initial load delay |
| `isProfileComplete` gate | Ensures both users establish a display name before any content is visible |

---

*This document reflects the application as built as of July 2026.*
