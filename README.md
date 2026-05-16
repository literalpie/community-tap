# Community Tap

Webhook delivery for AT Proto firehose events. Register a lexicon NSID, provide a webhook URL, and receive firehose events automatically.

## Prerequisites

- Node.js 20+
- `pnpm`
- A [Convex](https://convex.dev) account (free tier works)
- A [Tap](https://github.com/atproto/tap) instance (or use a hosted one)

## Setup

```bash
pnpm install
```

Copy the environment template and fill in the values:

```bash
cp .env.example .env.local
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CONVEX_DEPLOYMENT` | yes | Your Convex deployment name (set by `pnpm convex dev`) |
| `VITE_CONVEX_URL` | yes | Your Convex HTTP endpoint (found in Convex dashboard) |
| `CONVEX_SERVER_SECRET` | yes | Shared secret between TanStack and Convex — set to any random string; must match in both environments |
| `COMMUNITY_TAP_SERVICE_ID` | yes | Used to scope hook records to this instance (e.g. `my.community-tap`) |
| `VITE_PUBLIC_URL` | production | Public URL for OAuth client metadata |
| `PRIVATE_KEY` | production | ES256 private JWK for OAuth `private_key_jwt` auth (generate with `pnpm gen-key`) |
| `TAP_BASE_URL` | yes | URL of your Tap instance |
| `TAP_ADMIN_PASSWORD` | yes | Admin password for your Tap instance |
| `TAP_WEBHOOK_SECRET` | yes | Secret shared with Tap for outbound event delivery |

### Run Convex

In a separate terminal:

```bash
pnpm dlx convex dev
```

This will:
- Start the Convex dev server
- Apply the schema (creates tables: `hooks`, `users`, `events`, `repoRegistrations`, etc.)
- Prompt you to link your Convex project (follow the prompts)

After linking, note your `VITE_CONVEX_URL` from the Convex dashboard or the convex dev output.

Set the Convex server secret so Convex functions can validate the TanStack server:

```bash
npx convex env set CONVEX_SERVER_SECRET <your-secret>
```

### Run the App

```bash
pnpm dev
```

Opens at `http://localhost:3000`. Login with your AT Proto handle (e.g. Bluesky username) to create hooks and receive events.

## Architecture

```
Browser (SolidJS) ←→ TanStack Start (Nitro/Node) ←→ Convex (database + functions)
                                              ←→ Tap (firehose event delivery)
                                              ←→ PDS (hook record storage)
```

- **TanStack Start** is the backend-for-frontend. All authenticated requests go through server functions that verify the AT Proto OAuth session cookie before calling Convex.
- **Convex** is the database and function runtime. Sensitive functions require `CONVEX_SERVER_SECRET` to prove the call originated from TanStack server code.
- **Tap** delivers firehose record events to `/api/tap-events`.
- **PDS** stores hook records as AT Proto documents. The app reads/writes hooks through the user's authenticated PDS session.

## API

### Register a Repo

```
POST /api/hooks/addRepo
Authorization: Bearer <addRepoApiKey>
Content-Type: application/json

{
  "repoDid": "did:plc:abc123",
}
```

The API key is generated per-user in the dashboard. The user must have an active, unpaused hook for the submitted NSID.

## Limits

- 1000 delivery attempts/day per user, reset at midnight UTC
- 50 delivery attempts/minute per user, reset at top of each minute
- Failed and timed-out deliveries count toward the limit
- When a limit is reached, the user's hooks are paused until the window resets
- Admin-paused hooks are not auto-resumed

## Webhook Delivery

Events are delivered as POST requests with the raw Tap event as the JSON body.

### Headers

| Header | Description |
|---|---|
| `X-Community-Tap-Event` | Always `true` |
| `X-Community-Tap-Nsid` | The collection/NSID of the record |
| `X-Community-Tap-Timestamp` | Unix milliseconds |
| `X-Community-Tap-Signature` | HMAC-SHA256 signature (if signing secret is configured) |

### Signature Verification

If the hook owner has configured a webhook signing secret, deliveries include a signature header:

```
X-Community-Tap-Signature: sha256=<hex>
```

To verify:

```ts
import { createHmac } from "node:crypto";

const parts = signatureHeader.split("=");
if (parts[0] !== "sha256") throw new Error("Unknown algorithm");
const expected = createHmac("sha256", signingSecret)
  .update(`${timestamp}.${rawBody}`)
  .digest("hex");
if (parts[1] !== expected) throw new Error("Invalid signature");
```

## Development

```bash
pnpm dev        # Start dev server at localhost:3000
pnpm lint       # Run oxlint
pnpm format     # Format with oxfmt
pnpm check      # Lint + format check
pnpm gen-key    # Generate an ES256 key for production OAuth
```

## Deployment

This project uses Nitro for server-side rendering. Build for production:

```bash
pnpm build
```

The output in `.output/` is a self-contained Node.js server. Set all environment variables (including `CONVEX_SERVER_SECRET`) on your hosting platform.

See [Nitro deployment docs](https://v3.nitro.build/deploy) for host-specific presets.
