import { createFileRoute } from '@tanstack/solid-router'
import { JoseKey } from '@atproto/oauth-client-node'

const PRIVATE_KEY = import.meta.env.PRIVATE_KEY

export const Route = createFileRoute('/jwks/json')({
  server: {
    handlers: {
      GET: async () => {
        if (!PRIVATE_KEY) {
          return new Response(JSON.stringify({ keys: [] }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const key = await JoseKey.fromJWK(JSON.parse(PRIVATE_KEY))
        return new Response(
          JSON.stringify({
            keys: [key.publicJwk],
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      },
    },
  },
})
