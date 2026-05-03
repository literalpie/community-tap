import { createFileRoute } from '@tanstack/solid-router'

const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL || 'http://localhost:3000'
const PRIVATE_KEY = import.meta.env.PRIVATE_KEY

export const Route = createFileRoute('/oauth/client-metadata/json')({
  server: {
    handlers: {
      GET: async () => {
        if (PUBLIC_URL && PRIVATE_KEY) {
          return new Response(
            JSON.stringify({
              client_id: `${PUBLIC_URL}/oauth/client-metadata.json`,
              client_name: 'Community Tap',
              client_uri: PUBLIC_URL,
              redirect_uris: [`${PUBLIC_URL}/oauth/callback`],
              grant_types: ['authorization_code', 'refresh_token'],
              response_types: ['code'],
              scope: 'atproto repo:community.tap',
              token_endpoint_auth_method: 'private_key_jwt',
              token_endpoint_auth_signing_alg: 'ES256',
              jwks_uri: `${PUBLIC_URL}/jwks.json`,
              dpop_bound_access_tokens: true,
            }),
            { headers: { 'Content-Type': 'application/json' } }
          )
        }

        return new Response(JSON.stringify({}), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
