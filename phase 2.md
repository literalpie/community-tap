# Phase 2 — Event Delivery

> **Scope:** Code changes in this repository only. Tap runs externally.

## What We Built

### Architecture

```
Tap (external) ──→ TanStack Start API route ──→ Convex (storage) ──→ User webhooks
                    /api/tap-events           /api/hooks/addRepo
```

### TanStack Start Routes

**1. `/api/tap-events`** — Receives events from Tap, delivers to matching hooks

- Uses `@atproto/tap` types (`parseTapEvent`, `TapEvent`) for strong typing
- Queries Convex for hooks matching by collection NSID
- Fans out to user webhooks with original Tap event payload
- Logs delivery results to Convex

**2. `/api/hooks/addRepo`** — Registers repos with Tap

- Uses `@atproto/tap` client to call `tap.addRepos([repoDid])`
- Stores registration in Convex

### Convex Schema

```typescript
hooks: defineTable({
  userId: v.string(),
  nsid: v.string(),
  webhookUrl: v.string(),
  recordUri: v.string(),
  isActive: v.boolean(),
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_nsid", ["nsid"]);

events: defineTable({
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
  timestamp: v.number(),
});

repoRegistrations: defineTable({
  repoDid: v.string(),
  registeredBy: v.string(),
  registeredAt: v.number(),
  lastSeenAt: v.number(),
});
```

### Local Development

```bash
# Terminal 1: Convex
npx convex dev

# Terminal 2: Vite dev server
npm run dev

# Terminal 3: Tap
$(go env GOPATH)/bin/tap run \
  --webhook-url=http://localhost:3000/api/tap-events \
  --collection-filters=app.bsky.feed.post
```

### Testing

```bash
# Test tap-events endpoint
curl -X POST http://localhost:3000/api/tap-events \
  -H "Content-Type: application/json" \
  -d '{"type":"record","record":{"collection":"app.bsky.feed.post","did":"did:plc:abc","rkey":"123","action":"create","record":{"text":"hello"}}}'

# Test addRepo endpoint
curl -X POST http://localhost:3000/api/hooks/addRepo \
  -H "Content-Type: application/json" \
  -d '{"repoDid": "did:plc:abc"}'
```

### Key Decisions

1. **TanStack Start server handlers** instead of Convex httpActions — Allows using `@atproto/tap` client directly (needs Node.js runtime)

2. **Pass-through raw events** — Don't transform the Tap payload, preserve original format for user webhooks

3. **Use `@atproto/tap` types internally** — Strong typing for our code while letting users receive raw events

4. **No auth for user webhooks** — Each user secures their own endpoint; Community Tap just delivers
