# Background

## AT Protocol (AT Proto)

AT Proto is the open, federated social protocol underlying Bluesky

## Tap

Tap is a self-hosted Go service that acts as a structured, webhook-friendly consumer of the AT Proto firehose. Agents may not know about it — it was introduced in early 2025 and is less well-known than the raw firehose or Jetstream.
Key things to understand:

- Tap connects to the AT Proto relay firehose and filters it down to collections (lexicon NSIDs) you care about
- Instead of requiring you to maintain a persistent WebSocket connection in your app, Tap delivers events to your app via outbound webhooks — your app just needs an HTTP endpoint
- Tap uses SQLite by default for storing repo metadata, meaning it needs persistent disk (not ephemeral hosting)
- Collection signal mode is the key feature for this project: you tell Tap "watch for any repo that contains a record of type com.example.mylex.record" and it auto-discovers and tracks those repos across the whole network
- When Tap first encounters a new repo, it automatically backfills that repo's history before delivering live events
- Tap exposes an admin API for dynamically adding repos and collections to watch
- The official deploy guide targets Railway specifically
- Tap's throughput is extremely high (tens of thousands of events/sec) — the bottleneck in any real deployment is outbound webhook delivery, not Tap itself
- Repo: github.com/bluesky-social/indigo (Tap is part of the Indigo monorepo)

## This Project's Architecture

Community Tap is a multi-tenant managed Tap service. Instead of every AT Proto developer running their own Tap instance, they register their lexicon NSID and a webhook URL with Community Tap, and events are delivered to them automatically. One shared Tap instance serves all users. The key design points an agent needs to internalize:

- Tap → Convex httpAction → per-user webhooks is the delivery chain
- User hook config lives in the user's own PDS repo as com.communitytap.hook records — Convex mirrors this for fast querying but the PDS is the source of truth for user intent
- Convex is the runtime layer: fan-out logic, event log, usage tracking, and limit enforcement all live there
- AT Proto OAuth is the only auth mechanism — no separate accounts
- The frontend is SolidJS + TanStack Start, deployed to community-tap.netlify.app

# Build Plan

## Architecture Overview

```
User's PDS (com.communitytap.hook records)
        ↕ sync
    Convex DB ←── Frontend (SolidJS + TanStack Start) [scaffold done]
        ↑
  Tap (Railway) ──→ Convex httpAction (fan-out) ──→ User webhooks
```

**Starting point:** SolidJS + TanStack Start frontend with AT Proto OAuth and Convex already scaffolded.

---

## Phase 1 — UI + Hook Registration

Build the full UI and wire hook config to both PDS and Convex. No event delivery yet — just CRUD.

- Define Convex schema: `hooks`, `users`, `events`
- Define the `com.communitytap.hook` lexicon record type
- UI: dashboard listing user's hooks, new hook form (NSID + webhook URL), hook detail/delete
- Hook creation writes to user's PDS first, syncs record URI to Convex
- Hook deletion removes from PDS and Convex
- "Sync from AT Proto" button to reconcile drift between PDS and Convex

---

## Phase 2 — Event Delivery

Deploy Tap and wire up the fan-out. Hooks start doing something.

- Deploy Tap on Railway with persistent volume (SQLite)
- Convex `httpAction` receives events from Tap, looks up matching hooks, delivers to user webhooks via `Promise.allSettled`
- Log every delivery attempt to the `events` table
- When a hook is registered, call Tap's admin API to add the NSID to its watch list
- Surface recent event log per hook in the UI

---

## Phase 3 — Limits + Robustness

Make it safe to open publicly.

- Enforce limits derived from the `events` table: 1000 events/day and 50 events/minute per user
- When a limit is hit: pause delivery, show warning in UI
- Per-hook webhook timeout cap so slow endpoints don't block others
- Admin view (your DID only): all users, hook counts, pause/unpause
- Public landing page + README
