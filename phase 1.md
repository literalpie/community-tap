## Phase 1 Detailed Plan

---

### 1. Convex Schema

Define three tables in `convex/schema.ts`:

```
hooks
  userDid        string   (indexed)
  nsid           string
  webhookUrl     string
  pdsUri         string   (AT-URI, e.g. at://did:plc:xxx/com.communitytap.hook/rkey)
  pdsCid         string
  createdAt      number
  enabled        boolean  (default true — will be used in Phase 3)

users
  did            string   (indexed, unique)
  handle         string
  lastSeen       number

events           (stub only — empty for now, Phase 2 fills it)
```

Indexes needed on `hooks`: by `userDid`, and a compound `(userDid, nsid)` for duplicate detection.

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

The `key: "tid"` means the AT Proto server auto-generates a TID rkey — no need to manage keys yourself.

---

### 3. Convex Functions

**Queries:**

- `hooks.listByUser(userDid)` — returns all hooks for the authed user, ordered by `createdAt` desc
- `hooks.getByUri(pdsUri)` — used during sync to check existence

**Mutations:**

- `hooks.upsert({ userDid, nsid, webhookUrl, pdsUri, pdsCid })` — insert or update by `pdsUri`; used by both creation flow and sync
- `hooks.deleteByUri(pdsUri)` — delete by AT-URI
- `hooks.deleteAllForUser(userDid)` — used during full sync reconciliation
- `users.upsert({ did, handle })` — called on login to keep the users table current

All mutations should validate that the calling user's DID matches `userDid` (i.e. don't trust the client to pass their own DID unchecked — enforce it server-side via the Convex auth context).

---

### 4. PDS Interaction Layer

Create a client-side helper module (e.g. `src/lib/pds.ts`) wrapping the AT Proto agent. Three operations:

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
- Returns array of `{ uri, cid, value }` — handles pagination if >100 records exist

---

### 5. Hook Creation Flow

The create action is a two-step commit — PDS first, then Convex:

```
1. Validate inputs (NSID format regex: /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/, URL validity)
2. Check Convex for duplicate (userDid + nsid) — reject early
3. Write to PDS → get back { uri, cid }
4. Write to Convex via hooks.upsert
5. On any failure in step 4, attempt PDS rollback (deleteRecord) and surface error
```

The PDS-first ordering means Convex is always a mirror — the PDS is authoritative. If step 4 fails and rollback also fails, the sync button recovers it.

---

### 6. Hook Deletion Flow

Mirror of creation, but PDS delete is attempted first:

```
1. Call deleteHookRecord(agent, uri)
2. Call hooks.deleteByUri(uri) in Convex
3. If PDS delete fails, surface error and don't touch Convex
4. If Convex delete fails after PDS succeeds, log warning — sync will clean it up
```

---

### 7. Sync-from-PDS Flow

Triggered manually via the "Sync from AT Proto" button:

```
1. Call listHookRecords(agent) — get all PDS records
2. Call hooks.listByUser(userDid) from Convex — get current mirror state
3. Diff:
   - PDS records not in Convex → upsert into Convex
   - Convex records not in PDS → delete from Convex
   - Records in both but CID differs → upsert (record was edited externally)
4. Show result summary: "Added 2, removed 1, updated 0"
```

This handles all drift scenarios: external edits via a Bluesky client, failed creates, failed deletes.

---

### 8. UI

Three views, all within the authenticated shell:

**Dashboard (`/dashboard`)**

- Header row: "Your hooks" + "Add hook" button + "Sync" button with last-sync timestamp
- Hook list: table or card list showing NSID, truncated webhook URL, created date, enabled badge
- Empty state with a prompt to add the first hook
- Each row has a delete button (with confirm dialog — no undo)

**New Hook Form (modal or `/dashboard/new`)**

- NSID field with format validation on blur, example placeholder (`app.bsky.feed.post`)
- Webhook URL field with URL validation
- Submit button shows loading state during the two-step PDS+Convex write
- Error states for: duplicate NSID, invalid format, PDS write failure

**Hook Detail (`/dashboard/hooks/:rkey` — optional for Phase 1)**

- Shows full webhook URL (not truncated), NSID, AT-URI, created date
- Delete button
- In Phase 2 this page gains the event log

---

### 9. Implementation Order

1. Convex schema + stub mutations/queries (no auth enforcement yet, add that second)
2. Lexicon file
3. `pds.ts` helper with `createHookRecord` + `listHookRecords` + `deleteHookRecord`
4. `users.upsert` call on login so the users table populates from day one
5. Hook creation: form → PDS → Convex (happy path first, then error handling)
6. Dashboard list (reads from Convex)
7. Hook deletion
8. Sync flow
9. Auth enforcement on all Convex mutations
10. Input validation polish + empty/loading/error states throughout

---

### Key Decision Points to Resolve Before Starting

- **Where does the AT Proto agent live?** It's likely already in a context/store from the OAuth scaffold — confirm the API for getting a ready agent in a SolidJS component vs. a TanStack action.
- **Convex auth identity:** Confirm the Convex auth is configured to extract the user's DID from the AT Proto JWT so mutations can enforce `ctx.auth.subject === userDid`.
- **NSID validation strictness:** Decide whether to validate that the NSID is a real, registered lexicon or just syntactically valid. Syntactic-only is fine for Phase 1 — Phase 2 will surface bad NSIDs naturally when Tap finds no events.
