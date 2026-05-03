# Phase 2 — Event Delivery

> **Scope:** This plan covers only code changes in this repository. Tap deployment on Railway is excluded.

## Overview

In this phase, we wire up the actual event flow:

```
Tap (external) ──→ Convex httpAction (fan-out) ──→ User webhooks
                         ↓
                   Events table (logging)
                         ↓
                   UI (event log per hook)
```

**Key principle:** Developers must manually register repos via `/hooks/addRepo` — we don't auto-discover network-wide. This is an intentional simplification for this toy service.

---

## 1. Convex Schema Updates

### 1.1 Update `hooks` table

Extend the existing schema to track hook status:

```typescript
// convex/schema.ts
export default defineSchema({
  hooks: defineTable({
    userId: v.string(), // DID
    nsid: v.string(), // e.g., "app.bsky.feed.post"
    webhookUrl: v.string(),
    recordUri: v.string(), // at:// URI in user's PDS
    isActive: v.boolean(), // NEW: false when limits hit
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_nsid", ["nsid"]), // NEW: for fan-out lookups
});
```

### 1.2 Update `events` table

Detailed delivery logging:

```typescript
events: defineTable({
  hookId: v.id("hooks"),
  userId: v.string(),
  nsid: v.string(),
  repo: v.string(),              // DID of the source repo
  collection: v.string(),        // The collection path from Tap
  rkey: v.optional(v.string()),  // Record key
  action: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
  webhookUrl: v.string(),        // Where we tried to deliver
  requestBody: v.string(),         // JSON string of payload
  responseStatus: v.optional(v.number()),
  responseBody: v.optional(v.string()),
  durationMs: v.number(),
  success: v.boolean(),
  error: v.optional(v.string()),
  timestamp: v.number(),
})
.index("by_hook", ["hookId", "timestamp"])
.index("by_user", ["userId", "timestamp"])
.index("by_time", ["timestamp"]), // For cleanup
```

### 1.3 Add `repoRegistrations` table

Track which repos we've told Tap to watch:

```typescript
repoRegistrations: defineTable({
  repoDid: v.string(),           // The DID of the repo
  registeredBy: v.string(),      // User who registered this repo
  registeredAt: v.number(),
  lastSeenAt: v.number(),        // Last event we received for this repo
})
.index("by_repo", ["repoDid"])
.index("by_user", ["registeredBy"]),
```

---

## 2. Convex HTTP Actions

### 2.1 Event Ingestion: `POST /api/tap/events`

**File:** `convex/http.ts`

This endpoint receives firehose events from Tap and fans out to matching hooks.

```typescript
// Types matching Tap's webhook payload
interface TapEvent {
  repo: string; // DID of the repo that changed
  collection: string; // e.g., "app.bsky.feed.post"
  rkey: string; // Record key
  action: "create" | "update" | "delete";
  record?: unknown; // The actual record content (for create/update)
  time_us: number; // Timestamp from firehose
}

// POST /api/tap/events
httpAction(async (ctx, request) => {
  // 1. Verify request is from Tap (shared secret header)
  const authHeader = request.headers.get("x-tap-secret");
  if (authHeader !== process.env.TAP_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Parse the Tap event
  const event: TapEvent = await request.json();

  // 3. Find all hooks matching this collection
  const matchingHooks = await ctx.runQuery(internal.hooks.findHooksByNsid, {
    nsid: event.collection,
  });

  if (matchingHooks.length === 0) {
    return new Response("No matching hooks", { status: 200 });
  }

  // 4. Deliver to all hooks in parallel, log results
  const deliveries = await Promise.allSettled(
    matchingHooks.map(async (hook) => {
      // Skip paused hooks
      if (!hook.isActive) return null;

      const startTime = Date.now();
      try {
        const response = await fetch(hook.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Community-Tap-Event": "true",
            "X-Community-Tap-Nsid": event.collection,
          },
          body: JSON.stringify({
            repo: event.repo,
            collection: event.collection,
            rkey: event.rkey,
            action: event.action,
            record: event.record,
            time_us: event.time_us,
          }),
        });

        const duration = Date.now() - startTime;
        const responseBody = await response.text();

        // Log the delivery
        await ctx.runMutation(internal.events.logEvent, {
          hookId: hook._id,
          userId: hook.userId,
          nsid: event.collection,
          repo: event.repo,
          collection: event.collection,
          rkey: event.rkey,
          action: event.action,
          webhookUrl: hook.webhookUrl,
          requestBody: JSON.stringify(event.record),
          responseStatus: response.status,
          responseBody,
          durationMs: duration,
          success: response.ok,
        });

        return { hookId: hook._id, success: response.ok };
      } catch (error) {
        const duration = Date.now() - startTime;

        // Log the failure
        await ctx.runMutation(internal.events.logEvent, {
          hookId: hook._id,
          userId: hook.userId,
          nsid: event.collection,
          repo: event.repo,
          collection: event.collection,
          rkey: event.rkey,
          action: event.action,
          webhookUrl: hook.webhookUrl,
          requestBody: JSON.stringify(event.record),
          durationMs: duration,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });

        return { hookId: hook._id, success: false, error };
      }
    }),
  );

  // 5. Return summary to Tap (200 = Tap will continue, 5xx = Tap may retry)
  const summary = {
    delivered: deliveries.filter(
      (d) => d.status === "fulfilled" && d.value?.success,
    ).length,
    failed: deliveries.filter(
      (d) => d.status === "rejected" || !d.value?.success,
    ).length,
    total: matchingHooks.length,
  };

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
```

**Notes:**

- We use `Promise.allSettled` so one slow/failing webhook doesn't block others
- We always return 200 to Tap (individual failures are our problem, not Tap's)
- Each delivery attempt is logged to `events` table for debugging

### 2.2 Repo Registration: `POST /api/hooks/addRepo`

**File:** `convex/http.ts`

Machine-to-machine endpoint for developers to register repos.

```typescript
// POST /api/hooks/addRepo
httpAction(async (ctx, request) => {
  // 1. Auth: Bearer token in Authorization header
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token || token !== process.env.ADD_REPO_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Parse body
  const body = await request.json();
  const { repoDid } = body;

  if (!repoDid || typeof repoDid !== "string") {
    return new Response("Missing repoDid", { status: 400 });
  }

  // 3. Validate that this repo has at least one hook in our system
  // (prevents abuse — you can only register repos that belong to your users)
  const hasHook = await ctx.runQuery(internal.hooks.checkRepoHasHook, {
    repoDid,
  });

  if (!hasHook) {
    return new Response("No hooks found for this repo. Create a hook first.", {
      status: 400,
    });
  }

  // 4. Call Tap's /repos/add endpoint
  const tapUrl = `${process.env.TAP_BASE_URL}/repos/add`;
  const tapResponse = await fetch(tapUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAP_ADMIN_TOKEN}`,
    },
    body: JSON.stringify({ repo: repoDid }),
  });

  if (!tapResponse.ok) {
    const errorText = await tapResponse.text();
    console.error("Tap /repos/add failed:", errorText);
    return new Response(`Tap error: ${tapResponse.status}`, { status: 502 });
  }

  // 5. Record the registration in our DB
  await ctx.runMutation(internal.repos.registerRepo, {
    repoDid,
    registeredBy: body.registeredBy || "unknown", // optional field for tracking
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
```

**Auth design for Phase 2:** Simple shared secret in env var. Phase 3 will add per-user API keys.

---

## 3. Convex Internal Functions

### 3.1 Hook Queries

**File:** `convex/hooks.ts` (add to existing)

```typescript
// Find all active hooks for a given NSID
export const findHooksByNsid = internalQuery({
  args: { nsid: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("hooks"),
      userId: v.string(),
      webhookUrl: v.string(),
      isActive: v.boolean(),
    }),
  ),
  handler: async (ctx, { nsid }) => {
    return await ctx.db
      .query("hooks")
      .withIndex("by_nsid", (q) => q.eq("nsid", nsid))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// Check if a repo has any hooks in our system
export const checkRepoHasHook = internalQuery({
  args: { repoDid: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { repoDid }) => {
    // This is a simplified check — in reality we might want to scan
    // for hooks by collection, but for now we just check if there's
    // any hook that could match this repo
    const hooks = await ctx.db.query("hooks").collect();
    return hooks.length > 0; // Simplified: assume any hook could match
  },
});
```

### 3.2 Event Logging

**File:** `convex/events.ts` (new file)

```typescript
export const logEvent = internalMutation({
  args: {
    hookId: v.id("hooks"),
    userId: v.string(),
    nsid: v.string(),
    repo: v.string(),
    collection: v.string(),
    rkey: v.optional(v.string()),
    action: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("delete"),
    ),
    webhookUrl: v.string(),
    requestBody: v.string(),
    responseStatus: v.optional(v.number()),
    responseBody: v.optional(v.string()),
    durationMs: v.number(),
    success: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("events", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

// Get recent events for a hook
export const getEventsForHook = query({
  args: {
    hookId: v.id("hooks"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { hookId, limit = 50 }) => {
    return await ctx.db
      .query("events")
      .withIndex("by_hook", (q) => q.eq("hookId", hookId))
      .order("desc")
      .take(limit);
  },
});
```

### 3.3 Repo Registration

**File:** `convex/repos.ts` (new file)

```typescript
export const registerRepo = internalMutation({
  args: {
    repoDid: v.string(),
    registeredBy: v.string(),
  },
  handler: async (ctx, { repoDid, registeredBy }) => {
    // Check if already registered
    const existing = await ctx.db
      .query("repoRegistrations")
      .withIndex("by_repo", (q) => q.eq("repoDid", repoDid))
      .first();

    if (existing) {
      // Update lastSeenAt
      await ctx.db.patch(existing._id, {
        lastSeenAt: Date.now(),
      });
      return existing._id;
    }

    // Insert new registration
    return await ctx.db.insert("repoRegistrations", {
      repoDid,
      registeredBy,
      registeredAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  },
});
```

---

## 4. Environment Variables

Add these to `.env.local` and document in README:

```bash
# Tap configuration
TAP_BASE_URL=https://your-tap-instance.up.railway.app
TAP_WEBHOOK_SECRET=random-secret-shared-with-tap  # Used to verify events from Tap
TAP_ADMIN_TOKEN=admin-token-from-tap             # Used for /repos/add calls

# Machine-to-machine auth for /hooks/addRepo
ADD_REPO_SECRET=another-random-secret            # Phase 2: shared secret
```

---

## 5. UI Updates

### 5.1 Hook Detail Page — Event Log

**File:** `app/routes/hooks/$hookId.tsx` (or similar)

Add an event log section to the hook detail view:

```tsx
// Component showing recent deliveries for this hook
function EventLog({ hookId }: { hookId: string }) {
  const events = useQuery(api.events.getEventsForHook, { hookId, limit: 50 });

  if (!events) return <Skeleton />;

  return (
    <div class="space-y-2">
      <h3 class="text-lg font-semibold">Recent Events</h3>

      {events.length === 0 ? (
        <p class="text-gray-500">No events received yet.</p>
      ) : (
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr>
                <th>Time</th>
                <th>Repo</th>
                <th>Action</th>
                <th>Status</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              <For each={events}>
                {(event) => (
                  <tr class={event.success ? "" : "bg-red-50"}>
                    <td>{formatTime(event.timestamp)}</td>
                    <td class="font-mono text-xs">{event.repo}</td>
                    <td>{event.action}</td>
                    <td>
                      {event.success ? (
                        <span class="text-green-600">
                          ✓ {event.responseStatus}
                        </span>
                      ) : (
                        <span class="text-red-600">
                          ✗ {event.error || event.responseStatus}
                        </span>
                      )}
                    </td>
                    <td>{event.durationMs}ms</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

### 5.2 Developer Docs in UI

Add a "Getting Started" or "API Reference" page explaining:

1. **How to register repos:**

   ```bash
   curl -X POST https://community-tap.convex.site/api/hooks/addRepo \
     -H "Authorization: Bearer YOUR_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"repoDid": "did:plc:xyz"}'
   ```

2. **What to expect:** Events will be delivered to your webhook URL

3. **Payload format:**
   ```json
   {
     "repo": "did:plc:xyz",
     "collection": "app.bsky.feed.post",
     "rkey": "123",
     "action": "create",
     "record": { ... },
     "time_us": 1234567890
   }
   ```

---

## 6. Local Development Setup

### 6.1 Running Tap Locally

Since Tap is a Go binary from the [indigo](https://github.com/bluesky-social/indigo) repo, you can run it locally:

```bash
# Build or download the Tap binary
# From the indigo repo:
go build ./cmd/tap

# Run Tap locally with minimal config
# Uses SQLite (persistent file) for repo metadata
./tap \
  --api-listen=localhost:8080 \
  --db-path=./tap.db \
  --relay-host=wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos

# Tap will now connect to the Bluesky firehose and expose:
# - Admin API at POST /repos/add (for registering repos)
```

### 6.2 Connecting Tap to Local Community Tap

This app exposes an incoming webhook endpoint that Tap POSTs to:

**Community Tap endpoint (incoming from Tap):**
```
POST http://localhost:5173/api/tap/events
```

Configure Tap to send webhooks to this endpoint using the `--webhook-url` flag or environment variable:

```bash
# When starting Tap, point it at your local Community Tap instance
./tap \
  --api-listen=localhost:8080 \
  --db-path=./tap.db \
  --webhook-url=http://localhost:5173/api/tap/events \
  --webhook-secret-header=x-tap-secret \
  --webhook-secret-value=your-secret-here
```

### 6.3 Testing Without Tap

Mock Tap events with curl to test the fan-out logic:

```bash
curl -X POST http://localhost:5173/api/tap/events \
  -H "Content-Type: application/json" \
  -H "X-Tap-Secret: test-secret" \
  -d '{
    "repo": "did:plc:test",
    "collection": "app.bsky.feed.post",
    "rkey": "test123",
    "action": "create",
    "record": {"text": "Hello world"},
    "time_us": 1234567890
  }'
```

### 6.4 Full Local Dev Flow

**Three services running locally:**

```
┌─────────────┐      ┌──────────────────┐      ┌──────────────┐
│   Tap       │      │ Community Tap    │      │ User Webhook │
│             │      │                  │      │ (your test   │
│ localhost:  │──────→ localhost:5173  │──────→ endpoint)    │
│ 8080        │      │ /api/tap/events  │      │              │
└─────────────┘      └──────────────────┘      └──────────────┘
   ↑                       ↑
   │                       │
   └─ Bluesky firehose     └─ Convex (http://localhost:32123)
```

**Steps:**

```bash
# Terminal 1: Start Convex dev server
npx convex dev

# Terminal 2: Start Vite dev server (includes Convex httpAction)
npm run dev

# Terminal 3: Start Tap locally, pointed at Community Tap
./tap \
  --api-listen=localhost:8080 \
  --db-path=./tap.db \
  --webhook-url=http://localhost:5173/api/tap/events \
  --webhook-secret-header=x-tap-secret \
  --webhook-secret-value=your-secret-here
```

**Test the flow:**

1. Open http://localhost:5173, sign in with AT Proto OAuth
2. Create a hook in the UI (specify NSID + your test webhook URL)
3. Register a repo: `curl -X POST http://localhost:5173/api/hooks/addRepo -H "Authorization: Bearer SECRET" -d '{"repoDid": "did:plc:xyz"}'`
4. Wait for Tap to receive firehose events for that repo
5. Tap POSTs to Community Tap at `/api/tap/events`
6. Community Tap fans out to your webhook URL

### 6.2 Webhook Testing Endpoint

Provide a simple test webhook for developers to see what payloads look like:

```bash
# Use webhook.site or similar during development
```

---

## 7. Implementation Checklist

- [ ] Update `convex/schema.ts` with new fields and indexes
- [ ] Create `convex/events.ts` with `logEvent` mutation
- [ ] Create `convex/repos.ts` with `registerRepo` mutation
- [ ] Add `findHooksByNsid` and `checkRepoHasHook` queries to `convex/hooks.ts`
- [ ] Implement `POST /api/tap/events` in `convex/http.ts`
- [ ] Implement `POST /api/hooks/addRepo` in `convex/http.ts`
- [ ] Add environment variables to `.env.local` template
- [ ] Add event log component to hook detail page
- [ ] Add developer documentation page
- [ ] Test webhook delivery end-to-end
- [ ] Verify event logging works correctly
- [ ] Document the `/hooks/addRepo` API for developers

---

## 8. Dependencies & Assumptions

**Dependencies:**

- Phase 1 must be complete (hooks stored in Convex and PDS)
- A running Tap instance must be available (external to this repo)

**Key assumptions:**

- Shared secret auth is acceptable for Phase 2 (upgraded to API keys in Phase 3)
- Manual repo registration is acceptable (no auto-discovery)
- We don't handle backfill in this phase (Tap handles that when repo is added)
- Simple timeout on webhooks (no sophisticated retry logic yet)

---

## 9. Open Questions to Resolve

1. **Webhook timeout:** What timeout should we use? (suggest: 30s default)
2. **Payload size:** Should we truncate large payloads? (suggest: yes, 100KB limit)
3. **Event retention:** How long to keep events? (suggest: 30 days, cleanup job in Phase 3)
4. **Batching:** Should we batch events to the same webhook? (suggest: no, keep simple for now)
