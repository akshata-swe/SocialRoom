---
name: SSE real-time messaging
description: How chat real-time delivery works — SSE pub/sub replacing 5s polling
---

## Rule
Chat messages are delivered in real time via Server-Sent Events, not polling. The `refetchInterval` on `useGetMessages` was removed.

## Architecture
- `artifacts/api-server/src/lib/messageBus.ts` — in-process pub/sub (Map<tagId, Set<Listener>>). Single-process only; works for a two-user app on one server. Replace with Redis pub/sub for multi-instance deploys.
- `GET /api/messages/stream?tagId=N` — SSE endpoint; requires Clerk session cookie (sent automatically by EventSource via same-origin proxy). Sends `event: connected` on open, `event: message` on new messages, `: heartbeat` comment every 25s.
- `POST /api/messages` — inserts to DB, then calls `broadcast(tagId, serialized)` to push to all SSE listeners.
- `ChatView.tsx` — `useChatStream(tagId, onMessage)` hook creates EventSource, appends incoming messages to TanStack Query cache via `setQueryData`. Sender sees their own message immediately from the mutation response (deduped by id).

## Identity fields (messages table + API)
- `author_id` / `senderId` — Clerk userId
- `author_name` / `senderDisplayName` — display name resolved server-side from Clerk (firstName+lastName or email prefix). Never from client body — prevents spoofing.
- `sender_login_name` / `senderLoginName` — full Clerk email, stored for auditing. Never rendered in chat UI.

**Why:** The original `authorName` was taken from `req.body.authorName`, which the frontend never sent (falling back to "Partner" for everyone). Fixing this required server-side Clerk lookup on every POST — that's now the canonical source.

## How to apply
- Any new chat feature that needs sender identity: read from `msg.senderDisplayName` (never `senderLoginName`) for UI.
- `senderLoginName` is admin/audit only — backend routes only.
- To scale beyond one process: swap `messageBus.ts` subscribe/broadcast with Redis pub/sub using the same interface.
