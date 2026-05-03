## Phase 1 Detailed Plan

---

### 1. Convex Schema

Define three tables in `convex/schema.ts`:

```
hooks
  userDid      string   (indexed)
  nsid         string
  webhookUrl   string
  pdsUri       string   (indexed, unique — AT-URI is the stable identity)
  createdAt    number
  enabled      boolean  (default true — used in Phase 3)

users
  did          string   (indexed, unique)
  handle       string
  lastSeen     number

events         (stub only — empty for now, Phase 2 fills it)
```

Indexes on `hooks`: `by_userDid`, `by_pdsUri` (unique), `by_userDid_nsid` (unique — enforces one webhook per NSID per user at the DB level, not just application level).

---

### 2. Lexicon Definition

Create `lexicons/com/communitytap/hook.json`:

```json
{
  "lexicon": 1,
  "id": "com.communitytap.hook",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["nsid", "webhookUrl", "createdAt"],
        "properties": {
          "nsid": { "type": "string" },
          "webhookUrl": { "type": "string", "format": "uri" },
          "createdAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

`key: "tid"` means the AT Proto server auto-generates a TID rkey — no key management needed.

---

### 3. Convex Functions

**Queries:**

- `hooks.listByUser(userDid)` — returns all hooks for the authed user, ordered by `createdAt` desc
- `hooks.getByUri(pdsUri)` — used during sync to check existence

**Mutations:**

- `hooks.upsert({ userDid, nsid, webhookUrl, pdsUri })` — insert or update by `pdsUri`; used by both creation flow and sync
- `hooks.deleteByUri(pdsUri)` — delete by AT-URI
- `users.upsert({ did, handle })` — called on login to keep the users table current

All mutations enforce that the calling user's DID matches `userDid` via the Convex auth context — don't trust the client to pass their own DID unchecked.

---

### 4. PDS Interaction Layer

Create `src/lib/pds.ts` wrapping the AT Proto agent. Three operations:

**`createHookRecord(agent, { nsid, webhookUrl })`**

- Calls `agent.api.com.atproto.repo.createRecord` with:
  - `repo`: user's DID
  - `collection`: `"com.communitytap.hook"`
  - `record`: `{ nsid, webhookUrl, createdAt: new Date().toISOString() }`
- Returns `{ uri, cid }`

**`deleteHookRecord(agent, uri)`**

- Parses rkey from the AT-URI
- Calls `agent.api.com.atproto.repo.deleteRecord` with `repo`, `collection`, `rkey`

**`listHookRecords(agent)`**

- Calls `agent.api.com.atproto.repo.listRecords` with `collection: "com.communitytap.hook"`, `limit: 100`
- Returns array of `{ uri, value }`
- Known limitation: assumes <100 hooks per user; acceptable given Phase 3 will enforce a much lower per-user hook cap anyway

---

### 5. Hook Creation Flow

Two-step commit — PDS first, then Convex:

```
1. Validate inputs client-side:
     - NSID format: /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/
     - Webhook URL: valid URI
2. Check Convex for duplicate (userDid + nsid) — reject early with
   "You already have a hook for this NSID. Delete it first to change the webhook URL."
3. Write to PDS → get back { uri, cid }
4. Write to Convex via hooks.upsert
5. If step 4 fails: attempt PDS rollback (deleteRecord) and surface error to user
   If rollback also fails: surface error — sync button will recover
```

PDS-first ordering keeps Convex as a mirror with the PDS as the source of truth.

---

### 6. Hook Deletion Flow

PDS delete first, then Convex:

```
1. Call deleteHookRecord(agent, uri)
2. Call hooks.deleteByUri(uri) in Convex
3. If PDS delete fails: surface error, don't touch Convex
4. If Convex delete fails after PDS succeeds: log warning — sync will clean it up
```

---

### 7. Sync-from-PDS Flow

Triggered manually via the "Sync from AT Proto" button. Pure set diff — no CID comparison needed since hook records are immutable (NSID and webhook URL cannot be edited; changing either requires delete-and-recreate):

```
1. Call listHookRecords(agent) → set of PDS URIs + their values
2. Call hooks.listByUser(userDid) from Convex → set of Convex URIs
3. Diff by URI:
   - In PDS but not Convex → upsert into Convex
   - In Convex but not PDS → deleteByUri from Convex
4. Show result summary: "Added 2, removed 1"
```

Handles all real drift scenarios: failed creates, failed deletes, external edits made via another client (which manifest as a delete+new URI, caught by the diff).

---

### 8. UI

**Dashboard (`/dashboard`)**

- Header: "Your hooks" + "Add hook" button + "Sync" button with last-sync timestamp
- Hook list: table or card list showing NSID, truncated webhook URL, created date, enabled badge
- Empty state with prompt to add first hook
- Each row has a delete button with confirm dialog

**New Hook Form (modal or `/dashboard/new`)**

- NSID field with format validation on blur, example placeholder (`app.bsky.feed.post`)
- Webhook URL field with URL validation
- Submit shows loading state during two-step write
- Error states: duplicate NSID (with specific message above), invalid format, PDS write failure

**Hook Detail (`/dashboard/hooks/:rkey` — optional for Phase 1)**

- Full webhook URL, NSID, AT-URI, created date
- Delete button
- Gains event log in Phase 2

---

### 9. Implementation Order

1. Convex schema + stub mutations/queries
2. Lexicon file
3. `pds.ts` helper (`createHookRecord`, `listHookRecords`, `deleteHookRecord`)
4. `users.upsert` call on login
5. Hook creation: form → PDS → Convex (happy path first, then error handling)
6. Dashboard list (reads from Convex)
7. Hook deletion
8. Sync flow
9. Auth enforcement on all Convex mutations
10. Input validation polish + empty/loading/error states throughout

---

### Key Decision Points to Resolve Before Starting

- **AT Proto agent access:** Confirm how to get a ready agent in a SolidJS component vs. a TanStack action — likely already established in the OAuth scaffold.
- **Convex auth identity:** Confirm Convex auth is configured to extract the user's DID from the AT Proto JWT so mutations can enforce `ctx.auth.subject === userDid`.
- **NSID validation strictness:** Syntactic validation only for Phase 1. Bad NSIDs will surface naturally in Phase 2 when Tap finds no matching events.
