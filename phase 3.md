# Phase 3 — Limits + Robustness

> **Status:** Decisions resolved. Do Phase 2.5 first; it fixes prerequisite gaps from the existing code.

---

## Decisions Summary

| Question                      | Decision                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| Admin DID                     | Read from `COMMUNITY_TAP_ADMIN_DID`                                                          |
| `/api/hooks/addRepo` API Key  | One inbound API key per user; store a hash, show the raw key only on create/regenerate       |
| Webhook Verification          | Optional per-user outbound signing secret; send HMAC headers with webhook deliveries         |
| Limit Behavior                | Reserve rows in `events` before delivery. Auto-resume when the relevant window resets. Drop while paused |
| Limit Source                  | Use bounded indexed reads from `events`; no separate `eventCounters` table for now          |
| Event Retention               | No pruning — leave unbounded for now                                                         |
| Webhook Timeout               | Global hard cap of 5000ms (5 seconds)                                                        |
| Landing Page                  | Replace `/` with a public landing page; authed users redirect to `/dashboard`                |
| Convex Boundary               | Permanent server-secret boundary; TanStack Start is the backend-for-frontend        |

---

## Phase 2.5 — Fix Gaps from Phases 1 & 2

> **Do this before Phase 3.** These are mechanical fixes that don't change the product behavior, but they remove drift between the docs, schema, and current code.

### 1. Update Lexicon to Match Code

`lexicons/com/communitytap/hook.json` doesn't declare `serviceId`, but `src/lib/pds.ts` writes it on every record.

**Fix:** Add `serviceId` to the lexicon's required properties and record schema. AT Proto clients tolerate extra fields, but having it declared makes the record self-describing.

### 2. Remove Scaffold Code and Tables

`products` and `todos` are still in `convex/schema.ts`, and `convex/todos.ts` still references the scaffold `todos` table.

**Fix:** Delete `products` and `todos` from the schema, and delete `convex/todos.ts`. Removing only the tables will leave generated Convex types/functions inconsistent because `convex/todos.ts` still queries and mutates `todos`.

### 3. Handle `com.communitytap.hook` Events in `/api/tap-events`

**Goal:** Auto-discover hooks created via any AT Proto client, not just this UI, whenever Tap already delivers events for that repo.

**Current code:** `/api/tap-events` is a TanStack Start server route, not a Convex `httpAction`. It receives Tap record events, filters by `event.collection`, fans out to matching hooks, and logs attempts through Convex mutations.

**How it works:**

`/api/tap-events` receives record events from repo DIDs registered with Tap. When a registered repo creates or deletes a `com.communitytap.hook` record, Tap delivers that event just like any other record event. Today it gets ignored because no user hook has `nsid === "com.communitytap.hook"`.

**Fix:** In `/api/tap-events`, before the normal fan-out logic, add a branch:

- If `collection === "com.communitytap.hook"`:
  - Build `recordUri` as `at://${event.did}/${event.collection}/${event.rkey}`.
  - **Create/Update:** Read `nsid`, `webhookUrl`, and `serviceId` from the hook record. If `serviceId` matches `COMMUNITY_TAP_SERVICE_ID`, validate the fields and upsert into Convex `hooks` using `userId = event.did`.
  - If no `users` row exists for `event.did`, create a minimal user row with `handle = event.did`; the next OAuth login can update the handle.
  - After upserting, call Tap's `addRepos([event.did])` as an idempotent safety net. Tap ignores already-registered repos.
  - **Delete:** Remove the hook from Convex by `recordUri`.
  - Do not fan these events out to user webhooks; these are internal bookkeeping events.
  - Return early.
- For all other collections, continue with the normal hook-matching fan-out.

**Limitation:** This only discovers hooks in repos already registered with Tap through `/api/hooks/addRepo`, UI hook creation, sync, or a previous hook registration. A brand new user who creates a hook directly on their PDS before any Tap registration will not be auto-discovered until their repo is registered. The manual "Sync from AT Proto" button remains the fallback.

---

## Phase 3 Implementation Plan

### Step 1: Schema Updates

**Update `hooks` table**

- Add `pausedAt: v.optional(v.number())` — timestamp when paused by limit enforcement or admin.
- Add `pausedReason: v.optional(v.union(v.literal("daily_limit"), v.literal("minute_limit"), v.literal("admin")))`.
- Add index `by_userId_and_pausedAt` on `["userId", "pausedAt"]` for querying paused hooks per user.
- Treat a hook as deliverable only when `isActive === true` and `pausedAt` is absent.

**Update `users` table**

- Add `addRepoApiKeyHash: v.optional(v.string())` — hash of the inbound API key for `/api/hooks/addRepo`.
- Add `addRepoApiKeyCreatedAt: v.optional(v.number())`.
- Add index `by_addRepoApiKeyHash` on `["addRepoApiKeyHash"]`.
- Add `webhookSigningSecret: v.optional(v.string())` — optional per-user secret used to sign outbound webhook requests.
- Add `webhookSigningSecretCreatedAt: v.optional(v.number())`.
- Do not return `addRepoApiKeyHash` or `webhookSigningSecret` from normal user/dashboard queries.

**Update `events` table**

- Keep using `events` as the quota source of truth. The existing `by_user` index on `["userId", "timestamp"]` is enough to check current minute/day windows with bounded reads.
- Add `deliveryStatus: v.optional(v.union(v.literal("reserved"), v.literal("delivered"), v.literal("failed")))` so a row can be inserted before webhook delivery and patched after delivery completes.
- Keep `durationMs`, `success`, and response fields compatible with existing rows. For reserved rows, use placeholder values such as `durationMs: 0`, `success: false`, and `deliveryStatus: "reserved"`.

No `eventCounters` table is needed at the current limits. Counting at most 50 minute rows and 1000 daily rows per user is bounded and reasonable. The important part is to do the count and reservation insert in a single Convex mutation, not as separate route-level reads.

**Optionally update `repoRegistrations`**

- Add `nsid: v.optional(v.string())` so `/api/hooks/addRepo` can record which registered hook justified the repo registration.
- Add index `by_registeredBy_and_nsid` on `["registeredBy", "nsid"]` if the admin view needs it.

### Step 2: Use a Permanent Server-Side Convex Boundary

Keep TanStack Start as the backend-for-frontend. Browser code authenticates with AT Proto OAuth through the existing cookie/session flow, then TanStack server functions call Convex with server-only credentials. Convex functions that should not be public require a shared server secret argument.

This is simpler than wiring Convex auth to AT Proto OAuth and fits the current architecture, where dashboard queries/actions already go through TanStack server functions instead of direct browser-to-Convex calls.

**Approach:**

- Add `CONVEX_SERVER_SECRET` to both the TanStack server environment and Convex environment.
- Add a small Convex helper such as `requireServerSecret(serverSecret)` for sensitive functions.
- Sensitive Convex functions require `serverSecret` and compare it to `process.env.CONVEX_SERVER_SECRET`.
- Never pass `CONVEX_SERVER_SECRET` to client components, route loaders that serialize it, or public responses.
- Route guards and server functions continue deriving the current DID from the AT Proto OAuth session cookie.
- Server functions pass the derived DID plus `serverSecret` to Convex. Convex still checks ownership/admin rules using the DID argument, but trusts it only because the valid server secret proves the call came from TanStack server code.
- `/api/hooks/addRepo` remains machine-to-machine and authenticates with the user's inbound API key before using server-secret-protected Convex helpers.
- `/api/tap-events` continues authenticating Tap with `TAP_ADMIN_PASSWORD` before using server-secret-protected Convex helpers.
- Keep or remove the existing browser `ConvexProvider` depending on whether anything actually uses it. Do not use it for privileged reads/writes unless Convex auth is added later.

**Downsides:**

- Convex does not independently know the browser user's identity; TanStack server code is the trust boundary.
- Direct browser-to-Convex subscriptions/queries are not appropriate for protected data under this model.
- Every sensitive Convex function needs explicit secret validation.
- If the server secret leaks, an attacker can call protected Convex functions directly until the secret is rotated.

For this app, those tradeoffs are acceptable and arguably cleaner than adding a custom JWT issuer only to adapt AT Proto OAuth into Convex auth.

### Step 3: Limit Enforcement

**Limits:**

- 1000 accepted delivery attempts/day per user, reset at midnight UTC.
- 50 accepted delivery attempts/minute per user, reset at the top of each minute.
- Count reserved rows in `events`, not only successful webhook responses. With the current one-hook-per-NSID rule, this effectively maps to accepted Tap events for a user's hook.

**Window calculation:**

- Daily: `Math.floor(Date.now() / 86400000) * 86400000`.
- Minute: `Math.floor(Date.now() / 60000) * 60000`.

**Convex mutation:**

Add a single authenticated mutation, e.g. `events.reserveForDelivery`, that runs atomically for one `userId` and a bounded set of hook IDs:

1. Compute the current daily and minute windows.
2. Clear `pausedAt` / `pausedReason` for that user's limit-paused hooks if the relevant window has reset.
3. Leave `pausedReason === "admin"` untouched.
4. Query `events.by_user` for the current minute window and `take(50)`.
5. Query `events.by_user` for the current day window and `take(1000)`.
6. If either bounded result is already at the limit:
   - Set `pausedAt` and `pausedReason` on the user's active hooks whose current pause reason is not `"admin"`.
   - Return `{ allowed: false, reason: "daily_limit" | "minute_limit" }`.
7. If under both limits:
   - Insert one reserved `events` row per hook delivery with `timestamp = now`, `deliveryStatus = "reserved"`, and placeholder delivery result fields.
   - Return `{ allowed: true, eventIds }`.

Do the reservation before webhook delivery. This uses the `events` table itself as the quota ledger and avoids a separate counters table. If delivery later fails, the reserved row is patched to `deliveryStatus = "failed"` and the quota is still consumed; this is acceptable because the limit protects the service from attempted traffic, not only successful deliveries.

**Route logic in `/api/tap-events`:**

1. Load active hooks matching `event.collection`, including hooks that are currently limit-paused.
2. Group matching hooks by `userId`.
3. For each user group, call `events.reserveForDelivery`; this gives the mutation a chance to auto-resume expired limit pauses.
4. If denied, skip all deliveries for that user and do not log dropped events.
5. If allowed, deliver to hooks in that group except hooks with `pausedReason === "admin"`.
6. Patch each reserved event row with the delivery result.

**UI:**

- Dashboard shows a warning banner if any hooks are paused, e.g. `Delivery paused — daily limit reached (1000 events). Resets at midnight UTC.`
- Hook detail shows a paused badge with the reason.
- Admin-paused hooks should display separately from limit-paused hooks.

### Step 4: Webhook Delivery Robustness

**Timeout cap: 5000ms**

In `/api/tap-events`, per hook delivery:

- Create an `AbortController`.
- Abort the fetch after 5000ms.
- Log timeout as `success: false`, `error: "Timeout after 5000ms"`.
- Continue delivering other hooks in the same batch.

**Outbound webhook verification:**

The PLAN asks for a user-created key that helps webhook receivers verify that requests came from this service. Keep this separate from the inbound `/api/hooks/addRepo` API key.

- Let users generate/regenerate an optional `webhookSigningSecret`.
- Show the raw secret only once on create/regenerate.
- For users with a signing secret, send:
  - `X-Community-Tap-Event: true`
  - `X-Community-Tap-Nsid: <collection>`
  - `X-Community-Tap-Timestamp: <unix ms>`
  - `X-Community-Tap-Signature: sha256=<hex hmac>`
- Compute the HMAC over `${timestamp}.${rawRequestBody}` using `webhookSigningSecret`.
- Document signature verification in the README.

### Step 5: Per-User API Keys for `/api/hooks/addRepo`

**Generation:**

- Generate a random key such as `ct_repo_` + 32 random bytes encoded as hex or base64url.
- Store only a hash in `users.addRepoApiKeyHash`.
- Show the raw key once in the dashboard after generation/regeneration.
- Normal dashboard data should only expose `hasAddRepoApiKey`.

**Auth:**

- `/api/hooks/addRepo` requires `Authorization: Bearer <apiKey>`.
- Hash the submitted key and look up the user by `addRepoApiKeyHash` through an internal server-side Convex function. This route is machine-to-machine and is not tied to a browser user session.
- If not found, return 401.
- Request body should be `{ "repoDid": "did:...", "nsid": "com.example.record" }`.
- Validate `repoDid` is a sensible DID string.
- Validate `nsid` is a sensible NSID string.
- Validate the API-key owner has an active, unpaused hook for that exact `nsid`.
- Ignore any client-supplied `registeredBy`; derive it from the API key owner.
- Call Tap's `addRepos([repoDid])`.
- If Tap registration fails, return a 502 instead of silently succeeding.
- Store the registration with `registeredBy = user.did` and `nsid`.

This makes the PLAN's "matching hook in Convex" requirement concrete. The submitted repo DID belongs to the developer's end user, not to the Community Tap account owner, so the meaningful validation is: does the API key owner have an active hook for the submitted NSID?

**Also: register the Community Tap user's own repo on hook creation/sync**

Whenever a hook is created through the UI or discovered through `com.communitytap.hook` events, call Tap's `addRepos([userDid])` to ensure the hook owner's repo is watched. Do not roll back the PDS/Convex hook if Tap registration fails; surface a warning because the hook exists but may not receive events until Tap registration succeeds.

### Step 6: Admin View

**Route:** `/admin`

**Gating:**

- Read the current AT Proto session from the existing cookie/session flow.
- Compare `session.did` to `process.env.COMMUNITY_TAP_ADMIN_DID` in both the route guard and every admin server function.
- If mismatch, redirect to `/dashboard`.
- Admin Convex functions require `serverSecret` and compare the server-derived DID argument to `COMMUNITY_TAP_ADMIN_DID`.

**Features:**

- Table of all users: DID, handle, hook count, daily event count, paused status.
- Per-user expandable section: hooks list with NSID, truncated webhook URL, active/paused status.
- Pause/unpause per hook. Admin pause sets `pausedAt` and `pausedReason: "admin"`; unpause clears both only when reason is `"admin"`.
- Regenerate addRepo API key per user, returning the new raw key once.
- Regenerate webhook signing secret per user, returning the new raw secret once.
- Total events today across all users.

**Convex functions:**

- Add redacted authenticated admin list functions. Do not expose an unauthenticated `users.listAll` that returns secret fields.
- Add authenticated hook pause/unpause mutations.
- Add authenticated API key and webhook signing secret regeneration mutations.
- Add a query helper that uses bounded reads from `events.by_user` for current daily usage.

### Step 7: Public Landing Page + README

**Landing Page (`/`):**

- Unauthenticated users see:
  - Hero: `Webhook delivery for AT Proto firehose events`.
  - Subheadline: `Community Tap is a managed Tap service. Register your lexicon NSID, give us a webhook URL, and receive firehose events automatically — no server infrastructure required.`
  - Three-step visual: Login with Bluesky -> Add Hook -> Receive Events.
  - Login CTA button.
  - Link to GitHub / README.
- Authenticated users continue to redirect to `/dashboard`.

**README update:**

- Architecture overview.
- Setup instructions.
- API docs for `/api/hooks/addRepo` with auth header and request body schema.
- Limit policy: 1000/day and 50/minute per user.
- Webhook event format: raw Tap events.
- Webhook signature verification.
- Local development setup.

---

## Suggested Implementation Order

### Phase 2.5

1. Fix lexicon to include `serviceId`.
2. Remove scaffold schema entries and `convex/todos.ts`.
3. Add `com.communitytap.hook` handling branch to `/api/tap-events`.

### Phase 3

4. Schema: add hook pause fields, user key/secret fields, `events.deliveryStatus`, and optional `repoRegistrations.nsid`.
5. Add permanent server-secret protection for sensitive Convex functions.
6. `/api/tap-events`: add atomic quota reservation in `events` and pause/auto-resume behavior.
7. `/api/tap-events`: add webhook timeouts and optional HMAC signing headers.
8. `/api/hooks/addRepo`: replace open body-based registration with API key auth and NSID validation.
9. Hook creation/sync/discovery: register the hook owner's DID with Tap and surface Tap registration warnings.
10. Dashboard: show paused warnings, API key controls, and webhook signing secret controls.
11. Admin view: authenticated backend functions plus frontend page.
12. Landing page + README.

---

## Testing Checklist

- [ ] Phase 2.5: Lexicon validates `serviceId` is present.
- [ ] Phase 2.5: No `products`/`todos` tables in schema and no `convex/todos.ts` scaffold functions remain.
- [ ] Phase 2.5: Creating a `com.communitytap.hook` record on PDS via a different client auto-appears in Convex dashboard when that repo is already registered with Tap.
- [ ] Phase 2.5: Deleting a `com.communitytap.hook` record from PDS removes it from Convex.
- [ ] Create hook -> addRepo API key can be generated and shown once.
- [ ] Regenerate addRepo API key -> old key stops working.
- [ ] Call `/api/hooks/addRepo` with valid key and matching NSID -> success.
- [ ] Call `/api/hooks/addRepo` without key -> 401.
- [ ] Call `/api/hooks/addRepo` with wrong key -> 401.
- [ ] Call `/api/hooks/addRepo` with a valid key but an NSID the user has no hook for -> 400 or 403.
- [ ] Call `/api/hooks/addRepo` when Tap is unavailable -> 502.
- [ ] 51st accepted event in one minute -> deliveries for that user pause, banner appears.
- [ ] 1001st accepted event in one day -> deliveries for that user pause, banner appears.
- [ ] After minute/day window resets, limit-paused deliveries auto-resume and banner disappears.
- [ ] Admin-paused hook stays paused across window resets.
- [ ] Slow webhook (>5s) times out, logs correctly, and other hooks are unaffected.
- [ ] Webhook signing secret generation shows the raw secret once.
- [ ] Signed webhook includes timestamp and HMAC signature headers.
- [ ] Admin view loads for admin DID and redirects for non-admin.
- [ ] Admin server functions reject non-admin callers even if the route is bypassed.
- [ ] Admin can pause/unpause any hook.
- [ ] Normal dashboard/admin data never returns raw addRepo API keys or API key hashes.
- [ ] Landing page renders for unauthenticated users.
- [ ] Authed user on `/` redirects to `/dashboard`.

---

## Risks & Notes

- **Limit granularity:** Per-user `events` rows mean all hooks for a user share one 1000/day and 50/minute budget. This matches the PLAN spec.
- **Reservation race condition:** Do not implement limit checks as route-level query-then-mutation. Use a single Convex mutation that reads bounded `events` windows and inserts reservation rows atomically before delivery.
- **Convex boundary:** TanStack Start is the security boundary for user/admin requests. Sensitive Convex functions must require `CONVEX_SERVER_SECRET`, and privileged browser-to-Convex calls should be avoided unless Convex auth is added later.
- **Quota semantics:** Reserving before delivery means failed or timed-out webhook attempts still consume quota. That is intentional; the limit protects Community Tap's processing budget.
- **Tap registration:** Adding the hook owner's repo on hook creation ensures that future edits/deletes to `com.communitytap.hook` records can flow back through Tap. It does not provide network-wide discovery for unregistered repos.
- **PDS as source of truth for registered repos:** By handling `com.communitytap.hook` events internally, hooks created via any AT Proto client in a registered repo are mirrored into Convex. The gap remains: unregistered repos are not watched by Tap, so hooks in unregistered repos are only found via manual sync or explicit registration.
- **Event retention:** The `events` table remains unbounded by decision. If this stops being a toy app, add pruning or pagination before expanding usage.
