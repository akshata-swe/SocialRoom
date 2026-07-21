---
name: Onboarding flow
description: How display name collection and the first-login gate work
---

## Rule
`user_profiles` is the single source of truth for `displayName` and `isProfileComplete`. Clerk metadata (firstName/lastName) is only used to seed a blank row on first `/me` call — it is never used as the live display name after that.

**Why:** Users must explicitly choose their in-app name. Clerk metadata could be a real name, email prefix, or empty — unreliable for a warm, personal dual-user space.

## Architecture
- `lib/db/src/schema/userProfiles.ts` — `user_profiles` table: `userId (PK)`, `displayName`, `isProfileComplete (default false)`, `createdAt`, `updatedAt`.
- `GET /api/profile` — upserts a blank row (seeded from Clerk) on first call; returns the profile.
- `PATCH /api/profile` — sets `displayName` + flips `isProfileComplete = true`.
- `GET /api/me` — reads `displayName` and `isProfileComplete` from `user_profiles` (via `getOrCreateProfile`). Email kept for audit; never shown in UI.
- `POST /api/messages` — calls `resolveDisplayName(userId)` which queries `user_profiles`. Never trusts client-supplied display names.

## Frontend gate
- `OnboardingGate` component in `App.tsx` (rendered inside `SanctuaryPortal` for signed-in users).
- Calls `useGetMe()`. While loading → spinner. If `isProfileComplete === false` → `OnboardingModal`. If true → `<Sanctuary />`.
- `OnboardingModal` calls `useUpdateProfile`, then `invalidateQueries(getGetMeQueryKey())` to re-trigger the gate check.

## How to apply
- Any feature that needs the user's name: read from `me.displayName` (sourced from user_profiles). Never read Clerk's `firstName`/`lastName` in UI code.
- To add a "change display name" settings screen later: reuse `PATCH /api/profile` — it's an upsert so it works for both first-time and updates. No need to reset `isProfileComplete`.
